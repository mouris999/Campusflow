import React, { useMemo, useState } from 'react';
import { Armchair, Loader2, MapPin, AlertCircle, RefreshCw } from 'lucide-react';
import { useOfflineResource, secureWrite } from '../lib/api.js';
import { FreshnessBadge } from './FreshnessBadge.js';
import { useOfflineStatus } from '../lib/offline.js';
import { enqueuePendingAction } from '../lib/pendingActions.js';
import { OfflineGuard } from './OfflineBanner.js';

export interface SeatView {
  seat_id: string;
  label: string;
  zone_id: string;
  zone_name: string;
  floor: string;
  zone_kind: 'quiet' | 'group' | 'open';
  status: string;
  features: string[];
  availability: 'available' | 'held' | 'reserved' | 'occupied' | 'unavailable' | 'maintenance';
  unavailable_reason: string | null;
  your_reservation_id?: string;
}

export interface ZoneSummary {
  zone_id: string;
  name: string;
  floor: string;
  kind: 'quiet' | 'group' | 'open';
  total: number;
  available: number;
  reserved: number;
  maintenance: number;
}

export interface SeatingSummary {
  service_id: string;
  service_name: string;
  date: string;
  start_time: string;
  end_time: string;
  total_seats: number;
  available_seats: number;
  reserved_seats: number;
  maintenance_seats: number;
  zones: ZoneSummary[];
  outside_opening_hours: boolean;
  checked_at: string;
}

/**
 * Seat state is communicated by an icon, a word and a pattern — never by
 * colour alone, so it works for colour-blind users and screen readers.
 */
const SEAT_META: Record<
  SeatView['availability'],
  { label: string; glyph: string; chip: string; seat: string }
> = {
  available: {
    label: 'Available',
    glyph: '○',
    chip: 'border-emerald-400/40 text-emerald-200',
    seat: 'border-emerald-400/40 bg-emerald-400/10 hover:bg-emerald-400/20'
  },
  held: {
    label: 'Held',
    glyph: '◐',
    chip: 'border-amber-400/40 text-amber-200',
    seat: 'border-amber-400/40 bg-amber-400/10'
  },
  reserved: {
    label: 'Reserved',
    glyph: '◑',
    chip: 'border-sky-400/40 text-sky-200',
    seat: 'border-sky-400/40 bg-sky-400/10'
  },
  occupied: {
    label: 'Occupied',
    glyph: '●',
    chip: 'border-white/30 text-slate-300',
    seat: 'border-white/25 bg-white/[0.07]'
  },
  maintenance: {
    label: 'Maintenance',
    glyph: '✕',
    chip: 'border-rose-400/40 text-rose-200',
    seat: 'border-rose-400/40 bg-rose-400/10'
  },
  unavailable: {
    label: 'Unavailable',
    glyph: '⊘',
    chip: 'border-slate-500/40 text-slate-400',
    seat: 'border-slate-600/40 bg-slate-700/20'
  }
};

export const SeatMap: React.FC<{ serviceId: string; serviceName: string }> = ({ serviceId, serviceName }) => {
  const offline = useOfflineStatus();
  const [startTime, setStartTime] = useState(() => {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, '0')}:00`;
  });
  const [zoneFilter, setZoneFilter] = useState<string>('all');
  const [selected, setSelected] = useState<SeatView | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [view, setView] = useState<'map' | 'list'>('map');

  const endTime = useMemo(() => {
    const [h, m] = startTime.split(':').map(Number);
    const total = (h * 60 + m + 120) % (24 * 60);
    return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
  }, [startTime]);

  const { data, loading, error, freshness, fetchedAt, reload } = useOfflineResource<{
    seating: SeatingSummary;
    seats: SeatView[];
  }>(`/api/services/${serviceId}/seating?start_time=${startTime}&end_time=${endTime}`, { pollMs: 30000 });

  const seats = data?.seats ?? [];
  const summary = data?.seating;
  const visible = zoneFilter === 'all' ? seats : seats.filter(s => s.zone_id === zoneFilter);

  const reserve = async (seat: SeatView) => {
    if (offline) {
      // Queue it explicitly; never pretend the seat is held.
      enqueuePendingAction({
        kind: 'reserve_seat',
        label: `Reserve ${seat.label} at ${serviceName}`,
        endpoint: `/api/services/${serviceId}/seats/${seat.seat_id}/reserve`,
        method: 'POST',
        body: { start_time: startTime, end_time: endTime },
        idempotency_key: `seat-${serviceId}-${seat.seat_id}-${startTime}`
      });
      setMessage({
        tone: 'error',
        text: `Seat reservation for ${seat.label} is queued but NOT confirmed. It will be sent when you are back online.`
      });
      return;
    }

    setBusy(true);
    setMessage(null);
    try {
      const res = await secureWrite(`/api/services/${serviceId}/seats/${seat.seat_id}/reserve`, 'POST', {
        start_time: startTime,
        end_time: endTime
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        setMessage({ tone: 'ok', text: `Seat ${seat.label} is reserved for ${startTime}–${endTime}.` });
        setSelected(null);
        await reload();
      } else {
        setMessage({ tone: 'error', text: body?.error ?? 'That seat could not be reserved.' });
        await reload();
      }
    } catch {
      setMessage({ tone: 'error', text: 'No connection. The seat was not reserved.' });
    } finally {
      setBusy(false);
    }
  };

  if (error && !summary) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
        <p className="text-sm text-slate-300 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
          {error}
        </p>
      </div>
    );
  }

  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-5" aria-label="Library seating">
      <header className="flex flex-wrap items-start justify-between gap-2 mb-3">
        <div>
          <h3 className="text-sm font-bold text-white">Find a seat</h3>
          <p className="text-xs text-slate-400 mt-0.5">{serviceName}</p>
        </div>
        <FreshnessBadge freshness={freshness} fetchedAt={fetchedAt} />
      </header>

      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
          <CapacityStat label="Total seats" value={summary.total_seats} />
          <CapacityStat label="Available" value={summary.available_seats} tone="good" />
          <CapacityStat label="Reserved / held" value={summary.reserved_seats} />
          <CapacityStat label="Out of service" value={summary.maintenance_seats} />
        </div>
      )}

      {summary?.outside_opening_hours && (
        <p className="mb-3 text-xs text-amber-200 flex items-start gap-1.5" role="status">
          <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden="true" />
          This time is outside the library&apos;s seating hours. Reservations will be refused.
        </p>
      )}

      <div className="flex flex-wrap items-end gap-3 mb-3">
        <label className="text-xs text-slate-300">
          <span className="block mb-1">Start time</span>
          <input
            type="time"
            value={startTime}
            onChange={e => setStartTime(e.target.value)}
            className="rounded-lg bg-[#121315] border border-white/10 px-2.5 py-1.5 text-sm text-white"
          />
        </label>
        <p className="text-xs text-slate-400 pb-2">
          {startTime} – {endTime}
        </p>

        {summary && summary.zones.length > 1 && (
          <label className="text-xs text-slate-300">
            <span className="block mb-1">Zone</span>
            <select
              value={zoneFilter}
              onChange={e => setZoneFilter(e.target.value)}
              className="rounded-lg bg-[#121315] border border-white/10 px-2.5 py-1.5 text-sm text-white"
            >
              <option value="all">All zones</option>
              {summary.zones.map(z => (
                <option key={z.zone_id} value={z.zone_id}>
                  {z.name} ({z.available} free)
                </option>
              ))}
            </select>
          </label>
        )}

        <div className="ml-auto flex gap-1" role="group" aria-label="View mode">
          <ViewToggle active={view === 'map'} onClick={() => setView('map')}>
            Map
          </ViewToggle>
          <ViewToggle active={view === 'list'} onClick={() => setView('list')}>
            List
          </ViewToggle>
        </div>
      </div>

      {/* Legend: symbol + word, so state is never colour-only. */}
      <ul className="flex flex-wrap gap-2 mb-4">
        {(Object.keys(SEAT_META) as Array<keyof typeof SEAT_META>).map(key => (
          <li
            key={key}
            className={`inline-flex items-center gap-1.5 text-[10px] font-mono px-2 py-1 rounded border ${SEAT_META[key].chip}`}
          >
            <span aria-hidden="true">{SEAT_META[key].glyph}</span>
            {SEAT_META[key].label}
          </li>
        ))}
      </ul>

      {message && (
        <p
          role="status"
          className={`mb-3 text-xs rounded-lg px-3 py-2 border ${
            message.tone === 'ok'
              ? 'border-emerald-500/30 text-emerald-200 bg-emerald-500/10'
              : 'border-amber-500/30 text-amber-200 bg-amber-500/10'
          }`}
        >
          {message.text}
        </p>
      )}

      {loading && !summary && (
        <p className="text-sm text-slate-400 flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> Loading seating…
        </p>
      )}

      {offline && (
        <div className="mb-3">
          <OfflineGuard action="Reserving a seat" onRetry={() => reload()} />
        </div>
      )}

      {view === 'map' ? (
        <div className="space-y-4">
          {(summary?.zones ?? []).map(zone => {
            const zoneSeats = visible.filter(s => s.zone_id === zone.zone_id);
            if (zoneSeats.length === 0) return null;
            return (
              <div key={zone.zone_id}>
                <div className="flex items-baseline justify-between mb-2">
                  <h4 className="text-xs font-bold text-slate-200">{zone.name}</h4>
                  <p className="text-[10px] font-mono text-slate-400">
                    {zone.available} of {zone.total} free · {zone.floor}
                  </p>
                </div>
                <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-1.5">
                  {zoneSeats.map(seat => {
                    const meta = SEAT_META[seat.availability];
                    return (
                      <button
                        key={seat.seat_id}
                        onClick={() => setSelected(seat)}
                        aria-label={`Seat ${seat.label}, ${meta.label}${seat.unavailable_reason ? `, ${seat.unavailable_reason}` : ''}`}
                        className={`rounded-lg border px-1.5 py-2 text-center transition ${meta.seat} ${
                          seat.availability === 'available' ? 'cursor-pointer' : 'cursor-default'
                        }`}
                      >
                        <span className="block text-[10px] font-mono text-white" aria-hidden="true">
                          {seat.label}
                        </span>
                        <span className="block text-[11px] mt-0.5" aria-hidden="true">
                          {meta.glyph}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <SeatTable seats={visible} onSelect={setSelected} />
      )}

      {selected && (
        <SeatDetail
          seat={selected}
          startTime={startTime}
          endTime={endTime}
          busy={busy}
          onReserve={() => reserve(selected)}
          onClose={() => setSelected(null)}
        />
      )}
    </section>
  );
};

const SeatDetail: React.FC<{
  seat: SeatView;
  startTime: string;
  endTime: string;
  busy: boolean;
  onReserve: () => void;
  onClose: () => void;
}> = ({ seat, startTime, endTime, busy, onReserve, onClose }) => {
  const meta = SEAT_META[seat.availability];
  return (
    <div className="mt-4 rounded-xl border border-white/15 bg-[#1a1b1e] p-4" role="dialog" aria-label={`Seat ${seat.label}`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-lg font-black text-white">{seat.label}</p>
          <p className="text-xs text-slate-400 flex items-center gap-1.5 mt-0.5">
            <MapPin className="w-3.5 h-3.5" aria-hidden="true" />
            {seat.zone_name} · {seat.floor}
          </p>
        </div>
        <button onClick={onClose} className="text-xs text-slate-400 hover:text-white px-2 py-1" aria-label="Close seat details">
          ✕
        </button>
      </div>

      <p className={`mt-2 inline-flex items-center gap-1.5 text-[11px] font-mono px-2 py-1 rounded border ${meta.chip}`}>
        <span aria-hidden="true">{meta.glyph}</span>
        {meta.label}
      </p>

      {seat.features.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {seat.features.map(f => (
            <li key={f} className="text-[10px] px-1.5 py-0.5 rounded bg-white/[0.06] text-slate-300 border border-white/10">
              {f}
            </li>
          ))}
        </ul>
      )}

      {seat.unavailable_reason && seat.availability !== 'available' && (
        <p className="mt-2 text-xs text-slate-400">{seat.unavailable_reason}.</p>
      )}

      {seat.availability === 'available' && (
        <button
          onClick={onReserve}
          disabled={busy}
          className="mt-3 inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-[#d9f65b] text-[#121315] text-sm font-black hover:bg-[#e4fa78] disabled:opacity-60 transition"
        >
          {busy ? (
            <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
          ) : (
            <Armchair className="w-4 h-4" aria-hidden="true" />
          )}
          Reserve {seat.label} · {startTime}–{endTime}
        </button>
      )}
    </div>
  );
};

const SeatTable: React.FC<{ seats: SeatView[]; onSelect: (s: SeatView) => void }> = ({ seats, onSelect }) => (
  <div className="overflow-x-auto">
    <table className="w-full text-left text-xs">
      <caption className="sr-only">Seats with their zone, floor and current status</caption>
      <thead>
        <tr className="border-b border-white/10 text-slate-400">
          <th scope="col" className="py-2 pr-3 font-mono text-[10px] uppercase">Seat</th>
          <th scope="col" className="py-2 pr-3 font-mono text-[10px] uppercase">Zone</th>
          <th scope="col" className="py-2 pr-3 font-mono text-[10px] uppercase">Floor</th>
          <th scope="col" className="py-2 pr-3 font-mono text-[10px] uppercase">Status</th>
        </tr>
      </thead>
      <tbody>
        {seats.map(seat => {
          const meta = SEAT_META[seat.availability];
          return (
            <tr
              key={seat.seat_id}
              onClick={() => onSelect(seat)}
              className={`border-b border-white/5 ${seat.availability === 'available' ? 'cursor-pointer hover:bg-white/[0.04]' : ''}`}
            >
              <th scope="row" className="py-2 pr-3 font-mono text-white">{seat.label}</th>
              <td className="py-2 pr-3 text-slate-300">{seat.zone_name}</td>
              <td className="py-2 pr-3 text-slate-300">{seat.floor}</td>
              <td className="py-2 pr-3">
                <span className={`inline-flex items-center gap-1 font-mono ${meta.chip.split(' ')[1]}`}>
                  <span aria-hidden="true">{meta.glyph}</span>
                  {meta.label}
                </span>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  </div>
);

const CapacityStat: React.FC<{ label: string; value: number; tone?: 'good' }> = ({ label, value, tone }) => (
  <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2">
    <p className="text-[10px] font-mono uppercase tracking-wide text-slate-400">{label}</p>
    <p className={`text-xl font-black mt-0.5 ${tone === 'good' ? 'text-emerald-300' : 'text-white'}`}>{value}</p>
  </div>
);

const ViewToggle: React.FC<{ active: boolean; onClick: () => void; children: React.ReactNode }> = ({
  active,
  onClick,
  children
}) => (
  <button
    onClick={onClick}
    aria-pressed={active}
    className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold border transition ${
      active ? 'bg-[#d9f65b] text-[#121315] border-[#d9f65b]' : 'border-white/15 text-slate-300 hover:text-white'
    }`}
  >
    {children}
  </button>
);
