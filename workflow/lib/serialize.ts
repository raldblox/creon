const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const stripNullish = (value: unknown): unknown => {
  if (value === null || value === undefined) {
    return undefined;
  }

  if (Array.isArray(value)) {
    const cleaned = value
      .map((item) => stripNullish(item))
      .filter((item) => item !== undefined);
    return cleaned;
  }

  if (isObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      const cleaned = stripNullish(item);
      if (cleaned !== undefined) {
        out[key] = cleaned;
      }
    }
    return out;
  }

  return value;
};

export const toJsonSafeValue = (value: unknown): unknown => {
  const cleaned = stripNullish(value);
  return JSON.parse(JSON.stringify(cleaned));
};
