import type { Runtime } from "@chainlink/cre-sdk";

export type LogScope =
  | "ACTION"
  | "INPUT"
  | "OPENAI"
  | "MONGODB"
  | "PAYMENT"
  | "CHAIN";

export const logStep = (
  runtime: Runtime<unknown>,
  scope: LogScope,
  message: string,
): void => {
  runtime.log(`[${scope}] ${message}`);
};

