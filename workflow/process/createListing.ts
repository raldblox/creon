import { classifyListingPolicy } from "../integration/openai";
import { insertOne } from "../integration/mongodb";
import { buildPolicyArtifact } from "../lib/artifacts";
import { optionalSetting } from "../lib/env";
import { logStep } from "../lib/log";
import { evaluateDeterministicPolicy } from "../lib/policy";
import { validateCreateListingInput } from "../lib/schema";
import type { ActionHandler } from "../lib/types";

export const handleCreateListing: ActionHandler = (runtime, input) => {
  const parsed = validateCreateListingInput(input);
  const enablePolicyChecksSetting = optionalSetting(
    runtime,
    "ENABLE_POLICY_CHECKS",
    "false",
  );
  const enablePolicyChecks = enablePolicyChecksSetting.toLowerCase() === "true";
  logStep(runtime, "OPENAI", `policy checks setting=${enablePolicyChecksSetting}`);

  let deterministic: ReturnType<typeof evaluateDeterministicPolicy> | null = null;
  let llm: ReturnType<typeof classifyListingPolicy> | null = null;
  let artifacts: ReturnType<typeof buildPolicyArtifact> | null = null;

  if (enablePolicyChecks) {
    logStep(runtime, "ACTION", "createListing deterministic policy evaluation");
    deterministic = evaluateDeterministicPolicy(parsed.listing);
    logStep(
      runtime,
      "ACTION",
      `deterministic signals allow=${deterministic.allow} flags=${deterministic.flags.join("|") || "none"}`,
    );

    llm = classifyListingPolicy(runtime, {
      title: parsed.listing.title,
      description: parsed.listing.description,
      category: parsed.listing.category,
      pricing: parsed.listing.pricing,
      tags: parsed.listing.tags,
      merchant: parsed.listing.merchant,
    });
    logStep(runtime, "OPENAI", "listing policy classification completed");

    if (llm.recommendedPolicy === "deny") {
      return {
        ok: false,
        action: "createListing",
        reasonCode: "POLICY_DENY_LLM",
        message: "listing denied by classifier",
        data: { llm, deterministic },
      };
    }

    artifacts = buildPolicyArtifact(
      { deterministic },
      {
        complianceFlags: llm.complianceFlags,
        complianceDomains: llm.complianceDomains,
        evidence: llm.evidence,
        riskTier: llm.riskTier,
        recommendedPolicy: llm.recommendedPolicy,
        confidence: llm.confidence,
      },
    );
  } else {
    logStep(runtime, "OPENAI", "policy checks disabled; skipping LLM classification");
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
  logStep(runtime, "MONGODB", "listing inserted into products");

  const responseData: Record<string, unknown> = {
    productId: parsed.listing.productId,
    riskTier: llm?.riskTier ?? "not_checked",
    policyChecksEnabled: enablePolicyChecks,
  };
  if (llm) {
    responseData.complianceDomains = llm.complianceDomains;
    responseData.evidenceCount = llm.evidence.length;
  }
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
