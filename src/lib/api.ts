import { useCallback, useEffect, useRef, useState } from 'react';
import {
  reportNetworkFailure,
  reportNetworkSuccess,
  useOfflineStatus,
  type Freshness
} from './offline.js';

export interface OfflineAwareResult<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  /** LIVE | CACHED | STALE | OFFLINE */
  freshness: Freshness;
  fetchedAt: string | null;
  offline: boolean;
}

export interface OfflineAwareOptions {
  /** Poll interval in ms. Omit or 0 to fetch once. */
  pollMs?: number;
  /** Skip entirely (e.g. when unauthenticated). */
  enabled?: boolean;
}

/** Data older than this is presented as stale rather than merely cached. */
export const STALE_AFTER_MS = 2 * 60 * 1000;

/**
 * A GET that survives going offline.
 *
 * The service worker serves a cached body when the network is down, and this
 * hook surfaces that honestly: the caller always knows whether it is looking at
 * live data or a cached copy, and how old it is.
 */
export interface OfflineFetchResult<T> {
  data: T | null;
  ok: boolean;
  status: number;
  fromCache: boolean;
  fetchedAt: string | null;
  freshness: Freshness;
  error: string | null;
}

export function offlineAwareFetch<T>(url: string): Promise<OfflineFetchResult<T>> {
  return fetch(url, { credentials: 'same-origin' })
    .then(async res => {
      const fromCache = res.headers.get('x-cf-offline') === '1';
      const fetchedAt = res.headers.get('x-cached-at');
      if (!fromCache) reportNetworkSuccess();

      let freshness: Freshness = fromCache ? 'cached' : 'live';
      if (fromCache && fetchedAt) {
        if (Date.now() - new Date(fetchedAt).getTime() > STALE_AFTER_MS) freshness = 'stale';
      }
      if (fromCache && !navigator.onLine) freshness = 'offline';

      const body = (await res.json().catch(() => null)) as any;
      return {
        data: (body ?? null) as T | null,
        ok: res.ok && body?.success !== false,
        status: res.status,
        fromCache,
        fetchedAt,
        freshness,
        error: res.ok ? null : body?.error ?? `Request failed (${res.status})`
      };
    })
    .catch(() => {
      reportNetworkFailure();
      return {
        data: null,
        ok: false,
        status: 0,
        fromCache: false,
        fetchedAt: null,
        freshness: 'offline' as Freshness,
        error: 'No connection to CampusFlow.'
      };
    });
}

/**
 * React hook around offlineAwareFetch with optional polling.
 * Re-runs when connectivity returns so the user sees live data again.
 */
export function useOfflineResource<T>(url: string | null, options: OfflineAwareOptions = {}): OfflineAwareResult<T> & { reload: () => Promise<void> } {
  const { pollMs = 0, enabled = true } = options;
  const offline = useOfflineStatus();

  const [result, setResult] = useState<OfflineAwareResult<T>>({
    data: null,
    loading: Boolean(url && enabled),
    error: null,
    freshness: 'live',
    fetchedAt: null,
    offline: false
  });

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    if (!url || !enabled) return;
    setResult(prev => ({ ...prev, loading: true }));

    const res = await offlineAwareFetch<T>(url);
    if (!mounted.current) return;

    setResult({
      data: res.data,
      loading: false,
      error: res.error,
      freshness: res.freshness,
      fetchedAt: res.fetchedAt,
      offline: res.freshness === 'offline'
    });
  }, [url, enabled]);

  useEffect(() => {
    void load();
  }, [load]);

  // Poll for live data when asked (e.g. queue, seats).
  useEffect(() => {
    if (!pollMs || !url || !enabled) return;
    const id = setInterval(() => {
      // Do not poll while offline; there is nothing to learn.
      if (navigator.onLine) void load();
    }, pollMs);
    return () => clearInterval(id);
  }, [pollMs, url, enabled, load]);

  // Refresh as soon as the network comes back.
  useEffect(() => {
    if (!offline) void load();
  }, [offline, load]);

  return { ...result, reload: load };
}

let csrfToken: string | null = null;

/** Stores the CSRF token handed out with the current session. */
export function setCsrfToken(token: string | null): void {
  csrfToken = token;
}

async function ensureCsrfToken(): Promise<string | null> {
  if (csrfToken) return csrfToken;
  try {
    const res = await fetch('/api/auth/session', { credentials: 'same-origin' });
    if (!res.ok) return null;
    const data = await res.json();
    csrfToken = data?.csrf_token ?? null;
    return csrfToken;
  } catch {
    return null;
  }
}

/** The current CSRF token, fetched once if not already cached. */
export function currentCsrfToken(): Promise<string | null> {
  return ensureCsrfToken();
}

/**
 * POST/PATCH with the CSRF header attached.
 *
 * The server refuses state-changing requests that carry a session cookie but no
 * matching token, which is what stops a third-party page from driving a
 * signed-in student's account.
 */
export async function secureWrite(
  url: string,
  method: 'POST' | 'PATCH' | 'DELETE',
  body?: unknown
): Promise<Response> {
  const token = await ensureCsrfToken();
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers['x-csrf-token'] = token;
  return fetch(url, {
    method,
    credentials: 'same-origin',
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
}

function formatTime(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
