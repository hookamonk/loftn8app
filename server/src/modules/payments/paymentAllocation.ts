type PaymentItemSnapshot = {
  orderItemId: string;
  menuItemId: number;
  name: string;
  qty: number;
  unitPriceCzk: number;
  totalCzk: number;
  comment?: string;
};

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

export function parsePaymentItemsJson(value: unknown): PaymentItemSnapshot[] {
  if (!Array.isArray(value)) return [];

  const result: PaymentItemSnapshot[] = [];

  for (const entry of value) {
    const item = asObject(entry);
    if (!item) continue;

    const orderItemId = typeof item.orderItemId === "string" ? item.orderItemId : null;
    const menuItemId = typeof item.menuItemId === "number" ? item.menuItemId : null;
    const name = typeof item.name === "string" ? item.name : null;
    const qty = typeof item.qty === "number" ? item.qty : null;
    const unitPriceCzk = typeof item.unitPriceCzk === "number" ? item.unitPriceCzk : null;
    const totalCzk = typeof item.totalCzk === "number" ? item.totalCzk : null;
    const comment = typeof item.comment === "string" ? item.comment : undefined;

    if (!orderItemId || !menuItemId || !name || !qty || !unitPriceCzk || totalCzk == null) continue;

    result.push({
      orderItemId,
      menuItemId,
      name,
      qty,
      unitPriceCzk,
      totalCzk,
      comment,
    });
  }

  return result;
}

export function latestLegacyPaymentCutoff(
  payments: Array<{
    status: string;
    createdAt: Date | string;
    confirmedAt?: Date | string | null;
    itemsJson?: unknown;
    confirmation?: { itemsJson?: unknown; createdAt?: Date | string | null } | null;
  }>
) {
  return payments.reduce((latest, payment) => {
    if (payment.status !== "CONFIRMED") return latest;

    const items = parsePaymentItemsJson(payment.confirmation?.itemsJson ?? payment.itemsJson);
    if (items.length > 0) return latest;

    const ts = new Date(
      payment.confirmedAt ?? payment.confirmation?.createdAt ?? payment.createdAt
    ).getTime();
    return Number.isFinite(ts) && ts > latest ? ts : latest;
  }, 0);
}

export function paidQtyByOrderItemId(
  payments: Array<{
    status: string;
    itemsJson?: unknown;
    confirmation?: { itemsJson?: unknown } | null;
  }>
) {
  const map = new Map<string, number>();

  for (const payment of payments) {
    if (payment.status !== "CONFIRMED") continue;

    const items = parsePaymentItemsJson(payment.confirmation?.itemsJson ?? payment.itemsJson);
    for (const item of items) {
      map.set(item.orderItemId, (map.get(item.orderItemId) ?? 0) + item.qty);
    }
  }

  return map;
}
