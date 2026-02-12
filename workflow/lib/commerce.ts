import type { Runtime } from "@chainlink/cre-sdk";
import { optionalSetting, requireSetting } from "./env";

export const DEFAULT_COMMERCE_CHAIN = "base-sepolia";
export const DEFAULT_COMMERCE_CURRENCY = "USDC";

export const getAgentWalletAddress = (runtime: Runtime<unknown>): string =>
  requireSetting(runtime, "AGENT_WALLET_ADDRESS").toLowerCase();

export const validatePricingDefaults = (
  chain: string,
  currency: string,
): { ok: boolean; reasonCode?: string; message?: string } => {
  if (chain.toLowerCase() !== DEFAULT_COMMERCE_CHAIN) {
    return {
      ok: false,
      reasonCode: "UNSUPPORTED_CHAIN",
      message: `only ${DEFAULT_COMMERCE_CHAIN} is supported`,
    };
  }

  if (currency.toUpperCase() !== DEFAULT_COMMERCE_CURRENCY) {
    return {
      ok: false,
      reasonCode: "UNSUPPORTED_CURRENCY",
      message: `only ${DEFAULT_COMMERCE_CURRENCY} is supported`,
    };
  }

  return { ok: true };
};

export const getCommerceUSDCAddress = (runtime: Runtime<unknown>): string =>
  optionalSetting(runtime, "COMMERCE_USDC_ADDRESS", "").toLowerCase();
