export type StaffPushPayload = {
  title?: string;
  body?: string;
  url?: string;
  tag?: string;
  ts?: number;
  kind?: "ORDER_CREATED" | "CALL_CREATED" | "GUEST_MESSAGE" | "PAYMENT_REQUESTED";
  message?: string | null;
  tableCode?: string | null;
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
    if (ctx.state === "suspended") await ctx.resume();

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
  const tag = payload?.tag?.trim();
  if (tag) return tag;

  const parts = [
    payload?.kind ?? "UNKNOWN",
    payload?.tableCode ?? "",
    payload?.message ?? payload?.body ?? "",
  ];

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

function tonePatternFor(payload?: StaffPushPayload) {
  switch (payload?.kind) {
    case "GUEST_MESSAGE":
      return [1120, 920, 1120];
    case "CALL_CREATED":
      return [1040, 860, 1040];
    case "PAYMENT_REQUESTED":
      return [780, 780, 980];
    case "ORDER_CREATED":
      return [860, 980, 860];
    default:
      return [920, 860, 1020];
  }
}

export function beep(payload?: StaffPushPayload) {
  try {
    const ctx = getAudioCtx();
    if (!ctx) return;
    if (!primed || ctx.state === "suspended") return;

    const tones = tonePatternFor(payload);

    tones.forEach((freq, index) => {
      const startAt = ctx.currentTime + index * 0.18;
      const endAt = startAt + 0.16;

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = "triangle";
      osc.frequency.setValueAtTime(freq, startAt);

      gain.gain.setValueAtTime(0.0001, startAt);
      gain.gain.exponentialRampToValueAtTime(0.22, startAt + 0.02);
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
