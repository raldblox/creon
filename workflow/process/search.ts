import { find } from "../integration/mongodb";
import { validateSearchInput } from "../lib/schema";
import type { ActionHandler } from "../lib/types";

export const handleSearch: ActionHandler = (runtime, input) => {
  const parsed = validateSearchInput(input);
  const clauses: Record<string, unknown>[] = [{ status: { $ne: "BANNED" } }];

  if (parsed.query && parsed.query.trim().length > 0) {
    const q = parsed.query.trim();
    clauses.push({
      $or: [
        { title: { $regex: q, $options: "i" } },
        { description: { $regex: q, $options: "i" } },
      ],
    });
  }

  if (parsed.tags && parsed.tags.length > 0) {
    clauses.push({ tags: { $in: parsed.tags } });
  }

  const response = find(runtime, {
    collection: "products",
    filter: clauses.length > 1 ? { $and: clauses } : clauses[0],
    sort: { createdAt: -1 },
    limit: parsed.limit ?? 20,
  });
  runtime.log("CHECK: mongodb read ok");

  return {
    ok: true,
    action: "search",
    reasonCode: "SEARCH_OK",
    message: "search results returned",
    data: {
      count: response.documents.length,
      items: response.documents,
    },
  };
};
