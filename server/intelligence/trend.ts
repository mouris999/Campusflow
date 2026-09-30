/**
 * Live traffic trend.
 *
 * Answers "is it getting better or worse right now?" from recorded demand
 * samples, not from a guess. When there is not enough recent history the
 * answer is "unknown" rather than an invented direction.
 */

import type { Service } from '../../src/types/index.js';
import type { DemandMeasurement } from '../../src/types/traffic.js';

export type TrafficTrend = 'rising' | 'stable' | 'falling' | 'unknown';

export interface TrafficTrendResult {
  service_id: string;
  trend: TrafficTrend;
  /** Percentage change in arrival rate across the comparison window. */
  change_pct: number | null;
  window_mins: number;
  /** How many recent samples the comparison rests on. */
  sample_count: number;
  /** Set when trend is 'unknown' so the UI can explain itself. */
  insufficient_reason: string | null;
  headline: string;
  detail: string;
}

/** Below this magnitude we call the change "stable" rather than a trend. */
export const TREND_FLAT_PCT = 8;
/** At or above this we call it a real swing worth showing. */
export const TREND_SIGNIFICANT_PCT = 15;

export function computeTrafficTrend(
  service: Pick<Service, 'id' | 'name' | 'estimated_wait_mins'>,
  measurements: DemandMeasurement[],
  now = new Date(),
  windowMins = 30
): TrafficTrendResult {
  const nowMs = now.getTime();
  const windowStartMs = nowMs - windowMins * 60000;
  const halfway = windowStartMs + (windowMins * 60000) / 2;

  const recent = measurements.filter(m => {
    const t = new Date(m.recorded_at).getTime();
    return m.service_id === service.id && Number.isFinite(t) && t >= windowStartMs && t <= nowMs;
  });

  const base: Omit<TrafficTrendResult, 'trend' | 'headline' | 'detail'> = {
    service_id: service.id,
    change_pct: null,
    window_mins: windowMins,
    sample_count: recent.length,
    insufficient_reason: null
  };

  // Too few samples in the window: say so instead of guessing a direction.
  if (recent.length < 4) {
    return {
      ...base,
      trend: 'unknown',
      insufficient_reason: recent.length === 0 ? 'no_recent_samples' : 'too_few_recent_samples',
      headline: 'Traffic trend unavailable',
      detail:
        recent.length === 0
          ? 'Not enough recent activity has been recorded to show a trend yet.'
          : 'Only a few recent samples are available, so no reliable trend can be shown yet.'
    };
  }

  const earlier = recent.filter(m => new Date(m.recorded_at).getTime() < halfway);
  const later = recent.filter(m => new Date(m.recorded_at).getTime() >= halfway);

  if (earlier.length === 0 || later.length === 0) {
    return {
      ...base,
      trend: 'unknown',
      insufficient_reason: 'window_not_split',
      headline: 'Traffic trend unavailable',
      detail: 'Recent samples do not span both halves of the comparison window.'
    };
  }

  const avg = (rows: DemandMeasurement[], pick: (m: DemandMeasurement) => number) =>
    rows.reduce((sum, m) => sum + pick(m), 0) / rows.length;

  // Prefer arrival volume; fall back to recorded average wait, which moves in
  // the same direction, when arrivals were not counted separately.
  const earlierRate = avg(earlier, m => m.arrivals);
  const laterRate = avg(later, m => m.arrivals);
  const earlierSignal = earlierRate > 0 ? earlierRate : avg(earlier, m => m.avg_wait);
  const laterSignal = laterRate > 0 ? laterRate : avg(later, m => m.avg_wait);

  if (earlierSignal <= 0) {
    return {
      ...base,
      trend: 'unknown',
      insufficient_reason: 'no_baseline',
      headline: 'Traffic trend unavailable',
      detail: 'There is no earlier activity in this window to compare against.'
    };
  }

  const changePct = Math.round(((laterSignal - earlierSignal) / earlierSignal) * 100);

  let trend: TrafficTrend;
  if (Math.abs(changePct) < TREND_FLAT_PCT) trend = 'stable';
  else if (changePct >= TREND_SIGNIFICANT_PCT) trend = 'rising';
  else if (changePct <= -TREND_SIGNIFICANT_PCT) trend = 'falling';
  // Between flat and significant: report the direction but keep it modest.
  else trend = changePct > 0 ? 'rising' : 'falling';

  const direction = trend === 'rising' ? '↑' : trend === 'falling' ? '↓' : '→';
  const magnitude = Math.abs(changePct);

  const headline =
    trend === 'stable'
      ? 'Traffic is steady'
      : `Traffic is ${trend} ${direction} ${magnitude}% in the last ${windowMins} min`;

  const detail =
    trend === 'stable'
      ? 'Arrival volume has not changed much in the last half hour.'
      : trend === 'rising'
        ? 'More students are arriving than earlier in the window. Waiting time may increase.'
        : 'Fewer students are arriving than earlier in the window, so the queue may shorten.';

  return { ...base, trend, change_pct: changePct, headline, detail };
}
