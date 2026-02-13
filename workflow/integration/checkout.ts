import {
  ConsensusAggregationByFields,
  HTTPClient,
  identical,
  median,
  type Runtime,
} from "@chainlink/cre-sdk";
import { z } from "zod";
import { optionalSetting } from "../lib/env";
import { logStep } from "../lib/log";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
const toBase64 = (input: Uint8Array): string => Buffer.from(input).toString("base64");

const settleResponseSchema = z.object({
  ok: z.boolean(),
  settlementTxHash: z.string().min(1),
  quoted: z
    .object({
      grossAmount: z.string().optional(),
      feeAmount: z.string().optional(),
      merchantNetAmount: z.string().optional(),
    })
    .optional(),
});

type HttpJsonRequest = {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
};

type HttpTextResponse = {
  statusCode: number;
  body: string;
};

const readJson = (body: string): unknown => {
  if (!body.trim()) return {};
  return JSON.parse(body);
};

const getSettleConfig = (runtime: Runtime<unknown>) => ({
  url: optionalSetting(runtime, "COMMERCE_CHECKOUT_SETTLE_API_URL", "http://localhost:3000/api/checkout/settle"),
  apiKey: optionalSetting(runtime, "COMMERCE_CHECKOUT_SETTLE_API_KEY", ""),
});

export const settleViaCheckout = (
  runtime: Runtime<unknown>,
  input: {
    intentId: string;
    productId: string;
    merchant: string;
    buyer: string;
    merchantNetAmount: number;
  },
): z.infer<typeof settleResponseSchema> => {
  const { url, apiKey } = getSettleConfig(runtime);
  const httpClient = new HTTPClient();
  const sendHttp = httpClient.sendRequest<[HttpJsonRequest], HttpTextResponse>(
    runtime,
    (sendRequester, request): HttpTextResponse => {
      const response = sendRequester.sendRequest(request).result();
      return {
        statusCode: response.statusCode,
        body: textDecoder.decode(response.body),
      };
    },
    ConsensusAggregationByFields({
      statusCode: median,
      body: identical,
    }),
  );

  logStep(runtime, "SETTLEMENT", "settlement call start");
  const response = sendHttp({
    url,
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(apiKey ? { "x-checkout-api-key": apiKey } : {}),
    },
    body: toBase64(
      textEncoder.encode(
        JSON.stringify({
          intentId: input.intentId,
          productId: input.productId,
          merchant: input.merchant,
          buyer: input.buyer,
          merchantNetAmount: input.merchantNetAmount.toString(),
        }),
      ),
    ),
  }).result();

  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(`checkout settle failed (${response.statusCode}): ${response.body}`);
  }

  logStep(runtime, "SETTLEMENT", "settlement call completed");
  return settleResponseSchema.parse(readJson(response.body));
};
