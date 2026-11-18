import type { Response } from "express";
import type { MenuSection, StaffRole } from "@prisma/client";

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
  | "GUEST_MESSAGE"
  | "ORDER_CREATED"
  | "PAYMENT_REQUESTED"
  | "TICKET_NEW"
  | "TICKET_REMINDER"
  | "TICKET_READY"
  | "TICKET_CANCELLED"
  | "DATA_CHANGED";

export type StaffEvent = {
  kind: StaffEventKind;
  venueId: number;
  at: number;
  tableCode?: string | null;
  // Stable per-entity tag (e.g. `call_new:<id>`), shared with the web-push
  // payload tag. The client dedupes alerts on this, so the SAME event arriving
  // via both SSE and push beeps once, while DISTINCT events always beep.
  tag?: string | null;
  /** Hookah or drinks / food: the bar tablet sounds a hookah differently. */
  station?: MenuSection | null;
};

type Client = {
  id: number;
  venueId: number;
  role: StaffRole;
  res: Response;
  deviceId: string | null;
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
          // Keeps proxies from closing the idle connection AND lets the screen
          // see the line is alive (a comment line is invisible to the page).
          client.res.write(`event: ping\ndata: ${Date.now()}\n\n`);
        } catch {
          // best-effort; the close handler will clean it up
        }
      }
    }
  }, HEARTBEAT_MS);

  // Don't keep the process alive just for the heartbeat.
  heartbeat.unref?.();
}

export function addStaffClient(
  venueId: number,
  role: StaffRole,
  res: Response,
  deviceId: string | null = null
): () => void {
  ensureHeartbeat();

  const client: Client = { id: nextClientId++, venueId, role, res, deviceId };

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

/**
 * `roles` limits an alert to the people it is meant for (a hookah call must not
 * beep on the kitchen iPad). Without it the event goes to the whole venue —
 * that is what DATA_CHANGED refreshes rely on.
 */
export function emitStaffEvent(
  venueId: number,
  event: Omit<StaffEvent, "venueId" | "at"> & {
    at?: number;
    roles?: StaffRole[];
    /** The device that caused the event: it gets no alert about its own action. */
    exceptDevice?: string | null;
  }
) {
  const set = clientsByVenue.get(venueId);
  if (!set || set.size === 0) return;

  const payload: StaffEvent = {
    kind: event.kind,
    venueId,
    at: event.at ?? Date.now(),
    tableCode: event.tableCode ?? null,
    tag: event.tag ?? null,
    station: event.station ?? null,
  };

  const frame = `event: staff\ndata: ${JSON.stringify(payload)}\n\n`;

  for (const client of set) {
    if (event.roles && !event.roles.includes(client.role)) continue;
    if (event.exceptDevice && client.deviceId === event.exceptDevice) continue;
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
