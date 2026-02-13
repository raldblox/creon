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

const insertOneResponseSchema = z.object({
  insertedId: z.unknown().optional(),
});

const findResponseSchema = z.object({
  documents: z.array(z.record(z.unknown())).default([]),
});

const updateOneResponseSchema = z.object({
  matchedCount: z.number().int().nonnegative().default(0),
  modifiedCount: z.number().int().nonnegative().default(0),
  upsertedId: z.unknown().optional(),
});

type MongoAction = "insertOne" | "find" | "updateOne" | "purchaseCommit";

type MongoRequest = {
  collection: string;
  database?: string;
};

type InsertOneInput = MongoRequest & {
  document: Record<string, unknown>;
};

type FindInput = MongoRequest & {
  filter?: Record<string, unknown>;
  projection?: Record<string, unknown>;
  sort?: Record<string, unknown>;
  limit?: number;
};

type UpdateOneInput = MongoRequest & {
  filter: Record<string, unknown>;
  update: Record<string, unknown>;
  upsert?: boolean;
};

type PurchaseCommitInput = {
  buyer: string;
  merchant: string;
  productId: string;
  intentId: string;
  fingerprint: string;
  proofKind: string;
  paymentTxHash: string;
  entitlementTxHash: string;
  agentWallet: string;
  grossAmount: number;
  feeAmount: number;
  merchantNetAmount: number;
  feeBps: number;
  nowIso: string;
};

const retryableStatusCodes = new Set([408, 425, 429, 500, 502, 503, 504]);
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

const stripTrailingSlash = (value: string): string => value.replace(/\/+$/, "");
const toBase64 = (input: Uint8Array): string => Buffer.from(input).toString("base64");
const dataApiActionPattern = /\/action\/(insertOne|find|updateOne)$/;

const readJson = (body: Uint8Array | string): unknown => {
  const raw = typeof body === "string" ? body : textDecoder.decode(body);
  if (!raw.trim()) {
    return {};
  }

  try {
    return JSON.parse(raw);
  } catch {
    return { raw };
  }
};

const getMongoConfig = (runtime: Runtime<unknown>) => ({
  dataApiUrl: stripTrailingSlash(optionalSetting(runtime, "MONGODB_DATA_API_URL", "")),
  dataApiKey: optionalSetting(runtime, "MONGODB_DATA_API_KEY", ""),
  dataSource: optionalSetting(runtime, "MONGODB_DATA_SOURCE", ""),
  baseUrl: stripTrailingSlash(
    optionalSetting(runtime, "MONGODB_DB_API_URL", "http://localhost:3000/api/db"),
  ),
  apiKey: optionalSetting(runtime, "MONGODB_DB_API_KEY", ""),
  database: optionalSetting(runtime, "MONGODB_DATABASE", "creon_store"),
  maxRetries: Number.parseInt(
    optionalSetting(runtime, "MONGODB_MAX_RETRIES", "3"),
    10,
  ),
});

const buildDataApiActionUrl = (baseOrActionUrl: string, action: MongoAction): string => {
  if (dataApiActionPattern.test(baseOrActionUrl)) {
    return baseOrActionUrl.replace(dataApiActionPattern, `/action/${action}`);
  }
  if (baseOrActionUrl.endsWith("/action")) {
    return `${baseOrActionUrl}/${action}`;
  }
  return `${baseOrActionUrl}/action/${action}`;
};

const executeMongoAction = (
  runtime: Runtime<unknown>,
  action: MongoAction,
  payload: Record<string, unknown>,
): unknown => {
  const { baseUrl, apiKey, dataApiUrl, dataApiKey, dataSource, maxRetries } =
    getMongoConfig(runtime);
  const useAtlasDataApi = dataApiUrl.length > 0;
  if (useAtlasDataApi && !dataApiKey) {
    throw new Error(
      "missing required setting \"MONGODB_DATA_API_KEY\" for Atlas Data API mode",
    );
  }
  if (useAtlasDataApi && !dataSource) {
    throw new Error(
      "missing required setting \"MONGODB_DATA_SOURCE\" for Atlas Data API mode",
    );
  }

  const url = useAtlasDataApi
    ? buildDataApiActionUrl(dataApiUrl, action)
    : `${baseUrl}/${action}`;
  const bodyPayload = useAtlasDataApi ? { dataSource, ...payload } : payload;
  const headers: Record<string, string> = {
    "content-type": "application/json",
    ...(useAtlasDataApi
      ? { "api-key": dataApiKey }
      : apiKey
        ? { "x-db-api-key": apiKey }
        : {}),
  };

  const httpClient = new HTTPClient();
  const retries = Number.isFinite(maxRetries) && maxRetries > 0 ? maxRetries : 3;
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

  let lastError: unknown;

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    logStep(
      runtime,
      "DATABASE",
      `call start action=${action} mode=${useAtlasDataApi ? "atlas-data-api" : "db-api-bridge"} attempt=${attempt}`,
    );
    try {
      const response = sendHttp({
        url,
        method: "POST",
        headers,
        body: toBase64(textEncoder.encode(JSON.stringify(bodyPayload))),
      }).result();

      logStep(
        runtime,
        "DATABASE",
        `call completed action=${action} status=${response.statusCode}`,
      );

      const parsedBody = readJson(response.body);
      if (response.statusCode >= 200 && response.statusCode < 300) {
        return parsedBody;
      }

      const message = `mongodb ${action} failed with status ${response.statusCode}`;
      const shouldRetry =
        retryableStatusCodes.has(response.statusCode) && attempt < retries;
      if (!shouldRetry) {
        throw new Error(`${message}: ${JSON.stringify(parsedBody)}`);
      }

      lastError = new Error(message);
      logStep(
        runtime,
        "DATABASE",
        `retry scheduled action=${action} nextAttempt=${attempt + 1}`,
      );
    } catch (error) {
      const shouldRetry = attempt < retries;
      lastError = error;
      if (!shouldRetry) {
        throw new Error(
          `mongodb ${action} failed after ${attempt} attempt(s): ${String(error)}`,
        );
      }
      logStep(
        runtime,
        "DATABASE",
        `retry scheduled action=${action} nextAttempt=${attempt + 1}`,
      );
    }
  }

  throw new Error(`mongodb ${action} failed: ${String(lastError)}`);
};

export const insertOne = (
  runtime: Runtime<unknown>,
  input: InsertOneInput,
): z.infer<typeof insertOneResponseSchema> => {
  const config = getMongoConfig(runtime);
  const response = executeMongoAction(runtime, "insertOne", {
    database: input.database ?? config.database,
    collection: input.collection,
    document: input.document,
  });

  return insertOneResponseSchema.parse(response);
};

export const find = (
  runtime: Runtime<unknown>,
  input: FindInput,
): z.infer<typeof findResponseSchema> => {
  const config = getMongoConfig(runtime);
  const response = executeMongoAction(runtime, "find", {
    database: input.database ?? config.database,
    collection: input.collection,
    filter: input.filter ?? {},
    projection: input.projection,
    sort: input.sort,
    limit: input.limit,
  });

  return findResponseSchema.parse(response);
};

export const updateOne = (
  runtime: Runtime<unknown>,
  input: UpdateOneInput,
): z.infer<typeof updateOneResponseSchema> => {
  const config = getMongoConfig(runtime);
  const response = executeMongoAction(runtime, "updateOne", {
    database: input.database ?? config.database,
    collection: input.collection,
    filter: input.filter,
    update: input.update,
    upsert: input.upsert ?? false,
  });

  return updateOneResponseSchema.parse(response);
};

export const purchaseCommit = (
  runtime: Runtime<unknown>,
  input: PurchaseCommitInput,
): Record<string, unknown> => {
  const config = getMongoConfig(runtime);
  const response = executeMongoAction(runtime, "purchaseCommit", {
    database: config.database,
    ...input,
  });
  return z.record(z.unknown()).parse(response);
};
