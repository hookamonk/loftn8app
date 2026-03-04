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

/**
 * ВАЖНО: вызывать из user-gesture (клик по “Включить уведомления”),
 * чтобы браузер разрешил звук дальше.
 */
export async function primeAlerts(): Promise<void> {
  const ctx = getAudioCtx();
  if (!ctx) return;

  try {
    if (ctx.state === "suspended") await ctx.resume();

    // “тихий старт” — чтобы потом не блочило
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

// ✅ чтобы ты мог импортить ровно как у тебя в коде: `import { armAudio } ...`
export async function armAudio(): Promise<void> {
  return primeAlerts();
}

export function vibrate(pattern: number[] = [120, 60, 120]) {
  try {
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      (navigator as any).vibrate?.(pattern);
    }
  } catch {}
}

export function beep() {
  try {
    const ctx = getAudioCtx();
    if (!ctx) return;

    const now = Date.now();
    if (now - lastBeepAt < 900) return;
    lastBeepAt = now;

    if (!primed || ctx.state === "suspended") return;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "sine";
    osc.frequency.value = 880;
    gain.gain.value = 0.12;

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    osc.stop(ctx.currentTime + 0.08);
  } catch {}
}

export function fireInAppAlert(_payload?: StaffPushPayload) {
  // когда вкладка открыта — вибро + beep (если разлочено)
  vibrate();
  beep();
}
