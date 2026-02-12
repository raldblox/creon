import { classifyListingPolicy } from "../integration/openai";
import { insertOne } from "../integration/mongodb";
import { buildPolicyArtifact } from "../lib/artifacts";
import { optionalSetting } from "../lib/env";
import { evaluateDeterministicPolicy } from "../lib/policy";
import { validateCreateListingInput } from "../lib/schema";
import type { ActionHandler } from "../lib/types";

export const handleCreateListing: ActionHandler = (runtime, input) => {
  const parsed = validateCreateListingInput(input);
  const enablePolicyChecks =
    optionalSetting(runtime, "ENABLE_POLICY_CHECKS", "false").toLowerCase() ===
    "true";

  let deterministic: ReturnType<typeof evaluateDeterministicPolicy> | null = null;
  let llm: ReturnType<typeof classifyListingPolicy> | null = null;
  let artifacts: ReturnType<typeof buildPolicyArtifact> | null = null;

  if (enablePolicyChecks) {
    runtime.log("CHECK: policy evaluated");
    deterministic = evaluateDeterministicPolicy(parsed.listing);
    if (!deterministic.allow) {
      return {
        ok: false,
        action: "createListing",
        reasonCode: deterministic.reasonCode,
        message: "listing denied by deterministic policy",
        data: { flags: deterministic.flags },
      };
    }

    llm = classifyListingPolicy(runtime, {
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

    artifacts = buildPolicyArtifact(
      { deterministic },
      {
        complianceFlags: llm.complianceFlags,
        riskTier: llm.riskTier,
        recommendedPolicy: llm.recommendedPolicy,
        confidence: llm.confidence,
      },
    );
  } else {
    runtime.log("CHECK: policy checks skipped");
  }

  const listingDocument: Record<string, unknown> = {
    ...parsed.listing,
    status: "ACTIVE",
    createdAt: runtime.now().toISOString(),
    updatedAt: runtime.now().toISOString(),
  };
  if (deterministic) {
    listingDocument.deterministicPolicy = deterministic;
  }
  if (llm) {
    listingDocument.llmPolicy = llm;
  }
  if (artifacts) {
    listingDocument.artifacts = artifacts;
  }

  const writeResult = insertOne(runtime, {
    collection: "products",
    document: listingDocument,
  });
  runtime.log("CHECK: mongodb write ok");

  const responseData: Record<string, unknown> = {
    productId: parsed.listing.productId,
    riskTier: llm?.riskTier ?? "not_checked",
    policyChecksEnabled: enablePolicyChecks,
  };
  if (typeof writeResult.insertedId === "string") {
    responseData.insertedId = writeResult.insertedId;
  }

  return {
    ok: true,
    action: "createListing",
    reasonCode: "ALLOW",
    message: "listing created",
    data: responseData,
  };
};
