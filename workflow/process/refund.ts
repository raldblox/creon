import { type Address } from "viem";
import { hasEntitlementOnchain } from "../integration/chain";
import { find } from "../integration/mongodb";
import { logStep } from "../lib/log";
import { validateRefundInput } from "../lib/schema";
import type { ActionHandler } from "../lib/types";

export const handleRefund: ActionHandler = (runtime, input) => {
  const parsed = validateRefundInput(input);

  const refundEligibility = find(runtime, {
    collection: "refund_eligibility",
    filter: { buyer: parsed.buyer, productId: parsed.productId },
    limit: 1,
  });
  logStep(runtime, "MONGODB", "refund eligibility lookup completed");

  const eligibleByDuplicate =
    refundEligibility.documents.length > 0 &&
    Number(refundEligibility.documents[0]?.duplicateAttempts ?? 0) > 0;

  if (!eligibleByDuplicate) {
    return {
      ok: false,
      action: "refund",
      reasonCode: "REFUND_REJECTED_NOT_DUPLICATE",
      message: "refund is allowed only for duplicate purchase of same buyer and product",
    };
  }

  const hasEntitlement = hasEntitlementOnchain(
    runtime,
    parsed.buyer as Address,
    parsed.productId,
  );
  if (!hasEntitlement) {
    return {
      ok: false,
      action: "refund",
      reasonCode: "REFUND_REJECTED_NO_ENTITLEMENT",
      message: "refund requires an onchain entitlement record",
    };
  }

  return {
    ok: true,
    action: "refund",
    reasonCode: "REFUND_ELIGIBLE_DUPLICATE_PURCHASE",
    message: "refund request is eligible due to duplicate purchase",
    data: {
      buyer: parsed.buyer,
      productId: parsed.productId,
      intentId: parsed.intentId,
      reason: parsed.reason,
    },
  };
};
