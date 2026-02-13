import { NextRequest, NextResponse } from "next/server";

type VerifyResponse = {
  valid?: boolean;
  [key: string]: unknown;
};

const getPaymentHeader = (request: NextRequest): string =>
  request.headers.get("x-payment") ??
  request.headers.get("x-x402-payment") ??
  "";

const verifyX402IfConfigured = async (
  request: NextRequest,
  payload: unknown,
): Promise<NextResponse | null> => {
  const paymentHeader = getPaymentHeader(request);
  if (!paymentHeader) {
    return NextResponse.json(
      { error: "payment required", message: "x402 payment header missing" },
      { status: 402, headers: { "x-payment-required": "x402" } },
    );
  }

  const verifyUrl = process.env.X402_VERIFY_URL ?? "";
  if (!verifyUrl) {
    return null;
  }

  try {
    const verifyResponse = await fetch(verifyUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        payment: paymentHeader,
        request: {
          method: request.method,
          path: request.nextUrl.pathname,
        },
        payload,
      }),
      cache: "no-store",
    });

    if (!verifyResponse.ok) {
      return NextResponse.json(
        { error: "x402 verification failed", status: verifyResponse.status },
        { status: 402, headers: { "x-payment-required": "x402" } },
      );
    }

    const verifyBody = (await verifyResponse.json()) as VerifyResponse;
    if (verifyBody.valid !== true) {
      return NextResponse.json(
        { error: "x402 verification invalid", details: verifyBody },
        { status: 402, headers: { "x-payment-required": "x402" } },
      );
    }
  } catch (error) {
    return NextResponse.json(
      { error: `x402 verification error: ${String(error)}` },
      { status: 402, headers: { "x-payment-required": "x402" } },
    );
  }

  return null;
};

const forwardToCreWorkflow = async (workflowPayload: unknown): Promise<Response> => {
  const workflowUrl = process.env.CRE_WORKFLOW_URL ?? "";
  if (!workflowUrl) {
    return NextResponse.json(
      { error: "CRE_WORKFLOW_URL is required" },
      { status: 500 },
    );
  }

  const workflowKey = process.env.CRE_WORKFLOW_API_KEY ?? "";
  const response = await fetch(workflowUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(workflowKey ? { authorization: `Bearer ${workflowKey}` } : {}),
    },
    body: JSON.stringify(workflowPayload),
    cache: "no-store",
  });
  return response;
};

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ action: string }> },
) {
  const { action } = await context.params;
  const incoming = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const input =
    incoming.input && typeof incoming.input === "object"
      ? (incoming.input as Record<string, unknown>)
      : incoming;

  const workflowPayload = {
    input: {
      ...input,
      action,
    },
  };

  if (action === "purchase") {
    const verifyError = await verifyX402IfConfigured(request, workflowPayload);
    if (verifyError) {
      return verifyError;
    }
  }

  try {
    const response = await forwardToCreWorkflow(workflowPayload);
    const contentType = response.headers.get("content-type") ?? "application/json";
    const raw = await response.text();

    return new NextResponse(raw, {
      status: response.status,
      headers: {
        "content-type": contentType,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: `cre gateway forward failed: ${String(error)}` },
      { status: 502 },
    );
  }
}
