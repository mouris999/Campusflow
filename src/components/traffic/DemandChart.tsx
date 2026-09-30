/**
 * Recorded demand timeline.
 *
 * Every bar is a real measurement bucket from the store, so the chart is a
 * readout rather than a drawing: the height is the recorded average wait, the
 * colour is the demand band, and a hatched bar marks a window with no data.
 */

import React from 'react';
import type { HourlyDemandPoint, PeakForecast } from '../../types/traffic.js';
import { ConfidenceTag, EmptyNote, TRAFFIC_BAR_CLASS } from './TrafficBits.js';

interface DemandChartProps {
  forecast: PeakForecast;
  onSelectHour?: (hour: number) => void;
  /** The service modal uses a light surface, the campus view a dark one. */
  light?: boolean;
}

export const DemandChart: React.FC<DemandChartProps> = ({ forecast, onSelectHour, light = false }) => {
  const hours = forecast.hours;
  const muted = light ? 'text-slate-500' : 'text-slate-500';
  const hoverBg = light ? 'hover:bg-slate-100' : 'hover:bg-white/[0.06]';
  const currentBg = light ? 'bg-slate-100' : 'bg-white/[0.06]';

  if (!forecast.sufficient_data) {
    return (
      <EmptyNote light={light}>
        {forecast.insufficient_reason ??
          'Not enough recorded demand at this service yet to predict a peak.'}{' '}
        We will keep recording arrivals and waits, and the timeline appears once there is a history to learn from.
      </EmptyNote>
    );
  }

  const maxWait = Math.max(1, ...hours.map(h => h.avg_wait));

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className={`font-mono text-[10px] uppercase tracking-[0.18em] ${muted}`}>
          Recorded demand · {forecast.sample_count} samples across {forecast.distinct_days} days
        </p>
        <ConfidenceTag confidence={forecast.confidence} pct={forecast.confidence_pct} light={light} />
      </div>

      <div
        className="flex items-end gap-[3px] overflow-x-auto pb-1"
        role="img"
        aria-label={`Recorded demand timeline. Highest average wait ${maxWait} minutes.`}
      >
        {hours.map(point => {
          const isCurrent = point.is_current;
          const isPeak = forecast.predicted_peak
            ? point.hour >= forecast.predicted_peak.start_hour && point.hour < forecast.predicted_peak.end_hour
            : false;
          const isBetter = forecast.better_window
            ? point.hour >= forecast.better_window.start_hour && point.hour < forecast.better_window.end_hour
            : false;

          return (
            <button
              key={point.hour}
              type="button"
              onClick={() => onSelectHour?.(point.hour)}
              aria-label={`${point.label}: ${point.band} demand, about ${point.avg_wait} minutes average wait across ${point.sample_days} recorded days`}
              className={`group relative flex min-w-[26px] flex-1 flex-col items-center gap-1 rounded-lg px-0.5 pt-1 transition-colors ${hoverBg} ${
                isCurrent ? currentBg : ''
              }`}
              title={`${point.label} · ${point.band} · ~${point.avg_wait} min average wait · ${point.sample_days} recorded days`}
            >
              <span className={`text-[9px] font-mono tabular-nums ${muted} opacity-0 transition-opacity group-hover:opacity-100`}>
                {point.avg_wait}
              </span>
              <span
                className={`w-full rounded-t-md transition-all ${TRAFFIC_BAR_CLASS[point.band]} ${
                  isCurrent ? (light ? 'ring-1 ring-indigo-500' : 'ring-1 ring-[#d9f65b]') : ''
                } ${isPeak || isBetter ? 'ring-1 ring-white/40' : ''}`}
                style={{ height: `${Math.max(6, (point.avg_wait / maxWait) * 108)}px` }}
              />
              <span
                className={`font-mono text-[9px] tabular-nums ${
                  isCurrent ? (light ? 'font-bold text-indigo-600' : 'font-bold text-[#d9f65b]') : muted
                }`}
              >
                {point.hour % 3 === 0 ? point.label.replace(' ', '') : ''}
              </span>
            </button>
          );
        })}
      </div>

      <div className={`mt-3 flex flex-wrap gap-3 text-[10px] ${light ? 'text-slate-500' : 'text-slate-400'}`}>
        <LegendRow className="bg-rose-400/80" label="Predicted peak" ring />
        <LegendRow className="bg-emerald-400/70" label="Quieter window" ring />
        <LegendRow className="bg-sky-400/70" label="Moderate" />
        <span className="ml-auto">Bar height = recorded average wait</span>
      </div>
    </div>
  );
};

const LegendRow: React.FC<{ className: string; label: string; ring?: boolean }> = ({ className, label, ring }) => (
  <span className="inline-flex items-center gap-1.5">
    <span className={`h-2.5 w-4 rounded ${className} ${ring ? 'ring-1 ring-white/40' : ''}`} />
    {label}
  </span>
);
