/**
 * Deterministic historical demand generator.
 *
 * The peak engine needs recorded history. CampusFlow ships with a seeded
 * operating history (the same way `wait_measurements` was seeded originally)
 * so predictions work on a fresh install. The generator is seeded and pure:
 * the same service + date always produces the same measurement, which keeps
 * rebuilds idempotent and tests stable. Live samples recorded at runtime are
 * appended on top of this history and always take precedence.
 */

import type { DemandMeasurement } from '../../src/types/traffic.js';
import { DAY_NAMES, dateKey, parseClock } from '../../src/lib/time.js';

export const HISTORY_WINDOW_DAYS = 28;
export const SEED_HISTORY_DAYS = 21;

export interface DemandProfile {
  service_id: string;
  /** Typical arrivals per hour at a quiet hour of the day. */
  base_arrivals: number;
  /** hour -> relative weight (1.0 = the busiest hour of the day). */
  hourly_weights: Record<number, number>;
  /** Minutes of wait at the busiest hour of a typical weekday. */
  peak_wait_mins: number;
  /** 0 = perfectly repeatable, 1 = extremely noisy. */
  variability: number;
  service_duration_mins: number;
  total_capacity: number;
}

const H = (weights: Record<number, number>) => weights;

export const DEMAND_PROFILES: Record<string, DemandProfile> = {
  'srv-canteen-main': {
    service_id: 'srv-canteen-main',
    base_arrivals: 45,
    hourly_weights: H({ 8: 0.3, 9: 0.35, 10: 0.45, 11: 0.8, 12: 1.0, 13: 0.95, 14: 0.6, 15: 0.4, 16: 0.35, 17: 0.45, 18: 0.5, 19: 0.35 }),
    peak_wait_mins: 22,
    variability: 0.16,
    service_duration_mins: 4,
    total_capacity: 3
  },
  'srv-canteen-eng': {
    service_id: 'srv-canteen-eng',
    base_arrivals: 18,
    hourly_weights: H({ 8: 0.55, 9: 0.7, 10: 0.5, 11: 0.6, 12: 0.8, 13: 0.7, 14: 0.5, 15: 0.45, 16: 0.4, 17: 0.35, 18: 0.25 }),
    peak_wait_mins: 5,
    variability: 0.2,
    service_duration_mins: 3,
    total_capacity: 2
  },
  'srv-reg-main': {
    service_id: 'srv-reg-main',
    base_arrivals: 30,
    hourly_weights: H({ 9: 0.45, 10: 0.6, 11: 0.95, 12: 0.85, 13: 0.9, 14: 0.75, 15: 0.5, 16: 0.4 }),
    peak_wait_mins: 28,
    variability: 0.22,
    service_duration_mins: 6,
    total_capacity: 4
  },
  'srv-reg-north': {
    service_id: 'srv-reg-north',
    base_arrivals: 9,
    hourly_weights: H({ 9: 0.5, 10: 0.55, 11: 0.6, 12: 0.55, 13: 0.6, 14: 0.5, 15: 0.45, 16: 0.4 }),
    peak_wait_mins: 5,
    variability: 0.18,
    service_duration_mins: 5,
    total_capacity: 2
  },
  'srv-bursar': {
    service_id: 'srv-bursar',
    base_arrivals: 14,
    hourly_weights: H({ 9: 0.4, 10: 0.5, 11: 0.65, 12: 0.6, 13: 0.7, 14: 0.8, 15: 0.85, 16: 0.6 }),
    peak_wait_mins: 16,
    variability: 0.24,
    service_duration_mins: 8,
    total_capacity: 3
  },
  'srv-sci-lab': {
    service_id: 'srv-sci-lab',
    base_arrivals: 10,
    hourly_weights: H({ 9: 0.5, 10: 0.7, 11: 0.8, 12: 0.6, 13: 0.75, 14: 0.8, 15: 0.65, 16: 0.5, 17: 0.35 }),
    peak_wait_mins: 10,
    variability: 0.2,
    service_duration_mins: 5,
    total_capacity: 2
  },
  'srv-eng-workshop': {
    service_id: 'srv-eng-workshop',
    base_arrivals: 8,
    hourly_weights: H({ 9: 0.5, 10: 0.6, 11: 0.65, 12: 0.55, 13: 0.6, 14: 0.7, 15: 0.75, 16: 0.8, 17: 0.75, 18: 0.6, 19: 0.45, 20: 0.35 }),
    peak_wait_mins: 13,
    variability: 0.25,
    service_duration_mins: 7,
    total_capacity: 3
  },
  'srv-lib-desk': {
    service_id: 'srv-lib-desk',
    base_arrivals: 25,
    hourly_weights: H({ 8: 0.4, 9: 0.5, 10: 0.6, 11: 0.7, 12: 0.65, 13: 0.7, 14: 0.8, 15: 0.95, 16: 1.0, 17: 0.95, 18: 0.85, 19: 0.6, 20: 0.45, 21: 0.3, 22: 0.2 }),
    peak_wait_mins: 14,
    variability: 0.18,
    service_duration_mins: 4,
    total_capacity: 3
  },
  'srv-lib-commons': {
    service_id: 'srv-lib-commons',
    base_arrivals: 14,
    hourly_weights: H({ 8: 0.45, 9: 0.5, 10: 0.55, 11: 0.6, 12: 0.55, 13: 0.6, 14: 0.65, 15: 0.7, 16: 0.75, 17: 0.7, 18: 0.6, 19: 0.45, 20: 0.35 }),
    peak_wait_mins: 4,
    variability: 0.19,
    service_duration_mins: 3,
    total_capacity: 2
  },
  'srv-it-helpdesk': {
    service_id: 'srv-it-helpdesk',
    base_arrivals: 11,
    hourly_weights: H({ 9: 0.5, 10: 0.65, 11: 0.7, 12: 0.6, 13: 0.75, 14: 0.8, 15: 0.7, 16: 0.6, 17: 0.4 }),
    peak_wait_mins: 20,
    variability: 0.21,
    service_duration_mins: 10,
    total_capacity: 3
  }
};

/** Small deterministic PRNG (mulberry32) so seeded history never drifts. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export interface SeedServiceRef {
  id: string;
  name: string;
  building_id: string;
  operating_hours: { open: string; close: string; days: string[] };
  avg_service_duration_mins: number;
  total_counters: number;
}

/** Friday and Thursday run busier than midweek — a real campus rhythm. */
const WEEKDAY_FACTOR = [0.35, 1.0, 0.95, 1.0, 1.12, 1.08, 0.55];

export function generateDemandHistory(
  services: SeedServiceRef[],
  now: Date,
  days = SEED_HISTORY_DAYS,
  profiles: Record<string, DemandProfile> = DEMAND_PROFILES
): DemandMeasurement[] {
  const out: DemandMeasurement[] = [];

  for (const service of services) {
    const profile = profiles[service.id];
    // Services without a recorded demand profile are simply left without
    // history: the engine will then refuse to predict rather than invent data.
    if (!profile) continue;

    const openHour = parseClock(service.operating_hours.open);
    const closeHour = parseClock(service.operating_hours.close);
    const openDays = new Set(service.operating_hours.days);

    for (let dayOffset = days - 1; dayOffset >= 0; dayOffset -= 1) {
      const day = new Date(now.getTime());
      day.setDate(day.getDate() - dayOffset);
      day.setHours(0, 0, 0, 0);
      const dayName = DAY_NAMES[day.getDay()];
      if (!openDays.has(dayName)) continue;
      const key = dateKey(day);
      const dowFactor = WEEKDAY_FACTOR[day.getDay()] ?? 1;

      for (let hour = openHour; hour <= closeHour; hour += 1) {
        const rand = mulberry32(hashString(`${service.id}|${key}|${hour}`));
        const weight = profile.hourly_weights[hour] ?? 0.25;
        const noise = 1 + (rand() - 0.5) * 2 * profile.variability;
        const serviceDuration = Math.max(1, service.avg_service_duration_mins);
        const activeCapacity = Math.max(1, service.total_counters - (weight > 0.85 ? 1 : 0));

        // The recorded wait is the driver: queue and arrivals are derived from
        // it so the history stays internally consistent with the service model.
        const avgWait = Math.max(0, Math.round(profile.peak_wait_mins * weight * dowFactor * noise));
        const queue = Math.max(0, Math.round((avgWait * activeCapacity) / serviceDuration));
        const throughput = Math.round((60 / serviceDuration) * activeCapacity * (0.7 + rand() * 0.15));
        const arrivals = Math.max(0, queue + Math.round(throughput * (0.6 + rand() * 0.3)));
        const completed = Math.max(0, arrivals - Math.max(0, Math.round(queue * 0.4)));

        out.push({
          id: `dm-${service.id}-${key}-${hour}`,
          service_id: service.id,
          service_name: service.name,
          building_id: service.building_id,
          date: key,
          hour,
          day_of_week: day.getDay(),
          day_name: dayName,
          arrivals,
          completed,
          avg_queue: queue,
          peak_queue: queue + Math.round(2 + rand() * 6),
          avg_wait: avgWait,
          peak_wait: Math.round(avgWait * (1.2 + rand() * 0.4)),
          active_capacity: activeCapacity,
          total_capacity: service.total_counters,
          service_duration_mins: serviceDuration,
          incident_count: weight > 0.85 && rand() > 0.65 ? 1 : 0,
          source: 'historical_seed',
          recorded_at: new Date(day.getTime() + hour * 3600000 + 1800000).toISOString()
        });
      }
    }
  }

  return out;
}
