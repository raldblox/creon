import type { Runtime } from "@chainlink/cre-sdk";
import { z } from "zod";

const x402ProofSchema = z.object({
  paymentRequired: z.unknown(),
  paymentSignature: z.unknown(),
  settlementTx: z.object({
    txHash: z.string().min(1),
    chainId: z.union([z.string().min(1), z.number().int().positive()]),
    from: z.string().min(1).optional(),
    to: z.string().min(1).optional(),
    amount: z.union([z.string(), z.number()]).optional(),
    token: z.string().optional(),
  }),
  network: z.string().optional(),
  asset: z.string().optional(),
});

const txProofSchema = z.object({
  chainId: z.union([z.string().min(1), z.number().int().positive()]),
  txHash: z.string().min(1),
  payer: z.string().min(1),
  payTo: z.string().min(1),
  amount: z.union([z.string(), z.number()]),
  token: z.string().min(1),
  receiptLogs: z.array(z.unknown()).optional(),
});

const anyProofSchema = z.union([
  z.object({ x402: x402ProofSchema }),
  z.object({ tx: txProofSchema }),
  x402ProofSchema,
  txProofSchema,
]);

export type NormalizedProof =
  | {
      kind: "x402";
      chainId: string;
      txHash: string;
      payer: string;
      payTo: string;
      amount?: string;
      token?: string;
      network?: string;
      asset?: string;
      fingerprint: string;
      raw: z.infer<typeof x402ProofSchema>;
    }
  | {
      kind: "tx";
      chainId: string;
      txHash: string;
      payer: string;
      payTo: string;
      amount: string;
      token: string;
      fingerprint: string;
      raw: z.infer<typeof txProofSchema>;
    };

const normalizeChainId = (value: string | number): string => String(value);
const normalizeAmount = (value: string | number | undefined): string | undefined =>
  value === undefined ? undefined : String(value);

const computeFingerprint = (
  kind: "x402" | "tx",
  chainId: string,
  txHash: string,
  payer: string,
  payTo: string,
  amount: string | undefined,
  token: string | undefined,
): string =>
  [
    "proof",
    kind,
    chainId.toLowerCase(),
    txHash.toLowerCase(),
    payer.toLowerCase(),
    payTo.toLowerCase(),
    (amount ?? "").toLowerCase(),
    (token ?? "").toLowerCase(),
  ].join(":");

export const normalizePaymentProof = (
  runtime: Runtime<unknown>,
  proof: unknown,
): NormalizedProof => {
  runtime.log("CHECK: x402 normalization start");
  const parsed = anyProofSchema.parse(proof);

  let normalized: NormalizedProof;
  if ("x402" in parsed || "settlementTx" in parsed) {
    const x402 = "x402" in parsed ? parsed.x402 : parsed;
    const chainId = normalizeChainId(x402.settlementTx.chainId);
    const txHash = x402.settlementTx.txHash;
    const payer = x402.settlementTx.from ?? "";
    const payTo = x402.settlementTx.to ?? "";
    const amount = normalizeAmount(x402.settlementTx.amount);
    const token = x402.settlementTx.token;

    normalized = {
      kind: "x402",
      chainId,
      txHash,
      payer,
      payTo,
      amount,
      token,
      network: x402.network,
      asset: x402.asset,
      fingerprint: computeFingerprint(
        "x402",
        chainId,
        txHash,
        payer,
        payTo,
        amount,
        token,
      ),
      raw: x402,
    };
  } else {
    const tx = "tx" in parsed ? parsed.tx : parsed;
    const chainId = normalizeChainId(tx.chainId);
    const txHash = tx.txHash;
    const payer = tx.payer;
    const payTo = tx.payTo;
    const amount = String(tx.amount);
    const token = tx.token;

    normalized = {
      kind: "tx",
      chainId,
      txHash,
      payer,
      payTo,
      amount,
      token,
      fingerprint: computeFingerprint(
        "tx",
        chainId,
        txHash,
        payer,
        payTo,
        amount,
        token,
      ),
      raw: tx,
    };
  }

  runtime.log(`CHECK: x402 normalization completed kind=${normalized.kind}`);
  return normalized;
};
