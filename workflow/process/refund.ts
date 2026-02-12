import { find } from "../integration/mongodb";
import { validateRefundInput } from "../lib/schema";
import type { ActionHandler } from "../lib/types";

export const handleRefund: ActionHandler = (runtime, input) => {
  const parsed = validateRefundInput(input);

  const entitlement = find(runtime, {
    collection: "entitlements",
    filter: { buyer: parsed.buyer, productId: parsed.productId },
    limit: 1,
  });
  runtime.log("CHECK: mongodb read ok");

  if (entitlement.documents.length > 0) {
    return {
      ok: false,
      action: "refund",
      reasonCode: "REFUND_REJECTED_ENTITLEMENT_ACTIVE",
      message: "refund is not auto-approved while entitlement is active",
    };
  }

  return {
    ok: true,
    action: "refund",
    reasonCode: "REFUND_ELIGIBLE_REVIEW",
    message: "refund request is eligible for manual review",
    data: {
      buyer: parsed.buyer,
      productId: parsed.productId,
      intentId: parsed.intentId,
      reason: parsed.reason,
    },
  };
};
