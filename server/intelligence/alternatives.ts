/**
 * Verified smart-alternative engine.
 *
 * Pure ranking logic. Every number it returns is a number it was handed by the
 * caller from the database; the engine only filters, scores and explains.
 *
 * Hard guarantees enforced here:
 *  - a closed or currently-closed service is never recommended
 *  - an item that the catalogue says is unavailable is never recommended
 *  - an item that the catalogue does not list for a service is never claimed
 *  - nothing is invented: unknown facts are reported as unknown
 */

import type { ServiceCategory } from '../../src/types/index.js';
import type {
  AlternativeReason,
  AvailabilityFact,
  BlockedReasonCode,
  SmartAlternative,
  TrafficState
} from '../../src/types/traffic.js';
import { formatDistance } from '../../src/lib/geo.js';
import { effectiveTrafficState } from '../../src/lib/trafficState.js';

export const ALTERNATIVE_SCORING_VERSION = 'campusflow-alternative-score-v1';

/** Minimum net minutes saved before an alternative is worth recommending. */
export const MIN_NET_SAVED_MINS = 3;
/** Beyond this walking time an alternative is still listed but never promoted. */
export const MAX_PROMOTED_WALK_MINS = 20;

export const SCORING_WEIGHTS = {
  wait_saved_per_min: 2.4,
  walk_penalty_per_min: 2.2,
  verified_availability: 30,
  same_service_branch: 18,
  same_category: 12,
  capacity_headroom: 0.18,
  status_open: 8,
  status_congested: -14,
  status_paused: -45,
  predicted_quiet: 14,
  same_building: 6
} as const;

export interface AlternativeServiceFacts {
  id: string;
  name: string;
  code: string;
  category: ServiceCategory;
  status: 'open' | 'closed' | 'paused' | 'congested';
  building_id: string;
  building_name: string;
  floor: string;
  room_counter: string;
  current_queue_length: number;
  estimated_wait_mins: number;
  current_demand_level: 'low' | 'moderate' | 'high' | 'critical';
  active_counters: number;
  total_counters: number;
  max_queue_capacity: number;
  operating_hours: { open: string; close: string; days: string[] };
  alternate_service_ids: string[];
}

export interface CandidateFacts {
  service: AlternativeServiceFacts;
  distance_meters: number;
  walk_mins: number;
  /** Catalogue record for the requested offer at this service, if any. */
  item: {
    id: string;
    name: string;
    available: boolean;
    quantity_available: number;
    unit_label: string;
    source_system: string;
    updated_at: string;
    unavailability_note?: string;
  } | null;
  /** Predicted wait for the current hour, from the cached peak forecast. */
  predicted_wait_mins: number | null;
  predicted_intensity: number | null;
  is_open_now: boolean;
}

export interface RankAlternativesInput {
  origin: AlternativeServiceFacts;
  candidates: CandidateFacts[];
  requestedItem: { id: string; name: string; available_at_origin: boolean } | null;
  now: Date;
  limit?: number;
}

function availabilityFact(
  candidate: CandidateFacts,
  requestedItem: RankAlternativesInput['requestedItem'],
  now: Date
): AvailabilityFact {
  if (!requestedItem) {
    return {
      item_id: null,
      item_name: null,
      verified: true,
      available: null,
      checked_at: now.toISOString(),
      source_system: 'service-record',
      note: 'No specific item requested — verified on the service record itself.'
    };
  }
  if (!candidate.item) {
    return {
      item_id: null,
      item_name: requestedItem.name,
      verified: false,
      available: null,
      checked_at: now.toISOString(),
      source_system: 'service-catalogue',
      note: `The catalogue has no record of this offer at ${candidate.service.name}.`
    };
  }
  return {
    item_id: candidate.item.id,
    item_name: candidate.item.name,
    verified: true,
    available: candidate.item.available,
    checked_at: candidate.item.updated_at,
    source_system: candidate.item.source_system,
    note: candidate.item.available
      ? `${candidate.item.quantity_available} ${candidate.item.unit_label} reported by ${candidate.item.source_system}.`
      : candidate.item.unavailability_note || 'Marked unavailable in the catalogue.'
  };
}

function buildReasons(
  candidate: CandidateFacts,
  origin: AlternativeServiceFacts,
  availability: AvailabilityFact,
  requestedItem: RankAlternativesInput['requestedItem'],
  sameServiceBranch: boolean,
  trafficState: TrafficState,
  netSaved: number
): AlternativeReason[] {
  const reasons: AlternativeReason[] = [];
  const service = candidate.service;

  if (requestedItem && availability.verified && availability.available === true) {
    reasons.push({ code: 'verified_availability', text: `Same item available (${availability.item_name})` });
  } else if (sameServiceBranch) {
    reasons.push({ code: 'same_service_branch', text: 'Same service offered at this branch' });
  } else if (!requestedItem && service.category === origin.category) {
    reasons.push({ code: 'verified_availability', text: 'Same service category' });
  }

  if (netSaved >= MIN_NET_SAVED_MINS) {
    reasons.push({ code: 'wait_saved', text: `About ${netSaved} min less waiting (${origin.estimated_wait_mins}m here vs ${service.estimated_wait_mins}m there)` });
  }

  if (candidate.distance_meters > 0) {
    reasons.push({ code: 'nearby', text: `${formatDistance(candidate.distance_meters)} away · ${candidate.walk_mins} min walk` });
  }

  if (trafficState === 'low') {
    reasons.push({ code: 'low_traffic', text: 'Currently low traffic' });
  } else if (trafficState === 'moderate') {
    reasons.push({ code: 'low_traffic', text: 'Currently moderate traffic' });
  }

  if (service.total_counters > 0) {
    reasons.push({
      code: 'capacity_headroom',
      text: `${service.active_counters} of ${service.total_counters} counters open`
    });
  }

  if (candidate.is_open_now) {
    reasons.push({ code: 'open_now', text: `Open now until ${service.operating_hours.close}` });
  }

  if (candidate.predicted_intensity !== null && candidate.predicted_intensity < 40) {
    reasons.push({ code: 'predicted_lower', text: `Predicted demand for this hour is low (${candidate.predicted_intensity}/100)` });
  }

  return reasons;
}

function scoreCandidate(
  candidate: CandidateFacts,
  origin: AlternativeServiceFacts,
  availability: AvailabilityFact,
  sameServiceBranch: boolean
): number {
  const service = candidate.service;
  let score = 0;

  const grossSaved = origin.estimated_wait_mins - service.estimated_wait_mins;
  if (grossSaved > 0) score += grossSaved * SCORING_WEIGHTS.wait_saved_per_min;

  score -= candidate.walk_mins * SCORING_WEIGHTS.walk_penalty_per_min;

  if (availability.verified && availability.available === true) score += SCORING_WEIGHTS.verified_availability;
  if (sameServiceBranch) score += SCORING_WEIGHTS.same_service_branch;
  if (service.category === origin.category) score += SCORING_WEIGHTS.same_category;

  const headroom = service.max_queue_capacity > 0
    ? Math.max(0, 1 - service.current_queue_length / service.max_queue_capacity)
    : 0;
  score += headroom * service.total_counters * SCORING_WEIGHTS.capacity_headroom;

  if (service.status === 'open') score += SCORING_WEIGHTS.status_open;
  else if (service.status === 'congested') score += SCORING_WEIGHTS.status_congested;
  else if (service.status === 'paused') score += SCORING_WEIGHTS.status_paused;

  if (candidate.predicted_intensity !== null) {
    score += ((100 - candidate.predicted_intensity) / 100) * SCORING_WEIGHTS.predicted_quiet;
  }

  if (service.building_id === origin.building_id) score += SCORING_WEIGHTS.same_building;

  return score;
}

function blocked(
  candidate: CandidateFacts,
  availability: AvailabilityFact,
  requestedItem: RankAlternativesInput['requestedItem'],
  netSaved: number,
  openHoursLabel: string
): { code: BlockedReasonCode | null; text: string | null } {
  const service = candidate.service;

  if (service.status === 'closed') {
    return { code: 'closed_now', text: 'Service is closed' };
  }
  if (service.status === 'paused') {
    return { code: 'paused_status', text: 'Service is paused' };
  }
  if (!candidate.is_open_now) {
    return { code: 'outside_operating_hours', text: `Not open right now (${openHoursLabel})` };
  }
  if (requestedItem && !candidate.item) {
    return { code: 'item_not_offered', text: `Catalogue has no record of ${requestedItem.name} here` };
  }
  if (requestedItem && candidate.item && !candidate.item.available) {
    return {
      code: 'item_unavailable',
      text: candidate.item.unavailability_note
        ? `${requestedItem.name} unavailable — ${candidate.item.unavailability_note}`
        : `${requestedItem.name} is unavailable here`
    };
  }
  if (service.current_queue_length >= service.max_queue_capacity) {
    return {
      code: 'at_capacity',
      text: `Virtual queue full (${service.current_queue_length}/${service.max_queue_capacity})`
    };
  }
  if (netSaved < MIN_NET_SAVED_MINS) {
    return { code: 'no_wait_advantage', text: 'No meaningful wait advantage right now' };
  }
  return { code: null, text: null };
}

function relatedEnough(origin: AlternativeServiceFacts, candidate: AlternativeServiceFacts): boolean {
  if (origin.alternate_service_ids.includes(candidate.id)) return true;
  if (candidate.alternate_service_ids.includes(origin.id)) return true;
  if (candidate.category === origin.category) return true;
  return false;
}

export function rankAlternatives(input: RankAlternativesInput): {
  recommended: SmartAlternative[];
  not_usable: SmartAlternative[];
  scored: { alternative: SmartAlternative; score: number }[];
} {
  const { origin, candidates, requestedItem, now } = input;
  const scored: { alternative: SmartAlternative; score: number }[] = [];

  for (const candidate of candidates) {
    if (candidate.service.id === origin.id) continue;
    if (!relatedEnough(origin, candidate.service)) continue;

    const service = candidate.service;
    const trafficState = effectiveTrafficState(service);
    const availability = availabilityFact(candidate, requestedItem, now);
    const sameServiceBranch =
      origin.alternate_service_ids.includes(service.id) || service.alternate_service_ids.includes(origin.id);

    const grossSaved = origin.estimated_wait_mins - service.estimated_wait_mins;
    const netSaved = grossSaved - candidate.walk_mins;

    const openHoursLabel = `${service.operating_hours.open}–${service.operating_hours.close}`;
    const verdict = blocked(candidate, availability, requestedItem, netSaved, openHoursLabel);

    const alternative: SmartAlternative = {
      service_id: service.id,
      service_name: service.name,
      code: service.code,
      category: service.category,
      building_id: service.building_id,
      building_name: service.building_name,
      floor: service.floor,
      room_counter: service.room_counter,
      status: service.status,
      traffic_state: trafficState,
      current_wait_mins: service.estimated_wait_mins,
      current_queue_length: service.current_queue_length,
      active_counters: service.active_counters,
      total_counters: service.total_counters,
      capacity_headroom_pct:
        service.max_queue_capacity > 0
          ? Math.round(Math.max(0, 1 - service.current_queue_length / service.max_queue_capacity) * 100)
          : 0,
      distance_meters: candidate.distance_meters,
      walk_mins: candidate.walk_mins,
      predicted_wait_mins: candidate.predicted_wait_mins,
      predicted_intensity: candidate.predicted_intensity,
      open_now: candidate.is_open_now,
      opens_at: service.operating_hours.open,
      closes_at: service.operating_hours.close,
      same_service_branch: sameServiceBranch,
      availability,
      gross_wait_saved_mins: grossSaved,
      time_saved_mins: Math.max(0, netSaved),
      usable: verdict.code === null,
      blocked_reason: verdict.code,
      blocked_text: verdict.text,
      reasons: buildReasons(candidate, origin, availability, requestedItem, sameServiceBranch, trafficState, netSaved)
    };

    const score = scoreCandidate(candidate, origin, availability, sameServiceBranch);
    scored.push({ alternative, score });
  }

  scored.sort((a, b) => b.score - a.score);

  const recommended: SmartAlternative[] = [];
  const notUsable: SmartAlternative[] = [];

  for (const { alternative } of scored) {
    const tooFar = alternative.walk_mins > MAX_PROMOTED_WALK_MINS;
    if (alternative.usable && !tooFar) {
      recommended.push(alternative);
    } else {
      notUsable.push(
        tooFar && alternative.usable
          ? { ...alternative, usable: false, blocked_reason: 'too_far', blocked_text: `Too far to be worth the trip (${alternative.walk_mins} min walk)` }
          : alternative
      );
    }
  }

  const limit = input.limit ?? 3;
  return {
    recommended: recommended.slice(0, limit),
    not_usable: notUsable.slice(0, limit),
    scored
  };
}
