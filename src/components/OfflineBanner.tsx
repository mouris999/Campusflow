import React, { useEffect, useState } from 'react';
import { WifiOff, RefreshCw, CheckCircle2, Trash2, Clock } from 'lucide-react';
import { useOfflineStatus, reportNetworkSuccess } from '../lib/offline.js';
import { flushPendingActions, removePendingAction, usePendingActions, type PendingAction } from '../lib/pendingActions.js';

const KIND_LABEL: Record<PendingAction['kind'], string> = {
  join_queue: 'Join virtual queue',
  reserve_seat: 'Reserve seat',
  book_appointment: 'Book appointment'
};

/**
 * Non-blocking connectivity indicator.
 *
 * Offline is only shown after a request genuinely failed, and "restored" only
 * after one genuinely succeeded, so the banner never lies about the network.
 */
export const OfflineBanner: React.FC<{ onSynced?: () => void }> = ({ onSynced }) => {
  const offline = useOfflineStatus();
  const pending = usePendingActions();
  const [recovered, setRecovered] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [wasOffline, setWasOffline] = useState(offline);

  useEffect(() => {
    if (wasOffline && !offline) {
      setRecovered(true);
      setWasOffline(false);
      const t = setTimeout(() => setRecovered(false), 6000);
      return () => clearTimeout(t);
    }
    setWasOffline(offline);
  }, [offline, wasOffline]);

  // When the network returns, replay anything queued and refresh live state.
  useEffect(() => {
    if (offline) return;
    let cancelled = false;

    const sync = async () => {
      if (pending.length === 0) {
        onSynced?.();
        return;
      }
      setSyncing(true);
      // Confirm the network is genuinely back before replaying.
      try {
        await fetch('/api/health', { credentials: 'same-origin' });
        reportNetworkSuccess();
      } catch {
        setSyncing(false);
        return;
      }
      const result = await flushPendingActions();
      if (!cancelled) {
        setSyncing(false);
        onSynced?.();
        void result;
      }
    };

    void sync();
    return () => {
      cancelled = true;
    };
    // `pending` is intentionally excluded: this runs on reconnect, not on
    // every queue change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offline]);

  if (!offline && pending.length === 0 && !recovered) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed top-0 inset-x-0 z-50 px-3 pt-3 pointer-events-none"
    >
      <div className="mx-auto max-w-2xl pointer-events-auto">
        {offline && (
          <div className="flex items-start gap-3 rounded-2xl border border-amber-500/40 bg-amber-950/90 backdrop-blur px-4 py-3 shadow-xl">
            <WifiOff className="w-5 h-5 text-amber-300 shrink-0 mt-0.5" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-amber-100">You are offline</p>
              <p className="text-xs text-amber-200/90 mt-0.5">
                Information shown may be out of date. Live queues, seat availability and
                confirmations cannot be checked until the server is reachable.
              </p>
            </div>
          </div>
        )}

        {recovered && !offline && (
          <div className="flex items-center gap-3 rounded-2xl border border-emerald-500/40 bg-emerald-950/90 backdrop-blur px-4 py-3 shadow-xl">
            <CheckCircle2 className="w-5 h-5 text-emerald-300 shrink-0" aria-hidden="true" />
            <p className="text-sm font-bold text-emerald-100">Connection restored</p>
            {syncing && (
              <RefreshCw className="w-4 h-4 text-emerald-300 animate-spin ml-auto" aria-hidden="true" />
            )}
          </div>
        )}

        {pending.length > 0 && (
          <div className="mt-2 rounded-2xl border border-white/15 bg-[#1a1b1e]/95 backdrop-blur px-4 py-3 shadow-xl">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-slate-300 shrink-0" aria-hidden="true" />
              <p className="text-xs font-bold text-white">
                {pending.length} pending {pending.length === 1 ? 'action' : 'actions'} — not confirmed
              </p>
            </div>
            <p className="text-[11px] text-slate-400 mt-1">
              These have not been sent to the server yet. Nothing is reserved until CampusFlow confirms it.
            </p>
            <ul className="mt-2 space-y-1.5">
              {pending.map(action => (
                <li key={action.id} className="flex items-center gap-2 text-[11px]">
                  <span className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-200 border border-amber-500/30 font-mono">
                    PENDING
                  </span>
                  <span className="text-slate-300 truncate">{KIND_LABEL[action.kind]}</span>
                  {action.last_error && (
                    <span className="text-rose-300 truncate">· {action.last_error}</span>
                  )}
                  <button
                    onClick={() => removePendingAction(action.id)}
                    className="ml-auto inline-flex items-center gap-1 px-2 py-1 rounded-md border border-white/15 text-slate-300 hover:text-white hover:border-white/30 transition shrink-0"
                  >
                    <Trash2 className="w-3 h-3" aria-hidden="true" />
                    <span className="sr-only">Discard</span>
                    Discard
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
};

/** Inline warning used by any control that cannot work without the server. */
export const OfflineGuard: React.FC<{ action: string; onRetry?: () => void }> = ({ action, onRetry }) => (
  <div
    role="alert"
    className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3"
  >
    <p className="text-sm font-bold text-amber-100">You are offline</p>
    <p className="text-xs text-amber-200/90 mt-1">
      {action} cannot be confirmed until the server is reachable. It may already have been taken by
      someone else.
    </p>
    {onRetry && (
      <button
        onClick={onRetry}
        className="mt-2.5 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-400 text-[#121315] text-xs font-black hover:bg-amber-300 transition"
      >
        <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
        Retry
      </button>
    )}
  </div>
);
