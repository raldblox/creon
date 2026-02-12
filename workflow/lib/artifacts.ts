const checksum = (value: string): string => {
  let hash = 5381;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 33) ^ value.charCodeAt(i);
  }
  return (hash >>> 0).toString(16);
};

export type PolicyArtifact = {
  policyHash: string;
  llmHash: string;
  artifactHash: string;
};

export const buildPolicyArtifact = (
  policyOutput: Record<string, unknown>,
  llmOutput: Record<string, unknown>,
): PolicyArtifact => {
  const policyRaw = JSON.stringify(policyOutput);
  const llmRaw = JSON.stringify(llmOutput);
  const policyHash = checksum(policyRaw);
  const llmHash = checksum(llmRaw);
  const artifactHash = checksum(`${policyHash}:${llmHash}`);
  return { policyHash, llmHash, artifactHash };
};
