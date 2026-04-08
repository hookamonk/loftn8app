export const ORDER_REQUEST_MARKER = "__ORDER_REQUEST__";

export function isOrderRequestMessage(message?: string | null) {
  return String(message ?? "").trim() === ORDER_REQUEST_MARKER;
}
