import {
  EVMClient,
  LAST_FINALIZED_BLOCK_NUMBER,
  LATEST_BLOCK_NUMBER,
  TxStatus,
  bytesToHex,
  encodeCallMsg,
  getNetwork,
  hexToBase64,
  type Runtime,
} from "@chainlink/cre-sdk";
import { decodeFunctionResult, encodeAbiParameters, encodeFunctionData, formatUnits, parseUnits } from "viem";
import { zeroAddress, type Address, type Hex } from "viem";
import { CommerceCheckout, EntitlementRegistry } from "../../contracts/abi";
import { optionalSetting, requireSetting } from "../lib/env";
import { logStep } from "../lib/log";

type ChainConfig = {
  chainSelectorName: string;
  isTestnet?: boolean;
};

type ContractReadParams = ChainConfig & {
  to: Address;
  data: Hex;
  from?: Address;
};

type ContractWriteReportParams = ChainConfig & {
  receiver: Address;
  callData: Hex;
  gasLimit?: string;
};

export const getCommerceChainSelectorName = (
  runtime: Runtime<unknown>,
): string =>
  optionalSetting(runtime, "COMMERCE_CHAIN_SELECTOR_NAME", "ethereum-testnet-sepolia-base-1");

export const getEntitlementRegistryAddress = (
  runtime: Runtime<unknown>,
): Address => requireSetting(runtime, "ENTITLEMENT_REGISTRY_ADDRESS") as Address;

export const getCommerceCheckoutAddress = (
  runtime: Runtime<unknown>,
): Address | null => {
  const value = optionalSetting(runtime, "COMMERCE_CHECKOUT_ADDRESS", "").trim();
  if (!value || value === zeroAddress) return null;
  return value as Address;
};

const resolveClient = (params: ChainConfig): EVMClient => {
  const network = getNetwork({
    chainFamily: "evm",
    chainSelectorName: params.chainSelectorName,
    isTestnet: params.isTestnet ?? true,
  });

  if (!network) {
    throw new Error(`unsupported chain selector name: ${params.chainSelectorName}`);
  }

  return new EVMClient(network.chainSelector.selector);
};

export const callContractRead = (
  runtime: Runtime<unknown>,
  params: ContractReadParams,
): Hex => {
  logStep(runtime, "CHAIN", `read start chain=${params.chainSelectorName}`);
  const client = resolveClient(params);
  const call = encodeCallMsg({
    from: params.from ?? zeroAddress,
    to: params.to,
    data: params.data,
  });

  let reply: { data: Uint8Array };
  try {
    reply = client
      .callContract(runtime, {
        call,
        blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
      })
      .result();
  } catch (error) {
    const message = String(error);
    if (!message.toLowerCase().includes("historical state")) {
      throw error;
    }
    logStep(runtime, "CHAIN", "finalized-state read unavailable; retrying latest block");
    reply = client
      .callContract(runtime, {
        call,
        blockNumber: LATEST_BLOCK_NUMBER,
      })
      .result();
  }

  logStep(runtime, "CHAIN", `read completed chain=${params.chainSelectorName}`);
  return bytesToHex(reply.data) as Hex;
};

export const writeContractReport = (
  runtime: Runtime<unknown>,
  params: ContractWriteReportParams,
): { txHash: Hex } => {
  logStep(runtime, "CHAIN", `write start chain=${params.chainSelectorName}`);
  const client = resolveClient(params);
  const configuredGasLimit = optionalSetting(runtime, "CHAIN_GAS_LIMIT", "1000000");
  const gasLimit = params.gasLimit ?? configuredGasLimit;

  const report = runtime
    .report({
      encodedPayload: hexToBase64(params.callData),
      encoderName: "evm",
      signingAlgo: "ecdsa",
      hashingAlgo: "keccak256",
    })
    .result();

  const result = client
    .writeReport(runtime, {
      receiver: params.receiver,
      report,
      gasConfig: { gasLimit },
    })
    .result();

  if (result.txStatus !== TxStatus.SUCCESS) {
    throw new Error(
      `chain write failed on ${params.chainSelectorName}: ${result.errorMessage || result.txStatus}`,
    );
  }

  const txHash = bytesToHex(result.txHash ?? new Uint8Array(32)) as Hex;
  logStep(
    runtime,
    "CHAIN",
    `write completed chain=${params.chainSelectorName} txHash=${txHash}`,
  );
  return { txHash };
};

export const hasEntitlementOnchain = (
  runtime: Runtime<unknown>,
  buyer: Address,
  productId: string,
): boolean => {
  const chainSelectorName = getCommerceChainSelectorName(runtime);
  const registry = getEntitlementRegistryAddress(runtime);

  const data = encodeFunctionData({
    abi: EntitlementRegistry,
    functionName: "hasEntitlement",
    args: [buyer, productId],
  });

  const raw = callContractRead(runtime, {
    chainSelectorName,
    to: registry,
    data,
  });

  return decodeFunctionResult({
    abi: EntitlementRegistry,
    functionName: "hasEntitlement",
    data: raw,
  });
};

export const recordEntitlementOnchain = (
  runtime: Runtime<unknown>,
  buyer: Address,
  productId: string,
): { txHash: Hex } => {
  const chainSelectorName = getCommerceChainSelectorName(runtime);
  const registry = getEntitlementRegistryAddress(runtime);

  const reportData = encodeAbiParameters(
    [
      { type: "uint8" },
      { type: "address" },
      { type: "string" },
      { type: "uint8" },
    ],
    [0, buyer, productId, 0],
  );

  return writeContractReport(runtime, {
    chainSelectorName,
    receiver: registry,
    callData: reportData,
  });
};

export type OnchainProductStatus = "ACTIVE" | "PAUSED" | "DISCONTINUED" | "BANNED";

const statusToCode = (status: OnchainProductStatus): number => {
  switch (status) {
    case "ACTIVE":
      return 0;
    case "PAUSED":
      return 1;
    case "DISCONTINUED":
      return 2;
    case "BANNED":
      return 3;
    default: {
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
};

const codeToStatus = (code: number): OnchainProductStatus => {
  switch (code) {
    case 0:
      return "ACTIVE";
    case 1:
      return "PAUSED";
    case 2:
      return "DISCONTINUED";
    case 3:
      return "BANNED";
    default:
      throw new Error(`unknown onchain product status code: ${code}`);
  }
};

export const getProductStatusOnchain = (
  runtime: Runtime<unknown>,
  productId: string,
): OnchainProductStatus => {
  const chainSelectorName = getCommerceChainSelectorName(runtime);
  const registry = getEntitlementRegistryAddress(runtime);

  const data = encodeFunctionData({
    abi: EntitlementRegistry,
    functionName: "getStatus",
    args: [productId],
  });

  const raw = callContractRead(runtime, {
    chainSelectorName,
    to: registry,
    data,
  });

  const statusCode = Number(
    decodeFunctionResult({
      abi: EntitlementRegistry,
      functionName: "getStatus",
      data: raw,
    }),
  );

  return codeToStatus(statusCode);
};

export const setProductStatusOnchain = (
  runtime: Runtime<unknown>,
  productId: string,
  status: OnchainProductStatus,
): { txHash: Hex } => {
  const chainSelectorName = getCommerceChainSelectorName(runtime);
  const registry = getEntitlementRegistryAddress(runtime);
  const reportData = encodeAbiParameters(
    [
      { type: "uint8" },
      { type: "address" },
      { type: "string" },
      { type: "uint8" },
    ],
    [1, zeroAddress, productId, statusToCode(status)],
  );

  return writeContractReport(runtime, {
    chainSelectorName,
    receiver: registry,
    callData: reportData,
  });
};

export const quoteCheckoutSplitFromGross = (
  runtime: Runtime<unknown>,
  grossAmountDecimal: string | number,
): { feeBps: number; grossAmount: number; feeAmount: number; merchantNetAmount: number } | null => {
  const checkout = getCommerceCheckoutAddress(runtime);
  if (!checkout) return null;

  const chainSelectorName = getCommerceChainSelectorName(runtime);
  const decimalsRaw = Number.parseInt(optionalSetting(runtime, "COMMERCE_TOKEN_DECIMALS", "6"), 10);
  const decimals = Number.isFinite(decimalsRaw) && decimalsRaw >= 0 ? decimalsRaw : 6;
  const grossUnits = parseUnits(String(grossAmountDecimal), decimals);

  const feeBpsData = encodeFunctionData({
    abi: CommerceCheckout,
    functionName: "feeBps",
    args: [],
  });
  const feeBpsRaw = callContractRead(runtime, {
    chainSelectorName,
    to: checkout,
    data: feeBpsData,
  });
  const feeBps = Number(
    decodeFunctionResult({
      abi: CommerceCheckout,
      functionName: "feeBps",
      data: feeBpsRaw,
    }),
  );

  const denominator = BigInt(10_000 + feeBps);
  const baseCandidate = (grossUnits * 10_000n) / denominator;
  const candidates = [baseCandidate, baseCandidate + 1n];

  for (const baseUnits of candidates) {
    if (baseUnits <= 0n) continue;

    const quoteData = encodeFunctionData({
      abi: CommerceCheckout,
      functionName: "quoteSplit",
      args: [baseUnits],
    });
    const quoteRaw = callContractRead(runtime, {
      chainSelectorName,
      to: checkout,
      data: quoteData,
    });
    const [quotedGross, quotedFee, quotedMerchantNet] = decodeFunctionResult({
      abi: CommerceCheckout,
      functionName: "quoteSplit",
      data: quoteRaw,
    }) as [bigint, bigint, bigint];

    if (quotedGross !== grossUnits) continue;

    return {
      feeBps,
      grossAmount: Number(formatUnits(quotedGross, decimals)),
      feeAmount: Number(formatUnits(quotedFee, decimals)),
      merchantNetAmount: Number(formatUnits(quotedMerchantNet, decimals)),
    };
  }

  throw new Error(
    `checkout quote mismatch for gross amount ${grossAmountDecimal}; ensure listing price matches checkout quote rules`,
  );
};
