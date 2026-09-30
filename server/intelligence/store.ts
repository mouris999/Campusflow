/**
 * Smart Traffic persistence.
 *
 * Kept in its own JSON file next to the main CampusFlow database so that the
 * hot path (every queue join writes `campusflow.json`) never has to re-serialise
 * the much larger demand history. Writes here are event-driven and infrequent.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type {
  DemandMeasurement,
  PeakForecast,
  RecommendationEvent,
  RecommendationOutcome
} from '../../src/types/traffic.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = process.env.CAMPUSFLOW_DATA_DIR
  ? path.resolve(process.env.CAMPUSFLOW_DATA_DIR)
  : path.resolve(__dirname, '../../data');
const DATA_FILE = path.join(DATA_DIR, 'campusflow-traffic.json');

const MAX_EVENTS = 5000;
const MAX_OUTCOMES = 2000;
const MAX_SNAPSHOTS = 3000;
const MAX_RUNS = 200;

export interface PredictionRun {
  id: string;
  started_at: string;
  finished_at: string;
  model_version: string;
  services_evaluated: number;
  predictions_generated: number;
  services_without_data: number;
  trigger: 'boot' | 'scheduled' | 'manual' | 'on_demand';
  duration_ms: number;
  details: { service_id: string; sufficient_data: boolean; sample_count: number; distinct_days: number; confidence_pct: number }[];
}

export interface AvailabilitySnapshot {
  id: string;
  service_id: string;
  item_id: string;
  item_name: string;
  available: boolean;
  quantity_available: number;
  source_system: string;
  recorded_at: string;
  recorded_by: string;
  reason: 'seed' | 'staff_update' | 'system_sync';
}

export interface AlertDismissal {
  key: string;
  user_id: string;
  service_id: string;
  alert_kind: string;
  dismissed_at: string;
  expires_at: string;
}

export interface UserPreference {
  user_id: string;
  updated_at: string;
  /** Metres. Shorter values mean the student prefers closer locations. */
  max_distance_meters: number;
  /** Preferred arrival hour when the student has told us. */
  preferred_hour: number | null;
  /** Hours the student has historically avoided (recorded, not inferred). */
  avoid_peak: boolean;
  source: 'student_choice' | 'recorded_activity';
}

export interface TrafficStoreSchema {
  demand_measurements: DemandMeasurement[];
  peak_predictions: PeakForecast[];
  prediction_runs: PredictionRun[];
  availability_snapshots: AvailabilitySnapshot[];
  recommendation_events: RecommendationEvent[];
  recommendation_outcomes: RecommendationOutcome[];
  alert_dismissals: AlertDismissal[];
  user_preferences: UserPreference[];
}

function emptySchema(): TrafficStoreSchema {
  return {
    demand_measurements: [],
    peak_predictions: [],
    prediction_runs: [],
    availability_snapshots: [],
    recommendation_events: [],
    recommendation_outcomes: [],
    alert_dismissals: [],
    user_preferences: []
  };
}

class TrafficStore {
  private data: TrafficStoreSchema;
  private loaded = false;
  private indexes = { byService: new Map<string, DemandMeasurement[]>() };

  constructor() {
    this.data = emptySchema();
  }

  private ensureDir() {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
  }

  load(): TrafficStoreSchema {
    if (this.loaded) return this.data;
    this.ensureDir();
    try {
      if (fs.existsSync(DATA_FILE)) {
        const raw = fs.readFileSync(DATA_FILE, 'utf-8');
        const parsed = JSON.parse(raw) as Partial<TrafficStoreSchema>;
        this.data = { ...emptySchema(), ...parsed };
      }
    } catch (error) {
      console.warn('[traffic] failed to read traffic store, starting empty:', error);
      this.data = emptySchema();
    }
    this.loaded = true;
    this.reindex();
    return this.data;
  }

  private reindex() {
    this.indexes.byService = new Map();
    for (const measurement of this.data.demand_measurements) {
      const list = this.indexes.byService.get(measurement.service_id);
      if (list) list.push(measurement);
      else this.indexes.byService.set(measurement.service_id, [measurement]);
    }
  }

  save() {
    this.ensureDir();
    try {
      fs.writeFileSync(DATA_FILE, JSON.stringify(this.data), 'utf-8');
    } catch (error) {
      console.error('[traffic] failed to write traffic store:', error);
    }
  }

  get raw(): TrafficStoreSchema {
    return this.load();
  }

  // --- demand history ---------------------------------------------------

  getMeasurements(serviceId?: string, sinceDate?: string): DemandMeasurement[] {
    const all = this.load().demand_measurements;
    if (!serviceId) return all;
    const indexed = this.indexes.byService.get(serviceId) ?? [];
    const base = indexed.length ? indexed : all.filter(m => m.service_id === serviceId);
    return sinceDate ? base.filter(m => m.date >= sinceDate) : base;
  }

  /** Fingerprint used to invalidate a cached prediction when data changes. */
  measurementFingerprint(serviceId: string): string {
    const list = this.getMeasurements(serviceId);
    let latest = '';
    for (const m of list) {
      if (m.recorded_at > latest) latest = m.recorded_at;
    }
    return `${list.length}:${latest}`;
  }

  seedMeasurements(measurements: DemandMeasurement[]): number {
    const store = this.load();
    const existing = new Set(store.demand_measurements.map(m => m.id));
    let added = 0;
    for (const measurement of measurements) {
      if (existing.has(measurement.id)) continue;
      store.demand_measurements.push(measurement);
      existing.add(measurement.id);
      added += 1;
    }
    if (added > 0) {
      this.reindex();
      this.save();
    }
    return added;
  }

  recordMeasurement(measurement: DemandMeasurement) {
    const store = this.load();
    const index = store.demand_measurements.findIndex(m => m.id === measurement.id);
    if (index >= 0) store.demand_measurements[index] = measurement;
    else store.demand_measurements.push(measurement);
    this.reindex();
    this.save();
  }

  get distinctServiceCount(): number {
    return new Set(this.load().demand_measurements.map(m => m.service_id)).size;
  }

  // --- predictions ------------------------------------------------------

  getPrediction(serviceId: string): PeakForecast | null {
    return this.load().peak_predictions.find(p => p.service_id === serviceId) ?? null;
  }

  getPredictions(): PeakForecast[] {
    return this.load().peak_predictions;
  }

  putPrediction(forecast: PeakForecast) {
    const store = this.load();
    const index = store.peak_predictions.findIndex(p => p.service_id === forecast.service_id);
    if (index >= 0) store.peak_predictions[index] = forecast;
    else store.peak_predictions.push(forecast);
    this.save();
  }

  putPredictions(forecasts: PeakForecast[]) {
    const store = this.load();
    for (const forecast of forecasts) {
      const index = store.peak_predictions.findIndex(p => p.service_id === forecast.service_id);
      if (index >= 0) store.peak_predictions[index] = forecast;
      else store.peak_predictions.push(forecast);
    }
    this.save();
  }

  recordRun(run: PredictionRun) {
    const store = this.load();
    store.prediction_runs.unshift(run);
    if (store.prediction_runs.length > MAX_RUNS) store.prediction_runs.length = MAX_RUNS;
    this.save();
  }

  getRuns(limit = 20): PredictionRun[] {
    return this.load().prediction_runs.slice(0, limit);
  }

  // --- availability snapshots -------------------------------------------

  recordSnapshot(snapshot: AvailabilitySnapshot) {
    const store = this.load();
    store.availability_snapshots.unshift(snapshot);
    if (store.availability_snapshots.length > MAX_SNAPSHOTS) {
      store.availability_snapshots.length = MAX_SNAPSHOTS;
    }
    this.save();
  }

  getSnapshots(serviceId: string, limit = 20): AvailabilitySnapshot[] {
    return this.load().availability_snapshots.filter(s => s.service_id === serviceId).slice(0, limit);
  }

  // --- recommendation events -------------------------------------------

  recordEvent(event: RecommendationEvent) {
    const store = this.load();
    store.recommendation_events.unshift(event);
    if (store.recommendation_events.length > MAX_EVENTS) {
      store.recommendation_events.length = MAX_EVENTS;
    }
    this.save();
  }

  getEvents(filter?: { userId?: string; recommendationKey?: string; since?: string }): RecommendationEvent[] {
    let events = this.load().recommendation_events;
    if (filter?.userId) events = events.filter(e => e.user_id === filter.userId);
    if (filter?.recommendationKey) events = events.filter(e => e.recommendation_key === filter.recommendationKey);
    if (filter?.since) {
      const since = filter.since;
      events = events.filter(e => e.created_at >= since);
    }
    return events;
  }

  hasRecentEvent(recommendationKey: string, userId: string, type: RecommendationEvent['event_type'], withinMs: number): boolean {
    const cutoff = new Date(Date.now() - withinMs).toISOString();
    return this.getEvents({ recommendationKey, userId }).some(
      e => e.event_type === type && e.created_at >= cutoff
    );
  }

  // --- outcomes ---------------------------------------------------------

  recordOutcome(outcome: RecommendationOutcome) {
    const store = this.load();
    const index = store.recommendation_outcomes.findIndex(o => o.recommendation_key === outcome.recommendation_key);
    if (index >= 0) store.recommendation_outcomes[index] = { ...store.recommendation_outcomes[index], ...outcome };
    else store.recommendation_outcomes.unshift(outcome);
    if (store.recommendation_outcomes.length > MAX_OUTCOMES) {
      store.recommendation_outcomes.length = MAX_OUTCOMES;
    }
    this.save();
  }

  getOutcome(recommendationKey: string): RecommendationOutcome | null {
    return this.load().recommendation_outcomes.find(o => o.recommendation_key === recommendationKey) ?? null;
  }

  getOutcomes(filter?: { userId?: string }): RecommendationOutcome[] {
    const all = this.load().recommendation_outcomes;
    return filter?.userId ? all.filter(o => o.user_id === filter.userId) : all;
  }

  // --- alert dismissals -------------------------------------------------

  dismissAlert(dismissal: AlertDismissal) {
    const store = this.load();
    const index = store.alert_dismissals.findIndex(d => d.key === dismissal.key);
    if (index >= 0) store.alert_dismissals[index] = dismissal;
    else store.alert_dismissals.push(dismissal);
    this.save();
  }

  isAlertDismissed(key: string, now = new Date()): boolean {
    return this.load().alert_dismissals.some(d => d.key === key && new Date(d.expires_at).getTime() > now.getTime());
  }

  // --- preferences ------------------------------------------------------

  getPreference(userId: string): UserPreference | null {
    return this.load().user_preferences.find(p => p.user_id === userId) ?? null;
  }

  setPreference(preference: UserPreference) {
    const store = this.load();
    const index = store.user_preferences.findIndex(p => p.user_id === preference.user_id);
    if (index >= 0) store.user_preferences[index] = preference;
    else store.user_preferences.push(preference);
    this.save();
  }

  reset(): TrafficStoreSchema {
    this.data = emptySchema();
    this.loaded = true;
    this.reindex();
    this.save();
    return this.data;
  }
}

export const trafficStore = new TrafficStore();
