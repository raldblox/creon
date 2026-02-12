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
  data?: any;
};

export type ActionHandler = (
  runtime: Runtime<unknown>,
  input: WorkflowInput,
) => ActionHandlerResult;
