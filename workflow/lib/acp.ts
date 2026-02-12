import type { ActionHandlerResult } from "./types";

type ACPMessageType = "info" | "warning" | "error";
type ACPMessageCode =
  | "missing"
  | "invalid"
  | "out_of_stock"
  | "payment_declined"
  | "requires_sign_in"
  | "requires_3ds";
type ACPErrorType =
  | "invalid_request"
  | "request_not_idempotent"
  | "processing_error"
  | "service_unavailable";

type ACPMessage = {
  type: ACPMessageType;
  code?: ACPMessageCode;
  param?: string;
  content_type: "plain";
  content: string;
};

type ACPError = {
  type: ACPErrorType;
  code?: string;
  message: string;
  param?: string;
};

type ACPEnvelope = {
  version: "2026-01-30";
  messages: ACPMessage[];
  error?: ACPError;
};

const messageCodeFromReason = (reasonCode?: string): ACPMessageCode | undefined => {
  if (!reasonCode) {
    return undefined;
  }

  if (reasonCode.includes("NOT_FOUND")) {
    return "out_of_stock";
  }

  if (
    reasonCode.includes("MISMATCH") ||
    reasonCode.includes("INVALID") ||
    reasonCode.includes("DENY") ||
    reasonCode.includes("REJECTED")
  ) {
    return "invalid";
  }

  return undefined;
};

const errorTypeFromReason = (reasonCode?: string): ACPErrorType => {
  if (!reasonCode) {
    return "processing_error";
  }

  if (
    reasonCode.includes("INVALID") ||
    reasonCode.includes("MISMATCH") ||
    reasonCode.includes("NOT_FOUND")
  ) {
    return "invalid_request";
  }

  if (reasonCode.includes("IDEMPOTENT") || reasonCode.includes("REPLAY")) {
    return "request_not_idempotent";
  }

  if (reasonCode.includes("UNAVAILABLE") || reasonCode.includes("TIMEOUT")) {
    return "service_unavailable";
  }

  return "processing_error";
};

export const withACPEnvelope = (result: ActionHandlerResult): ActionHandlerResult => {
  const messageCode = messageCodeFromReason(result.reasonCode);
  const messages: ACPMessage[] = [
    {
      type: result.ok ? "info" : "error",
      ...(messageCode ? { code: messageCode } : {}),
      content_type: "plain",
      content: result.message,
    },
  ];

  const acp: ACPEnvelope = {
    version: "2026-01-30",
    messages,
    ...(result.ok
      ? {}
      : {
          error: {
            type: errorTypeFromReason(result.reasonCode),
            ...(result.reasonCode ? { code: result.reasonCode } : {}),
            message: result.message,
          },
        }),
  };

  return {
    ...result,
    acp,
  };
};
