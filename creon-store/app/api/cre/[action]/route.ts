import { NextRequest, NextResponse } from "next/server";

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
  if (action === "purchase") {
    return NextResponse.json(
      { error: "use /api/cre/purchase route for x402-gated purchases" },
      { status: 400 },
    );
  }

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
