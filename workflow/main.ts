import {
  type HTTPPayload,
  HTTPCapability,
  Runner,
  handler,
  type Runtime,
} from "@chainlink/cre-sdk";
import { z } from "zod";
import {
  handleCreateListing,
  handleDecide,
  handleGovernance,
  handleList,
  handlePurchase,
  handleRefund,
  handleRestore,
  handleSearch,
  handleVerify,
} from "./process";
import { withACPEnvelope } from "./lib/acp";
import { logStep } from "./lib/log";
import { toJsonSafeValue } from "./lib/serialize";
import type { ActionHandlerResult, WorkflowInput } from "./lib/types";

const configSchema = z.object({}).passthrough();
type Config = z.infer<typeof configSchema>;

const textDecoder = new TextDecoder();

const parsePayload = (payload: HTTPPayload): WorkflowInput => {
  if (!payload.input || payload.input.length === 0) {
    throw new Error("missing HTTP input payload");
  }

  const raw = textDecoder.decode(payload.input);
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("invalid JSON payload");
  }

  const input = (parsed as { input?: unknown }).input ?? parsed;
  if (!input || typeof input !== "object") {
    throw new Error("input object is required");
  }

  const action = (input as { action?: unknown }).action;
  if (typeof action !== "string" || action.trim() === "") {
    throw new Error("input.action is required");
  }

  return input as WorkflowInput;
};

const routeAction = (
  runtime: Runtime<Config>,
  input: WorkflowInput,
): ActionHandlerResult => {
  switch (input.action) {
    case "createListing":
      return handleCreateListing(runtime, input);
    case "list":
      return handleList(runtime, input);
    case "search":
      return handleSearch(runtime, input);
    case "purchase":
      return handlePurchase(runtime, input);
    case "restore":
      return handleRestore(runtime, input);
    case "refund":
      return handleRefund(runtime, input);
    case "governance":
      return handleGovernance(runtime, input);
    case "verify":
      return handleVerify(runtime, input);
    case "decide":
      return handleDecide(runtime, input);
    default:
      throw new Error(`unsupported action: ${input.action}`);
  }
};

const onHttpTrigger = (
  runtime: Runtime<Config>,
  payload: HTTPPayload,
): ActionHandlerResult => {
  const input = parsePayload(payload);
  logStep(runtime, "INPUT", "validated payload");
  logStep(runtime, "ACTION", `routing action=${input.action}`);
  const result = withACPEnvelope(routeAction(runtime, input));
  return toJsonSafeValue(result) as ActionHandlerResult;
};

const initWorkflow = () => {
  const httpTrigger = new HTTPCapability();

  return [
    handler(
      httpTrigger.trigger({
        authorizedKeys: [],
      }),
      onHttpTrigger,
    ),
  ];
};

export async function main() {
  const runner = await Runner.newRunner<Config>({ configSchema });
  await runner.run(initWorkflow);
}
