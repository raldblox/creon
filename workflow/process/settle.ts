import { find, updateOne } from "../integration/mongodb";
import { logStep } from "../lib/log";
import { validateSettleInput } from "../lib/schema";
import type { ActionHandler } from "../lib/types";

export const handleSettle: ActionHandler = (runtime, input) => {
  const parsed = validateSettleInput(input);

  const queued = find(runtime, {
    collection: "settlement_queue",
    filter: { intentId: parsed.intentId, status: "PENDING" },
    limit: 1,
  });

  if (queued.documents.length === 0) {
    return {
      ok: false,
      action: "settle",
      reasonCode: "SETTLEMENT_NOT_FOUND",
      message: "pending settlement record not found",
      data: { intentId: parsed.intentId },
    };
  }

  const item = queued.documents[0] as Record<string, unknown>;
  const merchant = String(item.merchant ?? "");
  const merchantNetAmount = Number(item.merchantNetAmount ?? 0);

  updateOne(runtime, {
    collection: "settlement_queue",
    filter: { intentId: parsed.intentId, status: "PENDING" },
    update: {
      $set: {
        status: "SETTLED",
        settlementTxHash: parsed.settlementTxHash,
        settledBy: parsed.settledBy ?? "workflow",
        settledAt: runtime.now().toISOString(),
        updatedAt: runtime.now().toISOString(),
      },
    },
    upsert: false,
  });
  logStep(runtime, "MONGODB", "settlement queue marked as SETTLED");

  if (merchant) {
    updateOne(runtime, {
      collection: "merchant_settlements",
      filter: { merchant },
      update: {
        $inc: { netSettledToMerchant: merchantNetAmount },
        $set: {
          lastSettlementIntentId: parsed.intentId,
          lastSettlementTxHash: parsed.settlementTxHash,
          updatedAt: runtime.now().toISOString(),
        },
      },
      upsert: true,
    });
    logStep(runtime, "MONGODB", "merchant settlement totals updated");
  }

  return {
    ok: true,
    action: "settle",
    reasonCode: "SETTLEMENT_RECORDED",
    message: "settlement marked as completed",
    data: {
      intentId: parsed.intentId,
      settlementTxHash: parsed.settlementTxHash,
      merchant,
      merchantNetAmount,
      status: "SETTLED",
    },
  };
};
