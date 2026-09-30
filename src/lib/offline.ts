import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Connectivity + offline-aware fetch.
 *
 * Two independent signals are combined, because either one alone lies:
 *   - `navigator.onLine` only knows whether a network interface exists.
 *   - An actual request failure proves the server is unreachable.
 * The app is only treated as "offline" once a real request has failed, and it
 * recovers only after a real request succeeds.
 */

export type Freshness = 'live' | 'cached' | 'stale' | 'offline';

export interface FetchResult<T> {
  data: T | null;
  ok: boolean;
  status: number;
  /** True when the response came from the service worker cache. */
  fromCache: boolean;
  /** When the cached copy was originally fetched. */
  fetchedAt: string | null;
  freshness: Freshness;
  error: string | null;
  offline: boolean;
}

/** Cached reads go "stale" after this long. */
export const STALE_AFTER_MS = 2 * 60 * 1000;

type Listener = (offline: boolean) => void;
const listeners = new Set<Listener>();
let offlineState = typeof navigator !== 'undefined' ? !navigator.onLine : false;

function emit(offline: boolean) {
  offlineState = offline;
  listeners.forEach(fn => fn(offline));
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => emit(false));
  window.addEventListener('offline', () => emit(true));
}

/** Lets any fetch layer report a real connectivity failure. */
export function reportNetworkFailure() {
  emit(true);
}

export function reportNetworkSuccess() {
  if (offlineState) emit(false);
}

export function isOffline(): boolean {
  return offlineState;
}

/** Subscribes to offline state. */
export function useOfflineStatus(): boolean {
  const [offline, setOffline] = useState(offlineState);

  useEffect(() => {
    const listener: Listener = next => setOffline(next);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  return offline;
}

/**
 * A fetch that understands the offline contract.
 *
 * On success it reports the response and clears offline state. On a network
 * failure it reports offline and returns a typed failure, so callers never
 * mistake a failure for data.
 */
export function useOfflineFetch() {
  const inflight = useRef<AbortController | null>(null);

  const request = useCallback(async <T>(input: string, init?: RequestInit): Promise<FetchResult<T>> => {
    inflight.current?.abort();
    const controller = new AbortController();
    inflight.current = controller;

    try {
      const res = await fetch(input, { ...init, signal: controller.signal, credentials: 'same-origin' });

      const fromCache = res.headers.get('x-cf-offline') === '1';
      const fetchedAt = res.headers.get('x-cached-at');

      if (!fromCache) reportNetworkSuccess();

      // A cached body is served when the network is down; freshness tells the
      // UI how much to trust it.
      let freshness: Freshness = fromCache ? 'cached' : 'live';
      if (fromCache && fetchedAt) {
        const age = Date.now() - new Date(fetchedAt).getTime();
        if (age > STALE_AFTER_MS) freshness = 'stale';
      }
      if (offlineState && fromCache) freshness = 'offline';

      if (res.status >= 500 && fromCache) freshness = 'stale';

      const data = (await res.json().catch(() => null)) as T | null;

      return {
        data,
        ok: res.ok,
        status: res.status,
        fromCache,
        fetchedAt,
        freshness,
        error: res.ok ? null : (data as any)?.error ?? `Request failed (${res.status})`,
        offline: fromCache && offlineState
      };
    } catch (error: any) {
      if (error?.name === 'AbortError') {
        return {
          data: null,
          ok: false,
          status: 0,
          fromCache: false,
          fetchedAt: null,
          freshness: 'offline',
          error: 'Request cancelled.',
          offline: true
        };
      }
      // A genuine network failure.
      reportNetworkFailure();
      return {
        data: null,
        ok: false,
        status: 0,
        fromCache: false,
        fetchedAt: null,
        freshness: 'offline',
        error: 'No connection to CampusFlow.',
        offline: true
      };
    }
  }, []);

  return { request, cancel: () => inflight.current?.abort() };
}

/** Human label for a freshness value, used in the UI. */
export function freshnessLabel(freshness: Freshness, fetchedAt: string | null): string {
  switch (freshness) {
    case 'live':
      return 'Live';
    case 'cached':
      return `Cached · ${formatTime(fetchedAt)}`;
    case 'stale':
      return `Stale · last updated ${formatTime(fetchedAt)}`;
    case 'offline':
      return 'Offline · live data unavailable';
  }
}

function formatTime(iso: string | null): string {
  if (!iso) return 'earlier';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'earlier';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
