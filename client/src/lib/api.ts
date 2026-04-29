import { ensureBackendWarm } from "@/lib/backendWarmup";
import { getVenueSlug } from "@/lib/venue";

const API = "/api";

type FetchOptions = Omit<RequestInit, "headers"> & {
  headers?: Record<string, string>;
};

const RETRYABLE_STATUS = new Set([502, 503, 504]);
const inFlightGetRequests = new Map<string, Promise<unknown>>();

function retryDelay(attempt: number) {
  return Math.min(1200 * attempt, 4000);
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function requestKey(url: string, options: FetchOptions, venueSlug?: string) {
  const headers = {
    "Content-Type": "application/json",
    ...(venueSlug ? { "X-Venue-Slug": venueSlug } : {}),
    ...(options.headers ?? {}),
  };

  return JSON.stringify({
    url,
    method: "GET",
    headers: Object.entries(headers).sort(([left], [right]) => left.localeCompare(right)),
  });
}

function withNoStoreQuery(url: string) {
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}__ts=${Date.now()}`;
}

export async function api<T>(path: string, options: FetchOptions = {}): Promise<T> {
  const base = API.replace(/\/$/, "");
  const baseUrl = `${base}${path.startsWith("/") ? path : `/${path}`}`;

  const method = String(options.method ?? "GET").toUpperCase();
  const maxAttempts = method === "GET" ? 3 : 1;
  const venueSlug = typeof window !== "undefined" ? getVenueSlug() : undefined;

  if (method !== "GET") {
    await ensureBackendWarm();
  }

  if (method === "GET") {
    const key = requestKey(baseUrl, options, venueSlug);
    const existing = inFlightGetRequests.get(key) as Promise<T> | undefined;
    if (existing) {
      return existing;
    }

    const pending = (async () => {
      try {
        return await performRequest<T>(baseUrl, options, maxAttempts, venueSlug);
      } finally {
        inFlightGetRequests.delete(key);
      }
    })();

    inFlightGetRequests.set(key, pending);
    return pending;
  }

  return performRequest<T>(baseUrl, options, maxAttempts, venueSlug);
}

async function performRequest<T>(
  url: string,
  options: FetchOptions,
  maxAttempts: number,
  venueSlug?: string
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const requestUrl = options.method && String(options.method).toUpperCase() !== "GET" ? url : withNoStoreQuery(url);
      const res = await fetch(requestUrl, {
        ...options,
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-cache, no-store, max-age=0",
          Pragma: "no-cache",
          ...(venueSlug ? { "X-Venue-Slug": venueSlug } : {}),
          ...(options.headers ?? {}),
        },
        credentials: "include",
      });

      const contentType = res.headers.get("content-type") || "";
      const data = contentType.includes("application/json") ? await res.json() : await res.text();

      if (!res.ok) {
        const msg =
          typeof data === "object" && data && "message" in data
            ? String((data as any).message)
            : `HTTP ${res.status}`;

        if (attempt < maxAttempts && RETRYABLE_STATUS.has(res.status)) {
          await sleep(retryDelay(attempt));
          continue;
        }

        throw new Error(msg);
      }

      return data as T;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("Request failed");

      if (attempt < maxAttempts) {
        await sleep(retryDelay(attempt));
        continue;
      }
      break;
    }
  }

  throw lastError ?? new Error("Request failed");
}
