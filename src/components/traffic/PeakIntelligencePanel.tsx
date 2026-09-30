/**
 * PEAK INTELLIGENCE sub-tab for the audit view.
 *
 * Everything here is a read-out of stored measurement: what the model was fed,
 * how confident it is, which windows it predicts, and what happened when it
 * recommended a redirect. When a service has too little history the row says so
 * instead of showing a number.
 */

import React, { useEffect, useState } from 'react';
import { Activity, RefreshCw, TrendingUp, Users } from 'lucide-react';
import { useTraffic } from '../../context/TrafficContext.js';
import type { PeakIntelligenceAnalytics } from '../../types/traffic.js';
import { DAY_SHORT } from '../../lib/time.js';
import { demandBand } from '../../lib/trafficState.js';
import { EmptyNote } from './TrafficBits.js';
import { secureWrite } from '../../lib/api.js';

const BAND_CLASS: Record<string, string> = {
  low: 'bg-emerald-400/80',
  moderate: 'bg-sky-400/80',
  high: 'bg-amber-400/80',
  peak: 'bg-rose-400/85'
};

export const PeakIntelligencePanel: React.FC = () => {
  const { loadAnalytics } = useTraffic();
  const [analytics, setAnalytics] = useState<PeakIntelligenceAnalytics | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRebuilding, setIsRebuilding] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadAnalytics().then(result => {
      if (cancelled) return;
      setAnalytics(result);
      setIsLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [loadAnalytics]);

  const rebuild = async () => {
    setIsRebuilding(true);
    await secureWrite('/api/intelligence/admin/rebuild', 'POST', {});
    const result = await loadAnalytics();
    setAnalytics(result);
    setIsRebuilding(false);
  };

  if (isLoading) {
    return <EmptyNote light>Loading the recorded demand model…</EmptyNote>;
  }
  if (!analytics) {
    return <EmptyNote light>Peak intelligence data is not available right now.</EmptyNote>;
  }

  const { totals } = analytics;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Kpi label="Measurements stored" value={totals.demand_measurements} />
        <Kpi label="Services with history" value={`${totals.services_with_history}`} />
        <Kpi
          label="Acceptance rate"
          value={totals.acceptance_rate_pct === null ? 'No clicks yet' : `${totals.acceptance_rate_pct}%`}
        />
        <Kpi
          label="Minutes avoided (est.)"
          value={totals.estimated_minutes_avoided}
          hint={`${totals.students_redirected} students redirected`}
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-mono text-[10px] text-slate-500">
          model {analytics.model_version} · {analytics.data_window_days}-day learning window
        </p>
        <button
          onClick={rebuild}
          disabled={isRebuilding}
          className="flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-[11px] font-bold text-slate-700 transition-colors hover:bg-slate-100 disabled:opacity-60"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isRebuilding ? 'animate-spin' : ''}`} />
          {isRebuilding ? 'Rebuilding…' : 'Rebuild from records'}
        </button>
      </div>

      {/* Per-service model readout */}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-[11px]">
          <thead>
            <tr className="border-b border-slate-200 text-[10px] uppercase tracking-wider text-slate-500">
              <th className="py-2 pr-3 font-bold">Service</th>
              <th className="py-2 pr-3 font-bold">Predicted peak</th>
              <th className="py-2 pr-3 font-bold">Quieter window</th>
              <th className="py-2 pr-3 font-bold">Confidence</th>
              <th className="py-2 pr-3 text-right font-bold">Peak wait</th>
              <th className="py-2 pr-3 text-right font-bold">Shown</th>
              <th className="py-2 pr-3 text-right font-bold">Redirects</th>
              <th className="py-2 text-right font-bold">Accepted</th>
            </tr>
          </thead>
          <tbody>
            {analytics.per_service.map(row => (
              <tr key={row.service_id} className="border-b border-slate-100 last:border-0">
                <td className="py-2 pr-3 font-semibold text-slate-800">{row.service_name}</td>
                <td className="py-2 pr-3 text-slate-600">{row.peak_window ?? '—'}</td>
                <td className="py-2 pr-3 text-slate-600">{row.better_window ?? '—'}</td>
                <td className="py-2 pr-3">
                  <span
                    className={`font-mono font-bold uppercase ${
                      row.confidence === 'high'
                        ? 'text-emerald-600'
                        : row.confidence === 'medium'
                        ? 'text-sky-600'
                        : 'text-slate-400'
                    }`}
                  >
                    {row.confidence} {row.confidence_pct}%
                  </span>
                </td>
                <td className="py-2 pr-3 text-right tabular-nums text-slate-700">{row.peak_wait}m</td>
                <td className="py-2 pr-3 text-right tabular-nums text-slate-500">{row.recommendations_shown}</td>
                <td className="py-2 pr-3 text-right tabular-nums text-slate-500">{row.redirects}</td>
                <td className="py-2 text-right tabular-nums text-slate-600">
                  {row.acceptance_rate_pct === null ? '—' : `${row.acceptance_rate_pct}%`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Campus-wide day x hour heatmap */}
      <div>
        <p className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-700">
          <Activity className="h-3.5 w-3.5" />
          Campus demand heatmap (recorded)
        </p>
        {analytics.heatmap.cells.length > 0 ? (
          <HeatmapGrid heatmap={analytics.heatmap} />
        ) : (
          <EmptyNote light>No recorded demand cells yet for the campus heatmap.</EmptyNote>
        )}
      </div>

      {/* Busiest recorded hours */}
      <div>
        <p className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-700">
          <TrendingUp className="h-3.5 w-3.5" />
          Busiest recorded hours
        </p>
        <ul className="grid gap-2 sm:grid-cols-3">
          {analytics.busiest_hours.map(hour => (
            <li key={hour.hour} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
              <p className="text-[10px] uppercase tracking-wider text-slate-400">{hour.label}</p>
              <p className="text-sm font-bold text-slate-900">~{hour.wait} min average</p>
              <p className="text-[10px] text-slate-500">
                ~{hour.arrivals} arrivals per hour · intensity {hour.intensity}
              </p>
            </li>
          ))}
        </ul>
      </div>

      <div>
        <p className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-700">
          <Users className="h-3.5 w-3.5" />
          Capacity pressure right now
        </p>
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {analytics.capacity_pressure.map(entry => (
            <li key={entry.service_id} className="rounded-xl border border-slate-200 px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <p className="truncate text-[11px] font-bold text-slate-800">{entry.service_name}</p>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-black uppercase ${
                    entry.pressure === 'high'
                      ? 'bg-rose-100 text-rose-700'
                      : entry.pressure === 'moderate'
                      ? 'bg-amber-100 text-amber-700'
                      : 'bg-emerald-100 text-emerald-700'
                  }`}
                >
                  {entry.pressure}
                </span>
              </div>
              <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
                <div
                  className={`h-full rounded-full ${
                    entry.pressure === 'high'
                      ? 'bg-rose-400'
                      : entry.pressure === 'moderate'
                      ? 'bg-amber-400'
                      : 'bg-emerald-400'
                  }`}
                  style={{ width: `${Math.min(100, entry.utilisation_pct)}%` }}
                />
              </div>
              <p className="mt-1 text-[10px] text-slate-500">
                {entry.active_capacity}/{entry.total_capacity} counters open · {entry.utilisation_pct}% of the
                hour consumed by the current queue
              </p>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
};

const HeatmapGrid: React.FC<{ heatmap: PeakIntelligenceAnalytics['heatmap'] }> = ({ heatmap }) => {
  const hours = heatmap.hours;
  const byKey = new Map(heatmap.cells.map(cell => [`${cell.day}-${cell.hour}`, cell]));
  const dayIndex = (label: string) => DAY_SHORT.indexOf(label as never);

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[560px]">
        <div className="mb-1 flex gap-[2px] pl-10">
          {hours.map(hour => (
            <span key={hour} className="flex-1 text-center font-mono text-[8px] text-slate-400">
              {hour % 2 === 0 ? hour : ''}
            </span>
          ))}
        </div>
        {heatmap.days.map(day => (
          <div key={day} className="mb-[2px] flex items-center gap-[2px]">
            <span className="w-10 shrink-0 font-mono text-[9px] uppercase text-slate-500">{day}</span>
            {hours.map(hour => {
              const cell = byKey.get(`${dayIndex(day)}-${hour}`);
              const band = cell ? demandBand(cell.intensity) : null;
              return (
                <span
                  key={hour}
                  title={
                    cell
                      ? `${day} ${hour}:00 · ${band} · ~${cell.wait} min · ${cell.samples} samples`
                      : `${day} ${hour}:00 · no recorded data`
                  }
                  className={`h-4 flex-1 rounded-[2px] ${
                    cell ? BAND_CLASS[band ?? 'low'] : 'bg-slate-100'
                  }`}
                />
              );
            })}
          </div>
        ))}
        <div className="mt-2 flex flex-wrap items-center gap-3 text-[9px] uppercase tracking-wider text-slate-500">
          <span>low</span>
          <span className="h-2 w-4 rounded bg-emerald-400/80" />
          <span>moderate</span>
          <span className="h-2 w-4 rounded bg-sky-400/80" />
          <span>high</span>
          <span className="h-2 w-4 rounded bg-amber-400/80" />
          <span>peak</span>
          <span className="h-2 w-4 rounded bg-rose-400/85" />
          <span className="ml-auto">blank = no recorded samples</span>
        </div>
      </div>
    </div>
  );
};

const Kpi: React.FC<{ label: string; value: string | number; hint?: string }> = ({ label, value, hint }) => (
  <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{label}</p>
    <p className="mt-0.5 text-lg font-black tabular-nums text-slate-900">{value}</p>
    {hint && <p className="text-[10px] text-slate-500">{hint}</p>}
  </div>
);
