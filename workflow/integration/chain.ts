import {
  EVMClient,
  LAST_FINALIZED_BLOCK_NUMBER,
  TxStatus,
  bytesToHex,
  encodeCallMsg,
  getNetwork,
  hexToBase64,
  type Runtime,
} from "@chainlink/cre-sdk";
import { decodeFunctionResult, encodeFunctionData } from "viem";
import { zeroAddress, type Address, type Hex } from "viem";
import { EntitlementRegistry } from "../../contracts/abi";
import { optionalSetting, requireSetting } from "../lib/env";

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
  runtime.log(`CHECK: chain read start chain=${params.chainSelectorName}`);
  const client = resolveClient(params);
  const reply = client
    .callContract(runtime, {
      call: encodeCallMsg({
        from: params.from ?? zeroAddress,
        to: params.to,
        data: params.data,
      }),
      blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
    })
    .result();

  runtime.log(`CHECK: chain read completed chain=${params.chainSelectorName}`);
  return bytesToHex(reply.data) as Hex;
};

export const writeContractReport = (
  runtime: Runtime<unknown>,
  params: ContractWriteReportParams,
): { txHash: Hex } => {
  runtime.log(`CHECK: chain write start chain=${params.chainSelectorName}`);
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
  runtime.log(
    `CHECK: chain write completed chain=${params.chainSelectorName} txHash=${txHash}`,
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

  const data = encodeFunctionData({
    abi: EntitlementRegistry,
    functionName: "recordEntitlement",
    args: [buyer, productId],
  });

  return writeContractReport(runtime, {
    chainSelectorName,
    receiver: registry,
    callData: data,
  });
};
