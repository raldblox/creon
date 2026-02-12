import type { Runtime } from "@chainlink/cre-sdk";
import { find, updateOne } from "../integration/mongodb";

export const hasReplayFingerprint = (
  runtime: Runtime<unknown>,
  fingerprint: string,
): boolean => {
  const res = find(runtime, {
    collection: "replay_store",
    filter: { fingerprint },
    limit: 1,
  });
  return res.documents.length > 0;
};

export const storeReplayFingerprint = (
  runtime: Runtime<unknown>,
  fingerprint: string,
  payload: Record<string, unknown>,
): void => {
  updateOne(runtime, {
    collection: "replay_store",
    filter: { fingerprint },
    update: {
      $setOnInsert: {
        fingerprint,
        ...payload,
        createdAt: runtime.now().toISOString(),
      },
    },
    upsert: true,
  });
};
