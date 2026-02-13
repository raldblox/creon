import { paymentProxyFromHTTPServer, x402HTTPResourceServer } from "@x402/next";
import { type HTTPRequestContext, HTTPFacilitatorClient, x402ResourceServer } from "@x402/core/server";
import { registerExactEvmScheme } from "@x402/evm/exact/server";
import { isAddress } from "viem";
import type { NextRequest } from "next/server";

const FACILITATOR_URL =
  process.env.X402_FACILITATOR_URL?.trim() || "https://x402.org/facilitator";
const NETWORK = "eip155:84532";
const DEFAULT_PRICE_USD = "0.01";

const payToAddress = process.env.AGENT_WALLET_ADDRESS?.trim() || "0x0000000000000000000000000000000000000000";

const isConfiguredAddress = (value: string): boolean =>
  isAddress(value) && value.toLowerCase() !== "0x0000000000000000000000000000000000000000";

const toUsdPriceString = (input: string): string => {
  const normalized = input.trim();
  if (!normalized) {
    return `$${DEFAULT_PRICE_USD}`;
  }
  if (!/^\d+(\.\d{1,6})?$/.test(normalized)) {
    throw new Error("invalid price query format");
  }
  const numeric = Number.parseFloat(normalized);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return `$${DEFAULT_PRICE_USD}`;
  }
  const clamped = Math.min(100_000, numeric);
  const formatted = clamped.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
  return `$${formatted}`;
};

const facilitatorClient = new HTTPFacilitatorClient({ url: FACILITATOR_URL });
const resourceServer = new x402ResourceServer(facilitatorClient)
  .onBeforeVerify(async (context) => {
    console.log("[X402] before verify", {
      network: context.requirements.network,
      scheme: context.requirements.scheme,
      payTo: context.requirements.payTo,
    });
  })
  .onAfterVerify(async (context) => {
    console.log("[X402] after verify", {
      isValid: context.result.isValid,
      payer: context.result.payer,
      invalidReason: context.result.invalidReason,
    });
  })
  .onVerifyFailure(async (context) => {
    console.log("[X402] verify failure", { error: String(context.error) });
  })
  .onBeforeSettle(async (context) => {
    console.log("[X402] before settle", {
      network: context.requirements.network,
      payTo: context.requirements.payTo,
    });
  })
  .onAfterSettle(async (context) => {
    console.log("[X402] after settle", {
      success: context.result.success,
      transaction: context.result.transaction,
      network: context.result.network,
      payer: context.result.payer,
    });
  })
  .onSettleFailure(async (context) => {
    console.log("[X402] settle failure", { error: String(context.error) });
  });

registerExactEvmScheme(resourceServer);

const httpServer = new x402HTTPResourceServer(resourceServer, {
  "/api/cre/purchase": {
    accepts: [
      {
        scheme: "exact",
        network: NETWORK,
        payTo: payToAddress,
        price: (context: HTTPRequestContext) => {
          const rawPrice = String(context.adapter.getQueryParam?.("price") ?? DEFAULT_PRICE_USD);
          return toUsdPriceString(rawPrice);
        },
      },
    ],
    description: "CREON purchase gateway for CRE workflow",
    mimeType: "application/json",
    unpaidResponseBody: async (context) => {
      const productId = String(context.adapter.getQueryParam?.("productId") ?? "");
      const price = String(context.adapter.getQueryParam?.("price") ?? DEFAULT_PRICE_USD);
      return {
        contentType: "application/json",
        body: {
          error: "payment required",
          network: NETWORK,
          productId,
          price,
          hint: "Retry with x402 PAYMENT-SIGNATURE header",
        },
      };
    },
  },
});

const proxyHandler = paymentProxyFromHTTPServer(httpServer);

export const proxy = async (request: NextRequest) => {
  const url = request.nextUrl;

  if (url.pathname === "/api/cre/purchase" && request.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "method not allowed", allowed: ["POST"] }),
      { status: 405, headers: { "content-type": "application/json" } },
    );
  }

  if (url.pathname === "/api/cre/purchase") {
    if (!isConfiguredAddress(payToAddress)) {
      return new Response(
        JSON.stringify({
          error: "gateway misconfigured: AGENT_WALLET_ADDRESS must be a non-zero EVM address",
        }),
        { status: 500, headers: { "content-type": "application/json" } },
      );
    }
    const productId = url.searchParams.get("productId")?.trim() ?? "";
    if (!productId) {
      return new Response(
        JSON.stringify({ error: "productId query is required" }),
        { status: 400, headers: { "content-type": "application/json" } },
      );
    }
  }

  return proxyHandler(request);
};

export const config = { matcher: ["/api/cre/purchase"] };
