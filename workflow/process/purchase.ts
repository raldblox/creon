import { type Address } from "viem";
import {
  hasEntitlementOnchain,
  quoteCheckoutSplitFromGross,
  recordEntitlementOnchain,
} from "../integration/chain";
import { find, purchaseCommit, updateOne } from "../integration/mongodb";
import { normalizePaymentProof } from "../integration/x402";
import {
  getAgentWalletAddress,
  validatePricingDefaults,
} from "../lib/commerce";
import { optionalSetting } from "../lib/env";
import { computeFeeAmount, verifyPaidAmountMatchesListing } from "../lib/fee";
import { logStep } from "../lib/log";
import { hasReplayFingerprint } from "../lib/replay";
import { validatePurchaseInput } from "../lib/schema";
import type { ActionHandler } from "../lib/types";

export const handlePurchase: ActionHandler = (runtime, input) => {
  const parsed = validatePurchaseInput(input);
  const configuredFeeBps = Number.parseInt(optionalSetting(runtime, "COMMERCE_FEE_BPS", "100"), 10);
  const fallbackFeeBps = Number.isFinite(configuredFeeBps) ? configuredFeeBps : 100;
  if (fallbackFeeBps < 0 || fallbackFeeBps > 2500) {
    return {
      ok: false,
      action: "purchase",
      reasonCode: "FEE_BPS_CONFIG_INVALID",
      message: "configured commerce fee must be between 0 and 2500 bps",
      data: { configuredFeeBps: fallbackFeeBps },
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

  const feeCheck = verifyPaidAmountMatchesListing(
    parsed.pricing.amount,
    normalized.amount,
  );
  if (!feeCheck.ok) {
    return {
      ok: false,
      action: "purchase",
      reasonCode: "FEE_MISMATCH",
      message: "paid amount must match listed amount exactly",
      data: {
        expectedPaid: feeCheck.expectedPaid,
        paidTotal: feeCheck.paidTotal,
      },
    };
  }
  logStep(runtime, "PAYMENT", "fee validation passed");
  const grossAmount = feeCheck.paidTotal ?? feeCheck.expectedPaid;
  const checkoutQuote = quoteCheckoutSplitFromGross(runtime, grossAmount);
  const effectiveFeeBps = checkoutQuote?.feeBps ?? fallbackFeeBps;

  if (parsed.feeBps !== effectiveFeeBps) {
    return {
      ok: false,
      action: "purchase",
      reasonCode: "FEE_BPS_INVALID",
      message: "purchase fee bps does not match enforced configuration",
      data: { expectedFeeBps: effectiveFeeBps, receivedFeeBps: parsed.feeBps },
    };
  }

  const feeAmount = checkoutQuote
    ? checkoutQuote.feeAmount
    : computeFeeAmount(grossAmount, effectiveFeeBps);
  const merchantNetAmount = checkoutQuote
    ? checkoutQuote.merchantNetAmount
    : round6(grossAmount - feeAmount);
  logStep(
    runtime,
    "PAYMENT",
    `fee source=${checkoutQuote ? "checkout" : "workflow"} feeBps=${effectiveFeeBps}`,
  );

  const duplicateProof = hasReplayFingerprint(runtime, normalized.fingerprint);
  if (duplicateProof) {
    return {
      ok: true,
      action: "purchase",
      reasonCode: "PURCHASE_ALREADY_RECORDED",
      message: "same payment proof already recorded",
      data: {
        buyer: parsed.buyer,
        productId: parsed.productId,
        fingerprint: normalized.fingerprint,
      },
    };
  }

  const existingPurchase = find(runtime, {
    collection: "purchases",
    filter: { buyer: parsed.buyer, productId: parsed.productId },
    sort: { createdAt: -1 },
    limit: 1,
  });
  const prior = existingPurchase.documents[0] as
    | { paymentTxHash?: unknown; fingerprint?: unknown }
    | undefined;
  const priorPaymentTxHash =
    typeof prior?.paymentTxHash === "string" ? prior.paymentTxHash.toLowerCase() : undefined;
  const currentPaymentTxHash = normalized.txHash.toLowerCase();

  if (priorPaymentTxHash && priorPaymentTxHash !== currentPaymentTxHash) {
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
      message: "same buyer purchased same product again with different payment tx hash",
      data: {
        buyer: parsed.buyer,
        productId: parsed.productId,
        priorPaymentTxHash,
        currentPaymentTxHash,
      },
    };
  }

  if (priorPaymentTxHash && priorPaymentTxHash === currentPaymentTxHash) {
    return {
      ok: true,
      action: "purchase",
      reasonCode: "PURCHASE_ALREADY_RECORDED",
      message: "same payment tx hash already recorded for this buyer and product",
      data: {
        buyer: parsed.buyer,
        productId: parsed.productId,
        paymentTxHash: currentPaymentTxHash,
      },
    };
  }

  const hasOnchainEntitlement = hasEntitlementOnchain(
    runtime,
    parsed.buyer as Address,
    parsed.productId,
  );
  if (hasOnchainEntitlement && !priorPaymentTxHash) {
    return {
      ok: true,
      action: "purchase",
      reasonCode: "PURCHASE_ALREADY_RECORDED",
      message: "buyer already has entitlement onchain",
      data: { buyer: parsed.buyer, productId: parsed.productId },
    };
  }

  const onchain = recordEntitlementOnchain(
    runtime,
    parsed.buyer as Address,
    parsed.productId,
  );

  const nowIso = runtime.now().toISOString();
  purchaseCommit(runtime, {
    buyer: parsed.buyer,
    merchant: parsed.merchant,
    productId: parsed.productId,
    intentId: parsed.intentId,
    fingerprint: normalized.fingerprint,
    proofKind: normalized.kind,
    paymentTxHash: normalized.txHash,
    entitlementTxHash: onchain.txHash,
    agentWallet,
    grossAmount,
    feeAmount,
    merchantNetAmount,
    feeBps: effectiveFeeBps,
    nowIso,
  });
  logStep(runtime, "DATABASE", "purchase commit completed");

  return {
    ok: true,
    action: "purchase",
    reasonCode: "PURCHASE_RECORDED_PENDING_SETTLEMENT",
    message: "purchase recorded, entitlement granted, merchant settlement pending",
    data: {
      buyer: parsed.buyer,
      productId: parsed.productId,
      fingerprint: normalized.fingerprint,
      agentWallet,
      merchant: parsed.merchant,
      paymentTxHash: normalized.txHash,
      entitlementTxHash: onchain.txHash,
      feeBps: effectiveFeeBps,
      feeAmount,
      grossAmount,
      merchantNetAmount,
      settlementStatus: "PENDING",
      expectedPaid: feeCheck.expectedPaid,
      feeSource: checkoutQuote ? "checkout" : "workflow",
    },
  };
};
