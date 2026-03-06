
const API = "/api";

type FetchOptions = Omit<RequestInit, "headers"> & {
  headers?: Record<string, string>;
};

export async function api<T>(path: string, options: FetchOptions = {}): Promise<T> {
  const base = API.replace(/\/$/, "");
  const url = `${base}${path.startsWith("/") ? path : `/${path}`}`;

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
    throw new Error(msg);
  }

  return data as T;
}