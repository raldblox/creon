import type { Runtime } from "@chainlink/cre-sdk";

export type ActionName =
  | "createListing"
  | "list"
  | "search"
  | "purchase"
  | "restore"
  | "refund"
  | "governance"
  | "verify"
  | "decide";

export type WorkflowInput = {
  action: ActionName | string;
  [key: string]: unknown;
};

export type ActionHandlerResult = {
  ok: boolean;
  action: string;
  message: string;
  reasonCode?: string;
  data?: unknown;
  acp?: {
    version: string;
    messages: Array<{
      type: "info" | "warning" | "error";
      code?: string;
      param?: string;
      content_type: "plain";
      content: string;
    }>;
    error?: {
      type: "invalid_request" | "request_not_idempotent" | "processing_error" | "service_unavailable";
      code?: string;
      message: string;
      param?: string;
    };
  };
};

export type ActionHandler = (
  runtime: Runtime<unknown>,
  input: WorkflowInput,
) => ActionHandlerResult;
