import { classifyListingPolicy } from "../integration/openai";
import { insertOne } from "../integration/mongodb";
import { buildPolicyArtifact } from "../lib/artifacts";
import { evaluateDeterministicPolicy } from "../lib/policy";
import { validateCreateListingInput } from "../lib/schema";
import type { ActionHandler } from "../lib/types";

export const handleCreateListing: ActionHandler = (runtime, input) => {
  const parsed = validateCreateListingInput(input);
  runtime.log("CHECK: policy evaluated");

  const deterministic = evaluateDeterministicPolicy(parsed.listing);
  if (!deterministic.allow) {
    return {
      ok: false,
      action: "createListing",
      reasonCode: deterministic.reasonCode,
      message: "listing denied by deterministic policy",
      data: { flags: deterministic.flags },
    };
  }

  const llm = classifyListingPolicy(runtime, {
    title: parsed.listing.title,
    description: parsed.listing.description,
    category: parsed.listing.category,
    pricing: parsed.listing.pricing,
    tags: parsed.listing.tags,
    merchant: parsed.listing.merchant,
  });
  runtime.log("CHECK: llm classification completed");

  if (llm.recommendedPolicy === "deny") {
    return {
      ok: false,
      action: "createListing",
      reasonCode: "POLICY_DENY_LLM",
      message: "listing denied by classifier",
      data: { llm },
    };
  }

  const artifacts = buildPolicyArtifact(
    { deterministic },
    {
      complianceFlags: llm.complianceFlags,
      riskTier: llm.riskTier,
      recommendedPolicy: llm.recommendedPolicy,
      confidence: llm.confidence,
    },
  );

  const listingDocument = {
    ...parsed.listing,
    status: "ACTIVE",
    deterministicPolicy: deterministic,
    llmPolicy: llm,
    artifacts,
    createdAt: runtime.now().toISOString(),
    updatedAt: runtime.now().toISOString(),
  };

  const writeResult = insertOne(runtime, {
    collection: "products",
    document: listingDocument,
  });
  runtime.log("CHECK: mongodb write ok");

  return {
    ok: true,
    action: "createListing",
    reasonCode: "ALLOW",
    message: "listing created",
    data: {
      productId: parsed.listing.productId,
      insertedId:
        typeof writeResult.insertedId === "string"
          ? writeResult.insertedId
          : undefined,
      riskTier: llm.riskTier,
    },
  };
};
