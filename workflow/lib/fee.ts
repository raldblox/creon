const toAmount = (value: string | number): number => {
  const numeric = typeof value === "number" ? value : Number.parseFloat(value);
  if (!Number.isFinite(numeric) || numeric < 0) {
    throw new Error("invalid amount");
  }
  return numeric;
};

const round6 = (value: number): number => Math.round(value * 1_000_000) / 1_000_000;

export const computeFeeAmount = (baseAmount: string | number, feeBps: number): number => {
  const base = toAmount(baseAmount);
  return round6((base * feeBps) / 10_000);
};

export const computeTotalWithFee = (
  baseAmount: string | number,
  feeBps: number,
): number => {
  const base = toAmount(baseAmount);
  return round6(base + computeFeeAmount(base, feeBps));
};

export const verifyFeeAmount = (
  baseAmount: string | number,
  paidAmount: string | number | undefined,
  feeBps: number,
): { ok: boolean; expectedTotal: number; paidTotal?: number } => {
  const expectedTotal = computeTotalWithFee(baseAmount, feeBps);
  if (paidAmount === undefined) {
    return { ok: false, expectedTotal };
  }

  const paidTotal = toAmount(paidAmount);
  const delta = Math.abs(paidTotal - expectedTotal);
  return {
    ok: delta <= 0.000001,
    expectedTotal,
    paidTotal,
  };
};
