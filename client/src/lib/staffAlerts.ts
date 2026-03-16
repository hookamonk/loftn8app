export type StaffPushPayload = {
  title?: string;
  body?: string;
  url?: string;
  tag?: string;
  ts?: number;
};

let audioCtx: AudioContext | null = null;
let primed = false;
let lastBeepAt = 0;

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

export function beep() {
  try {
    const ctx = getAudioCtx();
    if (!ctx) return;

    const now = Date.now();
    if (now - lastBeepAt < 700) return;
    lastBeepAt = now;

    if (!primed || ctx.state === "suspended") return;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "triangle";
    osc.frequency.setValueAtTime(920, ctx.currentTime);
    gain.gain.setValueAtTime(0.14, ctx.currentTime);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    osc.stop(ctx.currentTime + 0.12);
  } catch {
    // ignore
  }
}

export function fireInAppAlert(_payload?: StaffPushPayload) {
  vibrate();
  beep();
}