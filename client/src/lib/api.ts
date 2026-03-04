const API = process.env.NEXT_PUBLIC_API_BASE_URL!;

type FetchOptions = Omit<RequestInit, "headers"> & {
  headers?: Record<string, string>;
};

export async function api<T>(path: string, options: FetchOptions = {}): Promise<T> {
  const res = await fetch(`${API}${path}`, {
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
      typeof data === "object" && data && "message" in data ? String((data as any).message) : `HTTP ${res.status}`;
    throw new Error(msg);
  }

  return data as T;  
}
