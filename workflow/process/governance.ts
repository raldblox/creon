import { updateOne } from "../integration/mongodb";
import { validateGovernanceInput } from "../lib/schema";
import type { ActionHandler } from "../lib/types";

export const handleGovernance: ActionHandler = (runtime, input) => {
  const parsed = validateGovernanceInput(input);

  updateOne(runtime, {
    collection: "products",
    filter: { productId: parsed.productId },
    update: {
      $set: {
        status: parsed.status,
        updatedAt: runtime.now().toISOString(),
        governanceActor: parsed.actor,
      },
    },
    upsert: false,
  });
  runtime.log("CHECK: mongodb write ok");

  return {
    ok: true,
    action: "governance",
    reasonCode: "GOVERNANCE_UPDATED",
    message: "product status updated",
    data: {
      productId: parsed.productId,
      status: parsed.status,
    },
  };
};
