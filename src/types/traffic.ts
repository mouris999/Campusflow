/**
 * Smart Traffic Intelligence — shared type contracts.
 *
 * Every type in this file describes data that is stored on disk (or derived
 * from stored data). Nothing here is decorative: the UI only ever renders
 * values that the server computed from CampusFlow records.
 */

import type { Service, ServiceCategory } from './index.js';

export type TrafficState = 'low' | 'moderate' | 'high' | 'peak' | 'closed';

export interface TrafficStateMeta {
  label: string;
  short: string;
  /** Icon glyph kept in the text layer so colour is never the only signal. */
  glyph: string;
  description: string;
}

export const TRAFFIC_STATES: TrafficState[] = ['low', 'moderate', 'high', 'peak'];

export const TRAFFIC_STATE_META: Record<TrafficState, TrafficStateMeta> = {
  low: {
    label: 'Low traffic',
    short: 'LOW',
    glyph: '○',
    description: 'Short queues and open capacity.'
  },
  moderate: {
    label: 'Moderate traffic',
    short: 'MODERATE',
    glyph: '◔',
    description: 'Noticeable queue forming.'
  },
  high: {
    label: 'High traffic',
    short: 'HIGH',
    glyph: '◑',
    description: 'Long wait, capacity under pressure.'
  },
  peak: {
    label: 'Peak traffic',
    short: 'PEAK',
    glyph: '●',
    description: 'Above normal capacity — a peak is on.'
  },
  closed: {
    label: 'Closed',
    short: 'CLOSED',
    glyph: '✕',
    description: 'Not operating right now.'
  }
};

export type ServiceItemKind =
  | 'menu_item'
  | 'study_space'
  | 'resource'
  | 'equipment'
  | 'document_service'
  | 'lab_supply';

export interface ServiceItem {
  id: string;
  service_id: string;
  service_name: string;
  kind: ServiceItemKind;
  name: string;
  description: string;
  synonyms: string[];
  /** Authoritative availability flag written by staff / point-of-sale sync. */
  available: boolean;
  quantity_available: number;
  capacity: number;
  unit_label: string;
  requires_reservation: boolean;
  source_system: string;
  updated_at: string;
  updated_by: string;
  /** Why the item is unavailable, when known. */
  unavailability_note?: string;
}

export interface DemandMeasurement {
  id: string;
  service_id: string;
  service_name: string;
  building_id: string;
  date: string;
  hour: number;
  day_of_week: number;
  day_name: string;
  arrivals: number;
  completed: number;
  avg_queue: number;
  peak_queue: number;
  avg_wait: number;
  peak_wait: number;
  active_capacity: number;
  total_capacity: number;
  service_duration_mins: number;
  incident_count: number;
  source: 'historical_seed' | 'live_sample';
  recorded_at: string;
}

export type PeakConfidence = 'low' | 'medium' | 'high';

export type DemandBand = 'low' | 'moderate' | 'high' | 'peak';

export interface HourlyDemandPoint {
  hour: number;
  label: string;
  /** 0-100 normalised demand intensity derived from stored measurements. */
  intensity: number;
  band: DemandBand;
  avg_arrivals: number;
  avg_queue: number;
  avg_wait: number;
  min_wait: number;
  max_wait: number;
  wait_stdev: number;
  sample_days: number;
  is_current: boolean;
  is_predicted: boolean;
}

export interface PeakWindow {
  date: string | null;
  day_label: string;
  start_hour: number;
  end_hour: number;
  label: string;
  expected_demand: DemandBand;
  expected_queue: number;
  expected_wait_min: number;
  expected_wait_max: number;
  intensity: number;
}

export interface PeakForecast {
  service_id: string;
  service_name: string;
  generated_at: string;
  model_version: string;
  sufficient_data: boolean;
  insufficient_reason?: string;
  confidence: PeakConfidence;
  confidence_pct: number;
  sample_count: number;
  distinct_days: number;
  window_days: number;
  basis: 'weekday_profile' | 'overall_profile';
  hours: HourlyDemandPoint[];
  predicted_peak: PeakWindow | null;
  /** Wider high+peak stretch around the peak, when one exists. */
  busy_window: PeakWindow | null;
  upcoming_peaks: PeakWindow[];
  better_window: PeakWindow | null;
  peak_in_minutes: number | null;
  rising: boolean;
  is_open_now: boolean;
  disclaimer: string;
}

export type RecommendationReasonCode =
  | 'verified_availability'
  | 'wait_saved'
  | 'nearby'
  | 'low_traffic'
  | 'capacity_headroom'
  | 'open_now'
  | 'predicted_lower'
  | 'same_service_branch';

export interface AlternativeReason {
  code: RecommendationReasonCode;
  text: string;
}

export type BlockedReasonCode =
  | 'closed_now'
  | 'outside_operating_hours'
  | 'item_unavailable'
  | 'item_not_offered'
  | 'at_capacity'
  | 'too_far'
  | 'no_wait_advantage'
  | 'congested_status'
  | 'paused_status';

export interface AvailabilityFact {
  item_id: string | null;
  item_name: string | null;
  verified: boolean;
  available: boolean | null;
  checked_at: string;
  source_system: string | null;
  note: string;
}

export interface SmartAlternative {
  service_id: string;
  service_name: string;
  code: string;
  category: ServiceCategory;
  building_id: string;
  building_name: string;
  floor: string;
  room_counter: string;
  status: Service['status'];
  traffic_state: TrafficState;
  current_wait_mins: number;
  current_queue_length: number;
  active_counters: number;
  total_counters: number;
  capacity_headroom_pct: number;
  distance_meters: number;
  walk_mins: number;
  predicted_wait_mins: number | null;
  predicted_intensity: number | null;
  open_now: boolean;
  opens_at: string;
  closes_at: string;
  same_service_branch: boolean;
  availability: AvailabilityFact;
  gross_wait_saved_mins: number;
  time_saved_mins: number;
  usable: boolean;
  blocked_reason: BlockedReasonCode | null;
  blocked_text: string | null;
  reasons: AlternativeReason[];
}

export interface AlternativesResult {
  origin: {
    service_id: string;
    service_name: string;
    current_wait_mins: number;
    current_queue_length: number;
    traffic_state: TrafficState;
    building_name: string;
  };
  requested_item: { id: string; name: string; available_at_origin: boolean } | null;
  recommended: SmartAlternative[];
  not_usable: SmartAlternative[];
  method: string;
  generated_at: string;
  explanation: TrafficExplanation;
}

export interface TrafficExplanation {
  headline: string;
  body: string;
  bullets: string[];
  source: 'verified_rules' | 'ai_guarded';
  guard_violations?: string[];
  disclaimer: string;
}

export type RecommendationEventType =
  | 'shown'
  | 'clicked'
  | 'alternative_opened'
  | 'selected'
  | 'arrived'
  | 'returned_to_origin'
  | 'dismissed';

export interface RecommendationEvent {
  id: string;
  recommendation_key: string;
  user_id: string;
  requested_service: string;
  requested_item: string | null;
  origin_service: string;
  recommended_service: string;
  distance_meters: number;
  walk_mins: number;
  wait_before: number;
  wait_after: number;
  availability_verified: boolean;
  reason: string;
  event_type: RecommendationEventType;
  created_at: string;
}

export interface RecommendationOutcome {
  id: string;
  recommendation_key: string;
  user_id: string;
  origin_service: string;
  recommended_service: string;
  useful: boolean | null;
  estimated_wait: number;
  actual_wait: number | null;
  estimated_vs_actual: 'pending' | 'matched' | 'under' | 'over';
  minutes_saved: number;
  created_at: string;
  updated_at: string;
}

export interface TrafficAlert {
  key: string;
  service_id: string;
  service_name: string;
  kind: 'peak_approaching' | 'rising_traffic' | 'predicted_peak';
  severity: 'info' | 'warning' | 'alert';
  headline: string;
  body: string;
  suggested_action: string;
  peak_label: string | null;
  peak_in_minutes: number | null;
  better_window_label: string | null;
  alternative_name: string | null;
  alternative_wait_mins: number | null;
  created_at: string;
  dismissible: boolean;
}

export interface PlanYourVisit {
  service_id: string;
  service_name: string;
  now: {
    wait_mins: number;
    queue_length: number;
    traffic_state: TrafficState;
    status: string;
    is_open_now: boolean;
    opens_at: string;
    closes_at: string;
  };
  next_peak: PeakWindow | null;
  suggested_window: PeakWindow | null;
  alternative: SmartAlternative | null;
  forecast: PeakForecast;
  personalized: PersonalizedInsight | null;
}

export interface PersonalizedInsight {
  available: boolean;
  visit_count: number;
  services_visited: { service_id: string; service_name: string; count: number }[];
  usual_window: { label: string; start_hour: number; end_hour: number; count: number } | null;
  message: string | null;
  advice: string | null;
}

/** Student-set travel preferences, stored alongside the recorded demand data. */
export interface UserTrafficPreference {
  user_id: string;
  updated_at: string;
  /** Metres. Shorter values mean the student prefers closer locations. */
  max_distance_meters: number;
  /** Preferred arrival hour when the student has told us. */
  preferred_hour: number | null;
  avoid_peak: boolean;
  source: 'student_choice' | 'recorded_activity';
}

export interface IntentMatch {
  service_id: string;
  service_name: string;
  building_name: string;
  category: ServiceCategory;
  status: Service['status'];
  current_wait_mins: number;
  traffic_state: TrafficState;
  item: { id: string; name: string; available: boolean; quantity_available: number; unit_label: string } | null;
  match_basis: 'item_exact' | 'item_synonym' | 'item_token' | 'service_name' | 'service_description';
  match_score: number;
}

export interface IntentResolution {
  query: string;
  normalized_query: string;
  verified: boolean;
  message: string;
  resolved_item: { id: string; name: string; kind: ServiceItemKind } | null;
  matches: IntentMatch[];
  suggestions: string[];
  resolved_at: string;
}

export interface PeakIntelligenceAnalytics {
  generated_at: string;
  model_version: string;
  data_window_days: number;
  totals: {
    demand_measurements: number;
    services_with_history: number;
    predictions_generated: number;
    recommendations_shown: number;
    recommendation_clicks: number;
    redirects: number;
    students_redirected: number;
    estimated_minutes_avoided: number;
    actual_minutes_avoided: number;
    acceptance_rate_pct: number | null;
    feedback_responses: number;
  };
  busiest_service: {
    service_id: string;
    service_name: string;
    peak_window: string | null;
    avg_queue: number;
    peak_queue: number;
    avg_wait: number;
    peak_wait: number;
    redirects: number;
    estimated_minutes_avoided: number;
  } | null;
  busiest_hours: { hour: number; label: string; intensity: number; arrivals: number; wait: number }[];  upcoming_peaks: {
    service_id: string;
    service_name: string;
    peak_label: string;
    peak_in_minutes: number | null;
    expected_demand: DemandBand;
    confidence: PeakConfidence;
    confidence_pct: number;
  }[];
  demand_trend: { date: string; intensity: number; arrivals: number; wait: number }[];
  heatmap: {
    days: string[];
    hours: number[];
    cells: { day: number; hour: number; intensity: number; arrivals: number; wait: number; samples: number }[];
    max_intensity: number;
  };
  capacity_pressure: {
    service_id: string;
    service_name: string;
    active_capacity: number;
    total_capacity: number;
    utilisation_pct: number;
    pressure: 'low' | 'moderate' | 'high';
  }[];
  per_service: {
    service_id: string;
    service_name: string;
    peak_window: string | null;
    better_window: string | null;
    confidence: PeakConfidence;
    confidence_pct: number;
    avg_queue: number;
    peak_queue: number;
    avg_wait: number;
    peak_wait: number;
    recommendations_shown: number;
    recommendation_clicks: number;
    redirects: number;
    estimated_minutes_avoided: number;
    acceptance_rate_pct: number | null;
  }[];
}

export interface DemandHeatmapModel {
  days: { index: number; label: string }[];
  hours: number[];
  cells: {
    day: number;
    hour: number;
    intensity: number;
    band: DemandBand;
    arrivals: number;
    wait: number;
    samples: number;
  }[];
  max_intensity: number;
}
