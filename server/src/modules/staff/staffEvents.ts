import type { Response } from "express";

/**
 * In-memory SSE (Server-Sent Events) hub for the staff dashboard.
 *
 * Push notifications (web-push) are best-effort and unreliable on phones,
 * so they must NOT be the only realtime channel. While the staff dashboard
 * is open, it keeps a persistent SSE connection and gets events instantly.
 * Polling stays as a fallback for when the connection drops.
 */

export type StaffEventKind =
  | "CALL_CREATED"
  | "ORDER_CREATED"
  | "PAYMENT_REQUESTED"
  | "DATA_CHANGED";

export type StaffEvent = {
  kind: StaffEventKind;
  venueId: number;
  at: number;
  tableCode?: string | null;
};

type Client = {
  id: number;
  venueId: number;
  res: Response;
};

const clientsByVenue = new Map<number, Set<Client>>();
let nextClientId = 1;
let heartbeat: NodeJS.Timeout | null = null;

const HEARTBEAT_MS = 25_000;

function ensureHeartbeat() {
  if (heartbeat) return;

  heartbeat = setInterval(() => {
    for (const set of clientsByVenue.values()) {
      for (const client of set) {
        try {
          // SSE comment line — keeps proxies/load balancers from closing idle conn.
          client.res.write(`: ping ${Date.now()}\n\n`);
        } catch {
          // best-effort; the close handler will clean it up
        }
      }
    }
  }, HEARTBEAT_MS);

  // Don't keep the process alive just for the heartbeat.
  heartbeat.unref?.();
}

export function addStaffClient(venueId: number, res: Response): () => void {
  ensureHeartbeat();

  const client: Client = { id: nextClientId++, venueId, res };

  let set = clientsByVenue.get(venueId);
  if (!set) {
    set = new Set();
    clientsByVenue.set(venueId, set);
  }
  set.add(client);

  return () => {
    const current = clientsByVenue.get(venueId);
    if (!current) return;
    current.delete(client);
    if (current.size === 0) clientsByVenue.delete(venueId);
  };
}

export function emitStaffEvent(
  venueId: number,
  event: Omit<StaffEvent, "venueId" | "at"> & { at?: number }
) {
  const set = clientsByVenue.get(venueId);
  if (!set || set.size === 0) return;

  const payload: StaffEvent = {
    kind: event.kind,
    venueId,
    at: event.at ?? Date.now(),
    tableCode: event.tableCode ?? null,
  };

  const frame = `event: staff\ndata: ${JSON.stringify(payload)}\n\n`;

  for (const client of set) {
    try {
      client.res.write(frame);
    } catch {
      // best-effort; the close handler will clean it up
    }
  }
}

export function staffEventClientCount(venueId?: number) {
  if (typeof venueId === "number") {
    return clientsByVenue.get(venueId)?.size ?? 0;
  }
  let total = 0;
  for (const set of clientsByVenue.values()) total += set.size;
  return total;
}
