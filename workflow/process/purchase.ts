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
import { optionalSetting } from "../lib/env";
import { computeFeeAmount, verifyFeeAmount } from "../lib/fee";
import { logStep } from "../lib/log";
import { hasReplayFingerprint, storeReplayFingerprint } from "../lib/replay";
import { validatePurchaseInput } from "../lib/schema";
import type { ActionHandler } from "../lib/types";

export const handlePurchase: ActionHandler = (runtime, input) => {
  const parsed = validatePurchaseInput(input);
  const configuredFeeBps = Number.parseInt(optionalSetting(runtime, "COMMERCE_FEE_BPS", "100"), 10);
  const REQUIRED_FEE_BPS = Number.isFinite(configuredFeeBps) ? configuredFeeBps : 100;
  if (REQUIRED_FEE_BPS < 0 || REQUIRED_FEE_BPS > 2500) {
    return {
      ok: false,
      action: "purchase",
      reasonCode: "FEE_BPS_CONFIG_INVALID",
      message: "configured commerce fee must be between 0 and 2500 bps",
      data: { configuredFeeBps: REQUIRED_FEE_BPS },
    };
  }
  const round6 = (value: number): number => Math.round(value * 1_000_000) / 1_000_000;
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

  const normalized = normalizePaymentProof(runtime, parsed.proof);
  logStep(runtime, "PAYMENT", "payment proof verified");

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

  if (parsed.feeBps !== REQUIRED_FEE_BPS) {
    return {
      ok: false,
      action: "purchase",
      reasonCode: "FEE_BPS_INVALID",
      message: "purchase fee must be fixed at 1 percent (100 bps)",
      data: { expectedFeeBps: REQUIRED_FEE_BPS, receivedFeeBps: parsed.feeBps },
    };
  }

  const feeCheck = verifyFeeAmount(
    parsed.pricing.amount,
    normalized.amount,
    REQUIRED_FEE_BPS,
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
  logStep(runtime, "PAYMENT", "fee validation passed");
  const feeAmount = computeFeeAmount(parsed.pricing.amount, REQUIRED_FEE_BPS);
  const grossAmount = feeCheck.paidTotal ?? feeCheck.expectedTotal;
  const merchantNetAmount = round6(grossAmount - feeAmount);

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
  logStep(runtime, "ACTION", "replay fingerprint stored");

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
  logStep(runtime, "MONGODB", "entitlement upsert completed");

  insertOne(runtime, {
    collection: "purchases",
    document: {
      intentId: parsed.intentId,
      buyer: parsed.buyer,
      merchant: parsed.merchant,
      productId: parsed.productId,
      fingerprint: normalized.fingerprint,
      proofKind: normalized.kind,
      baseAmount: parsed.pricing.amount,
      grossAmount,
      feeAmount,
      merchantNetAmount,
      feeBps: REQUIRED_FEE_BPS,
      txHash: onchain.txHash,
      createdAt: runtime.now().toISOString(),
    },
  });
  updateOne(runtime, {
    collection: "merchant_settlements",
    filter: { merchant: parsed.merchant },
    update: {
      $inc: {
        purchaseCount: 1,
        grossCollected: grossAmount,
        feeCollected: feeAmount,
        netOwedToMerchant: merchantNetAmount,
      },
      $set: {
        merchant: parsed.merchant,
        settlementWallet: agentWallet,
        updatedAt: runtime.now().toISOString(),
      },
      $setOnInsert: {
        createdAt: runtime.now().toISOString(),
      },
    },
    upsert: true,
  });
  logStep(runtime, "MONGODB", "merchant settlement ledger updated");

  insertOne(runtime, {
    collection: "settlement_queue",
    document: {
      intentId: parsed.intentId,
      buyer: parsed.buyer,
      merchant: parsed.merchant,
      productId: parsed.productId,
      proofKind: normalized.kind,
      grossAmount,
      feeAmount,
      merchantNetAmount,
      feeBps: REQUIRED_FEE_BPS,
      settlementWallet: agentWallet,
      status: "PENDING",
      settlementMode:
        normalized.kind === "x402" ? "x402_transfer_only_two_step" : "standard_two_step",
      createdAt: runtime.now().toISOString(),
      updatedAt: runtime.now().toISOString(),
    },
  });
  logStep(runtime, "MONGODB", "merchant settlement queued");

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
      merchant: parsed.merchant,
      txHash: onchain.txHash,
      feeBps: REQUIRED_FEE_BPS,
      feeAmount,
      grossAmount,
      merchantNetAmount,
      settlementStatus: "PENDING",
      expectedTotal: feeCheck.expectedTotal,
    },
  };
};
