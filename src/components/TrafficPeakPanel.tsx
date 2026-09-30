import React, { useEffect, useState } from 'react';
import { TrendingUp, TrendingDown, Minus, Clock, AlertTriangle, Info } from 'lucide-react';
import type { PeakForecast } from '../types/traffic.js';
import { freshnessLabel, useOfflineFetch, useOfflineStatus, type Freshness } from '../lib/offline.js';
import { FreshnessBadge } from './FreshnessBadge.js';

interface TrendResult {
  trend: 'rising' | 'stable' | 'falling' | 'unknown';
  change_pct: number | null;
  window_mins: number;
  sample_count: number;
  insufficient_reason: string | null;
  headline: string;
  detail: string;
}

const BAND_STYLE: Record<string, { label: string; glyph: string; className: string }> = {
  low: { label: 'Low', glyph: '▁', className: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' },
  moderate: { label: 'Moderate', glyph: '▄', className: 'bg-sky-500/15 text-sky-300 border-sky-500/30' },
  high: { label: 'Busy', glyph: '▆', className: 'bg-amber-500/15 text-amber-200 border-amber-500/30' },
  peak: { label: 'PEAK', glyph: '█', className: 'bg-rose-500/20 text-rose-200 border-rose-500/40' }
};

const HOUR_LABEL = (h: number) => {
  if (h === 0) return '12 AM';
  if (h === 12) return '12 PM';
  return h < 12 ? `${h} AM` : `${h - 12} PM`;
};

const TrendIcon = ({ trend }: { trend: TrendResult['trend'] }) => {
  if (trend === 'rising') return <TrendingUp className="w-4 h-4 text-rose-300" aria-hidden="true" />;
  if (trend === 'falling') return <TrendingDown className="w-4 h-4 text-emerald-300" aria-hidden="true" />;
  return <Minus className="w-4 h-4 text-slate-300" aria-hidden="true" />;
};

/**
 * Traffic and peak-time intelligence.
 *
 * Every number here comes from the server. Historical facts, live measurement
 * and forecast are labelled separately, and when there is not enough history
 * the panel says so rather than inventing a peak.
 */
export const TrafficPeakPanel: React.FC<{ serviceId: string }> = ({ serviceId }) => {
  const { request } = useOfflineFetch();
  const offline = useOfflineStatus();
  const [trend, setTrend] = useState<TrendResult | null>(null);
  const [freshness, setFreshness] = useState<Freshness>('live');
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await request<{ trend: TrendResult }>(`/api/intelligence/services/${serviceId}/trend`);
      if (cancelled) return;
      if (res.ok && res.data?.trend) {
        setTrend(res.data.trend);
        setFreshness(res.freshness);
        setFetchedAt(res.fetchedAt);
        setError(null);
      } else {
        setError(res.error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [serviceId, request]);

  if (error && !trend) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
        <p className="text-xs text-slate-400 flex items-center gap-2">
          <Info className="w-4 h-4" aria-hidden="true" />
          Traffic trend is unavailable right now.
        </p>
      </div>
    );
  }

  if (!trend) return null;

  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-5" aria-label="Traffic and peak time">
      <header className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <h3 className="text-sm font-bold text-white">Traffic trend</h3>
        <span
          className={`text-[10px] font-mono px-2 py-0.5 rounded border ${
            freshness === 'live' ? 'border-emerald-500/30 text-emerald-300' : 'border-amber-500/30 text-amber-200'
          }`}
        >
          {freshnessLabel(freshness, fetchedAt)}
        </span>
      </header>

      <div className="flex items-start gap-2.5">
        <TrendIcon trend={trend.trend} />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-white">{trend.headline}</p>
          <p className="text-xs text-slate-400 mt-0.5">{trend.detail}</p>
        </div>
      </div>

      {trend.trend === 'unknown' && trend.insufficient_reason && (
        <p className="mt-2.5 text-[11px] text-slate-400 flex items-start gap-1.5">
          <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden="true" />
          Not enough recent history yet to show a trend.
        </p>
      )}

      {offline && (
        <p className="mt-2.5 text-[11px] text-amber-200 flex items-start gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden="true" />
          Shown from cache. Live traffic cannot be confirmed while offline.
        </p>
      )}
    </section>
  );
};

/** The visual day timeline. Always paired with a text equivalent below. */
export const TrafficTimeline: React.FC<{ forecast: PeakForecast; loading?: boolean }> = ({ forecast, loading }) => {
  if (loading) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
        <div className="h-4 w-40 rounded bg-white/10 animate-pulse" />
      </div>
    );
  }

  if (!forecast.sufficient_data || forecast.hours.length === 0) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
        <h3 className="text-sm font-bold text-white mb-1.5">Traffic today</h3>
        <p className="text-xs text-slate-400 flex items-center gap-2">
          <Info className="w-4 h-4 shrink-0" aria-hidden="true" />
          Not enough history yet to draw a traffic profile for this service.
        </p>
      </div>
    );
  }

  const maxIntensity = Math.max(1, ...forecast.hours.map(h => h.intensity));
  const peak = forecast.predicted_peak;
  const better = forecast.better_window;

  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-5" aria-label="Traffic timeline">
      <header className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <h3 className="text-sm font-bold text-white">Traffic today</h3>
        <span className="text-[10px] font-mono px-2 py-0.5 rounded border border-sky-500/30 text-sky-300">
          HISTORICAL PATTERN
        </span>
      </header>

      {/* Bars encode level by height, glyph and label, never colour alone. */}
      <div className="flex items-end gap-1 h-20" role="img" aria-label={describeTimeline(forecast)}>
        {forecast.hours.map(hour => {
          const band = BAND_STYLE[hour.band] ?? BAND_STYLE.low;
          const height = Math.max(8, Math.round((hour.intensity / maxIntensity) * 100));
          const isPeak = peak?.start_hour === hour.hour;
          const isBetter = better?.start_hour === hour.hour;
          return (
            <div
              key={hour.hour}
              className="flex-1 flex flex-col items-center gap-1 min-w-0"
              title={`${HOUR_LABEL(hour.hour)} — ${band.label} (intensity ${hour.intensity})`}
            >
              <div
                className={`w-full rounded-t border ${band.className} ${hour.is_current ? 'ring-2 ring-[#d9f65b]' : ''}`}
                style={{ height: `${height}%` }}
              />
              <span className="text-[9px] font-mono text-slate-500 leading-none">{band.glyph}</span>
            </div>
          );
        })}
      </div>

      <div className="flex justify-between mt-1.5 text-[10px] font-mono text-slate-500">
        <span>{HOUR_LABEL(forecast.hours[0].hour)}</span>
        <span>{HOUR_LABEL(forecast.hours[forecast.hours.length - 1].hour)}</span>
      </div>

      {/* Text equivalent: required, and the primary source of truth. */}
      <dl className="mt-4 grid gap-2 sm:grid-cols-2">
        {peak && (
          <div className="rounded-lg border border-rose-500/25 bg-rose-500/[0.07] px-3 py-2">
            <dt className="text-[10px] font-mono uppercase tracking-wide text-rose-200/80">Expected peak</dt>
            <dd className="text-xs font-semibold text-white mt-0.5">
              {HOUR_LABEL(peak.start_hour)} – {HOUR_LABEL(peak.end_hour)}
            </dd>
            <dd className="text-[11px] text-rose-200/80 mt-0.5">
              Forecast · {forecast.confidence} confidence ({forecast.confidence_pct}%)
            </dd>
          </div>
        )}

        {better && (
          <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/[0.07] px-3 py-2">
            <dt className="text-[10px] font-mono uppercase tracking-wide text-emerald-200/80">
              Expected lower traffic
            </dt>
            <dd className="text-xs font-semibold text-white mt-0.5">
              {HOUR_LABEL(better.start_hour)} – {HOUR_LABEL(better.end_hour)}
            </dd>
            <dd className="text-[11px] text-emerald-200/80 mt-0.5">Forecast · {better.expected_demand}</dd>
          </div>
        )}
      </dl>

      {!peak && !better && (
        <p className="mt-3 text-xs text-slate-400">
          No clear peak or quieter window stands out in the recorded pattern for this service.
        </p>
      )}

      <p className="mt-3 text-[11px] text-slate-500 flex items-start gap-1.5">
        <Clock className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden="true" />
        {forecast.disclaimer}
      </p>
    </section>
  );
};

/** Screen-reader description of the whole profile. */
function describeTimeline(forecast: PeakForecast): string {
  const parts = forecast.hours.map(h => `${HOUR_LABEL(h.hour)}: ${(BAND_STYLE[h.band] ?? BAND_STYLE.low).label}`);
  return `Recorded traffic profile. ${parts.join(', ')}.`;
}

/** "Best time to visit", clearly labelled as an estimate. */
export const BestTimeCard: React.FC<{ forecast: PeakForecast }> = ({ forecast }) => {
  const better = forecast.better_window;
  if (!forecast.sufficient_data || !better) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
        <h3 className="text-sm font-bold text-white mb-1.5">Best estimated time to visit</h3>
        <p className="text-xs text-slate-400">Not enough history yet to suggest a better time.</p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-emerald-500/25 bg-emerald-500/[0.07] p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-bold text-white">Best estimated time to visit</h3>
        <span className="text-[10px] font-mono px-2 py-0.5 rounded border border-emerald-500/30 text-emerald-300">
          ESTIMATE
        </span>
      </div>
      <p className="text-lg font-black text-white mt-2">
        {HOUR_LABEL(better.start_hour)} – {HOUR_LABEL(better.end_hour)}
      </p>
      <p className="text-xs text-emerald-200/90 mt-1">
        Expected traffic: {better.expected_demand}. This is an estimate from recorded campus demand
        and does not guarantee the wait will match.
      </p>
    </div>
  );
};
