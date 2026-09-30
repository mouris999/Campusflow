import React, { useState } from 'react';
import { MapPin, Clock, Footprints, XCircle, LogIn, Bell, Loader2 } from 'lucide-react';
import { useOfflineResource, secureWrite } from '../lib/api.js';
import { FreshnessBadge } from './FreshnessBadge.js';
import { useOfflineStatus } from '../lib/offline.js';
import { enqueuePendingAction, usePendingActions } from '../lib/pendingActions.js';
import { OfflineGuard } from './OfflineBanner.js';

export interface TokenView {
  token: string;
  entry_id: string;
  service_id: string;
  service_name: string;
  building_name?: string;
  location?: string;
  phase: string;
  phase_label: string;
  position: number;
  people_ahead: number;
  status: string;
  eta_mins: number | null;
  eta_low_mins: number | null;
  eta_high_mins: number | null;
  leave_by: string | null;
  leave_by_mins: number | null;
  checked_in_at_counter: boolean;
  grace_period_expires_at: string | null;
  grace_mins_remaining: number | null;
  actionable: boolean;
  stale_after_secs: number;
}

const PHASE_STYLE: Record<string, { ring: string; chip: string }> = {
  waiting: { ring: 'border-white/15', chip: 'border-slate-500/40 text-slate-300' },
  approaching: { ring: 'border-amber-400/50', chip: 'border-amber-400/50 text-amber-200' },
  called: { ring: 'border-[#d9f65b]/60', chip: 'border-[#d9f65b]/60 text-[#d9f65b]' },
  check_in_required: { ring: 'border-rose-400/60', chip: 'border-rose-400/60 text-rose-200' },
  checked_in: { ring: 'border-emerald-400/50', chip: 'border-emerald-400/50 text-emerald-200' },
  serving: { ring: 'border-emerald-400/50', chip: 'border-emerald-400/50 text-emerald-200' }
};

/**
 * The student's virtual token.
 *
 * Everything shown is read back from the server. The browser never advances the
 * position or decides that a student has been served, and while offline the
 * panel says the live token state cannot be confirmed.
 */
export const VirtualTokenCard: React.FC<{ serviceId: string }> = ({ serviceId }) => {
  const offline = useOfflineStatus();
  const pending = usePendingActions();
  const { data, loading, error, freshness, fetchedAt, offline: dataOffline, reload } = useOfflineResource<{
    tokens: TokenView[];
  }>(`/api/queue/my-token?service_id=${encodeURIComponent(serviceId)}`, { pollMs: 20000 });

  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const token = data?.tokens?.[0];

  const runAction = async (action: 'check-in' | 'cancel', entryId: string) => {
    setBusy(action);
    setActionError(null);
    try {
      const res = await secureWrite(`/api/queue/${entryId}/${action}`, 'POST');
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setActionError(body?.error ?? 'That action could not be completed.');
      } else {
        await reload();
      }
    } catch {
      setActionError('No connection. The action was not applied.');
    } finally {
      setBusy(null);
    }
  };

  if (loading && !token) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 flex items-center justify-center gap-2 text-sm text-slate-400">
        <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> Loading your token…
      </div>
    );
  }

  if (!token) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
        <p className="text-sm font-semibold text-white">No active token</p>
        <p className="text-xs text-slate-400 mt-1">
          Join the virtual queue to hold your place remotely.
        </p>
      </div>
    );
  }

  const style = PHASE_STYLE[token.phase] ?? PHASE_STYLE.waiting;
  const etaText =
    token.eta_low_mins !== null && token.eta_high_mins !== null
      ? `${token.eta_low_mins}–${token.eta_high_mins} min`
      : token.eta_mins !== null
        ? `${token.eta_mins} min`
        : 'Not available yet';

  return (
    <section
      className={`rounded-2xl border-2 bg-gradient-to-b from-white/[0.06] to-transparent p-5 sm:p-6 ${style.ring}`}
      aria-label="Your virtual token"
    >
      <header className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-mono uppercase tracking-widest text-slate-400">Your token</p>
        <FreshnessBadge freshness={freshness} fetchedAt={fetchedAt} />
      </header>

      <p className="mt-3 text-4xl sm:text-5xl font-black tracking-tight text-[#d9f65b]">{token.token}</p>

      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        <span className={`text-[11px] font-mono px-2 py-0.5 rounded border ${style.chip}`}>{token.phase_label}</span>
        <span className="text-xs text-slate-400">{token.service_name}</span>
      </div>

      {token.building_name && (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-slate-300">
          <MapPin className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          {token.location ? `${token.location}, ${token.building_name}` : token.building_name}
        </p>
      )}

      {token.phase === 'serving' || token.status === 'in_service' ? (
        <div className="mt-4 grid grid-cols-2 gap-3">
          <Stat label="Position" value="At the counter" />
          <Stat label="Estimated wait" value="Being served now" />
        </div>
      ) : (
        <div className="mt-4 grid grid-cols-2 gap-3">
          <Stat label="Position" value={`#${token.position}`} />
          <Stat label="People ahead" value={String(token.people_ahead)} />
        </div>
      )}

      {/* Progress is decorative; the numbers above carry the meaning. */}
      <div className="mt-4" aria-hidden="true">
        <div className="h-2.5 rounded-full bg-white/10 overflow-hidden">
          <div
            className="h-full rounded-full bg-[#d9f65b] transition-all duration-500"
            style={{ width: `${Math.max(6, 100 - Math.min(100, token.people_ahead * 6))}%` }}
          />
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2.5">
          <p className="text-[10px] font-mono uppercase tracking-wide text-slate-400 flex items-center gap-1.5">
            <Clock className="w-3 h-3" aria-hidden="true" /> Estimated wait
          </p>
          <p className="text-sm font-bold text-white mt-1">{etaText}</p>
        </div>
        {token.leave_by ? (
          <div className="rounded-xl border border-[#d9f65b]/25 bg-[#d9f65b]/[0.06] px-3 py-2.5">
            <p className="text-[10px] font-mono uppercase tracking-wide text-[#d9f65b]/80 flex items-center gap-1.5">
              <Footprints className="w-3 h-3" aria-hidden="true" /> Leave by
            </p>
            <p className="text-sm font-bold text-white mt-1">{token.leave_by}</p>
          </div>
        ) : (
          <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2.5">
            <p className="text-[10px] font-mono uppercase tracking-wide text-slate-400">Leave by</p>
            <p className="text-sm font-bold text-white mt-1">
              {token.status === 'called' || token.status === 'in_service' ? 'Go to the counter' : '—'}
            </p>
          </div>
        )}
      </div>

      {token.grace_mins_remaining !== null && token.status === 'called' && (
        <p className="mt-3 text-xs text-rose-200 flex items-center gap-1.5" role="status">
          <Bell className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          Check in within {token.grace_mins_remaining} min or your place is released.
        </p>
      )}

      {dataOffline && (
        <p className="mt-3 text-xs text-amber-200">
          Position and ETA cannot be confirmed while offline.
        </p>
      )}

      {actionError && (
        <p role="alert" className="mt-3 text-xs text-rose-300 bg-rose-500/10 border border-rose-500/30 rounded-lg px-3 py-2">
          {actionError}
        </p>
      )}

      {offline ? (
        <div className="mt-4">
          <OfflineGuard
            action="Checking in or cancelling your token"
            onRetry={async () => {
              if (token.entry_id) await runAction('check-in', token.entry_id);
            }}
          />
        </div>
      ) : (
        token.actionable && (
          <div className="mt-5 flex flex-wrap gap-2">
            {token.status === 'called' && !token.checked_in_at_counter && (
              <button
                onClick={() => runAction('check-in', token.entry_id)}
                disabled={busy === 'check-in'}
                className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-[#d9f65b] text-[#121315] text-sm font-black hover:bg-[#e4fa78] disabled:opacity-60 transition"
              >
                {busy === 'check-in' ? (
                  <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                ) : (
                  <LogIn className="w-4 h-4" aria-hidden="true" />
                )}
                Check in
              </button>
            )}
            <button
              onClick={() => runAction('cancel', token.entry_id)}
              disabled={busy === 'cancel'}
              className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl border border-white/15 text-sm font-bold text-slate-200 hover:border-white/30 hover:text-white disabled:opacity-60 transition"
            >
              {busy === 'cancel' ? (
                <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
              ) : (
                <XCircle className="w-4 h-4" aria-hidden="true" />
              )}
              Cancel
            </button>
          </div>
        )
      )}

      {!token.actionable && (
        <p className="mt-4 text-xs text-slate-400">
          This token is {token.phase_label.toLowerCase()}.
        </p>
      )}
    </section>
  );
};

const Stat: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2.5">
    <p className="text-[10px] font-mono uppercase tracking-wide text-slate-400">{label}</p>
    <p className="text-2xl font-black text-white mt-0.5">{value}</p>
  </div>
);
