/**
 * Smart Traffic Intelligence orchestrator.
 *
 * Owns the read path (facts -> forecast -> alternatives -> explanation) and the
 * write path (events, feedback, alert dismissals, preference records).
 *
 * Predictions are cached per service and only recomputed when the underlying
 * demand history changed or the cache aged out, so page renders stay cheap.
 */

import { db } from '../db.js';
import type { Service } from '../../src/types/index.js';
import type {
  AlternativesResult,
  AvailabilityFact,
  PersonalizedInsight,
  PlanYourVisit,
  ServiceItem,
  PeakForecast,
  PeakIntelligenceAnalytics,
  RecommendationEvent,
  RecommendationEventType,
  RecommendationOutcome,
  SmartAlternative,
  TrafficAlert,
  TrafficState
} from '../../src/types/traffic.js';
import { campusDistanceMeters, walkingMinutes } from '../../src/lib/geo.js';
import { DAY_NAMES, DAY_SHORT, dateKey, formatHourLabel, formatHourWindow, parseClock } from '../../src/lib/time.js';
import { demandBand, effectiveTrafficState } from '../../src/lib/trafficState.js';
import { buildServiceItems, catalogItemKey, SERVICE_CATALOG } from './catalog.js';
import { DEMAND_PROFILES, generateDemandHistory, HISTORY_WINDOW_DAYS, SEED_HISTORY_DAYS } from './demandSeed.js';
import { computePeakForecast, PEAK_MODEL_VERSION, predictedIntensityAtHour, predictedWaitAtHour } from './prediction.js';
import { rankAlternatives, type AlternativeServiceFacts, type CandidateFacts } from './alternatives.js';
import { resolveIntent } from './intent.js';
import { composeRuleExplanation, explainRecommendation, type Explanation } from './explain.js';
import { trafficStore, type AvailabilitySnapshot, type PredictionRun, type UserPreference } from './store.js';

export const FORECAST_TTL_MS = 30 * 60 * 1000;
const PREDICTION_SWEEP_INTERVAL_MS = 5 * 60 * 1000;
const SHOWN_EVENT_DEDUPE_MS = 5 * 60 * 1000;
const ALERT_COOLDOWN_MS = 6 * 60 * 60 * 1000;
const ALERT_DISMISS_TTL_MS = 12 * 60 * 60 * 1000;
const MAX_RECOMMENDED_ALERTS = 3;

let sweepTimer: NodeJS.Timeout | null = null;

function asServiceFacts(service: Service): AlternativeServiceFacts {
  return {
    id: service.id,
    name: service.name,
    code: service.code,
    category: service.category,
    status: service.status,
    building_id: service.building_id,
    building_name: service.building_name,
    floor: service.floor,
    room_counter: service.room_counter,
    current_queue_length: service.current_queue_length,
    estimated_wait_mins: service.estimated_wait_mins,
    current_demand_level: service.current_demand_level,
    active_counters: service.active_counters,
    total_counters: service.total_counters,
    max_queue_capacity: service.max_queue_capacity,
    operating_hours: service.operating_hours,
    alternate_service_ids: service.alternate_service_ids
  };
}

export function isServiceOpenNow(service: Service, now: Date): boolean {
  if (service.status === 'closed') return false;
  if (!service.operating_hours.days.includes(DAY_NAMES[now.getDay()])) return false;
  const open = parseClock(service.operating_hours.open);
  const close = parseClock(service.operating_hours.close);
  return now.getHours() >= open && now.getHours() <= close;
}

function id(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

class TrafficIntelligence {
  private started = false;
  /** Anti-spam memory: last time an alert was surfaced to a user. */
  private alertEmittedAt = new Map<string, number>();

  // ------------------------------------------------------------------ setup

  /** Idempotent bootstrap: catalogue records + demand history + predictions. */
  bootstrap(): { catalogue_added: number; demand_added: number } {
    if (this.started) return { catalogue_added: 0, demand_added: 0 };
    const now = new Date();

    const catalogueAdded = this.ensureCatalogue(now);
    const demandAdded = this.ensureDemandHistory(now);

    this.started = true;
    this.rebuildAll('boot');
    this.startScheduler();
    return { catalogue_added: catalogueAdded, demand_added: demandAdded };
  }

  /** Creates `service_items` records for any service present in the catalogue. */
  ensureCatalogue(now: Date): number {
    const services = db.getServices();
    const existing = new Set(db.getServiceItems().map(item => item.id));
    let added = 0;
    for (const service of services) {
      if (!SERVICE_CATALOG[service.id]) continue;
      for (const item of buildServiceItems(service.id, service.name, now)) {
        if (existing.has(item.id)) continue;
        db.addServiceItem(item);
        this.recordSnapshot(item, 'seed', 'catalogue-seed');
        added += 1;
      }
    }
    return added;
  }

  /** Seeds the historical demand record used by the peak engine. */
  ensureDemandHistory(now: Date): number {
    const services = db
      .getServices()
      .filter(service => !!DEMAND_PROFILES[service.id])
      .map(service => ({
        id: service.id,
        name: service.name,
        building_id: service.building_id,
        operating_hours: service.operating_hours,
        avg_service_duration_mins: service.avg_service_duration_mins,
        total_counters: service.total_counters
      }));

    const generated = generateDemandHistory(services, now, SEED_HISTORY_DAYS);
    return trafficStore.seedMeasurements(generated);
  }

  private startScheduler() {
    if (sweepTimer) return;
    sweepTimer = setInterval(() => {
      try {
        this.rebuildAll('scheduled');
      } catch (error) {
        console.error('[traffic] scheduled prediction sweep failed:', error);
      }
    }, PREDICTION_SWEEP_INTERVAL_MS);
    if (typeof sweepTimer.unref === 'function') sweepTimer.unref();
  }

  stopScheduler() {
    if (sweepTimer) {
      clearInterval(sweepTimer);
      sweepTimer = null;
    }
  }

  // ------------------------------------------------------- live demand feed

  /**
   * Records the current hour of a service as a live sample so the history keeps
   * growing from real operations, not just seed data.
   */
  sampleLiveDemand(serviceId: string, now = new Date()): void {
    const service = db.getServiceById(serviceId);
    if (!service) return;
    if (!service.operating_hours.days.includes(DAY_NAMES[now.getDay()])) return;

    const hour = now.getHours();
    const key = dateKey(now);
    const measurementId = `dm-${service.id}-${key}-${hour}`;
    const previous = trafficStore.getMeasurements(service.id).find(m => m.id === measurementId);
    if (previous && previous.source === 'historical_seed') return;

    const avgDuration = Math.max(1, service.avg_service_duration_mins);
    const arrivals = Math.max(1, service.current_queue_length + service.active_counters);
    trafficStore.recordMeasurement({
      id: measurementId,
      service_id: service.id,
      service_name: service.name,
      building_id: service.building_id,
      date: key,
      hour,
      day_of_week: now.getDay(),
      day_name: DAY_NAMES[now.getDay()],
      arrivals,
      completed: previous ? previous.completed : Math.max(0, arrivals - 1),
      avg_queue: service.current_queue_length,
      peak_queue: Math.max(previous?.peak_queue ?? 0, service.current_queue_length),
      avg_wait: service.estimated_wait_mins,
      peak_wait: Math.max(previous?.peak_wait ?? 0, service.estimated_wait_mins),
      active_capacity: Math.max(1, service.active_counters),
      total_capacity: service.total_counters,
      service_duration_mins: avgDuration,
      incident_count: service.active_incident_cause ? 1 : 0,
      source: 'live_sample',
      recorded_at: now.toISOString()
    });
  }

  // -------------------------------------------------------------- catalogue

  getItems(serviceId?: string): ServiceItem[] {
    return db.getServiceItems(serviceId);
  }

  getItem(itemId: string): ServiceItem | null {
    return db.getServiceItems().find(item => item.id === itemId) ?? null;
  }

  setItemAvailability(params: {
    item_id: string;
    available: boolean;
    quantity_available: number;
    actor: string;
    note?: string;
  }): ServiceItem | null {
    const item = db.getServiceItems().find(candidate => candidate.id === params.item_id);
    if (!item) return null;

    item.available = params.available;
    item.quantity_available = Math.max(0, Math.round(params.quantity_available));
    item.updated_at = new Date().toISOString();
    item.updated_by = params.actor;
    if (params.note !== undefined) item.unavailability_note = params.note;
    else if (params.available) delete item.unavailability_note;

    db.persistServiceItem(item);
    this.recordSnapshot(item, 'staff_update', params.actor);
    return item;
  }

  private recordSnapshot(item: ServiceItem, reason: AvailabilitySnapshot['reason'], by: string) {
    trafficStore.recordSnapshot({
      id: id('snap'),
      service_id: item.service_id,
      item_id: item.id,
      item_name: item.name,
      available: item.available,
      quantity_available: item.quantity_available,
      source_system: item.source_system,
      recorded_at: item.updated_at,
      recorded_by: by,
      reason
    });
  }

  // -------------------------------------------------------------- forecasts

  /** Cached forecast. Recomputes only when stale or when data changed. */
  getForecast(serviceId: string, options: { force?: boolean; now?: Date } = {}): PeakForecast | null {
    const service = db.getServiceById(serviceId);
    if (!service) return null;
    const now = options.now ?? new Date();

    const cached = trafficStore.getPrediction(serviceId);
    const fingerprint = trafficStore.measurementFingerprint(serviceId);
    const age = cached ? now.getTime() - new Date(cached.generated_at).getTime() : Infinity;
    const fresh = !!cached && age < FORECAST_TTL_MS && this.fingerprintOf(cached) === fingerprint;

    if (fresh && !options.force) return cached;

    const forecast = this.computeForecastFor(service, now);
    trafficStore.putPrediction(forecast);
    return forecast;
  }

  private fingerprintOf(forecast: PeakForecast): string {
    return `${forecast.sample_count}:${forecast.window_days}:${forecast.model_version}`;
  }

  computeForecastFor(service: Service, now: Date): PeakForecast {
    const cutoff = dateKey(new Date(now.getTime() - HISTORY_WINDOW_DAYS * 86400000));
    const measurements = trafficStore.getMeasurements(service.id, cutoff);
    return computePeakForecast({ service, measurements, now, windowDays: HISTORY_WINDOW_DAYS });
  }

  rebuildAll(trigger: PredictionRun['trigger'] = 'manual'): PredictionRun {
    const started = Date.now();
    const now = new Date();
    const forecasts: PeakForecast[] = [];
    const details: PredictionRun['details'] = [];
    let withoutData = 0;

    for (const service of db.getServices()) {
      const forecast = this.computeForecastFor(service, now);
      forecasts.push(forecast);
      if (!forecast.sufficient_data) withoutData += 1;
      details.push({
        service_id: service.id,
        sufficient_data: forecast.sufficient_data,
        sample_count: forecast.sample_count,
        distinct_days: forecast.distinct_days,
        confidence_pct: forecast.confidence_pct
      });
    }

    trafficStore.putPredictions(forecasts);
    const run: PredictionRun = {
      id: id('run'),
      started_at: new Date(started).toISOString(),
      finished_at: new Date().toISOString(),
      model_version: PEAK_MODEL_VERSION,
      services_evaluated: forecasts.length,
      predictions_generated: forecasts.filter(f => f.sufficient_data).length,
      services_without_data: withoutData,
      trigger,
      duration_ms: Date.now() - started,
      details
    };
    trafficStore.recordRun(run);
    return run;
  }

  // ------------------------------------------------------------ alternatives

  private candidateFacts(origin: Service, now: Date, requestedItem: ServiceItem | null): CandidateFacts[] {
    const buildings = db.getBuildings();
    const originBuilding = buildings.find(b => b.id === origin.building_id);
    const itemKey = requestedItem ? catalogItemKey(requestedItem) : null;

    return db
      .getServices()
      .filter(service => service.id !== origin.id)
      .map(service => {
        const building = buildings.find(b => b.id === service.building_id);
        const distance = originBuilding && building ? campusDistanceMeters(originBuilding.map_coords, building.map_coords) : 0;
        const forecast = this.getForecast(service.id, { now });
        const candidateItem =
          itemKey !== null
            ? db.getServiceItems(service.id).find(item => catalogItemKey(item) === itemKey) ?? null
            : null;
        return {
          service: asServiceFacts(service),
          distance_meters: distance,
          walk_mins: walkingMinutes(distance),
          item: candidateItem
            ? {
                id: candidateItem.id,
                name: candidateItem.name,
                available: candidateItem.available,
                quantity_available: candidateItem.quantity_available,
                unit_label: candidateItem.unit_label,
                source_system: candidateItem.source_system,
                updated_at: candidateItem.updated_at,
                ...(candidateItem.unavailability_note ? { unavailability_note: candidateItem.unavailability_note } : {})
              }
            : null,
          predicted_wait_mins: predictedWaitAtHour(forecast, now.getHours()),
          predicted_intensity: predictedIntensityAtHour(forecast, now.getHours()),
          is_open_now: isServiceOpenNow(service, now)
        } satisfies CandidateFacts;
      });
  }

  async getAlternatives(params: {
    serviceId: string;
    itemId?: string | null;
    userId?: string | null;
    limit?: number;
    now?: Date;
    explain?: boolean;
  }): Promise<AlternativesResult | null> {
    const origin = db.getServiceById(params.serviceId);
    if (!origin) return null;
    const now = params.now ?? new Date();

    const requestedItem = params.itemId ? this.getItem(params.itemId) : null;
    const candidates = this.candidateFacts(origin, now, requestedItem);

    const ranked = rankAlternatives({
      origin: asServiceFacts(origin),
      candidates,
      requestedItem: requestedItem
        ? { id: requestedItem.id, name: requestedItem.name, available_at_origin: requestedItem.available }
        : null,
      now,
      limit: params.limit ?? 3
    });

    const forecast = this.getForecast(origin.id, { now });
    const base = {
      origin: {
        service_id: origin.id,
        service_name: origin.name,
        current_wait_mins: origin.estimated_wait_mins,
        current_queue_length: origin.current_queue_length,
        traffic_state: effectiveTrafficState(origin),
        building_name: origin.building_name
      },
      requested_item: requestedItem
        ? { id: requestedItem.id, name: requestedItem.name, available_at_origin: requestedItem.available }
        : null,
      recommended: ranked.recommended,
      not_usable: ranked.not_usable,
      method: 'verified-rule-engine',
      generated_at: now.toISOString()
    };

    if (params.userId && ranked.recommended.length > 0) {
      this.recordRecommendationEvent({
        userId: params.userId,
        origin,
        alternative: ranked.recommended[0],
        requestedItem,
        eventType: 'shown'
      });
    }

    let explanation: Explanation | null = null;
    if (params.explain !== false) {
      explanation = await explainRecommendation({
        origin: {
          service_name: origin.name,
          wait_mins: origin.estimated_wait_mins,
          queue_length: origin.current_queue_length,
          building_name: origin.building_name
        },
        alternatives: ranked.recommended,
        forecast,
        requestedItem: requestedItem?.name ?? null,
        allServiceNames: db.getServices().map(s => s.name)
      });
    }

    const result: AlternativesResult = { ...base, explanation: explanation ?? composeRuleExplanation({
      origin: {
        service_name: origin.name,
        wait_mins: origin.estimated_wait_mins,
        queue_length: origin.current_queue_length,
        building_name: origin.building_name
      },
      alternatives: ranked.recommended,
      forecast,
      requestedItem: requestedItem?.name ?? null,
      allServiceNames: []
    }) };
    return result;
  }

  // -------------------------------------------------------------- plan view

  async getPlan(params: {
    serviceId: string;
    userId?: string | null;
    itemId?: string | null;
    now?: Date;
  }): Promise<PlanYourVisit | null> {
    const service = db.getServiceById(params.serviceId);
    if (!service) return null;
    const now = params.now ?? new Date();

    const forecast = this.getForecast(service.id, { now })!;
    const alternatives = await this.getAlternatives({
      serviceId: service.id,
      itemId: params.itemId ?? null,
      userId: params.userId ?? null,
      now,
      explain: false
    });

    const personalized = params.userId
      ? this.buildPersonalizedInsight(params.userId, service, forecast, now)
      : null;

    return {
      service_id: service.id,
      service_name: service.name,
      now: {
        wait_mins: service.estimated_wait_mins,
        queue_length: service.current_queue_length,
        traffic_state: effectiveTrafficState(service),
        status: service.status,
        is_open_now: isServiceOpenNow(service, now),
        opens_at: service.operating_hours.open,
        closes_at: service.operating_hours.close
      },
      next_peak: forecast.predicted_peak,
      suggested_window: forecast.better_window,
      alternative: alternatives?.recommended[0] ?? null,
      forecast,
      personalized
    };
  }

  // ---------------------------------------------------------- personalization

  /**
   * Personalisation is derived strictly from the student's own recorded
   * queue/appointment history. Below the sample floor we return no insight at
   * all rather than guessing.
   */
  buildPersonalizedInsight(
    userId: string,
    service: Service,
    forecast: PeakForecast,
    now: Date
  ): PersonalizedInsight {
    const visits: { service_id: string; at: Date }[] = [
      ...db.getUserQueueEntries(userId).map(entry => ({ service_id: entry.service_id, at: new Date(entry.queue_join_time) })),
      ...db.getAppointments(userId).map(appointment => ({
        service_id: appointment.service_id,
        at: new Date(`${appointment.date}T${appointment.slot_time}:00`)
      }))
    ].filter(visit => !Number.isNaN(visit.at.getTime()));

    const MIN_VISITS = 3;
    if (visits.length < MIN_VISITS) {
      return {
        available: false,
        visit_count: visits.length,
        services_visited: [],
        usual_window: null,
        message: null,
        advice: null
      };
    }

    const buckets = new Map<string, { start_hour: number; end_hour: number; count: number }>();
    const perService = new Map<string, { service_id: string; service_name: string; count: number }>();

    for (const visit of visits) {
      const bucket = Math.floor(visit.at.getHours() / 2) * 2;
      const bucketKey = `${bucket}`;
      const existing = buckets.get(bucketKey);
      if (existing) existing.count += 1;
      else buckets.set(bucketKey, { start_hour: bucket, end_hour: bucket + 1, count: 1 });

      const svc = db.getServiceById(visit.service_id);
      const stat = perService.get(visit.service_id);
      if (stat) stat.count += 1;
      else perService.set(visit.service_id, { service_id: visit.service_id, service_name: svc?.name ?? visit.service_id, count: 1 });
    }

    const servicesVisited = Array.from(perService.values()).sort((a, b) => b.count - a.count);
    const usual = Array.from(buckets.values()).sort((a, b) => b.count - a.count)[0];
    const usualWindow = usual
      ? { label: formatHourWindow(usual.start_hour, usual.end_hour), start_hour: usual.start_hour, end_hour: usual.end_hour, count: usual.count }
      : null;

    const sameServiceVisits = perService.get(service.id)?.count ?? 0;
    const message = `Based on ${visits.length} recorded CampusFlow ${visits.length === 1 ? 'visit' : 'visits'}, you visit ${servicesVisited[0].service_name} most often and your usual window is ${usualWindow?.label ?? 'not yet clear'}.`;

    let advice: string | null = null;
    const usualStart = usualWindow?.start_hour ?? null;
    const usualBand = usualStart !== null ? forecast.hours.find(h => h.hour === usualStart) : null;
    if (sameServiceVisits >= MIN_VISITS && usualStart !== null && usualBand && (usualBand.band === 'high' || usualBand.band === 'peak')) {
      const better = forecast.better_window;
      advice = better
        ? `Recorded demand for this service usually peaks around ${formatHourLabel(usualStart)}. A lower-demand window is ${better.day_label} ${better.label} (${better.expected_wait_min}–${better.expected_wait_max} min expected wait).`
        : null;
    } else if (sameServiceVisits >= MIN_VISITS) {
      advice = `Your usual window (${usualWindow?.label ?? 'varies'}) is historically low demand for this service, so it is a reasonable time to visit.`;
    }

    return {
      available: true,
      visit_count: visits.length,
      services_visited: servicesVisited,
      usual_window: usualWindow,
      message,
      advice
    };
  }

  // ------------------------------------------------------------------ intent

  resolveIntent(query: string, now = new Date()) {
    return resolveIntent({
      query,
      services: db.getServices(),
      items: db.getServiceItems(),
      now
    });
  }

  // ------------------------------------------------------------------ events

  recommendationKey(originId: string, alternativeId: string, userId: string): string {
    return `${userId}|${originId}|${alternativeId}`;
  }

  recordRecommendationEvent(params: {
    userId: string;
    origin: Service;
    alternative: SmartAlternative;
    requestedItem: ServiceItem | null;
    eventType: RecommendationEventType;
  }): RecommendationEvent {
    const now = new Date();
    const key = this.recommendationKey(params.origin.id, params.alternative.service_id, params.userId);
    const event: RecommendationEvent = {
      id: id('rec'),
      recommendation_key: key,
      user_id: params.userId,
      requested_service: params.origin.name,
      requested_item: params.requestedItem?.name ?? null,
      origin_service: params.origin.name,
      recommended_service: params.alternative.service_name,
      distance_meters: params.alternative.distance_meters,
      walk_mins: params.alternative.walk_mins,
      wait_before: params.origin.estimated_wait_mins,
      wait_after: params.alternative.current_wait_mins,
      availability_verified: params.alternative.availability.verified && params.alternative.availability.available === true,
      reason: params.alternative.reasons.map(r => r.text).join(' · '),
      event_type: params.eventType,
      created_at: now.toISOString()
    };
    trafficStore.recordEvent(event);
    return event;
  }

  /**
   * Records a funnel event. The `shown` step is de-duplicated so refreshing a
   * page does not inflate the analytics.
   */
  trackEvent(params: {
    user_id: string;
    origin_service_id: string;
    recommended_service_id: string;
    event_type: RecommendationEventType;
    item_id?: string | null;
  }): RecommendationEvent | null {
    const origin = db.getServiceById(params.origin_service_id);
    const alternative = db.getServiceById(params.recommended_service_id);
    if (!origin || !alternative) return null;

    const now = new Date();
    const key = this.recommendationKey(origin.id, alternative.id, params.user_id);
    if (params.event_type === 'shown' && trafficStore.hasRecentEvent(key, params.user_id, 'shown', SHOWN_EVENT_DEDUPE_MS)) {
      return null;
    }

    const buildings = db.getBuildings();
    const from = buildings.find(b => b.id === origin.building_id);
    const to = buildings.find(b => b.id === alternative.building_id);
    const distance = from && to ? campusDistanceMeters(from.map_coords, to.map_coords) : 0;
    const item = params.item_id ? this.getItem(params.item_id) : null;

    const event: RecommendationEvent = {
      id: id('rec'),
      recommendation_key: key,
      user_id: params.user_id,
      requested_service: origin.name,
      requested_item: item?.name ?? null,
      origin_service: origin.name,
      recommended_service: alternative.name,
      distance_meters: distance,
      walk_mins: walkingMinutes(distance),
      wait_before: origin.estimated_wait_mins,
      wait_after: alternative.estimated_wait_mins,
      availability_verified: item ? item.available : true,
      reason: item ? `Catalogue verified: ${item.name}` : 'Verified on the service record',
      event_type: params.event_type,
      created_at: now.toISOString()
    };
    trafficStore.recordEvent(event);
    return event;
  }

  submitFeedback(params: {
    user_id: string;
    origin_service_id: string;
    recommended_service_id: string;
    useful: boolean;
  }): RecommendationOutcome | null {
    const origin = db.getServiceById(params.origin_service_id);
    const alternative = db.getServiceById(params.recommended_service_id);
    if (!origin || !alternative) return null;

    const key = this.recommendationKey(origin.id, alternative.id, params.user_id);
    const existing = trafficStore.getOutcome(key);
    const now = new Date().toISOString();
    const outcome: RecommendationOutcome = {
      id: existing?.id ?? id('out'),
      recommendation_key: key,
      user_id: params.user_id,
      origin_service: origin.name,
      recommended_service: alternative.name,
      useful: params.useful,
      estimated_wait: alternative.estimated_wait_mins,
      actual_wait: existing?.actual_wait ?? null,
      estimated_vs_actual: existing?.estimated_vs_actual ?? 'pending',
      minutes_saved: existing?.minutes_saved ?? 0,
      created_at: existing?.created_at ?? now,
      updated_at: now
    };
    trafficStore.recordOutcome(outcome);
    return outcome;
  }

  /**
   * Closes the loop once the student actually completes a service after being
   * redirected: compares the wait they would have faced with the wait they did.
   */
  finalizeRedirect(queueEntryId: string): RecommendationOutcome | null {
    const entry = db.getQueueEntryById(queueEntryId);
    if (!entry || !entry.recommendation_id) return null;
    const existing = trafficStore.getOutcome(entry.recommendation_id);
    if (!existing) return null;

    const actualWait = entry.actual_wait_mins ?? null;
    const delta = actualWait === null ? null : actualWait - existing.estimated_wait;
    const now = new Date().toISOString();

    const updated: RecommendationOutcome = {
      ...existing,
      actual_wait: actualWait,
      estimated_vs_actual: delta === null ? 'pending' : delta <= -1 ? 'under' : delta >= 1 ? 'over' : 'matched',
      minutes_saved: actualWait === null ? existing.minutes_saved : Math.max(0, existing.estimated_wait - actualWait),
      updated_at: now
    };
    trafficStore.recordOutcome(updated);
    return updated;
  }

  // ------------------------------------------------------------- run history

  getRuns(limit = 10): PredictionRun[] {
    return trafficStore.getRuns(limit);
  }

  // ------------------------------------------------------------------ alerts

  getAlerts(userId: string, now = new Date()): TrafficAlert[] {
    const services = db.getServices().filter(service => service.status !== 'closed');
    const alerts: TrafficAlert[] = [];

    for (const service of services) {
      const forecast = this.getForecast(service.id, { now });
      if (!forecast || !forecast.sufficient_data) continue;

      const peak = forecast.predicted_peak;
      const rising = forecast.rising;
      if (!peak && !rising) continue;

      const kind: TrafficAlert['kind'] = rising ? 'peak_approaching' : 'predicted_peak';
      const key = `${userId}|${service.id}|${kind}|${peak?.label ?? 'rising'}`;
      if (trafficStore.isAlertDismissed(key, now)) continue;

      const lastEmitted = this.alertEmittedAt.get(key);
      if (lastEmitted !== undefined && now.getTime() - lastEmitted < ALERT_COOLDOWN_MS) continue;
      this.alertEmittedAt.set(key, now.getTime());
      const alternatives = rankAlternatives({
        origin: asServiceFacts(service),
        candidates: this.candidateFacts(service, now, null).filter(c => c.service.category === service.category),
        requestedItem: null,
        now,
        limit: 1
      }).recommended[0];

      const peakInMinutes = forecast.peak_in_minutes;
      const peakUnderWay = peak !== null && peakInMinutes !== null && peakInMinutes <= 0;
      const headline = peakUnderWay
        ? `Peak traffic is under way at ${service.name}`
        : rising && peakInMinutes !== null
        ? `Peak expected in ${formatLeadTime(peakInMinutes)}`
        : `Traffic is rising at ${service.name}`;

      const bodyLines: string[] = [];
      if (peak) {
        bodyLines.push(`${service.name} usually gets busy around ${formatHourLabel(peak.start_hour)}.`);
      }
      const currentState = effectiveTrafficState(service);
      if (currentState === 'moderate' || currentState === 'high' || currentState === 'peak') {
        bodyLines.push(`Current traffic is already ${currentState}.`);
      }
      if (alternatives) {
        bodyLines.push(`${alternatives.service_name} currently has a shorter queue (~${alternatives.current_wait_mins} min).`);
      }

      const suggested = peakUnderWay
        ? alternatives
          ? `Try ${alternatives.service_name} now, or join virtually instead of walking over.`
          : 'Join the virtual queue now so you keep your place while the peak passes.'
        : peak
        ? `You may want to visit before ${formatHourLabel(peak.start_hour)}.`
        : `Join the virtual queue now or wait for the queue to move.`;

      alerts.push({
        key,
        service_id: service.id,
        service_name: service.name,
        kind,
        severity: peakInMinutes !== null && peakInMinutes <= 45 ? 'alert' : 'warning',
        headline,
        body: bodyLines.join(' '),
        suggested_action: suggested,
        peak_label: peak ? `${peak.day_label} · ${peak.label}` : null,
        peak_in_minutes: peakInMinutes,
        better_window_label: forecast.better_window ? `${forecast.better_window.day_label} · ${forecast.better_window.label}` : null,
        alternative_name: alternatives?.service_name ?? null,
        alternative_wait_mins: alternatives?.current_wait_mins ?? null,
        created_at: now.toISOString(),
        dismissible: true
      });
    }

    return alerts
      .sort((a, b) => (a.peak_in_minutes ?? 9999) - (b.peak_in_minutes ?? 9999))
      .slice(0, MAX_RECOMMENDED_ALERTS);
  }

  dismissAlert(params: { user_id: string; key: string }): boolean {
    const [userId, serviceId, kind] = params.key.split('|');
    if (!userId || !serviceId || !kind) return false;
    if (userId !== params.user_id) return false;
    const now = new Date();
    trafficStore.dismissAlert({
      key: params.key,
      user_id: params.user_id,
      service_id: serviceId,
      alert_kind: kind,
      dismissed_at: now.toISOString(),
      expires_at: new Date(now.getTime() + ALERT_DISMISS_TTL_MS).toISOString()
    });
    return true;
  }

  alertCooldownMs(): number {
    return ALERT_COOLDOWN_MS;
  }

  // ------------------------------------------------------------ preferences

  getPreference(userId: string): UserPreference | null {
    return trafficStore.getPreference(userId);
  }

  setPreference(params: {
    user_id: string;
    max_distance_meters?: number;
    preferred_hour?: number | null;
    avoid_peak?: boolean;
  }): UserPreference {
    const existing = trafficStore.getPreference(params.user_id);
    const preference: UserPreference = {
      user_id: params.user_id,
      updated_at: new Date().toISOString(),
      max_distance_meters: params.max_distance_meters ?? existing?.max_distance_meters ?? 1200,
      preferred_hour: params.preferred_hour ?? existing?.preferred_hour ?? null,
      avoid_peak: params.avoid_peak ?? existing?.avoid_peak ?? true,
      source: 'student_choice'
    };
    trafficStore.setPreference(preference);
    return preference;
  }

  // -------------------------------------------------------- admin analytics

  getAdminAnalytics(now = new Date()): PeakIntelligenceAnalytics {
    const services = db.getServices();
    const measurements = trafficStore.getMeasurements();
    const events = trafficStore.getEvents();
    const outcomes = trafficStore.getOutcomes();

    const since = new Date(now.getTime() - 7 * 86400000).toISOString();
    const recentEvents = events.filter(e => e.created_at >= since);

    const shown = recentEvents.filter(e => e.event_type === 'shown').length;
    const clicked = recentEvents.filter(e => e.event_type === 'clicked' || e.event_type === 'alternative_opened').length;
    const selected = recentEvents.filter(e => e.event_type === 'selected');
    const studentsRedirected = new Set(selected.map(e => e.user_id)).size;
    const estimatedMinutes = selected.reduce((sum, e) => sum + Math.max(0, e.wait_before - e.wait_after - e.walk_mins), 0);
    const actualMinutes = outcomes.reduce((sum, o) => sum + (o.minutes_saved || 0), 0);
    const feedback = outcomes.filter(o => o.useful !== null);
    const positive = feedback.filter(o => o.useful === true).length;
    const acceptanceRate = feedback.length > 0 ? Math.round((positive / feedback.length) * 100) : null;

    const byService = new Map<string, Service>();
    for (const service of services) byService.set(service.id, service);

    const perService = services.map(service => {
      const serviceMeasurements = measurements.filter(m => m.service_id === service.id);
      const forecast = this.getForecast(service.id, { now });
      const serviceEvents = recentEvents.filter(e => e.origin_service === service.name);
      const redirects = serviceEvents.filter(e => e.event_type === 'selected').length;
      const serviceOutcomes = outcomes.filter(o => o.origin_service === service.name && o.useful !== null);
      const servicePositive = serviceOutcomes.filter(o => o.useful === true).length;
      return {
        service_id: service.id,
        service_name: service.name,
        peak_window: forecast?.predicted_peak ? `${forecast.predicted_peak.day_label} · ${forecast.predicted_peak.label}` : null,
        better_window: forecast?.better_window ? `${forecast.better_window.day_label} · ${forecast.better_window.label}` : null,
        confidence: forecast?.confidence ?? ('low' as const),
        confidence_pct: forecast?.confidence_pct ?? 0,
        avg_queue: serviceMeasurements.length
          ? Math.round(serviceMeasurements.reduce((s, m) => s + m.avg_queue, 0) / serviceMeasurements.length)
          : 0,
        peak_queue: serviceMeasurements.length ? Math.max(...serviceMeasurements.map(m => m.peak_queue)) : 0,
        avg_wait: serviceMeasurements.length
          ? Math.round(serviceMeasurements.reduce((s, m) => s + m.avg_wait, 0) / serviceMeasurements.length)
          : 0,
        peak_wait: serviceMeasurements.length ? Math.max(...serviceMeasurements.map(m => m.peak_wait)) : 0,
        recommendations_shown: serviceEvents.filter(e => e.event_type === 'shown').length,
        recommendation_clicks: serviceEvents.filter(e => e.event_type === 'clicked' || e.event_type === 'alternative_opened').length,
        redirects,
        estimated_minutes_avoided: serviceEvents
          .filter(e => e.event_type === 'selected')
          .reduce((sum, e) => sum + Math.max(0, e.wait_before - e.wait_after - e.walk_mins), 0),
        acceptance_rate_pct: serviceOutcomes.length ? Math.round((servicePositive / serviceOutcomes.length) * 100) : null
      };
    });

    const busiest = [...perService].sort((a, b) => b.peak_wait - a.peak_wait || b.avg_wait - a.avg_wait)[0] ?? null;

    const upcoming = perService
      .filter(entry => entry.peak_window)
      .map(entry => {
        const forecast = this.getForecast(entry.service_id, { now });
        return {
          service_id: entry.service_id,
          service_name: entry.service_name,
          peak_label: entry.peak_window as string,
          peak_in_minutes: forecast?.peak_in_minutes ?? null,
          expected_demand: forecast?.predicted_peak?.expected_demand ?? ('low' as const),
          confidence: entry.confidence,
          confidence_pct: entry.confidence_pct
        };
      })
      .sort((a, b) => (a.peak_in_minutes ?? 999999) - (b.peak_in_minutes ?? 999999))
      .slice(0, 6);

    // Hour-of-day intensity across the whole campus (recorded data only).
    const hourBuckets = new Map<number, { arrivals: number; wait: number; count: number }>();
    for (const m of measurements) {
      const bucket = hourBuckets.get(m.hour) ?? { arrivals: 0, wait: 0, count: 0 };
      bucket.arrivals += m.arrivals;
      bucket.wait += m.avg_wait;
      bucket.count += 1;
      hourBuckets.set(m.hour, bucket);
    }
    const maxArrivals = Math.max(1, ...Array.from(hourBuckets.values()).map(b => b.arrivals / Math.max(1, b.count)));
    const maxWait = Math.max(1, ...Array.from(hourBuckets.values()).map(b => b.wait / Math.max(1, b.count)));
    const busiestHours = Array.from(hourBuckets.entries())
      .map(([hour, bucket]) => {
        const avgArrivals = bucket.arrivals / Math.max(1, bucket.count);
        const avgWait = bucket.wait / Math.max(1, bucket.count);
        return {
          hour,
          label: formatHourLabel(hour),
          intensity: Math.round(100 * (0.55 * (avgArrivals / maxArrivals) + 0.45 * (avgWait / maxWait))),
          arrivals: Math.round(avgArrivals),
          wait: Math.round(avgWait)
        };
      })
      .sort((a, b) => b.intensity - a.intensity)
      .slice(0, 6);

    // Day x hour heatmap.
    const heatBuckets = new Map<string, { arrivals: number; wait: number; count: number }>();
    for (const m of measurements) {
      const key = `${m.day_of_week}|${m.hour}`;
      const bucket = heatBuckets.get(key) ?? { arrivals: 0, wait: 0, count: 0 };
      bucket.arrivals += m.arrivals;
      bucket.wait += m.avg_wait;
      bucket.count += 1;
      heatBuckets.set(key, bucket);
    }
    const cellIntensity = (bucket: { arrivals: number; wait: number; count: number }) => {
      const avgArrivals = bucket.arrivals / Math.max(1, bucket.count);
      const avgWait = bucket.wait / Math.max(1, bucket.count);
      return Math.round(100 * (0.55 * (avgArrivals / maxArrivals) + 0.45 * (avgWait / maxWait)));
    };

    const cells = Array.from(heatBuckets.entries()).map(([key, bucket]) => {
      const [day, hour] = key.split('|').map(Number);
      return {
        day,
        hour,
        intensity: cellIntensity(bucket),
        arrivals: Math.round(bucket.arrivals / Math.max(1, bucket.count)),
        wait: Math.round(bucket.wait / Math.max(1, bucket.count)),
        samples: bucket.count
      };
    });
    const maxIntensity = Math.max(1, ...cells.map(c => c.intensity));

    // Daily trend for the last 14 days.
    const trendBuckets = new Map<string, { arrivals: number; wait: number; count: number }>();
    for (const m of measurements) {
      const bucket = trendBuckets.get(m.date) ?? { arrivals: 0, wait: 0, count: 0 };
      bucket.arrivals += m.arrivals;
      bucket.wait += m.avg_wait;
      bucket.count += 1;
      trendBuckets.set(m.date, bucket);
    }
    const maxDailyArrivals = Math.max(1, ...Array.from(trendBuckets.values()).map(b => b.arrivals / Math.max(1, b.count)));
    const maxDailyWait = Math.max(1, ...Array.from(trendBuckets.values()).map(b => b.wait / Math.max(1, b.count)));
    const demandTrend = Array.from(trendBuckets.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(-14)
      .map(([date, bucket]) => {
        const avgArrivals = bucket.arrivals / Math.max(1, bucket.count);
        const avgWait = bucket.wait / Math.max(1, bucket.count);
        return {
          date,
          intensity: Math.round(100 * (0.55 * (avgArrivals / maxDailyArrivals) + 0.45 * (avgWait / maxDailyWait))),
          arrivals: Math.round(avgArrivals),
          wait: Math.round(avgWait)
        };
      });

    const capacityPressure = services.map(service => {
      const utilisation =
        service.avg_service_duration_mins > 0
          ? Math.min(100, Math.round(((service.current_queue_length * service.avg_service_duration_mins) / Math.max(1, service.active_counters)) / 60 * 100))
          : 0;
      return {
        service_id: service.id,
        service_name: service.name,
        active_capacity: service.active_counters,
        total_capacity: service.total_counters,
        utilisation_pct: utilisation,
        pressure: (utilisation >= 60 ? 'high' : utilisation >= 30 ? 'moderate' : 'low') as 'low' | 'moderate' | 'high'
      };
    }).sort((a, b) => b.utilisation_pct - a.utilisation_pct);

    const busiestService = busiest && busiest.avg_wait > 0
      ? {
          service_id: busiest.service_id,
          service_name: busiest.service_name,
          peak_window: busiest.peak_window,
          avg_queue: busiest.avg_queue,
          peak_queue: busiest.peak_queue,
          avg_wait: busiest.avg_wait,
          peak_wait: busiest.peak_wait,
          redirects: busiest.redirects,
          estimated_minutes_avoided: busiest.estimated_minutes_avoided
        }
      : null;

    return {
      generated_at: now.toISOString(),
      model_version: PEAK_MODEL_VERSION,
      data_window_days: HISTORY_WINDOW_DAYS,
      totals: {
        demand_measurements: measurements.length,
        services_with_history: new Set(measurements.map(m => m.service_id)).size,
        predictions_generated: trafficStore.getPredictions().filter(p => p.sufficient_data).length,
        recommendations_shown: shown,
        recommendation_clicks: clicked,
        redirects: selected.length,
        students_redirected: studentsRedirected,
        estimated_minutes_avoided: estimatedMinutes,
        actual_minutes_avoided: actualMinutes,
        acceptance_rate_pct: acceptanceRate,
        feedback_responses: feedback.length
      },
      busiest_service: busiestService,
      busiest_hours: busiestHours,
      upcoming_peaks: upcoming,
      demand_trend: demandTrend,
      heatmap: {
        days: DAY_SHORT.map((label, index) => label),
        hours: Array.from(new Set(cells.map(c => c.hour))).sort((a, b) => a - b),
        cells,
        max_intensity: maxIntensity
      },
      capacity_pressure: capacityPressure,
      per_service: perService
    };
  }

  // ------------------------------------------------------------ heatmap view

  /** Day x hour demand model for a single service, from recorded data only. */
  getServiceHeatmap(serviceId: string) {
    const measurements = trafficStore.getMeasurements(serviceId);
    if (measurements.length === 0) {
      return { days: DAY_SHORT.map((label, index) => ({ index, label })), hours: [], cells: [], max_intensity: 0 };
    }

    const buckets = new Map<string, { arrivals: number; wait: number; count: number }>();
    for (const m of measurements) {
      const key = `${m.day_of_week}|${m.hour}`;
      const bucket = buckets.get(key) ?? { arrivals: 0, wait: 0, count: 0 };
      bucket.arrivals += m.arrivals;
      bucket.wait += m.avg_wait;
      bucket.count += 1;
      buckets.set(key, bucket);
    }

    const maxArrivals = Math.max(1, ...Array.from(buckets.values()).map(b => b.arrivals / b.count));
    const maxWait = Math.max(1, ...Array.from(buckets.values()).map(b => b.wait / b.count));

    const cells = Array.from(buckets.entries()).map(([key, bucket]) => {
      const [day, hour] = key.split('|').map(Number);
      const intensity = Math.round(100 * (0.55 * (bucket.arrivals / maxArrivals) + 0.45 * (bucket.wait / maxWait)));
      return {
        day,
        hour,
        intensity,
        band: demandBand(intensity),
        arrivals: Math.round(bucket.arrivals / bucket.count),
        wait: Math.round(bucket.wait / bucket.count),
        samples: bucket.count
      };
    });

    return {
      days: DAY_SHORT.map((label, index) => ({ index, label })),
      hours: Array.from(new Set(cells.map(c => c.hour))).sort((a, b) => a - b),
      cells,
      max_intensity: Math.max(1, ...cells.map(c => c.intensity))
    };
  }
}

export function formatLeadTime(minutes: number): string {
  if (minutes < 60) {
    const mins = Math.max(1, Math.round(minutes));
    return `${mins} minute${mins === 1 ? '' : 's'}`;
  }
  const hours = Math.floor(minutes / 60);
  const rest = Math.round(minutes % 60);
  return rest === 0 ? `${hours} hour${hours === 1 ? '' : 's'}` : `${hours}h ${rest}m`;
}

export const trafficIntelligence = new TrafficIntelligence();
export type { TrafficIntelligence, TrafficState, AvailabilityFact };
