import assert from 'node:assert/strict';
import test from 'node:test';
import { computePeakForecast, MIN_DISTINCT_DAYS, PEAK_MODEL_VERSION, type ForecastService } from '../server/intelligence/prediction.js';
import { generateDemandHistory, type DemandProfile, type SeedServiceRef } from '../server/intelligence/demandSeed.js';
import type { DemandMeasurement } from '../src/types/traffic.js';

const NOW = new Date('2026-09-30T10:00:00'); // a Wednesday

const TEST_PROFILE: DemandProfile = {
  service_id: 'srv-test',
  base_arrivals: 30,
  hourly_weights: { 8: 0.3, 9: 0.35, 10: 0.4, 11: 0.5, 12: 1.0, 13: 0.95, 14: 0.5, 15: 0.4, 16: 0.35, 17: 0.3, 18: 0.25 },
  peak_wait_mins: 40,
  variability: 0.05,
  service_duration_mins: 5,
  total_capacity: 3
};

const SERVICE: ForecastService = {
  id: 'srv-test',
  name: 'Test Counter',
  status: 'open',
  operating_hours: { open: '08:00', close: '18:00', days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'] },
  current_queue_length: 5,
  estimated_wait_mins: 10,
  current_demand_level: 'moderate',
  avg_service_duration_mins: 5,
  total_counters: 3,
  active_counters: 3,
  max_queue_capacity: 50
};

const SEED_REF: SeedServiceRef = {
  id: 'srv-test',
  name: 'Test Counter',
  building_id: 'bld-1',
  operating_hours: SERVICE.operating_hours,
  avg_service_duration_mins: 5,
  total_counters: 3
};

function seededHistory(): DemandMeasurement[] {
  return generateDemandHistory([SEED_REF], NOW, 21, { 'srv-test': TEST_PROFILE });
}

test('generates a peak prediction from sufficient recorded history', () => {
  const forecast = computePeakForecast({ service: SERVICE, measurements: seededHistory(), now: NOW });

  assert.equal(forecast.sufficient_data, true);
  assert.equal(forecast.model_version, PEAK_MODEL_VERSION);
  assert.ok(forecast.distinct_days >= MIN_DISTINCT_DAYS);
  assert.ok(forecast.predicted_peak, 'expected a predicted peak window');
  assert.equal(forecast.predicted_peak?.start_hour, 12);
  assert.ok((forecast.predicted_peak?.expected_wait_max ?? 0) > (forecast.predicted_peak?.expected_wait_min ?? 0));
  assert.ok(forecast.confidence_pct > 0 && forecast.confidence_pct <= 93);
});

test('refuses to predict when there is not enough history', () => {
  const forecast = computePeakForecast({ service: SERVICE, measurements: [], now: NOW });

  assert.equal(forecast.sufficient_data, false);
  assert.equal(forecast.predicted_peak, null);
  assert.equal(forecast.better_window, null);
  assert.equal(forecast.insufficient_reason, 'no_recorded_demand');
  assert.equal(forecast.confidence_pct, 0);
});

test('refuses to predict when only a couple of days were recorded', () => {
  const sparse = seededHistory().filter(m => m.date >= '2026-09-29');
  const forecast = computePeakForecast({ service: SERVICE, measurements: sparse, now: NOW });

  assert.equal(forecast.sufficient_data, false);
  assert.equal(forecast.insufficient_reason, 'insufficient_recorded_days');
  assert.equal(forecast.predicted_peak, null);
});

test('the peak window moves when the demand data moves', () => {
  const history = seededHistory();
  const before = computePeakForecast({ service: SERVICE, measurements: history, now: NOW });
  assert.equal(before.predicted_peak?.start_hour, 12);

  const shifted = history.map(m => {
    if (m.hour === 12 || m.hour === 13) {
      return { ...m, arrivals: 15, avg_wait: 6 };
    }
    if (m.hour === 16) {
      return { ...m, arrivals: 95, avg_wait: 42 };
    }
    return m;
  });

  const after = computePeakForecast({ service: SERVICE, measurements: shifted, now: NOW });
  assert.equal(after.predicted_peak?.start_hour, 16);
});
test('suggests a lower-demand window outside the peak', () => {
  const forecast = computePeakForecast({ service: SERVICE, measurements: seededHistory(), now: NOW });

  assert.ok(forecast.better_window, 'expected a suggested window');
  const better = forecast.better_window!;
  assert.ok(better.start_hour >= NOW.getHours(), 'suggested window should not be in the past today');
  assert.ok(better.intensity < (forecast.predicted_peak?.intensity ?? 100));
});

test('flags rising traffic when the recorded profile is climbing right now', () => {
  const history = seededHistory().map(m => {
    // 11:00 is a clear step up (moderate band) but the peak band starts at 12:00.
    if (m.hour === 11) return { ...m, arrivals: 45, avg_wait: 15 };
    if (m.hour === 12 || m.hour === 13) return { ...m, arrivals: 90, avg_wait: 40 };
    if (m.hour === 10) return { ...m, arrivals: 25, avg_wait: 8 };
    return m;
  });

  const forecast = computePeakForecast({ service: SERVICE, measurements: history, now: new Date('2026-09-30T11:00:00') });
  assert.equal(forecast.sufficient_data, true);
  assert.equal(forecast.rising, true);
  assert.equal(forecast.predicted_peak?.start_hour, 12);
  assert.equal(forecast.peak_in_minutes, 60);
});

test('reports a peak that is already under way as starting now', () => {
  const history = seededHistory().map(m =>
    m.hour === 12 || m.hour === 13 ? { ...m, arrivals: 90, avg_wait: 40 } : m
  );

  const forecast = computePeakForecast({ service: SERVICE, measurements: history, now: new Date('2026-09-30T12:30:00') });
  assert.equal(forecast.predicted_peak?.start_hour, 12);
  assert.equal(forecast.peak_in_minutes, 0);
});

test('does not flag rising traffic when the profile is flat', () => {
  const forecast = computePeakForecast({
    service: { ...SERVICE, operating_hours: { open: '09:00', close: '15:00', days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'] } },
    measurements: seededHistory().map(m => ({ ...m, arrivals: 10, avg_wait: 4 })),
    now: new Date('2026-09-30T11:00:00')
  });

  assert.equal(forecast.sufficient_data, true);
  assert.equal(forecast.rising, false);
  assert.equal(forecast.predicted_peak, null);
});

test('marks closed services as not open and never recommends them', () => {
  const forecast = computePeakForecast({
    service: { ...SERVICE, status: 'closed' },
    measurements: seededHistory(),
    now: NOW
  });

  assert.equal(forecast.is_open_now, false);
});

test('only uses measurements inside the bounded history window', () => {
  const old = generateDemandHistory([SEED_REF], new Date('2026-01-05T10:00:00'), 21, { 'srv-test': TEST_PROFILE }).map(m => ({
    ...m,
    arrivals: 999,
    avg_wait: 999
  }));
  const forecast = computePeakForecast({ service: SERVICE, measurements: old, now: NOW, windowDays: 28 });

  assert.equal(forecast.sufficient_data, false);
});

test('the timeline is restricted to operating hours and flags the current hour', () => {
  const forecast = computePeakForecast({ service: SERVICE, measurements: seededHistory(), now: NOW });

  assert.ok(forecast.hours.length > 0);
  assert.equal(forecast.hours[0].hour, 8);
  assert.ok(forecast.hours.every(h => h.hour >= 8 && h.hour <= 18));
  assert.equal(forecast.hours.filter(h => h.is_current).length, 1);
  assert.equal(forecast.hours.find(h => h.is_current)?.hour, 10);
});
