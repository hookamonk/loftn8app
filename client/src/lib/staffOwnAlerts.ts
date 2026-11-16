"use client";

/**
 * Alerts this device caused itself (it punched the order, asked for the bill,
 * marked the hookah ready). The server already leaves this device out; this
 * list also keeps the screen's own backup check quiet about them.
 */
const OWN_TTL_MS = 10 * 60_000;
const own = new Map<string, number>();

export function markOwnAlerts(tags: Array<string | null | undefined>) {
  const now = Date.now();
  for (const [tag, at] of own) if (now - at > OWN_TTL_MS) own.delete(tag);
  for (const tag of tags) if (tag) own.set(tag, now);
}

export function isOwnAlert(tag: string | null | undefined) {
  if (!tag) return false;
  const at = own.get(tag);
  return at !== undefined && Date.now() - at <= OWN_TTL_MS;
}
