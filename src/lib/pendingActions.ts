/**
 * Pending offline actions.
 *
 * A queued action is explicitly *not confirmed*. Nothing here reports success:
 * the UI must keep saying "pending — not confirmed" until the server has
 * actually accepted the request. Every entry carries an idempotency key so a
 * retry after reconnect cannot create a duplicate ticket or seat.
 */

import { useEffect, useState } from 'react';
import { reportNetworkFailure, reportNetworkSuccess } from './offline.js';
import { currentCsrfToken } from './api.js';

export type PendingKind = 'join_queue' | 'reserve_seat' | 'book_appointment';

export interface PendingAction {
  id: string;
  kind: PendingKind;
  label: string;
  endpoint: string;
  method: 'POST';
  body: Record<string, unknown>;
  /** Reused on replay so the server can de-duplicate. */
  idempotency_key: string;
  created_at: string;
  attempts: number;
  last_error: string | null;
}

const STORAGE_KEY = 'campusflow.pending-actions.v1';

function read(): PendingAction[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as PendingAction[]) : [];
  } catch {
    return [];
  }
}

function write(actions: PendingAction[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(actions));
  } catch {
    // Storage may be unavailable (private mode); pending state is best-effort.
  }
  subscribers.forEach(fn => fn(actions));
}

const subscribers = new Set<(actions: PendingAction[]) => void>();

export function listPendingActions(): PendingAction[] {
  return read();
}

export function enqueuePendingAction(
  action: Omit<PendingAction, 'id' | 'created_at' | 'attempts' | 'last_error'>
): PendingAction {
  const entry: PendingAction = {
    ...action,
    id: `pa-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    created_at: new Date().toISOString(),
    attempts: 0,
    last_error: null
  };
  // One pending action of a kind per endpoint: a double tap must not queue two.
  const existing = read().filter(a => !(a.kind === entry.kind && a.endpoint === entry.endpoint));
  write([...existing, entry]);
  return entry;
}

export function removePendingAction(id: string): void {
  write(read().filter(a => a.id !== id));
}

export function clearPendingActions(): void {
  write([]);
}

/**
 * Replays pending actions against the server.
 *
 * The server is authoritative: a response is only treated as confirmed when it
 * actually succeeds. A `already_held` / `seat_unavailable` rejection resolves
 * the entry as failed rather than retrying forever, because replaying it would
 * keep hitting the same conflict.
 */
export async function flushPendingActions(): Promise<{ confirmed: number; failed: number; remaining: number }> {
  const pending = read();
  let confirmed = 0;
  let failed = 0;

  for (const action of pending) {
    try {
      // Replay uses the same CSRF-protected path as a live write, so a queued
      // action is not rejected on reconnect purely for being replayed.
      const token = await currentCsrfToken();
      const res = await fetch(action.endpoint, {
        method: action.method,
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'x-csrf-token': token } : {})
        },
        credentials: 'same-origin',
        body: JSON.stringify({ ...action.body, idempotency_key: action.idempotency_key })
      });
      reportNetworkSuccess();

      if (res.ok) {
        // Only now is the action real.
        removePendingAction(action.id);
        confirmed += 1;
        continue;
      }

      const body = await res.json().catch(() => ({}));
      const code = body?.code;
      // A permanent conflict will not resolve itself: drop it and report.
      if (res.status === 409 || res.status === 400) {
        removePendingAction(action.id);
        failed += 1;
        continue;
      }
      void code;
    } catch {
      // Still offline: leave it queued for the next reconnect.
      reportNetworkFailure();
    }
  }

  return { confirmed, failed, remaining: read().length };
}

/** Subscribes to the pending queue. */
export function usePendingActions(): PendingAction[] {
  const [actions, setActions] = useState<PendingAction[]>(() => read());

  useEffect(() => {
    const listener = (next: PendingAction[]) => setActions(next);
    subscribers.add(listener);
    // Keep tabs in sync.
    const onStorage = () => setActions(read());
    window.addEventListener('storage', onStorage);
    return () => {
      subscribers.delete(listener);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  return actions;
}

/** Retry with exponential backoff, bounded, and cancellable. */
export async function withRetry<T>(
  operation: () => Promise<T>,
  options: { retries?: number; baseDelayMs?: number; signal?: AbortSignal } = {}
): Promise<T> {
  const retries = options.retries ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 400;
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (options.signal?.aborted) throw new Error('Cancelled');
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      // Do not hammer the server; back off and give up after `retries`.
      if (attempt === retries) break;
      const delay = baseDelayMs * Math.pow(2, attempt);
      await new Promise<void>(resolve => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}
