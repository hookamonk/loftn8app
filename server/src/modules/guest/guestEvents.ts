import type { Response } from "express";

/**
 * In-memory SSE hub for guests, keyed by tableId. The bill/orders are shared
 * per table, so any change (staff accepts/prepares/delivers an order, confirms
 * a payment, acknowledges a call…) is broadcast to every guest currently
 * connected at that table. The client just refetches its feed on each ping —
 * instant updates with no page reload, polling stays only as a fallback.
 */

type Client = { id: number; tableId: number; res: Response };

const clientsByTable = new Map<number, Set<Client>>();
let nextClientId = 1;
let heartbeat: NodeJS.Timeout | null = null;

const HEARTBEAT_MS = 25_000;

function ensureHeartbeat() {
  if (heartbeat) return;
  heartbeat = setInterval(() => {
    for (const set of clientsByTable.values()) {
      for (const client of set) {
        try {
          client.res.write(`: ping ${Date.now()}\n\n`);
        } catch {
          // best-effort; close handler cleans up
        }
      }
    }
  }, HEARTBEAT_MS);
  heartbeat.unref?.();
}

export function addGuestClient(tableId: number, res: Response): () => void {
  ensureHeartbeat();

  const client: Client = { id: nextClientId++, tableId, res };
  let set = clientsByTable.get(tableId);
  if (!set) {
    set = new Set();
    clientsByTable.set(tableId, set);
  }
  set.add(client);

  return () => {
    const current = clientsByTable.get(tableId);
    if (!current) return;
    current.delete(client);
    if (current.size === 0) clientsByTable.delete(tableId);
  };
}

/**
 * Tell every guest at `tableId` that something changed — they refetch the feed.
 * `reason` is informational only (for logging/debugging on the client).
 */
export function emitGuestEvent(tableId: number | null | undefined, reason: string) {
  if (typeof tableId !== "number") return;
  const set = clientsByTable.get(tableId);
  if (!set || set.size === 0) return;

  const frame = `event: guest\ndata: ${JSON.stringify({ reason, at: Date.now() })}\n\n`;
  for (const client of set) {
    try {
      client.res.write(frame);
    } catch {
      // best-effort; close handler cleans up
    }
  }
}