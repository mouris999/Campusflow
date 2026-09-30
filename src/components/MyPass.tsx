import React from 'react';
import { Ticket, Armchair, MapPin, Clock, LogIn, XCircle, Loader2, ExternalLink } from 'lucide-react';
import { useApp } from '../context/AppContext.js';
import { useOfflineResource, secureWrite } from '../lib/api.js';
import { useOfflineStatus } from '../lib/offline.js';
import type { TokenView } from './VirtualTokenCard.js';
import type { SeatReservationView } from './lib/seatTypes.js';

const SEAT_PHASE_COPY: Record<string, string> = {
  reserved: 'Reserved — check in to keep it',
  held: 'Held — check in to keep it',
  checked_in: 'Checked in',
  completed: 'Completed',
  cancelled: 'Cancelled',
  expired: 'Expired',
  no_show: 'Released (no check-in)'
};

/**
 * "My Pass" — the student's live token and seat reservations in one place.
 *
 * This is the surface a student returns to, so it must answer "do I need to
 * move, and when?" without opening anything else. Both records come from the
 * server; when the server cannot be reached nothing is shown as confirmed.
 */
export const MyPass: React.FC<{ onOpenService?: (serviceId: string) => void }> = ({ onOpenService }) => {
  const offline = useOfflineStatus();
  const { myQueues, checkInAtCounter, cancelQueue } = useApp();
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  // Active queue services drive which token to show.
  const activeServiceIds = myQueues
    .filter(e => ['waiting', 'called', 'in_service'].includes(e.status))
    .map(e => e.service_id);

  const tokenUrl =
    activeServiceIds.length > 0
      ? `/api/queue/my-token?service_id=${encodeURIComponent(activeServiceIds[0])}`
      : null;

  const { data: tokenData, loading: tokenLoading, offline: tokenOffline } = useOfflineResource<{ tokens: TokenView[] }>(
    tokenUrl,
    { pollMs: 15000, enabled: Boolean(tokenUrl) }
  );

  const { data: seatData, loading: seatLoading, offline: seatOffline } = useOfflineResource<{
    reservations: SeatReservationView[];
  }>('/api/seats/mine', { pollMs: 30000 });

  const token = tokenData?.tokens?.[0] ?? null;
  const activeSeats = (seatData?.reservations ?? []).filter(r =>
    ['held', 'reserved', 'checked_in'].includes(r.status)
  );
  const pastSeats = (seatData?.reservations ?? []).filter(r =>
    ['completed', 'cancelled', 'expired', 'no_show'].includes(r.status)
  );

  const act = async (id: string, action: 'check-in' | 'cancel') => {
    setBusy(`${id}:${action}`);
    setError(null);
    try {
      const res = await secureWrite(`/api/queue/${id}/${action}`, 'POST');
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body?.error ?? 'That action could not be completed.');
      }
    } catch {
      setError('No connection. The action was not applied.');
    } finally {
      setBusy(null);
    }
  };

  const nothingHeld = !token && activeSeats.length === 0;

  return (
    <section className="space-y-4" aria-label="My pass">
      <header className="flex items-baseline justify-between gap-2">
        <h2 className="text-base font-black text-white">My pass</h2>
        <p className="text-[11px] text-slate-400">Live tokens and seat reservations</p>
      </header>

      {error && (
        <p role="alert" className="text-xs text-rose-300 bg-rose-500/10 border border-rose-500/30 rounded-lg px-3 py-2">
          {error}
        </p>
      )}

      {tokenLoading && !token && !tokenOffline && (
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm text-slate-400 flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> Loading your token…
        </div>
      )}

      {/* --- Live virtual token ------------------------------------------- */}
      {token && (
        <article className="rounded-2xl border-2 border-[#d9f65b]/40 bg-gradient-to-br from-[#d9f65b]/[0.07] to-transparent p-4 sm:p-5">
          <header className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[10px] font-mono uppercase tracking-widest text-slate-300 flex items-center gap-1.5">
              <Ticket className="w-3.5 h-3.5" aria-hidden="true" /> Virtual token
            </p>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded border border-emerald-500/30 text-emerald-300">LIVE</span>
          </header>

          <p className="mt-2 text-3xl sm:text-4xl font-black text-[#d9f65b] tracking-tight">{token.token}</p>
          <p className="text-xs text-slate-300 mt-1">{token.service_name}</p>

          {token.building_name && (
            <p className="mt-1.5 text-xs text-slate-400 flex items-center gap-1.5">
              <MapPin className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              {token.location ? `${token.location}, ${token.building_name}` : token.building_name}
            </p>
          )}

          <div className="mt-3 grid grid-cols-3 gap-2">
            <PassStat label="Position" value={`#${token.position}`} />
            <PassStat
              label="Ahead"
              value={
                token.status === 'called' || token.status === 'in_service' ? 'At counter' : String(token.people_ahead)
              }
            />
            <PassStat
              label={token.leave_by ? 'Leave by' : 'Wait'}
              value={
                token.leave_by ??
                (token.eta_low_mins !== null && token.eta_high_mins !== null
                  ? `${token.eta_low_mins}–${token.eta_high_mins}m`
                  : '—')
              }
              highlight={Boolean(token.leave_by)}
            />
          </div>

          <p className="mt-2.5 text-[11px] text-slate-300">{token.phase_label}</p>

          {token.grace_mins_remaining !== null && token.status === 'called' && !token.checked_in_at_counter && (
            <p className="mt-2 text-xs text-rose-200" role="status">
              Check in within {token.grace_mins_remaining} min or your place is released.
            </p>
          )}

          {tokenOffline && (
            <p className="mt-2 text-xs text-amber-200">Live position cannot be confirmed while offline.</p>
          )}

          {!offline && (
            <div className="mt-4 flex flex-wrap gap-2">
              {token.status === 'called' && !token.checked_in_at_counter && (
                <button
                  onClick={() => act(token.entry_id, 'check-in')}
                  disabled={busy === `${token.entry_id}:check-in`}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#d9f65b] text-[#121315] text-xs font-black hover:bg-[#e4fa78] disabled:opacity-60 transition"
                >
                  <LogIn className="w-3.5 h-3.5" aria-hidden="true" /> Check in
                </button>
              )}
              <button
                onClick={() => act(token.entry_id, 'cancel')}
                disabled={busy === `${token.entry_id}:cancel`}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-white/15 text-xs font-bold text-slate-200 hover:border-white/30 hover:text-white disabled:opacity-60 transition"
              >
                <XCircle className="w-3.5 h-3.5" aria-hidden="true" /> Cancel
              </button>
              {onOpenService && (
                <button
                  onClick={() => onOpenService(token.service_id)}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-white/15 text-xs font-bold text-slate-200 hover:border-white/30 hover:text-white transition"
                >
                  <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" /> Service details
                </button>
              )}
            </div>
          )}
        </article>
      )}

      {/* --- Live seat reservations --------------------------------------- */}
      {seatLoading && activeSeats.length === 0 && !seatOffline && (
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm text-slate-400 flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> Loading your seats…
        </div>
      )}

      {activeSeats.length > 0 && (
        <div className="space-y-2">
          {activeSeats.map(seat => (
            <article key={seat.reservation_id} className="rounded-2xl border-2 border-emerald-500/40 bg-emerald-500/[0.06] p-4">
              <header className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[10px] font-mono uppercase tracking-widest text-slate-300 flex items-center gap-1.5">
                  <Armchair className="w-3.5 h-3.5" aria-hidden="true" /> Study seat
                </p>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded border border-emerald-500/30 text-emerald-300">
                  {seatOffline ? 'OFFLINE' : 'LIVE'}
                </span>
              </header>

              <p className="mt-2 text-2xl font-black text-white">{seat.seat_label}</p>
              <p className="text-xs text-slate-300 mt-0.5">
                {seat.zone_name}
                {seat.floor ? ` · ${seat.floor}` : ''}
              </p>
              {seat.service_name && <p className="text-xs text-slate-400">{seat.service_name}</p>}

              <div className="mt-3 flex flex-wrap gap-2 text-xs">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-white/10 bg-black/20">
                  <Clock className="w-3.5 h-3.5" aria-hidden="true" />
                  {formatSeatWindow(seat)}
                </span>
                {seat.check_in_required && (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-amber-500/40 text-amber-200">
                    Check in within {seat.check_in_mins_remaining} min
                  </span>
                )}
              </div>

              <p className="mt-2 text-[11px] text-slate-300">{SEAT_PHASE_COPY[seat.status] ?? seat.status}</p>

              {onOpenService && (
                <button
                  onClick={() => onOpenService(findServiceIdFor(seat.service_name))}
                  className="mt-3 inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-white/15 text-xs font-bold text-slate-200 hover:border-white/30 hover:text-white transition"
                >
                  <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" /> Open seat map
                </button>
              )}
            </article>
          ))}
        </div>
      )}

      {pastSeats.length > 0 && (
        <details className="rounded-2xl border border-white/10 bg-white/[0.02] p-3">
          <summary className="text-xs text-slate-400 cursor-pointer select-none">
            Past seat reservations ({pastSeats.length})
          </summary>
          <ul className="mt-2 space-y-1">
            {pastSeats.map(seat => (
              <li key={seat.reservation_id} className="text-[11px] text-slate-400 flex justify-between gap-2">
                <span>
                  {seat.seat_label} · {seat.service_name}
                </span>
                <span className="font-mono">{SEAT_PHASE_COPY[seat.status] ?? seat.status}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {nothingHeld && (
        <div className="rounded-2xl border border-dashed border-white/15 p-5 text-center">
          <p className="text-sm font-semibold text-white">You are not holding anything right now</p>
          <p className="text-xs text-slate-400 mt-1">
            Join a virtual queue to skip the line, or reserve a study seat to hold your place in the library.
          </p>
        </div>
      )}
    </section>
  );
};

/**
 * A seat booked for later today reads better as a clock time; a seat for
 * another day needs the date, otherwise "10:00" is ambiguous.
 */
function formatSeatWindow(seat: { date: string; start_time: string; end_time: string }): string {
  const today = new Date().toISOString().slice(0, 10);
  const time = `${seat.start_time}–${seat.end_time}`;
  if (seat.date === today) return `Today ${time}`;
  if (seat.date) {
    const d = new Date(`${seat.date}T00:00:00`);
    const label = Number.isNaN(d.getTime())
      ? seat.date
      : d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
    return `${label} · ${time}`;
  }
  return time;
}

const PassStat: React.FC<{ label: string; value: string; highlight?: boolean }> = ({
  label,
  value,
  highlight
}) => (
  <div
    className={`rounded-xl border px-2.5 py-2 ${
      highlight ? 'border-[#d9f65b]/40 bg-[#d9f65b]/[0.07]' : 'border-white/10 bg-black/20'
    }`}
  >
    <p className="text-[9px] font-mono uppercase tracking-wide text-slate-400">{label}</p>
    <p className={`text-sm font-black mt-0.5 ${highlight ? 'text-[#d9f65b]' : 'text-white'}`}>{value}</p>
  </div>
);

/** Resolves a service id from a display name for deep links. */
function findServiceIdFor(serviceName: string | null): string {
  if (!serviceName) return '';
  const key = serviceName.toLowerCase();
  if (key.includes('commons')) return 'srv-lib-commons';
  if (key.includes('library') || key.includes('williamson')) return 'srv-lib-desk';
  return '';
}
