import { normalizePaymentProof } from "../integration/x402";
import { validateVerifyInput } from "../lib/schema";
import type { ActionHandler } from "../lib/types";

export const handleVerify: ActionHandler = (runtime, input) => {
  const parsed = validateVerifyInput(input);
  const normalized = normalizePaymentProof(runtime, parsed.proof);
  runtime.log("CHECK: proof verified");

  return {
    ok: true,
    action: "verify",
    reasonCode: "VERIFY_OK",
    message: "payment proof is valid and normalized",
    data: {
      kind: normalized.kind,
      fingerprint: normalized.fingerprint,
      txHash: normalized.txHash,
      chainId: normalized.chainId,
    },
  };
};
