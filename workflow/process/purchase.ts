import { type Address } from "viem";
import {
  hasEntitlementOnchain,
  recordEntitlementOnchain,
} from "../integration/chain";
import { find, insertOne, updateOne } from "../integration/mongodb";
import { normalizePaymentProof } from "../integration/x402";
import {
  getAgentWalletAddress,
  validatePricingDefaults,
} from "../lib/commerce";
import { verifyFeeAmount } from "../lib/fee";
import { hasReplayFingerprint, storeReplayFingerprint } from "../lib/replay";
import { validatePurchaseInput } from "../lib/schema";
import type { ActionHandler } from "../lib/types";

export const handlePurchase: ActionHandler = (runtime, input) => {
  const parsed = validatePurchaseInput(input);
  const pricingCheck = validatePricingDefaults(
    parsed.pricing.chain,
    parsed.pricing.currency,
  );
  if (!pricingCheck.ok) {
    return {
      ok: false,
      action: "purchase",
      reasonCode: pricingCheck.reasonCode,
      message: pricingCheck.message || "unsupported commerce config",
    };
  }

  const agentWallet = getAgentWalletAddress(runtime);
  if (parsed.merchant.toLowerCase() !== agentWallet) {
    return {
      ok: false,
      action: "purchase",
      reasonCode: "MERCHANT_MISMATCH",
      message: "merchant must match agent wallet",
      data: { merchant: parsed.merchant, agentWallet },
    };
  }

  const normalized = normalizePaymentProof(runtime, parsed.proof);
  runtime.log("CHECK: proof verified");

  if (
    normalized.payTo &&
    normalized.payTo.length > 0 &&
    normalized.payTo.toLowerCase() !== agentWallet
  ) {
    return {
      ok: false,
      action: "purchase",
      reasonCode: "PAYEE_MISMATCH",
      message: "payment recipient must be agent wallet",
      data: { payTo: normalized.payTo, agentWallet },
    };
  }

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

  const duplicateProof = hasReplayFingerprint(runtime, normalized.fingerprint);

  const existingEntitlement = find(runtime, {
    collection: "entitlements",
    filter: { buyer: parsed.buyer, productId: parsed.productId },
    limit: 1,
  });

  const hasLocalEntitlement = existingEntitlement.documents.length > 0;
  const hasOnchainEntitlement = hasEntitlementOnchain(
    runtime,
    parsed.buyer as Address,
    parsed.productId,
  );
  const duplicatePurchase = duplicateProof || hasLocalEntitlement || hasOnchainEntitlement;

  if (duplicatePurchase) {
    updateOne(runtime, {
      collection: "refund_eligibility",
      filter: { buyer: parsed.buyer, productId: parsed.productId },
      update: {
        $inc: { duplicateAttempts: 1 },
        $set: {
          buyer: parsed.buyer,
          productId: parsed.productId,
          merchant: parsed.merchant,
          latestIntentId: parsed.intentId,
          latestFingerprint: normalized.fingerprint,
          updatedAt: runtime.now().toISOString(),
        },
        $setOnInsert: {
          createdAt: runtime.now().toISOString(),
        },
      },
      upsert: true,
    });

    return {
      ok: false,
      action: "purchase",
      reasonCode: "REFUND_ELIGIBLE_DUPLICATE_PURCHASE",
      message: "duplicate purchase for same buyer and product is refund eligible",
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

  const onchain = recordEntitlementOnchain(
    runtime,
    parsed.buyer as Address,
    parsed.productId,
  );

  updateOne(runtime, {
    collection: "entitlements",
    filter: { buyer: parsed.buyer, productId: parsed.productId },
    update: {
      $setOnInsert: {
        buyer: parsed.buyer,
        merchant: parsed.merchant,
        productId: parsed.productId,
        intentId: parsed.intentId,
        txHash: onchain.txHash,
        grantedAt: runtime.now().toISOString(),
      },
    },
    upsert: true,
  });
  runtime.log("CHECK: entitlement written");

  insertOne(runtime, {
    collection: "purchases",
    document: {
      intentId: parsed.intentId,
      buyer: parsed.buyer,
      merchant: parsed.merchant,
      productId: parsed.productId,
      fingerprint: normalized.fingerprint,
      proofKind: normalized.kind,
      amount: normalized.amount ?? parsed.pricing.amount,
      feeBps: parsed.feeBps,
      txHash: onchain.txHash,
      createdAt: runtime.now().toISOString(),
    },
  });

  return {
    ok: true,
    action: "purchase",
    reasonCode: "PURCHASE_SUCCESS",
    message: "purchase recorded and entitlement granted",
    data: {
      buyer: parsed.buyer,
      productId: parsed.productId,
      fingerprint: normalized.fingerprint,
      agentWallet,
      txHash: onchain.txHash,
      expectedTotal: feeCheck.expectedTotal,
    },
  };
};
