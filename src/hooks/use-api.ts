"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiClientError, api } from "@/lib/api-client";

/**
 * Minimal data-fetching hook with loading/error states and optional polling.
 * Polling pauses while the tab is hidden to save battery.
 */
export function useApi<T>(path: string | null, opts: { pollMs?: number } = {}) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** HTTP status of the last error (e.g. 403 = no access), 0 for network errors. */
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [loading, setLoading] = useState(Boolean(path));
  const mounted = useRef(true);

  const load = useCallback(async () => {
    if (!path) return;
    try {
      const d = await api<T>(path);
      if (mounted.current) { setData(d); setError(null); setErrorStatus(null); }
    } catch (e) {
      if (mounted.current) { setError((e as Error).message); setErrorStatus(e instanceof ApiClientError ? e.status : null); }
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    mounted.current = true;
    setLoading(Boolean(path));
    load();
    if (!opts.pollMs) return () => { mounted.current = false; };
    const t = setInterval(() => { if (document.visibilityState === "visible") load(); }, opts.pollMs);
    return () => { mounted.current = false; clearInterval(t); };
  }, [load, opts.pollMs, path]);

  return { data, error, errorStatus, loading, reload: load, setData };
}
