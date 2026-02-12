import {
  ConsensusAggregationByFields,
  HTTPClient,
  identical,
  median,
  type Runtime,
} from "@chainlink/cre-sdk";
import { z } from "zod";
import { optionalSetting } from "../lib/env";

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

type MongoAction = "insertOne" | "find" | "updateOne";

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

const executeMongoAction = (
  runtime: Runtime<unknown>,
  action: MongoAction,
  payload: Record<string, unknown>,
): unknown => {
  const { baseUrl, apiKey, maxRetries } = getMongoConfig(runtime);
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
    runtime.log(`CHECK: mongodb call start action=${action} attempt=${attempt}`);
    try {
      const response = sendHttp({
        url: `${baseUrl}/${action}`,
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(apiKey ? { "x-db-api-key": apiKey } : {}),
        },
        body: toBase64(textEncoder.encode(JSON.stringify(payload))),
      }).result();

      runtime.log(
        `CHECK: mongodb call completed action=${action} status=${response.statusCode}`,
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
      runtime.log(`CHECK: mongodb retry action=${action} nextAttempt=${attempt + 1}`);
    } catch (error) {
      const shouldRetry = attempt < retries;
      lastError = error;
      if (!shouldRetry) {
        throw new Error(
          `mongodb ${action} failed after ${attempt} attempt(s): ${String(error)}`,
        );
      }
      runtime.log(`CHECK: mongodb retry action=${action} nextAttempt=${attempt + 1}`);
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
