"use client";

/**
 * Typed fetch wrapper for the SafeHer REST API. The same endpoints will be
 * consumed by the React Native app — see docs/API.md.
 */
export class ApiClientError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
  }
}

let tokenProvider: () => Promise<string | null> = async () => null;
export function setTokenProvider(fn: () => Promise<string | null>) {
  tokenProvider = fn;
}

export async function api<T = unknown>(path: string, init: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  const token = await tokenProvider();
  let res: Response;
  try {
    res = await fetch(path, {
      method: init.method ?? (init.body !== undefined ? "POST" : "GET"),
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: init.signal,
      cache: "no-store",
    });
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    throw new ApiClientError(0, "network_error", "Network error — check your connection. If you are in danger, call 112.");
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = (json as { error?: { code: string; message: string; details?: unknown } }).error;
    throw new ApiClientError(res.status, e?.code ?? "error", e?.message ?? `Request failed (${res.status})`, e?.details);
  }
  return json as T;
}
