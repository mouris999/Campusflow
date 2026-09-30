/**
 * Traffic-state classification.
 *
 * Thresholds live here so the student UI, the map badges, the admin heatmap
 * and the server-side ranking all agree on what "busy" means.
 */

import type { Service } from '../types/index.js';
import type { TrafficState, DemandBand } from '../types/traffic.js';
import { TRAFFIC_STATES } from '../types/traffic.js';

export const TRAFFIC_THRESHOLDS = {
  /** <= this many minutes of wait is calm. */
  lowMax: 8,
  /** <= this many minutes of wait is a visible warning. */
  moderateMax: 17,
  /** <= this many minutes of wait is heavy. */
  highMax: 27
} as const;

export function waitBand(waitMins: number): DemandBand {
  if (waitMins <= TRAFFIC_THRESHOLDS.lowMax) return 'low';
  if (waitMins <= TRAFFIC_THRESHOLDS.moderateMax) return 'moderate';
  if (waitMins <= TRAFFIC_THRESHOLDS.highMax) return 'high';
  return 'peak';
}

export function demandBand(intensity: number): DemandBand {
  if (intensity < 35) return 'low';
  if (intensity < 55) return 'moderate';
  if (intensity < 78) return 'high';
  return 'peak';
}

export function trafficStateFromWait(waitMins: number, status?: Service['status']): TrafficState {
  if (status === 'closed') return 'closed';
  return waitBand(waitMins) as TrafficState;
}

export function trafficStateFromDemand(level: Service['current_demand_level']): TrafficState {
  switch (level) {
    case 'critical':
      return 'peak';
    case 'high':
      return 'high';
    case 'moderate':
      return 'moderate';
    default:
      return 'low';
  }
}

/** The most severe of two states wins. */
export function worstTrafficState(a: TrafficState, b: TrafficState): TrafficState {
  if (a === 'closed' || b === 'closed') return 'closed';
  return TRAFFIC_STATES[Math.max(TRAFFIC_STATES.indexOf(a), TRAFFIC_STATES.indexOf(b))];
}

/**
 * Effective traffic state for a service: combines the live wait estimate with
 * the operational demand level already stored on the service record.
 */
export function effectiveTrafficState(service: Pick<Service, 'status' | 'estimated_wait_mins' | 'current_demand_level'>): TrafficState {
  if (service.status === 'closed') return 'closed';
  if (service.status === 'paused') return 'peak';
  return worstTrafficState(
    trafficStateFromWait(service.estimated_wait_mins, service.status),
    trafficStateFromDemand(service.current_demand_level)
  );
}
