import {
  ConsensusAggregationByFields,
  HTTPClient,
  identical,
  median,
  type Runtime,
} from "@chainlink/cre-sdk";
import { z } from "zod";
import { optionalSetting, requireSetting } from "../lib/env";
import { logStep } from "../lib/log";
import {
  buildListingPolicyUserPrompt,
  LISTING_POLICY_SYSTEM_PROMPT,
} from "../lib/prompts/listingPolicy";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const classificationSchema = z.object({
  complianceFlags: z.array(z.string()).default([]),
  complianceDomains: z
    .array(
      z.enum([
        "financial_crime",
        "sanctions_trade",
        "ip_abuse",
        "malware_cybercrime",
        "deceptive_marketing",
        "consumer_protection",
      ]),
    )
    .default([]),
  evidence: z.array(z.string()).default([]),
  riskTier: z.enum(["low", "medium", "high"]),
  recommendedPolicy: z.enum(["allow", "review", "deny"]),
  confidence: z.number().min(0).max(1),
});

type ListingContext = {
  title: string;
  description: string;
  category?: string;
  pricing?: Record<string, unknown>;
  tags?: string[];
  merchant?: string;
};

const openAiResponseSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({
          content: z.string().nullable().optional(),
        }),
      }),
    )
    .min(1),
});

const strictOutputSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "complianceFlags",
    "complianceDomains",
    "evidence",
    "riskTier",
    "recommendedPolicy",
    "confidence",
  ],
  properties: {
    complianceFlags: {
      type: "array",
      items: { type: "string" },
    },
    complianceDomains: {
      type: "array",
      items: {
        type: "string",
        enum: [
          "financial_crime",
          "sanctions_trade",
          "ip_abuse",
          "malware_cybercrime",
          "deceptive_marketing",
          "consumer_protection",
        ],
      },
    },
    evidence: {
      type: "array",
      items: { type: "string" },
    },
    riskTier: { type: "string", enum: ["low", "medium", "high"] },
    recommendedPolicy: { type: "string", enum: ["allow", "review", "deny"] },
    confidence: { type: "number", minimum: 0, maximum: 1 },
  },
};

export type PolicyClassification = z.infer<typeof classificationSchema>;
type HttpJsonRequest = {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
  cacheSettings?: {
    store: boolean;
    maxAge: string;
  };
};

type HttpTextResponse = {
  statusCode: number;
  body: string;
};

const parseJsonBody = (body: Uint8Array | string): unknown => {
  const raw = typeof body === "string" ? body : textDecoder.decode(body);
  if (!raw.trim()) {
    throw new Error("empty response body");
  }

  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("invalid JSON response");
  }
};

const getOpenAIConfig = (runtime: Runtime<unknown>) => ({
  apiKey: requireSetting(runtime, "OPENAI_API_KEY"),
  model: optionalSetting(runtime, "OPENAI_MODEL", "gpt-4o-mini"),
  baseUrl: optionalSetting(runtime, "OPENAI_BASE_URL", "https://api.openai.com/v1"),
});
const toBase64 = (input: Uint8Array): string => Buffer.from(input).toString("base64");

export const classifyListingPolicy = (
  runtime: Runtime<unknown>,
  listing: ListingContext,
): PolicyClassification => {
  const config = getOpenAIConfig(runtime);
  const httpClient = new HTTPClient();
  const url = `${config.baseUrl.replace(/\/+$/, "")}/chat/completions`;
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

  const systemPrompt = LISTING_POLICY_SYSTEM_PROMPT;
  const userPrompt = buildListingPolicyUserPrompt(listing);

  logStep(runtime, "OPENAI", "analyzing listing policy");
  const response = sendHttp({
    url,
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${config.apiKey}`,
    },
    cacheSettings: {
      store: true,
      maxAge: "60s",
    },
    body: toBase64(
      textEncoder.encode(
        JSON.stringify({
          model: config.model,
          temperature: 0,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "listing_policy_response",
              strict: true,
              schema: strictOutputSchema,
            },
          },
        }),
      ),
    ),
  }).result();

  logStep(
    runtime,
    "OPENAI",
    `analysis completed status=${response.statusCode}`,
  );

  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(
      `openai classification failed closed: status ${response.statusCode}`,
    );
  }

  const parsed = openAiResponseSchema.parse(parseJsonBody(response.body));
  const content = parsed.choices[0]?.message?.content;
  if (!content) {
    throw new Error("openai classification failed closed: missing output content");
  }

  let jsonContent: unknown;
  try {
    jsonContent = JSON.parse(content);
  } catch {
    throw new Error("openai classification failed closed: malformed JSON content");
  }

  const classification = classificationSchema.parse(jsonContent);
  logStep(
    runtime,
    "OPENAI",
    `classification result policy=${classification.recommendedPolicy} riskTier=${classification.riskTier} confidence=${classification.confidence} domains=${classification.complianceDomains.join("|") || "none"} flags=${classification.complianceFlags.join("|") || "none"} evidenceCount=${classification.evidence.length}`,
  );

  return classification;
};
