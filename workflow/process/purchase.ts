import { find, updateOne } from "../integration/mongodb";
import { normalizePaymentProof } from "../integration/x402";
import { verifyFeeAmount } from "../lib/fee";
import { hasReplayFingerprint, storeReplayFingerprint } from "../lib/replay";
import { validatePurchaseInput } from "../lib/schema";
import type { ActionHandler } from "../lib/types";

export const handlePurchase: ActionHandler = (runtime, input) => {
  const parsed = validatePurchaseInput(input);
  const normalized = normalizePaymentProof(runtime, parsed.proof);
  runtime.log("CHECK: proof verified");

  const feeCheck = verifyFeeAmount(
    parsed.pricing.amount,
    normalized.amount,
    parsed.feeBps,
  );
  if (!feeCheck.ok) {
    return {
      ok: false,
      action: "purchase",
      reasonCode: "FEE_MISMATCH",
      message: "purchase amount does not include expected service fee",
      data: {
        expectedTotal: feeCheck.expectedTotal,
        paidTotal: feeCheck.paidTotal,
      },
    };
  }
  runtime.log("CHECK: fee verified");

  if (hasReplayFingerprint(runtime, normalized.fingerprint)) {
    return {
      ok: false,
      action: "purchase",
      reasonCode: "REFUND_ELIGIBLE_DOUBLE_PURCHASE",
      message: "duplicate payment proof detected",
      data: { fingerprint: normalized.fingerprint },
    };
  }

  const existingEntitlement = find(runtime, {
    collection: "entitlements",
    filter: { buyer: parsed.buyer, productId: parsed.productId },
    limit: 1,
  });

  if (existingEntitlement.documents.length > 0) {
    return {
      ok: false,
      action: "purchase",
      reasonCode: "REFUND_ELIGIBLE_ALREADY_OWNED",
      message: "buyer already has entitlement",
      data: { buyer: parsed.buyer, productId: parsed.productId },
    };
  }

  storeReplayFingerprint(runtime, normalized.fingerprint, {
    intentId: parsed.intentId,
    buyer: parsed.buyer,
    merchant: parsed.merchant,
    productId: parsed.productId,
    proofKind: normalized.kind,
  });
  runtime.log("CHECK: replay stored");

  updateOne(runtime, {
    collection: "entitlements",
    filter: { buyer: parsed.buyer, productId: parsed.productId },
    update: {
      $setOnInsert: {
        buyer: parsed.buyer,
        merchant: parsed.merchant,
        productId: parsed.productId,
        intentId: parsed.intentId,
        grantedAt: runtime.now().toISOString(),
      },
    },
    upsert: true,
  });
  runtime.log("CHECK: entitlement written");

  return {
    ok: true,
    action: "purchase",
    reasonCode: "PURCHASE_SUCCESS",
    message: "purchase recorded and entitlement granted",
    data: {
      buyer: parsed.buyer,
      productId: parsed.productId,
      fingerprint: normalized.fingerprint,
      expectedTotal: feeCheck.expectedTotal,
    },
  };
};
