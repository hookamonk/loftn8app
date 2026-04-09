"use client";

const HEALTH_URL = "/api/health";
const WARM_TTL_MS = 45_000;

let lastWarmAt = 0;
let inFlight: Promise<void> | null = null;

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function pingHealth() {
  const res = await fetch(HEALTH_URL, {
    method: "GET",
    credentials: "include",
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(`HEALTH_${res.status}`);
  }
}

export async function ensureBackendWarm() {
  if (typeof window === "undefined") return;

  const now = Date.now();
  if (now - lastWarmAt < WARM_TTL_MS) return;

  if (inFlight) {
    await inFlight;
    return;
  }

  inFlight = (async () => {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        await pingHealth();
        lastWarmAt = Date.now();
        return;
      } catch {
        if (attempt < 3) {
          await sleep(250 * attempt);
          continue;
        }
      }
    }
  })();

  try {
    await inFlight;
  } finally {
    inFlight = null;
  }
}
