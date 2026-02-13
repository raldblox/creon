import { find } from "../integration/mongodb";
import { logStep } from "../lib/log";
import { validateListInput } from "../lib/schema";
import { stripNullish } from "../lib/serialize";
import type { ActionHandler } from "../lib/types";

export const handleList: ActionHandler = (runtime, input) => {
  const parsed = validateListInput(input);
  const filter: Record<string, unknown> = {};

  if (!parsed.includeInactive) {
    filter.status = { $ne: "BANNED" };
  }

  if (parsed.merchant) {
    filter.merchant = parsed.merchant;
  }

  const response = find(runtime, {
    collection: "products",
    filter,
    sort: { createdAt: -1 },
    limit: parsed.limit ?? 20,
  });
  logStep(runtime, "DATABASE", "list query completed");

  return {
    ok: true,
    action: "list",
    reasonCode: "LIST_OK",
    message: "listings returned",
    data: {
      count: response.documents.length,
      items: stripNullish(response.documents),
    },
  };
};
