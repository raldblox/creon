import type { Runtime } from "@chainlink/cre-sdk";

const DEFAULT_SECRET_NAMESPACES = ["env", "default", "workflow"];

const asConfigRecord = (runtime: Runtime<unknown>): Record<string, unknown> =>
  (runtime.config ?? {}) as Record<string, unknown>;

const readFromConfig = (
  runtime: Runtime<unknown>,
  key: string,
): string | undefined => {
  const value = asConfigRecord(runtime)[key];
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const readFromSecrets = (
  runtime: Runtime<unknown>,
  key: string,
  namespaces: readonly string[],
): string | undefined => {
  for (const namespace of namespaces) {
    try {
      const secret = runtime.getSecret({ id: key, namespace }).result();
      const value = secret.value?.trim();
      if (value) {
        return value;
      }
    } catch {
      // Keep searching through configured namespaces.
    }
  }
  return undefined;
};

export const requireSetting = (
  runtime: Runtime<unknown>,
  key: string,
  namespaces: readonly string[] = DEFAULT_SECRET_NAMESPACES,
): string => {
  const configValue = readFromConfig(runtime, key);
  if (configValue) {
    return configValue;
  }

  const secretValue = readFromSecrets(runtime, key, namespaces);
  if (secretValue) {
    return secretValue;
  }

  throw new Error(
    `missing required setting "${key}" (config or secrets namespace: ${namespaces.join(", ")})`,
  );
};

export const optionalSetting = (
  runtime: Runtime<unknown>,
  key: string,
  defaultValue: string,
  namespaces: readonly string[] = DEFAULT_SECRET_NAMESPACES,
): string => {
  const configValue = readFromConfig(runtime, key);
  if (configValue) {
    return configValue;
  }

  const secretValue = readFromSecrets(runtime, key, namespaces);
  if (secretValue) {
    return secretValue;
  }

  return defaultValue;
};
