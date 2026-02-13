import { z } from "zod";
import type { WorkflowInput } from "./types";

const deliverySchema = z.object({
  type: z.enum(["download", "api", "license", "content_unlock"]),
  format: z.enum(["pdf", "zip", "json", "key", "html", "other"]),
  access: z.enum(["direct", "gated"]),
  restoreSupported: z.boolean().default(true),
});

const pricingSchema = z.object({
  currency: z.string().min(1),
  chain: z.string().min(1),
  amount: z.string().min(1),
});

const policiesSchema = z
  .object({
    refundPolicy: z.enum(["no_refunds", "limited", "standard"]).optional(),
    regionDenylist: z.array(z.string()).optional(),
    maxPurchasesPerBuyer: z.number().int().positive().optional(),
  })
  .optional();

const listingSchema = z.object({
  productId: z.string().min(1).optional(),
  merchant: z.string().startsWith("0x"),
  title: z.string().min(3),
  description: z.string().min(20),
  category: z.enum([
    "template",
    "download",
    "report",
    "api_credits",
    "license_key",
    "unlock",
  ]),
  delivery: deliverySchema,
  pricing: pricingSchema,
  tags: z.array(z.string()).default([]),
  policies: policiesSchema,
});

const createListingInputSchema = z.object({
  action: z.literal("createListing"),
  listing: listingSchema,
});

const listInputSchema = z.object({
  action: z.literal("list"),
  limit: z.number().int().positive().max(100).optional(),
  merchant: z.string().startsWith("0x").optional(),
  includeInactive: z.boolean().optional(),
});

const searchInputSchema = z.object({
  action: z.literal("search"),
  query: z.string().optional(),
  tags: z.array(z.string()).optional(),
  limit: z.number().int().positive().max(100).optional(),
});

const x402ProofSchema = z.object({
  paymentRequired: z.unknown(),
  paymentSignature: z.unknown(),
  settlementTx: z.object({
    txHash: z.string().min(1),
    chainId: z.union([z.string().min(1), z.number().int().positive()]),
    from: z.string().optional(),
    to: z.string().optional(),
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
});

const proofSchema = z.union([
  z.object({ x402: x402ProofSchema }),
  z.object({ tx: txProofSchema }),
  x402ProofSchema,
  txProofSchema,
]);

const purchaseInputSchema = z.object({
  action: z.literal("purchase"),
  intentId: z.string().min(1),
  buyer: z.string().startsWith("0x"),
  merchant: z.string().startsWith("0x"),
  productId: z.string().min(1),
  pricing: pricingSchema,
  feeBps: z.number().int().nonnegative().max(10_000).default(100),
  proof: proofSchema,
});

const settleInputSchema = z.object({
  action: z.literal("settle"),
  intentId: z.string().min(1),
  settlementTxHash: z.string().min(1).optional(),
  settledBy: z.string().optional(),
});

const restoreInputSchema = z.object({
  action: z.literal("restore"),
  buyer: z.string().startsWith("0x"),
  productId: z.string().min(1),
});

const refundInputSchema = z.object({
  action: z.literal("refund"),
  intentId: z.string().optional(),
  buyer: z.string().startsWith("0x"),
  productId: z.string().min(1),
  reason: z.string().optional(),
});

const governanceInputSchema = z.object({
  action: z.literal("governance"),
  actor: z.string().startsWith("0x"),
  productId: z.string().min(1),
  status: z.enum(["ACTIVE", "PAUSED", "DISCONTINUED", "BANNED"]),
});

const verifyInputSchema = z.object({
  action: z.literal("verify"),
  proof: proofSchema,
});

const decideInputSchema = z.object({
  action: z.literal("decide"),
  allow: z.boolean().optional(),
  reasonCode: z.string().optional(),
  context: z.record(z.unknown()).optional(),
});

export type Listing = z.infer<typeof listingSchema>;
export type CreateListingInput = z.infer<typeof createListingInputSchema>;
export type ListInput = z.infer<typeof listInputSchema>;
export type SearchInput = z.infer<typeof searchInputSchema>;
export type PurchaseInput = z.infer<typeof purchaseInputSchema>;
export type SettleInput = z.infer<typeof settleInputSchema>;
export type RestoreInput = z.infer<typeof restoreInputSchema>;
export type RefundInput = z.infer<typeof refundInputSchema>;
export type GovernanceInput = z.infer<typeof governanceInputSchema>;
export type VerifyInput = z.infer<typeof verifyInputSchema>;
export type DecideInput = z.infer<typeof decideInputSchema>;

export const validateCreateListingInput = (input: WorkflowInput): CreateListingInput =>
  createListingInputSchema.parse(input);

export const validateListInput = (input: WorkflowInput): ListInput =>
  listInputSchema.parse(input);

export const validateSearchInput = (input: WorkflowInput): SearchInput =>
  searchInputSchema.parse(input);

export const validatePurchaseInput = (input: WorkflowInput): PurchaseInput =>
  purchaseInputSchema.parse(input);

export const validateSettleInput = (input: WorkflowInput): SettleInput =>
  settleInputSchema.parse(input);

export const validateRestoreInput = (input: WorkflowInput): RestoreInput =>
  restoreInputSchema.parse(input);

export const validateRefundInput = (input: WorkflowInput): RefundInput =>
  refundInputSchema.parse(input);

export const validateGovernanceInput = (input: WorkflowInput): GovernanceInput =>
  governanceInputSchema.parse(input);

export const validateVerifyInput = (input: WorkflowInput): VerifyInput =>
  verifyInputSchema.parse(input);

export const validateDecideInput = (input: WorkflowInput): DecideInput =>
  decideInputSchema.parse(input);
