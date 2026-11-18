import type { MenuSection } from "@/types";

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
  /** HOOKAH plays the hookah tunes (the bar tablet hears drinks and hookahs). */
  station?: MenuSection | null;
  venueId?: number | null;
  venueSlug?: string | null;
  vibrate?: number[];
};

let audioCtx: AudioContext | null = null;
let primed = false;
// Station screens (kitchen / bar / hookah-zone tablets) play a louder, longer
// version of every alert. Waiter and manager phones keep the normal one.
let stationProfile = false;

export function setStationAlertProfile(on: boolean) {
  stationProfile = on;
}
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

/**
 * Hookahs have tunes of their own, so the bar tablet (drinks on the left,
 * hookahs on the right) tells them apart by ear: the bar dings two notes back
 * and forth, a hookah climbs.
 */
function hookahPatternFor(kind?: StaffAlertKind): { tones: number[]; gain: number } | null {
  switch (kind) {
    case "TICKET_NEW":
      return { tones: [523, 659, 784, 1047], gain: 0.4 };
    case "TICKET_REMINDER":
      return { tones: [523, 784, 1047, 523, 784, 1047], gain: 0.5 };
    case "TICKET_CANCELLED":
      return { tones: [1047, 523, 1047, 523], gain: 0.35 };
    default:
      return null;
  }
}

function tonePatternFor(payload?: StaffPushPayload): { tones: number[]; gain: number } {
  if (payload?.station === "HOOKAH") {
    const hookah = hookahPatternFor(payload.kind);
    if (hookah) return hookah;
  }
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

// Louder and longer on station tablets: a square wave carries over kitchen
// noise, and the pattern repeats (the reminder three times).
function stationPatternFor(payload?: StaffPushPayload) {
  const { tones } = tonePatternFor(payload);
  switch (payload?.kind) {
    case "TICKET_REMINDER":
      return { tones, gain: 0.6, repeats: 3 };
    case "TICKET_NEW":
      return { tones, gain: 0.55, repeats: 2 };
    default:
      return { tones, gain: 0.5, repeats: 2 };
  }
}

// Two alerts at the same moment (a drink and a hookah, two reminders) play one
// after the other, never on top of each other — each stays recognisable.
const GAP_BETWEEN_ALERTS_S = 0.3;
// A long queue never delays an alert by more than this.
const MAX_ALERT_DELAY_S = 8;
let soundFreeAt = 0;

function play(ctx: AudioContext, payload?: StaffPushPayload) {
  const station = stationProfile;
  const { tones, gain: peak, repeats } = station
    ? stationPatternFor(payload)
    : { ...tonePatternFor(payload), repeats: 1 };
  const step = station ? 0.26 : 0.18;
  const length = station ? 0.22 : 0.16;
  const pause = station ? 0.35 : 0;

  const now = ctx.currentTime;
  const begin = Math.max(now, Math.min(soundFreeAt, now + MAX_ALERT_DELAY_S));
  const duration = repeats * tones.length * step + (repeats - 1) * pause;
  soundFreeAt = begin + duration + GAP_BETWEEN_ALERTS_S;

  for (let round = 0; round < repeats; round += 1) {
    const roundStart = round * (tones.length * step + pause);
    tones.forEach((freq, index) => {
      const startAt = begin + roundStart + index * step;
      const endAt = startAt + length;

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = station ? "square" : "triangle";
      osc.frequency.setValueAtTime(freq, startAt);

      gain.gain.setValueAtTime(0.0001, startAt);
      gain.gain.exponentialRampToValueAtTime(peak, startAt + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, endAt);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(startAt);
      osc.stop(endAt);
    });
  }
}

export function beep(payload?: StaffPushPayload) {
  try {
    const ctx = getAudioCtx();
    if (!ctx) return;

    if (stationProfile && (!primed || ctx.state !== "running")) {
      // A station tablet must not stay silent because Android paused the
      // audio while the app was in the background: wake it and then play.
      // An installed app is allowed to do this without a tap.
      void primeAlerts()
        .then(() => {
          if (isAudioArmed()) play(ctx, payload);
        })
        .catch(() => {});
      return;
    }

    if (!primed || ctx.state === "suspended") return;
    play(ctx, payload);
  } catch {
    // ignore
  }
}

export function fireInAppAlert(payload?: StaffPushPayload) {
  if (!shouldFire(payload)) return;
  vibrate(payload?.vibrate ?? DEFAULT_VIBRATE);
  beep(payload);
}
