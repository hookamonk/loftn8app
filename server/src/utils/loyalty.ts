const PRAGUE_TZ = "Europe/Prague";

type LoyaltyLike = {
  cashbackCzk: number;
  redeemedAmountCzk?: number | null;
  availableAt: Date | string;
  createdAt?: Date | string;
};

export function nextPragueMidnight(from: Date) {
  const pragueNow = toZonedDate(from, PRAGUE_TZ);
  const next = new Date(pragueNow);
  next.setHours(24, 0, 0, 0);
  return fromZonedDate(next, PRAGUE_TZ);
}

export function summarizeLoyalty(transactions: LoyaltyLike[], now = new Date()) {
  let availableCzk = 0;
  let pendingCzk = 0;
  let nextAvailableAt: Date | null = null;

  for (const txn of transactions) {
    const availableAt = effectiveAvailableAt(txn);
    const remaining = Math.max(txn.cashbackCzk - (txn.redeemedAmountCzk ?? 0), 0);
    if (!remaining) continue;

    if (availableAt.getTime() <= now.getTime()) {
      availableCzk += remaining;
      continue;
    }

    pendingCzk += remaining;
    if (!nextAvailableAt || availableAt.getTime() < nextAvailableAt.getTime()) {
      nextAvailableAt = availableAt;
    }
  }

  return {
    availableCzk,
    pendingCzk,
    nextAvailableAt,
  };
}

export function effectiveAvailableAt(txn: LoyaltyLike) {
  const rawAvailableAt = new Date(txn.availableAt);

  if (!txn.createdAt) {
    return rawAvailableAt;
  }

  const minAvailableAt = nextPragueMidnight(new Date(txn.createdAt));
  return rawAvailableAt.getTime() >= minAvailableAt.getTime() ? rawAvailableAt : minAvailableAt;
}

function toZonedDate(date: Date, timeZone: string) {
  return new Date(date.toLocaleString("en-US", { timeZone }));
}

function fromZonedDate(date: Date, timeZone: string) {
  const local = new Date(date.toLocaleString("en-US", { timeZone }));
  return new Date(date.getTime() + (date.getTime() - local.getTime()));
}
