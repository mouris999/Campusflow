/**
 * Peak-time prediction engine.
 *
 * Pure functions only: given stored demand measurements plus the live service
 * record, produce a forecast. When there is not enough recorded history the
 * engine reports `sufficient_data: false` and produces no peak at all — it
 * never extrapolates a number it cannot support.
 */

import type {
  DemandBand,
  DemandMeasurement,
  HourlyDemandPoint,
  PeakConfidence,
  PeakForecast,
  PeakWindow
} from '../../src/types/traffic.js';
import { DAY_NAMES, dateKey, formatHourLabel, formatHourWindow, minutesIntoDay, pad2 } from '../../src/lib/time.js';
import { demandBand } from '../../src/lib/trafficState.js';
import { HISTORY_WINDOW_DAYS } from './demandSeed.js';

export const PEAK_MODEL_VERSION = 'campusflow-peak-v1';

/** Below this many distinct recorded days we refuse to predict. */
export const MIN_DISTINCT_DAYS = 5;
/** Below this many same-weekday samples we fall back to the overall profile. */
export const MIN_WEEKDAY_SAMPLES = 3;
/**
 * A recorded wait of this many minutes counts as a full peak when scaling
 * demand intensity. It matches the `high`/`peak` traffic thresholds shown to
 * students, so "peak" means the same thing in the chart and in the badge.
 */
export const PEAK_REFERENCE_WAIT_MINS = 20;

const PEAK_BAND: DemandBand[] = ['peak', 'high'];
const SHARP_PEAK_BAND: DemandBand[] = ['peak'];
const BAND_RANK: Record<DemandBand, number> = { low: 0, moderate: 1, high: 2, peak: 3 };

export interface ForecastService {
  id: string;
  name: string;
  status: 'open' | 'closed' | 'paused' | 'congested';
  operating_hours: { open: string; close: string; days: string[] };
  current_queue_length: number;
  estimated_wait_mins: number;
  current_demand_level: 'low' | 'moderate' | 'high' | 'critical';
  avg_service_duration_mins: number;
  total_counters: number;
  active_counters: number;
  max_queue_capacity: number;
}

export interface ForecastInput {
  service: ForecastService;
  measurements: DemandMeasurement[];
  now: Date;
  windowDays?: number;
}

interface HourStat {
  hour: number;
  arrivals: number[];
  waits: number[];
  queues: number[];
  capacity: number[];
  days: Set<string>;
  incidentTotal: number;
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function stdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  const variance = values.reduce((sum, v) => sum + (v - m) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function round(value: number): number {
  return Math.round(value);
}

function isOpenOn(service: ForecastService, date: Date): boolean {
  return service.operating_hours.days.includes(DAY_NAMES[date.getDay()]);
}

function openHoursFor(service: ForecastService): number[] {
  const open = parseInt(service.operating_hours.open.split(':')[0], 10);
  const close = parseInt(service.operating_hours.close.split(':')[0], 10);
  const hours: number[] = [];
  for (let h = open; h <= close; h += 1) hours.push(h);
  return hours;
}

function buildHourStats(measurements: DemandMeasurement[]): Map<number, HourStat> {
  const map = new Map<number, HourStat>();
  for (const m of measurements) {
    let stat = map.get(m.hour);
    if (!stat) {
      stat = {
        hour: m.hour,
        arrivals: [],
        waits: [],
        queues: [],
        capacity: [],
        days: new Set<string>(),
        incidentTotal: 0
      };
      map.set(m.hour, stat);
    }
    stat.arrivals.push(m.arrivals);
    stat.waits.push(m.avg_wait);
    stat.queues.push(m.avg_queue);
    stat.capacity.push(m.active_capacity);
    stat.days.add(m.date);
    stat.incidentTotal += m.incident_count;
  }
  return map;
}

interface Profile {
  hours: HourlyDemandPoint[];
  byHour: Map<number, HourlyDemandPoint>;
  distinctDays: number;
  sampleCount: number;
}

function buildProfile(measurements: DemandMeasurement[], now: Date): Profile {
  const stats = buildHourStats(measurements);
  const hours = Array.from(stats.values()).sort((a, b) => a.hour - b.hour);

  const waitsByHour = hours.map(s => mean(s.waits));
  const minWait = Math.min(...waitsByHour);
  const maxWait = Math.max(...waitsByHour);
  const span = Math.max(1, maxWait - minWait);

  const byHour = new Map<number, HourlyDemandPoint>();
  for (const stat of stats.values()) {
    const avgArrivals = mean(stat.arrivals);
    const avgWait = mean(stat.waits);
    // Two signals, both from stored measurements:
    //  - how long the recorded wait is, against a documented peak reference
    //  - where that hour sits inside this service's own recorded day
    const level = Math.min(1, avgWait / PEAK_REFERENCE_WAIT_MINS);
    const shape = (avgWait - minWait) / span;
    const intensity = round(100 * (0.6 * level + 0.4 * shape));
    const waits = stat.waits;
    byHour.set(stat.hour, {
      hour: stat.hour,
      label: formatHourLabel(stat.hour),
      intensity,
      band: demandBand(intensity),
      avg_arrivals: round(avgArrivals),
      avg_queue: round(mean(stat.queues)),
      avg_wait: round(avgWait),
      min_wait: round(Math.min(...waits)),
      max_wait: round(Math.max(...waits)),
      wait_stdev: round(stdDev(waits)),
      sample_days: stat.days.size,
      is_current: false,
      is_predicted: true
    });
  }

  return {
    hours: Array.from(byHour.values()).sort((a, b) => a.hour - b.hour),
    byHour,
    distinctDays: new Set(measurements.map(m => m.date)).size,
    sampleCount: measurements.length
  };
}

function windowsFromHours(
  hours: HourlyDemandPoint[],
  dateKeyValue: string | null,
  dayLabel: string,
  bands: DemandBand[] = PEAK_BAND
): PeakWindow[] {
  const windows: PeakWindow[] = [];
  let run: HourlyDemandPoint[] = [];

  const flush = () => {
    if (run.length === 0) return;
    const intensity = round(run.reduce((s, h) => s + h.intensity, 0) / run.length);
    const queue = round(run.reduce((s, h) => s + h.avg_queue, 0) / run.length);
    const avgWait = mean(run.map(h => h.avg_wait));
    const spread = Math.max(1, mean(run.map(h => h.wait_stdev)));
    const waitMin = Math.max(0, round(Math.min(...run.map(h => h.min_wait))));
    const waitMax = Math.max(waitMin, round(avgWait + spread));
    // A run of hours 11 and 12 is the 11:00-13:00 stretch, so the window ends
    // at the hour *after* the last busy hour. This also keeps a single-hour
    // peak from rendering as "2 PM - 2 PM".
    const endHour = Math.min(24, run[run.length - 1].hour + 1);
    windows.push({
      date: dateKeyValue,
      day_label: dayLabel,
      start_hour: run[0].hour,
      end_hour: endHour,
      label: formatHourWindow(run[0].hour, endHour),
      expected_demand: demandBand(intensity),
      expected_queue: queue,
      expected_wait_min: waitMin,
      expected_wait_max: waitMax,
      intensity
    });
    run = [];
  };

  for (const point of hours) {
    if (bands.includes(point.band)) {
      run.push(point);
    } else {
      flush();
    }
  }
  flush();
  return windows;
}

function pickBetterWindow(
  hours: HourlyDemandPoint[],
  fromHour: number,
  toHour: number,
  dateKeyValue: string | null,
  dayLabel: string
): PeakWindow | null {
  const candidates = hours.filter(h => h.hour >= fromHour && h.hour <= toHour);
  if (candidates.length === 0) return null;

  // Find the longest run of consecutive hours that are not in a peak band.
  const runs: HourlyDemandPoint[][] = [];
  let run: HourlyDemandPoint[] = [];
  for (const point of candidates) {
    if (!PEAK_BAND.includes(point.band)) {
      run.push(point);
    } else {
      if (run.length) runs.push(run);
      run = [];
    }
  }
  if (run.length) runs.push(run);

  if (runs.length === 0) return null;
  // Rank by the calmest stretch first, then prefer the longer of equally calm
  // options. A window is only useful if *every* hour in it is calmer.
  const worstIntensity = (run: HourlyDemandPoint[]) => Math.max(...run.map(h => h.intensity));
  runs.sort((a, b) => worstIntensity(a) - worstIntensity(b) || b.length - a.length);
  const best = runs[0];
  const intensity = worstIntensity(best);
  const avgWait = mean(best.map(h => h.avg_wait));
  const endHour = Math.min(24, best[best.length - 1].hour + 1);
  return {
    date: dateKeyValue,
    day_label: dayLabel,
    start_hour: best[0].hour,
    end_hour: endHour,
    label: formatHourWindow(best[0].hour, endHour),
    expected_demand: demandBand(intensity),
    expected_queue: Math.max(...best.map(h => h.avg_queue)),
    expected_wait_min: round(Math.min(...best.map(h => h.min_wait))),
    expected_wait_max: round(avgWait + Math.max(1, mean(best.map(h => h.wait_stdev)))),
    intensity
  };
}

function confidenceFrom(samples: DemandMeasurement[], peakWaits: number[], basisIsWeekday: boolean) {
  const distinctDays = new Set(samples.map(m => m.date)).size;
  const sampleFactor = Math.min(1, distinctDays / 14);
  const weekdayFactor = basisIsWeekday ? 1 : 0.82;
  const m = mean(peakWaits);
  const cv = m > 0 ? stdDev(peakWaits) / m : 1;
  const consistency = Math.max(0, 1 - Math.min(1, cv));
  const pct = Math.round(100 * (0.45 * sampleFactor + 0.25 * weekdayFactor + 0.3 * consistency));
  const confidence_pct = Math.max(20, Math.min(93, pct));
  const confidence: PeakConfidence = confidence_pct >= 70 ? 'high' : confidence_pct >= 45 ? 'medium' : 'low';
  return { confidence_pct, confidence, distinctDays };
}

export function computePeakForecast(input: ForecastInput): PeakForecast {
  const { service, now } = input;
  const windowDays = input.windowDays ?? HISTORY_WINDOW_DAYS;
  const generatedAt = now.toISOString();

  const base: PeakForecast = {
    service_id: service.id,
    service_name: service.name,
    generated_at: generatedAt,
    model_version: PEAK_MODEL_VERSION,
    sufficient_data: false,
    confidence: 'low',
    confidence_pct: 0,
    sample_count: 0,
    distinct_days: 0,
    window_days: windowDays,
    basis: 'overall_profile',
    hours: [],
    predicted_peak: null,
    busy_window: null,
    upcoming_peaks: [],
    better_window: null,
    peak_in_minutes: null,
    rising: false,
    is_open_now: false,
    disclaimer:
      'Predictions are estimates from recorded campus demand, not guarantees. Live queues always win.'
  };

  const cutoff = new Date(now.getTime() - windowDays * 86400000);
  const cutoffKey = dateKey(cutoff);
  const windowed = input.measurements.filter(m => m.service_id === service.id && m.date >= cutoffKey);

  if (windowed.length === 0) {
    return { ...base, insufficient_reason: 'no_recorded_demand' };
  }

  const dow = now.getDay();
  const weekdaySamples = windowed.filter(m => m.day_of_week === dow);
  const weekdayDays = new Set(weekdaySamples.map(m => m.date)).size;
  const recordedDays = new Set(windowed.map(m => m.date)).size;

  // The history floor applies to the recorded record as a whole; a weekday
  // profile may be built from a smaller subset once that subset is stable.
  if (recordedDays < MIN_DISTINCT_DAYS) {
    return {
      ...base,
      sample_count: windowed.length,
      distinct_days: recordedDays,
      insufficient_reason: 'insufficient_recorded_days'
    };
  }

  const useWeekday = weekdayDays >= MIN_WEEKDAY_SAMPLES;
  const basis: PeakForecast['basis'] = useWeekday ? 'weekday_profile' : 'overall_profile';
  const samples = useWeekday ? weekdaySamples : windowed;

  const profile = buildProfile(samples, now);

  const openHours = openHoursFor(service);
  const isOpenToday = isOpenOn(service, now);
  const currentHour = now.getHours();

  // Timeline: recorded hours that the service is actually open.
  const timeline: HourlyDemandPoint[] = openHours
    .map(hour => profile.byHour.get(hour))
    .filter((point): point is HourlyDemandPoint => !!point)
    .map(point => ({ ...point, is_current: isOpenToday && point.hour === currentHour }));

  const todayKey = dateKey(now);
  const tomorrow = new Date(now.getTime() + 86400000);
  const sharpToday = windowsFromHours(timeline, todayKey, 'Today', SHARP_PEAK_BAND);
  const busyToday = windowsFromHours(timeline, todayKey, 'Today', PEAK_BAND);
  const sharpTomorrow = windowsFromHours(timeline, dateKey(tomorrow), 'Tomorrow', SHARP_PEAK_BAND);
  const busyTomorrow = windowsFromHours(timeline, dateKey(tomorrow), 'Tomorrow', PEAK_BAND);

  const nowMins = minutesIntoDay(now);
  const stillRelevant = (w: PeakWindow) => w.end_hour * 60 + 60 > nowMins;
  const sharpUpcoming = [...sharpToday.filter(stillRelevant), ...sharpTomorrow];
  const busyUpcoming = [...busyToday.filter(stillRelevant), ...busyTomorrow];

  const predictedPeak = sharpUpcoming[0] ?? null;
  const busyWindow = busyUpcoming[0] ?? null;
  const upcomingPeaks = (sharpUpcoming.length ? sharpUpcoming : busyUpcoming).slice(0, 2);

  const betterWindowToday = pickBetterWindow(
    timeline,
    isOpenToday ? currentHour : openHours[0],
    openHours[openHours.length - 1],
    todayKey,
    'Today'
  );
  const betterWindow =
    betterWindowToday ??
    pickBetterWindow(
      timeline,
      openHours[0],
      openHours[openHours.length - 1],
      dateKey(tomorrow),
      'Tomorrow'
    );

  const peakWaits = (predictedPeak
    ? timeline.filter(h => h.hour >= predictedPeak.start_hour && h.hour <= predictedPeak.end_hour)
    : []
  ).map(h => h.avg_wait);
  const { confidence_pct, confidence, distinctDays } = confidenceFrom(windowed, peakWaits, useWeekday);

  let peakInMinutes: number | null = null;
  if (predictedPeak) {
    const startMins = predictedPeak.start_hour * 60;
    peakInMinutes = Math.max(0, startMins - nowMins);
    if (peakInMinutes === 0 && predictedPeak.end_hour < currentHour) peakInMinutes = null;
  }

  const currentPoint = timeline.find(h => h.is_current);
  const rising =
    isOpenToday &&
    !!currentPoint &&
    (BAND_RANK[currentPoint.band] >= BAND_RANK.moderate) &&
    (peakInMinutes !== null && peakInMinutes <= 150 ||
      (currentPoint.intensity > 0 &&
        profile.byHour.get(currentHour - 1) !== undefined &&
        currentPoint.intensity - (profile.byHour.get(currentHour - 1)?.intensity ?? 0) >= 10));

  const isOpenNow =
    isOpenToday &&
    service.status !== 'closed' &&
    currentHour >= openHours[0] &&
    currentHour < openHours[openHours.length - 1] + 1;

  return {
    service_id: service.id,
    service_name: service.name,
    generated_at: generatedAt,
    model_version: PEAK_MODEL_VERSION,
    sufficient_data: true,
    confidence,
    confidence_pct,
    sample_count: profile.sampleCount,
    distinct_days: distinctDays,
    window_days: windowDays,
    basis,
    hours: timeline,
    predicted_peak: predictedPeak,
    busy_window: busyWindow,
    upcoming_peaks: upcomingPeaks,
    better_window: betterWindow,
    peak_in_minutes: peakInMinutes,
    rising,
    is_open_now: isOpenNow,
    disclaimer:
      'Predictions are estimates from recorded campus demand, not guarantees. Live queues always win.'
  };
}

/** Small projection used by the alternative engine / cards. */
export function predictedWaitAtHour(forecast: PeakForecast | null, hour: number): number | null {
  if (!forecast || !forecast.sufficient_data) return null;
  const point = forecast.hours.find(h => h.hour === hour);
  return point ? point.avg_wait : null;
}

export function predictedIntensityAtHour(forecast: PeakForecast | null, hour: number): number | null {
  if (!forecast || !forecast.sufficient_data) return null;
  const point = forecast.hours.find(h => h.hour === hour);
  return point ? point.intensity : null;
}

export function peakWindowLabel(window: PeakWindow | null): string | null {
  if (!window) return null;
  return `${window.day_label} · ${window.label}`;
}

export function formatHourRange(startHour: number, endHour: number): string {
  return `${pad2(startHour)}:00–${pad2(endHour)}:00`;
}
