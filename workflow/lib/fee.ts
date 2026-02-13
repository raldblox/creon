const toAmount = (value: string | number): number => {
  const numeric = typeof value === "number" ? value : Number.parseFloat(value);
  if (!Number.isFinite(numeric) || numeric < 0) {
    throw new Error("invalid amount");
  }
  return numeric;
};

const round6 = (value: number): number => Math.round(value * 1_000_000) / 1_000_000;

export const computeFeeAmount = (paidAmount: string | number, feeBps: number): number => {
  const paid = toAmount(paidAmount);
  return round6((paid * feeBps) / 10_000);
};

export const verifyPaidAmountMatchesListing = (
  listedAmount: string | number,
  paidAmount: string | number | undefined,
): { ok: boolean; expectedPaid: number; paidTotal?: number } => {
  const expectedPaid = toAmount(listedAmount);
  if (paidAmount === undefined) {
    return { ok: false, expectedPaid };
  }

  const paidTotal = toAmount(paidAmount);
  const delta = Math.abs(paidTotal - expectedPaid);
  return {
    ok: delta <= 0.000001,
    expectedPaid,
    paidTotal,
  };
};
