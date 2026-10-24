export type StaffAlertKind =
  | "ORDER_CREATED"
  | "CALL_CREATED"
  | "GUEST_MESSAGE"
  | "PAYMENT_REQUESTED"
  | "TICKET_NEW"
  | "TICKET_REMINDER"
  | "TICKET_READY"
  | "TICKET_CANCELLED";

const ALERT_KINDS = new Set<string>([
  "ORDER_CREATED",
  "CALL_CREATED",
  "GUEST_MESSAGE",
  "PAYMENT_REQUESTED",
  "TICKET_NEW",
  "TICKET_REMINDER",
  "TICKET_READY",
  "TICKET_CANCELLED",
]);

/** Everything except plain "refresh" events makes a sound. */
export function isAlertKind(kind?: string | null): kind is StaffAlertKind {
  return !!kind && ALERT_KINDS.has(kind);
}

export type StaffPushPayload = {
  title?: string;
  body?: string;
  url?: string;
  tag?: string;
  ts?: number;
  kind?: StaffAlertKind;
  message?: string | null;
  tableCode?: string | null;
  venueId?: number | null;
  venueSlug?: string | null;
  vibrate?: number[];
};

let audioCtx: AudioContext | null = null;
let primed = false;
const DEFAULT_VIBRATE = [320, 140, 320, 140, 420];
const ALERT_DEDUPE_MS = 2500;
const recentAlerts = new Map<string, number>();

function getAudioCtx(): AudioContext | null {
  try {
    const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return null;
    audioCtx = audioCtx ?? new Ctx();
    return audioCtx;
  } catch {
    return null;
  }
}

export async function primeAlerts(): Promise<void> {
  const ctx = getAudioCtx();
  if (!ctx) return;

  try {
    // iOS/iPadOS 16.4+: play alerts even when the ringer switch is on silent —
    // a station iPad must never go quiet because of a side switch.
    const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
    if (session) session.type = "playback";
  } catch {
    // ignore
  }

  try {
    if (ctx.state !== "running") await ctx.resume();

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    gain.gain.value = 0.0001;

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.01);

    primed = true;
  } catch {
    // ignore
  }
}

export async function armAudio(): Promise<void> {
  return primeAlerts();
}

/**
 * Browsers only allow sound after a tap, and iOS suspends audio again when the
 * app goes to the background. Screens that must be heard check this and ask
 * for one tap when it is false.
 */
export function isAudioArmed() {
  return primed && audioCtx?.state === "running";
}

export function vibrate(pattern: number[] = [160, 80, 160]) {
  try {
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      navigator.vibrate?.(pattern);
    }
  } catch {
    // ignore
  }
}

function cleanupRecentAlerts(now: number) {
  for (const [key, ts] of recentAlerts.entries()) {
    if (now - ts > ALERT_DEDUPE_MS) {
      recentAlerts.delete(key);
    }
  }
}

function alertKey(payload?: StaffPushPayload) {
  // Prefer the stable per-entity tag (e.g. `call_new:<id>`): the SAME event
  // arriving via BOTH web-push and SSE shares one tag → one beep, while two
  // DISTINCT calls/orders (different ids → different tags) always beep
  // separately. Only fall back to kind+table when no tag is present.
  if (payload?.tag) return `tag:${payload.tag}`;
  const parts = [payload?.kind ?? "UNKNOWN", payload?.tableCode ?? ""];
  return parts.join("|");
}

function shouldFire(payload?: StaffPushPayload) {
  const now = Date.now();
  cleanupRecentAlerts(now);

  const key = alertKey(payload);
  const prev = recentAlerts.get(key);
  if (prev && now - prev < ALERT_DEDUPE_MS) {
    return false;
  }

  recentAlerts.set(key, now);
  return true;
}

function tonePatternFor(payload?: StaffPushPayload): { tones: number[]; gain: number } {
  switch (payload?.kind) {
    case "GUEST_MESSAGE":
      return { tones: [1120, 920, 1120], gain: 0.22 };
    case "CALL_CREATED":
      return { tones: [1040, 860, 1040], gain: 0.22 };
    case "PAYMENT_REQUESTED":
      return { tones: [780, 780, 980], gain: 0.22 };
    case "ORDER_CREATED":
      return { tones: [860, 980, 860], gain: 0.22 };
    case "TICKET_NEW":
      return { tones: [880, 1175, 880, 1175], gain: 0.4 };
    // Seatbelt chime: insistent, unmistakable, repeats until accepted.
    case "TICKET_REMINDER":
      return { tones: [1320, 1320, 1320, 1320, 1320, 1320], gain: 0.5 };
    case "TICKET_READY":
      return { tones: [660, 880, 1100], gain: 0.3 };
    case "TICKET_CANCELLED":
      return { tones: [990, 740, 520], gain: 0.35 };
    default:
      return { tones: [920, 860, 1020], gain: 0.22 };
  }
}

export function beep(payload?: StaffPushPayload) {
  try {
    const ctx = getAudioCtx();
    if (!ctx) return;
    if (!primed || ctx.state === "suspended") return;

    const { tones, gain: peak } = tonePatternFor(payload);

    tones.forEach((freq, index) => {
      const startAt = ctx.currentTime + index * 0.18;
      const endAt = startAt + 0.16;

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = "triangle";
      osc.frequency.setValueAtTime(freq, startAt);

      gain.gain.setValueAtTime(0.0001, startAt);
      gain.gain.exponentialRampToValueAtTime(peak, startAt + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, endAt);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(startAt);
      osc.stop(endAt);
    });
  } catch {
    // ignore
  }
}

export function fireInAppAlert(payload?: StaffPushPayload) {
  if (!shouldFire(payload)) return;
  vibrate(payload?.vibrate ?? DEFAULT_VIBRATE);
  beep(payload);
}
