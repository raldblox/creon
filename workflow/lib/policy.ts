import type { Listing } from "./schema";

const blockedKeywords = [
  "stolen",
  "counterfeit",
  "fake passport",
  "hacking service",
  "malware",
  "credit card dump",
  "exploit kit",
];

const riskyPhrases = [
  "guaranteed profit",
  "double your money",
  "risk free return",
  "100% guaranteed",
];

export type DeterministicPolicyResult = {
  allow: boolean;
  reasonCode: string;
  flags: string[];
};

const toNumber = (amount: string): number => {
  const parsed = Number.parseFloat(amount);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
};

export const evaluateDeterministicPolicy = (
  listing: Listing,
): DeterministicPolicyResult => {
  const title = listing.title.toLowerCase();
  const description = listing.description.toLowerCase();
  const haystack = `${title}\n${description}`;
  const flags: string[] = [];

  for (const keyword of blockedKeywords) {
    if (haystack.includes(keyword)) {
      flags.push(`blocked_keyword:${keyword}`);
    }
  }

  for (const phrase of riskyPhrases) {
    if (haystack.includes(phrase)) {
      flags.push(`scam_phrase:${phrase}`);
    }
  }

  const amount = toNumber(listing.pricing.amount);
  if (Number.isFinite(amount) && amount > 10000) {
    flags.push("price_outlier");
  }

  if (flags.some((f) => f.startsWith("blocked_keyword"))) {
    return { allow: false, reasonCode: "POLICY_DENY_DISALLOWED_GOODS", flags };
  }

  if (flags.some((f) => f.startsWith("scam_phrase")) && flags.includes("price_outlier")) {
    return { allow: false, reasonCode: "POLICY_DENY_SCAM_PATTERN", flags };
  }

  return { allow: true, reasonCode: "POLICY_ALLOW", flags };
};
