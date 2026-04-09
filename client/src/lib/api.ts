const API = "/api";

type FetchOptions = Omit<RequestInit, "headers"> & {
  headers?: Record<string, string>;
};

const RETRYABLE_STATUS = new Set([502, 503, 504]);

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export async function api<T>(path: string, options: FetchOptions = {}): Promise<T> {
  const base = API.replace(/\/$/, "");
  const url = `${base}${path.startsWith("/") ? path : `/${path}`}`;

  const method = String(options.method ?? "GET").toUpperCase();
  const maxAttempts = method === "GET" ? 3 : 1;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const res = await fetch(url, {
        ...options,
        headers: {
          "Content-Type": "application/json",
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
          await sleep(350 * attempt);
          continue;
        }

        throw new Error(msg);
      }

      return data as T;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("Request failed");

      if (attempt < maxAttempts) {
        await sleep(350 * attempt);
        continue;
      }
      break;
    }
  }

  throw lastError ?? new Error("Request failed");
}
