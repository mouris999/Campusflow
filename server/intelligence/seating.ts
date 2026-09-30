/**
 * Library seat allocation.
 *
 * Every rule here is enforced server-side against stored records. The browser
 * never decides that a seat is free, and two students can never be handed the
 * same seat for overlapping times: the "is this seat taken" check and the write
 * happen in the same synchronous turn, so a second request that arrives while
 * the first is in flight observes the first one's row.
 */

import type { Seat, SeatReservation, SeatStatus, SeatZone } from '../../src/types/index.js';

export const SEAT_CHECK_IN_MINUTES = 10;
export const DEFAULT_SEAT_MINUTES = 120;

export interface SeatView {
  seat_id: string;
  label: string;
  zone_id: string;
  zone_name: string;
  floor: string;
  zone_kind: SeatZone['kind'];
  status: SeatStatus;
  features: string[];
  /** Effective availability for the requested window. */
  availability: 'available' | 'held' | 'reserved' | 'occupied' | 'unavailable' | 'maintenance';
  /** Set when the seat is not available, for an honest UI message. */
  unavailable_reason: string | null;
  /** Present only for the viewer's own reservation. */
  your_reservation_id?: string;
}

export interface ZoneSummary {
  zone_id: string;
  name: string;
  floor: string;
  kind: SeatZone['kind'];
  total: number;
  available: number;
  reserved: number;
  maintenance: number;
}

export interface SeatingSummary {
  service_id: string;
  service_name: string;
  date: string;
  start_time: string;
  end_time: string;
  total_seats: number;
  available_seats: number;
  reserved_seats: number;
  maintenance_seats: number;
  zones: ZoneSummary[];
  /** True when the caller asked for a window and the library is closed then. */
  outside_opening_hours: boolean;
  checked_at: string;
}

// ------------------------------------------------------------- time helpers

export function minutesOfDay(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return 0;
  return h * 60 + m;
}

export function addMinutesToClock(hhmm: string, minutes: number): string {
  const total = (minutesOfDay(hhmm) + minutes) % (24 * 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function windowsOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return minutesOfDay(aStart) < minutesOfDay(bEnd) && minutesOfDay(bStart) < minutesOfDay(aEnd);
}

export function dateKey(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/**
 * Converts a campus wall-clock date + time into an absolute instant.
 *
 * Seat bookings are expressed in campus local time ("14:00"), but deadlines
 * and expiry are absolute. Parsing the wall clock with the server's own local
 * time would make expiry fire at the wrong moment on any host that is not on
 * campus time, so the campus timezone is resolved explicitly.
 */
export function campusTimeToUtc(date: string, hhmm: string, timeZone: string): number {
  const target = `${date}T${hhmm}:00`;
  // Intl gives us the zone's offset for a given instant; probe twice to settle
  // it across a DST boundary.
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });

  const offsetAt = (instant: Date) => {
    const parts = formatter.formatToParts(instant);
    const get = (type: string) => Number(parts.find(p => p.type === type)?.value ?? '0');
    const asUtc = Date.UTC(
      get('year'),
      get('month') - 1,
      get('day'),
      get('hour') % 24,
      get('minute'),
      get('second')
    );
    return asUtc - instant.getTime();
  };

  const naive = Date.parse(`${target}Z`);
  if (Number.isNaN(naive)) return NaN;

  let instant = naive - offsetAt(new Date(naive));
  instant = naive - offsetAt(new Date(instant));
  return instant;
}

// ------------------------------------------------------------------ expiry

/** Statuses that no longer hold a seat. */
const INACTIVE_STATUSES = new Set<SeatReservation['status']>([
  'cancelled',
  'expired',
  'no_show',
  'completed'
]);

export function reservationHoldsSeat(reservation: SeatReservation): boolean {
  return !INACTIVE_STATUSES.has(reservation.status);
}

/**
 * Reservations that were never checked into lose their hold once the check-in
 * deadline passes, so an abandoned hold cannot permanently consume a seat.
 * Returns the reservations that expired on this call.
 */
export function expireStaleReservations(
  reservations: SeatReservation[],
  now = new Date(),
  /** Campus timezone, so the booking window is judged in campus local time. */
  timeZone: string = 'America/New_York'
): SeatReservation[] {
  const nowMs = now.getTime();
  const expired: SeatReservation[] = [];

  for (const reservation of reservations) {
    if (reservation.status !== 'held' && reservation.status !== 'reserved') continue;
    const deadline = new Date(reservation.check_in_deadline).getTime();
    if (Number.isNaN(deadline)) continue;
    // A no-show only makes sense once the booking window has actually begun.
    const startsAt = campusTimeToUtc(reservation.date, reservation.start_time, timeZone);
    if (Number.isNaN(startsAt)) continue;
    if (nowMs > deadline && nowMs >= startsAt) {
      reservation.status = 'no_show';
      reservation.released_at = now.toISOString();
      expired.push(reservation);
    }
  }

  return expired;
}

// ------------------------------------------------------------- allocation

export interface AllocationInput {
  reservations: SeatReservation[];
  seat: Seat;
  serviceId: string;
  userId: string;
  date: string;
  startTime: string;
  endTime: string;
  now?: Date;
  /** Campus timezone used to resolve the booking window to an instant. */
  timeZone?: string;
}

export interface AllocationResult {
  success: boolean;
  reservation?: SeatReservation;
  error?: string;
  error_code?: 'seat_unavailable' | 'already_held' | 'invalid_window' | 'outside_hours';
}

export function isSeatFreeForWindow(input: {
  reservations: SeatReservation[];
  seatId: string;
  date: string;
  startTime: string;
  endTime: string;
  /** Reservations that should not count, e.g. the caller's own. */
  ignoreReservationId?: string;
}): boolean {
  return !input.reservations.some(r => {
    if (r.id === input.ignoreReservationId) return false;
    if (r.seat_id !== input.seatId) return false;
    if (r.date !== input.date) return false;
    if (!reservationHoldsSeat(r)) return false;
    return windowsOverlap(input.startTime, input.endTime, r.start_time, r.end_time);
  });
}

/**
 * Allocates one specific seat. The availability check and the row creation are
 * synchronous and adjacent, so a concurrent request for the same seat fails.
 */
export function allocateSeat(input: AllocationInput): AllocationResult {
  const now = input.now ?? new Date();

  if (minutesOfDay(input.endTime) <= minutesOfDay(input.startTime)) {
    return { success: false, error_code: 'invalid_window', error: 'The end time must be after the start time.' };
  }

  if (input.seat.status !== 'available') {
    return {
      success: false,
      error_code: 'seat_unavailable',
      error: `Seat ${input.seat.label} is ${input.seat.status === 'maintenance' ? 'under maintenance' : 'unavailable'}.`
    };
  }

  // One live hold per person per service, so a retry cannot pile up holds.
  const ownActive = input.reservations.find(
    r =>
      r.user_id === input.userId &&
      r.service_id === input.serviceId &&
      r.date === input.date &&
      ['held', 'reserved', 'checked_in'].includes(r.status)
  );
  if (ownActive) {
    return {
      success: false,
      error_code: 'already_held',
      error: 'You already hold a seat at this location for today.',
      reservation: ownActive
    };
  }

  if (
    !isSeatFreeForWindow({
      reservations: input.reservations,
      seatId: input.seat.id,
      date: input.date,
      startTime: input.startTime,
      endTime: input.endTime
    })
  ) {
    return {
      success: false,
      error_code: 'seat_unavailable',
      error: `Seat ${input.seat.label} was just taken. Please choose another seat.`
    };
  }

  const startMs = campusTimeToUtc(input.date, input.startTime, input.timeZone ?? 'America/New_York');
  if (Number.isNaN(startMs)) {
    return { success: false, error_code: 'invalid_window', error: 'The requested date or time could not be understood.' };
  }

  const reservation: SeatReservation = {
    id: `res-${now.getTime()}-${Math.random().toString(36).slice(2, 8)}`,
    seat_id: input.seat.id,
    service_id: input.serviceId,
    user_id: input.userId,
    date: input.date,
    start_time: input.startTime,
    end_time: input.endTime,
    status: 'reserved',
    created_at: now.toISOString(),
    check_in_deadline: new Date(startMs + SEAT_CHECK_IN_MINUTES * 60000).toISOString(),
    source: 'web'
  };

  return { success: true, reservation };
}

/** Marks a reservation as checked in at the library. */
export function checkInReservation(
  reservation: SeatReservation | undefined,
  now = new Date()
): { success: boolean; reservation?: SeatReservation; error?: string } {
  if (!reservation) return { success: false, error: 'Reservation not found.' };
  if (reservation.status === 'cancelled' || reservation.status === 'expired' || reservation.status === 'no_show') {
    return { success: false, error: 'This reservation is no longer active.' };
  }
  if (reservation.status === 'checked_in') {
    return { success: true, reservation };
  }
  if (new Date(reservation.check_in_deadline).getTime() < now.getTime()) {
    return { success: false, error: 'The check-in window for this seat has passed.' };
  }
  reservation.status = 'checked_in';
  reservation.checked_in_at = now.toISOString();
  return { success: true, reservation };
}

/** Releases a hold so the seat returns to the available pool immediately. */
export function cancelReservation(
  reservation: SeatReservation | undefined,
  now = new Date()
): { success: boolean; reservation?: SeatReservation; error?: string } {
  if (!reservation) return { success: false, error: 'Reservation not found.' };
  if (reservation.status === 'completed') {
    return { success: false, error: 'A completed stay cannot be cancelled.' };
  }
  reservation.status = 'cancelled';
  reservation.released_at = now.toISOString();
  return { success: true, reservation };
}

// ------------------------------------------------------------------ views

/** Builds the per-seat availability view for one service + window. */
export function buildSeatViews(params: {
  seats: Seat[];
  zones: SeatZone[];
  reservations: SeatReservation[];
  serviceId: string;
  date: string;
  startTime: string;
  endTime: string;
  viewerId?: string;
  now?: Date;
}): SeatView[] {
  const { seats, zones, reservations, serviceId, date, startTime, endTime, viewerId } = params;
  const zoneById = new Map(zones.map(z => [z.id, z]));

  return seats
    .filter(s => s.service_id === serviceId)
    .map(seat => {
      const zone = zoneById.get(seat.zone_id);
      const blocking = reservations.find(
        r =>
          r.seat_id === seat.id &&
          r.date === date &&
          reservationHoldsSeat(r) &&
          windowsOverlap(startTime, endTime, r.start_time, r.end_time)
      );
      const mine = blocking && blocking.user_id === viewerId ? blocking : undefined;

      let availability: SeatView['availability'];
      let unavailable_reason: string | null = null;

      if (seat.status === 'maintenance') {
        availability = 'maintenance';
        unavailable_reason = 'Under maintenance';
      } else if (seat.status === 'unavailable') {
        availability = 'unavailable';
        unavailable_reason = 'Not available for allocation';
      } else if (blocking) {
        availability = blocking.status === 'checked_in' ? 'occupied' : blocking.status === 'held' ? 'held' : 'reserved';
        unavailable_reason =
          blocking.status === 'checked_in'
            ? 'Occupied by another student'
            : 'Reserved for this time slot';
      } else {
        availability = 'available';
      }

      return {
        seat_id: seat.id,
        label: seat.label,
        zone_id: seat.zone_id,
        zone_name: zone?.name ?? 'Unassigned',
        floor: zone?.floor ?? '',
        zone_kind: zone?.kind ?? 'open',
        status: seat.status,
        features: seat.features,
        availability,
        unavailable_reason,
        ...(mine ? { your_reservation_id: mine.id } : {})
      };
    });
}

export function summariseSeating(params: {
  seats: Seat[];
  zones: SeatZone[];
  views: SeatView[];
  serviceId: string;
  serviceName: string;
  date: string;
  startTime: string;
  endTime: string;
  outsideOpeningHours: boolean;
  now?: Date;
}): SeatingSummary {
  const { seats, zones, views, serviceId, serviceName, date, startTime, endTime, outsideOpeningHours } = params;
  const mine = views.filter(v => v.zone_id && zones.some(z => z.id === v.zone_id));

  const zoneSummaries: ZoneSummary[] = zones
    .filter(z => z.service_id === serviceId)
    .map(zone => {
      const zoneViews = mine.filter(v => v.zone_id === zone.id);
      return {
        zone_id: zone.id,
        name: zone.name,
        floor: zone.floor,
        kind: zone.kind,
        total: zoneViews.length,
        available: zoneViews.filter(v => v.availability === 'available').length,
        reserved: zoneViews.filter(v => ['held', 'reserved', 'occupied'].includes(v.availability)).length,
        maintenance: zoneViews.filter(v => v.availability === 'maintenance' || v.availability === 'unavailable').length
      };
    });

  return {
    service_id: serviceId,
    service_name: serviceName,
    date,
    start_time: startTime,
    end_time: endTime,
    total_seats: views.length,
    available_seats: views.filter(v => v.availability === 'available').length,
    reserved_seats: views.filter(v => ['held', 'reserved', 'occupied'].includes(v.availability)).length,
    maintenance_seats: views.filter(v => v.availability === 'maintenance' || v.availability === 'unavailable').length,
    zones: zoneSummaries,
    outside_opening_hours: outsideOpeningHours,
    checked_at: (params.now ?? new Date()).toISOString()
  };
}
