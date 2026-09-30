/**
 * Virtual token presentation.
 *
 * A token is a real queue entry, so everything here is derived from the stored
 * record plus the live queue. Nothing is invented: if the server has not told
 * us the position or the call time, the UI says so instead of guessing.
 */

import type { QueueEntry } from '../../src/types/index.js';
import type { SeatReservation } from '../../src/types/index.js';
import { campusTimeToUtc } from './seating.js';

/**
 * Token lifecycle as the student experiences it. This is a *view* of the
 * authoritative queue status, never a replacement for it.
 */
export type TokenPhase =
  | 'waiting'
  | 'approaching'
  | 'called'
  | 'check_in_required'
  | 'checked_in'
  | 'serving'
  | 'completed'
  | 'cancelled'
  | 'expired'
  | 'no_show'
  | 'skipped'
  | 'transferred';

/** Beyond this many people ahead, the student is "approaching". */
export const APPROACHING_THRESHOLD = 3;
/** Below this many minutes to arrival, the student should be told to leave. */
export const DEPART_SOON_MINUTES = 5;

export interface TokenView {
  /** The public code the student shows at the counter. */
  token: string;
  entry_id: string;
  service_id: string;
  service_name: string;
  building_name?: string;
  location?: string;
  phase: TokenPhase;
  /** Short human label for the phase. */
  phase_label: string;
  position: number;
  people_ahead: number;
  status: QueueEntry['status'];

  /** Minutes until this token is expected to be called, or null if unknown. */
  eta_mins: number | null;
  eta_low_mins: number | null;
  eta_high_mins: number | null;

  /** Clock time the student should start walking over, or null. */
  leave_by: string | null;
  leave_by_mins: number | null;

  checked_in_at_counter: boolean;
  grace_period_expires_at: string | null;
  grace_mins_remaining: number | null;

  created_at: string;
  called_at: string | null;
  service_started_at: string | null;
  service_ended_at: string | null;

  /** Whether the queue still accepts this token. */
  actionable: boolean;
  /** Seconds since the record last changed, for the staleness indicator. */
  stale_after_secs: number;
}

const PHASE_LABELS: Record<TokenPhase, string> = {
  waiting: 'Waiting in line',
  approaching: 'Your turn is close',
  called: 'Called to the counter',
  check_in_required: 'Check in now',
  checked_in: 'Checked in',
  serving: 'Being served',
  completed: 'Completed',
  cancelled: 'Cancelled',
  expired: 'Expired',
  no_show: 'Marked as a no-show',
  skipped: 'Skipped',
  transferred: 'Moved to another service'
};

function clockFromNow(minutes: number, now: Date): string {
  const total = (now.getHours() * 60 + now.getMinutes() + Math.max(0, Math.round(minutes))) % (24 * 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export interface BuildTokenInput {
  entry: QueueEntry;
  /** Live number of people still ahead in the queue. */
  peopleAhead: number;
  /** Average observed service duration at this service, in minutes. */
  avgServiceMins: number;
  /** The student's own id, to decide whether a seat is theirs. */
  now?: Date;
  buildingName?: string;
  location?: string;
}

export function buildTokenView(input: BuildTokenInput): TokenView {
  const now = input.now ?? new Date();
  const { entry, peopleAhead } = input;

  const phase = resolvePhase(entry, peopleAhead, now);
  const avg = Math.max(1, input.avgServiceMins);

  // Service-rate estimate: how long until this position is served. Served by
  // the number of people ahead and the observed pace, not by a fixed number.
  const eta = entry.status === 'called' || entry.status === 'in_service' ? 0 : (peopleAhead * avg) / Math.max(1, 1);
  const low = Math.max(0, Math.round(eta * 0.8));
  const high = Math.max(low, Math.round(eta * 1.25));

  const graceRemaining = entry.grace_period_expires_at
    ? Math.max(0, Math.round((new Date(entry.grace_period_expires_at).getTime() - now.getTime()) / 60000))
    : null;

  // "Leave by" is only meaningful while the student is still waiting; once
  // called, they are already at the counter.
  const leaveByMins =
    phase === 'waiting' || phase === 'approaching' ? Math.max(0, low - DEPART_SOON_MINUTES) : null;

  return {
    token: entry.ticket_number,
    entry_id: entry.id,
    service_id: entry.service_id,
    service_name: entry.service_name,
    building_name: input.buildingName,
    location: input.location,
    phase,
    phase_label: PHASE_LABELS[phase],
    position: entry.position,
    people_ahead: peopleAhead,
    status: entry.status,
    eta_mins: eta > 0 || phase !== 'completed' ? Math.round(eta) : null,
    eta_low_mins: eta > 0 ? low : null,
    eta_high_mins: eta > 0 ? high : null,
    leave_by: leaveByMins === null ? null : clockFromNow(leaveByMins, now),
    leave_by_mins: leaveByMins,
    checked_in_at_counter: entry.checked_in_at_counter,
    grace_period_expires_at: entry.grace_period_expires_at ?? null,
    grace_mins_remaining: graceRemaining,
    created_at: entry.queue_join_time,
    called_at: entry.called_time ?? null,
    service_started_at: entry.service_start_time ?? null,
    service_ended_at: entry.service_end_time ?? null,
    actionable: !['completed', 'cancelled', 'expired', 'no_show', 'skipped'].includes(entry.status),
    stale_after_secs: 30
  };
}

function resolvePhase(entry: QueueEntry, peopleAhead: number, now: Date): TokenPhase {
  switch (entry.status) {
    case 'completed':
      return 'completed';
    case 'cancelled':
      return 'cancelled';
    case 'no_show':
      return 'no_show';
    case 'skipped':
      return 'skipped';
    case 'in_service':
      return 'serving';
    case 'called': {
      // Called but not yet physically present, and the grace window is closing.
      const grace = entry.grace_period_expires_at
        ? new Date(entry.grace_period_expires_at).getTime() - now.getTime()
        : null;
      if (entry.checked_in_at_counter) return 'checked_in';
      if (grace !== null && grace <= DEPART_SOON_MINUTES * 60000) return 'check_in_required';
      return 'called';
    }
    case 'waiting':
    default:
      return peopleAhead <= APPROACHING_THRESHOLD ? 'approaching' : 'waiting';
  }
}

/** Counts the people still ahead of an entry in the live queue. */
export function countPeopleAhead(entries: QueueEntry[], entry: QueueEntry): number {
  return entries.filter(
    e =>
      e.service_id === entry.service_id &&
      e.status === 'waiting' &&
      new Date(e.queue_join_time).getTime() < new Date(entry.queue_join_time).getTime()
  ).length;
}

// ------------------------------------------------------------------ seats

export interface SeatReservationView {
  reservation_id: string;
  seat_label: string | null;
  zone_name: string | null;
  floor: string | null;
  service_name: string | null;
  date: string;
  start_time: string;
  end_time: string;
  status: SeatReservation['status'];
  /** True only when the check-in window is open or imminent. */
  check_in_required: boolean;
  check_in_deadline: string;
  check_in_mins_remaining: number | null;
  /** Minutes until the booking starts, or null when it cannot be determined. */
  starts_in_mins?: number | null;
  actionable: boolean;
}

export function buildSeatReservationView(
  reservation: SeatReservation,
  meta: {
    seat_label?: string | null;
    zone_name?: string | null;
    floor?: string | null;
    service_name?: string | null;
    /** Campus timezone, so the booking start is judged in campus local time. */
    timeZone?: string;
  },
  now = new Date()
): SeatReservationView {
  const deadlineMs = new Date(reservation.check_in_deadline).getTime();
  const remaining = Math.max(0, Math.round((deadlineMs - now.getTime()) / 60000));
  const startsAt = campusTimeToUtc(reservation.date, reservation.start_time, meta.timeZone ?? 'America/New_York');

  // A countdown of "check in within 1700 minutes" is noise. The prompt only
  // becomes actionable shortly before the booking window opens.
  const minutesUntilStart = Number.isNaN(startsAt) ? Number.POSITIVE_INFINITY : Math.round((startsAt - now.getTime()) / 60000);
  const isActive = ['held', 'reserved'].includes(reservation.status);
  const nearStart = minutesUntilStart <= CHECK_IN_PROMPT_LEAD_MINUTES;
  const needsCheckIn = isActive && nearStart && remaining > 0;

  return {
    reservation_id: reservation.id,
    seat_label: meta.seat_label ?? null,
    zone_name: meta.zone_name ?? null,
    floor: meta.floor ?? null,
    service_name: meta.service_name ?? null,
    date: reservation.date,
    start_time: reservation.start_time,
    end_time: reservation.end_time,
    status: reservation.status,
    check_in_required: needsCheckIn,
    check_in_deadline: reservation.check_in_deadline,
    check_in_mins_remaining: needsCheckIn ? remaining : null,
    /** Minutes until the booking begins; negative once it has started. */
    starts_in_mins: Number.isFinite(minutesUntilStart) ? minutesUntilStart : null,
    actionable: !['cancelled', 'expired', 'no_show', 'completed'].includes(reservation.status)
  };
}

/** How long before a booking the check-in prompt becomes relevant. */
export const CHECK_IN_PROMPT_LEAD_MINUTES = 30;
