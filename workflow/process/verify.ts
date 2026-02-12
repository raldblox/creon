import { normalizePaymentProof } from "../integration/x402";
import { logStep } from "../lib/log";
import { validateVerifyInput } from "../lib/schema";
import type { ActionHandler } from "../lib/types";

export const handleVerify: ActionHandler = (runtime, input) => {
  const parsed = validateVerifyInput(input);
  const normalized = normalizePaymentProof(runtime, parsed.proof);
  logStep(runtime, "PAYMENT", "verification proof normalized");
  const data: Record<string, unknown> = {
    kind: normalized.kind,
    fingerprint: normalized.fingerprint,
  };
  if (normalized.txHash) {
    data.txHash = normalized.txHash;
  }
  if (normalized.chainId) {
    data.chainId = normalized.chainId;
  }

  return {
    ok: true,
    action: "verify",
    reasonCode: "VERIFY_OK",
    message: "payment proof is valid and normalized",
    data,
  };
};
