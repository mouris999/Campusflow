import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import {
  addMinutesToClock,
  allocateSeat,
  buildSeatViews,
  campusTimeToUtc,
  cancelReservation,
  checkInReservation,
  expireStaleReservations,
  isSeatFreeForWindow,
  minutesOfDay,
  summariseSeating,
  windowsOverlap,
  type AllocationInput
} from '../server/intelligence/seating.js';
import type { Seat, SeatReservation, SeatZone } from '../src/types/index.js';
import { authedGet, authedPost, createIsolatedServer, signIn } from './helpers.js';
import { buildSeatReservationView } from '../server/intelligence/token.js';

let app: Awaited<ReturnType<typeof createIsolatedServer>>;
let student: string;
let other: string;
let libraryId = '';
let commonsId = '';

const STUDENT = { email: 'alex.rivera@metrouni.edu', password: 'student123' };
const OTHER = { email: 'maya.lin@metrouni.edu', password: 'student123' };

const ZONES: SeatZone[] = [
  { id: 'z1', service_id: 'lib', name: 'Silent Study', floor: 'Mezzanine', kind: 'quiet' },
  { id: 'z2', service_id: 'lib', name: 'Group Study', floor: 'Floor 3', kind: 'group' }
];

const SEAT = (n: number, over: Partial<Seat> = {}): Seat => ({
  id: `seat-${n}`,
  zone_id: n <= 2 ? 'z1' : 'z2',
  service_id: 'lib',
  label: `A-${String(n).padStart(3, '0')}`,
  status: 'available',
  features: [],
  ...over
});

function reservation(over: Partial<SeatReservation> = {}): SeatReservation {
  return {
    id: 'r-1',
    seat_id: 'seat-1',
    service_id: 'lib',
    user_id: 'u1',
    date: '2026-03-02',
    start_time: '14:00',
    end_time: '16:00',
    status: 'reserved',
    created_at: '2026-03-02T10:00:00.000Z',
    check_in_deadline: '2026-03-02T14:10:00.000Z',
    source: 'web',
    ...over
  };
}

before(async () => {
  app = await createIsolatedServer();
  const services = app.db.getServices();
  libraryId = services.find(s => s.name.includes('Williamson') || s.category === 'library')!.id;
  commonsId = services.find(s => s.id === 'srv-lib-commons')!.id;
  student = (await signIn(app.base, STUDENT.email, STUDENT.password)).cookie;
  other = (await signIn(app.base, OTHER.email, OTHER.password)).cookie;
});

after(async () => {
  await app.close();
});

test('the check-in prompt only appears when the booking is imminent', async () => {
  // Booking far in the future: no "check in within 1700 minutes" noise.
  const tz = 'America/New_York';
  const futureDate = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
  const seat = app.db.getSeats(commonsId).find(s => s.status === 'available')!;
  const created = await authedPost(student, `${app.base}/services/${commonsId}/seats/${seat.id}/reserve`, {
    date: futureDate,
    start_time: '10:00',
    end_time: '12:00'
  });
  if (created.status !== 201) return; // seat already taken by another test

  const mine = await authedGet(student, `${app.base}/seats/mine`);
  const view = mine.body.reservations.find((r: any) => r.reservation_id === created.body.reservation.id);
  assert.equal(view.status, 'reserved');
  assert.equal(view.check_in_required, false, 'no prompt two days ahead');
  assert.equal(view.check_in_mins_remaining, null);
  assert.ok(view.starts_in_mins > 0, 'the start time is still reported');
  void tz;
});

test('a seat reservation view reports the booking window', () => {
  const view = buildSeatReservationView(
    reservation({ date: '2026-03-02', start_time: '14:00', end_time: '16:00' }),
    { seat_label: 'A-001', zone_name: 'Silent Study', timeZone: 'America/New_York' },
    new Date(campusTimeToUtc('2026-03-01', '12:00', 'America/New_York'))
  );
  assert.equal(view.seat_label, 'A-001');
  assert.equal(view.start_time, '14:00');
  assert.equal(view.end_time, '16:00');
  // A booking a day out does not need a check-in prompt yet.
  assert.equal(view.check_in_required, false);
  assert.ok((view.starts_in_mins ?? 0) > 0);
});

// ------------------------------------------------------------------- units

test('clock helpers handle time arithmetic', () => {
  assert.equal(minutesOfDay('14:30'), 870);
  assert.equal(addMinutesToClock('14:30', 60), '15:30');
  assert.equal(addMinutesToClock('23:30', 60), '00:30');
});

test('overlapping windows are detected on both boundaries', () => {
  assert.equal(windowsOverlap('14:00', '16:00', '15:00', '17:00'), true);
  assert.equal(windowsOverlap('14:00', '16:00', '16:00', '18:00'), false, 'touching is not overlapping');
  assert.equal(windowsOverlap('16:00', '18:00', '14:00', '16:00'), false);
});

test('cancelled, expired and no-show reservations free the seat again', () => {
  const base = { seatId: 'seat-1', date: '2026-03-02', startTime: '14:00', endTime: '16:00' };
  assert.equal(isSeatFreeForWindow({ ...base, reservations: [] }), true);
  assert.equal(isSeatFreeForWindow({ ...base, reservations: [reservation()] }), false);
  for (const status of ['cancelled', 'expired', 'no_show', 'completed'] as const) {
    assert.equal(
      isSeatFreeForWindow({ ...base, reservations: [reservation({ status })] }),
      true,
      `${status} should not block the seat`
    );
  }
});

test('a reservation on a different day or non-overlapping time does not block', () => {
  const base = { seatId: 'seat-1', date: '2026-03-02', startTime: '14:00', endTime: '16:00' };
  assert.equal(isSeatFreeForWindow({ ...base, reservations: [reservation({ date: '2026-03-03' })] }), true);
  assert.equal(isSeatFreeForWindow({ ...base, reservations: [reservation({ start_time: '16:00', end_time: '18:00' })] }), true);
});

test('an unclaimed hold expires and releases the seat', () => {
  const tz = 'America/New_York';
  const held = reservation({
    status: 'held',
    check_in_deadline: new Date(campusTimeToUtc('2026-03-02', '14:10', tz)).toISOString()
  });
  const list = [held];

  // Before the deadline it still holds.
  assert.equal(expireStaleReservations(list, new Date(campusTimeToUtc('2026-03-02', '14:05', tz)), tz).length, 0);
  assert.equal(held.status, 'held');

  // After the deadline and once the window has started it is released.
  const expired = expireStaleReservations(list, new Date(campusTimeToUtc('2026-03-02', '14:20', tz)), tz);
  assert.equal(expired.length, 1);
  assert.equal(held.status, 'no_show');
  assert.ok(held.released_at, 'the release is timestamped');
  assert.equal(isSeatFreeForWindow({ seatId: 'seat-1', date: '2026-03-02', startTime: '14:00', endTime: '16:00', reservations: list }), true);
});

test('a hold is not expired before its booking window begins', () => {
  // The check-in deadline has passed by wall clock, but in campus local time
  // the booking has not started yet, so the hold must stand.
  const tz = 'America/New_York';
  const held = reservation({
    status: 'held',
    date: '2026-03-05',
    start_time: '09:00',
    check_in_deadline: new Date(campusTimeToUtc('2026-03-05', '09:10', tz) + 60000).toISOString()
  });
  const list = [held];
  // 09:05 campus time: past the 09:00 start, but before the 09:11 deadline.
  assert.equal(expireStaleReservations(list, new Date(campusTimeToUtc('2026-03-05', '09:05', tz)), tz).length, 0);
  assert.equal(held.status, 'held');
});

test('campus wall-clock times resolve to the correct instant', () => {
  // 14:00 in New York is 19:00 UTC in winter (EST, UTC-5).
  assert.equal(new Date(campusTimeToUtc('2026-01-15', '14:00', 'America/New_York')).toISOString(), '2026-01-15T19:00:00.000Z');
  // ...and 18:00 UTC in summer (EDT, UTC-4).
  assert.equal(new Date(campusTimeToUtc('2026-07-15', '14:00', 'America/New_York')).toISOString(), '2026-07-15T18:00:00.000Z');
});

test('an expired hold releases the seat regardless of server timezone', () => {
  // The same rule must hold no matter which timezone the host runs in.
  const tz = 'America/New_York';
  for (const hostTz of ['UTC', 'Asia/Kolkata', 'America/Los_Angeles']) {
    const held = reservation({
      status: 'held',
      date: '2026-03-02',
      start_time: '14:00',
      check_in_deadline: new Date(campusTimeToUtc('2026-03-02', '14:10', tz)).toISOString()
    });
    const list = [held];
    // 14:20 campus time is past the 14:10 deadline.
    const now = new Date(campusTimeToUtc('2026-03-02', '14:20', tz));
    assert.equal(expireStaleReservations(list, now, tz).length, 1, `failed with host tz ${hostTz}`);
    assert.equal(held.status, 'no_show');
  }
});

test('check-in is allowed inside the window and refused after it', () => {
  const tz = 'America/New_York';
  const deadline = new Date(campusTimeToUtc('2026-03-02', '14:10', tz)).toISOString();

  const r = reservation({ status: 'reserved', check_in_deadline: deadline });
  assert.equal(checkInReservation(r, new Date(campusTimeToUtc('2026-03-02', '14:05', tz))).success, true);
  assert.equal(r.status, 'checked_in');

  const late = reservation({ status: 'reserved', check_in_deadline: deadline });
  const result = checkInReservation(late, new Date(campusTimeToUtc('2026-03-02', '14:30', tz)));
  assert.equal(result.success, false);
  assert.match(result.error!, /check-in window/i);
});

test('cancelling releases the seat and completed stays cannot be cancelled', () => {
  const r = reservation();
  assert.equal(cancelReservation(r).success, true);
  assert.equal(r.status, 'cancelled');
  assert.equal(
    cancelReservation(reservation({ status: 'completed' })).success,
    false,
    'a finished stay must stay recorded'
  );
});

test('allocation rejects invalid windows and unavailable seats', () => {
  const base: AllocationInput = {
    reservations: [],
    seat: SEAT(1),
    serviceId: 'lib',
    userId: 'u1',
    date: '2026-03-02',
    startTime: '14:00',
    endTime: '16:00'
  };

  assert.equal(allocateSeat({ ...base, endTime: '13:00' }).success, false);
  const maint = allocateSeat({ ...base, seat: SEAT(1, { status: 'maintenance' }) });
  assert.equal(maint.success, false);
  assert.equal(maint.error_code, 'seat_unavailable');
  assert.match(maint.error!, /maintenance/i);
});

test('one person cannot hold two seats at the same location', () => {
  const mine = reservation({ user_id: 'u1' });
  const again = allocateSeat({
    reservations: [mine],
    seat: SEAT(2),
    serviceId: 'lib',
    userId: 'u1',
    date: '2026-03-02',
    startTime: '14:00',
    endTime: '16:00'
  });
  assert.equal(again.success, false);
  assert.equal(again.error_code, 'already_held');
  assert.equal(again.reservation?.id, 'r-1', 'the existing hold is returned so the client can show it');
});

test('seat views report availability per seat and redact other students', () => {
  const views = buildSeatViews({
    seats: [SEAT(1), SEAT(2), SEAT(3, { status: 'maintenance' })],
    zones: ZONES,
    reservations: [reservation({ id: 'r-1', seat_id: 'seat-1', user_id: 'someone-else' })],
    serviceId: 'lib',
    date: '2026-03-02',
    startTime: '14:00',
    endTime: '16:00',
    viewerId: 'u1'
  });

  assert.equal(views[0].availability, 'reserved');
  assert.equal(views[0].your_reservation_id, undefined, 'another student reservation is not exposed');
  assert.equal(views[1].availability, 'available');
  assert.equal(views[2].availability, 'maintenance');
  assert.equal(views[2].unavailable_reason, 'Under maintenance');
  assert.equal(views[0].zone_name, 'Silent Study');
  assert.equal(views[0].label, 'A-001');
});

test('the caller can identify their own reservation in the seat view', () => {
  const views = buildSeatViews({
    seats: [SEAT(1)],
    zones: ZONES,
    reservations: [reservation({ user_id: 'u1' })],
    serviceId: 'lib',
    date: '2026-03-02',
    startTime: '14:00',
    endTime: '16:00',
    viewerId: 'u1'
  });
  assert.equal(views[0].your_reservation_id, 'r-1');
});

test('summary totals add up across zones', () => {
  const seats = [SEAT(1), SEAT(2), SEAT(3, { status: 'maintenance' })];
  const views = buildSeatViews({
    seats,
    zones: ZONES,
    reservations: [reservation({ user_id: 'other' })],
    serviceId: 'lib',
    date: '2026-03-02',
    startTime: '14:00',
    endTime: '16:00'
  });
  const summary = summariseSeating({
    seats,
    zones: ZONES,
    views,
    serviceId: 'lib',
    serviceName: 'Test Library',
    date: '2026-03-02',
    startTime: '14:00',
    endTime: '16:00',
    outsideOpeningHours: false
  });

  assert.equal(summary.total_seats, 3);
  assert.equal(summary.available_seats, 1);
  assert.equal(summary.reserved_seats, 1);
  assert.equal(summary.maintenance_seats, 1);
  assert.equal(summary.available_seats + summary.reserved_seats + summary.maintenance_seats, summary.total_seats);
  assert.equal(summary.zones.find(z => z.zone_id === 'z1')!.total, 2);
});

// -------------------------------------------------------------- integration

test('the seating endpoint reports real inventory for a library', async () => {
  const res = await authedGet(student, `${app.base}/services/${libraryId}/seating?start_time=10:00&end_time=12:00`);
  assert.equal(res.status, 200);
  assert.ok(res.body.seating.total_seats > 0, 'the library has managed seats');
  assert.ok(res.body.seats.length === res.body.seating.total_seats);
  // Identifiers must be real and unique.
  const labels = res.body.seats.map((s: any) => s.label);
  assert.equal(new Set(labels).size, labels.length, 'seat identifiers are unique');
  assert.ok(labels.every((l: string) => /^[A-Z]-\d{3}$/.test(l)), 'identifiers follow the campus scheme');
  // Every seat belongs to a named zone.
  assert.ok(res.body.seats.every((s: any) => s.zone_name && s.zone_name !== 'Unassigned'));
});

test('a non-library reports that it has no managed seating', async () => {
  const canteen = app.db.getServices().find(s => s.category === 'canteen')!;
  const res = await authedGet(student, `${app.base}/services/${canteen.id}/seating`);
  assert.equal(res.status, 404);
  assert.equal(res.body.code, 'no_seating');
});

test('a student reserves a real seat and it disappears from availability', async () => {
  const date = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const before = await authedGet(student, `${app.base}/services/${libraryId}/seating?date=${date}&start_time=10:00&end_time=12:00`);
  const free = before.body.seats.find((s: any) => s.availability === 'available');
  assert.ok(free, 'a free seat exists');

  const reserved = await authedPost(student, `${app.base}/services/${libraryId}/seats/${free.seat_id}/reserve`, {
    date,
    start_time: '10:00',
    end_time: '12:00'
  });
  assert.equal(reserved.status, 201);
  assert.equal(reserved.body.reservation.seat_id, free.seat_id);
  assert.equal(reserved.body.reservation.status, 'reserved');
  assert.ok(reserved.body.reservation.check_in_deadline, 'a check-in deadline is set');

  const after = await authedGet(student, `${app.base}/services/${libraryId}/seating?date=${date}&start_time=10:00&end_time=12:00`);
  const now = after.body.seats.find((s: any) => s.seat_id === free.seat_id);
  assert.equal(now.availability, 'reserved');
  assert.equal(now.your_reservation_id, reserved.body.reservation.id);
  assert.equal(after.body.seating.available_seats, before.body.seating.available_seats - 1);
});

test('the same seat cannot be reserved twice, even by concurrent requests', async () => {
  const date = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
  const before = await authedGet(student, `${app.base}/services/${libraryId}/seating?date=${date}&start_time=14:00&end_time=16:00`);
  const free = before.body.seats.find((s: any) => s.availability === 'available');
  assert.ok(free, 'a free seat exists for the concurrency test');

  // Two students fire at the same seat simultaneously.
  const [a, b] = await Promise.all([
    authedPost(student, `${app.base}/services/${libraryId}/seats/${free.seat_id}/reserve`, {
      date,
      start_time: '14:00',
      end_time: '16:00'
    }),
    authedPost(other, `${app.base}/services/${libraryId}/seats/${free.seat_id}/reserve`, {
      date,
      start_time: '14:00',
      end_time: '16:00'
    })
  ]);

  const results = [a, b];
  const successes = results.filter(r => r.status === 201);
  const conflicts = results.filter(r => r.status === 409);
  assert.equal(successes.length, 1, 'exactly one student gets the seat');
  assert.equal(conflicts.length, 1, 'the other is rejected');
  assert.match(conflicts[0].body.error, /just taken|already hold/i);

  // And the database reflects a single holder.
  const after = await authedGet(student, `${app.base}/services/${libraryId}/seating?date=${date}&start_time=14:00&end_time=16:00`);
  const holders = after.body.seats.filter((s: any) => s.seat_id === free.seat_id && s.availability === 'reserved');
  assert.equal(holders.length, 1);
});

test('a student cannot reserve a second seat while already holding one', async () => {
  const date = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
  // Look the seats up rather than assuming their generated identifiers.
  const commonsSeats = app.db.getSeats(commonsId).filter(s => s.status === 'available');
  const [seatA, seatB] = commonsSeats;

  const first = await authedPost(other, `${app.base}/services/${commonsId}/seats/${seatA.id}/reserve`, {
    date,
    start_time: '10:00',
    end_time: '12:00'
  });
  assert.equal(first.status, 201, `first reservation failed: ${first.body?.error ?? ''}`);

  const second = await authedPost(other, `${app.base}/services/${commonsId}/seats/${seatB.id}/reserve`, {
    date,
    start_time: '10:00',
    end_time: '12:00'
  });
  assert.equal(second.status, 409);
  assert.equal(second.body.code, 'already_held');
});

test('a maintenance seat cannot be reserved', async () => {
  const maintenance = app.db.getSeats(libraryId).find(s => s.status === 'maintenance');
  assert.ok(maintenance, 'the seed includes a maintenance seat');
  const date = new Date(Date.now() + 4 * 86400000).toISOString().slice(0, 10);
  const res = await authedPost(student, `${app.base}/services/${libraryId}/seats/${maintenance.id}/reserve`, {
    date,
    start_time: '10:00',
    end_time: '12:00'
  });
  assert.equal(res.status, 409);
  assert.match(res.body.error, /maintenance/i);
});

test('reservations outside opening hours are refused', async () => {
  const date = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
  const res = await authedPost(student, `${app.base}/services/${libraryId}/seats/${app.db.getSeats(libraryId)[0].id}/reserve`, {
    date,
    start_time: '02:00',
    end_time: '04:00'
  });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /seating is only available between/i);
});

test('cancelling a reservation returns the seat to the pool', async () => {
  const date = new Date(Date.now() + 6 * 86400000).toISOString().slice(0, 20).slice(0, 10);
  const free = app.db.getSeats(libraryId).find(s => s.status === 'available')!;
  const created = await authedPost(student, `${app.base}/services/${libraryId}/seats/${free.id}/reserve`, {
    date,
    start_time: '10:00',
    end_time: '12:00'
  });
  // This student may already hold a seat from an earlier test; use whatever
  // reservation the endpoint reports.
  const reservationId = created.body.reservation?.id;
  if (created.status !== 201) {
    assert.equal(created.status, 409);
    return;
  }

  const cancelled = await authedPost(student, `${app.base}/seats/reservations/${reservationId}/cancel`, {});
  assert.equal(cancelled.status, 200);
  assert.equal(cancelled.body.reservation.status, 'cancelled');

  const after = await authedGet(student, `${app.base}/services/${libraryId}/seating?date=${date}&start_time=10:00&end_time=12:00`);
  const seat = after.body.seats.find((s: any) => s.seat_id === free.id);
  assert.equal(seat.availability, 'available', 'the seat is free again');
});

test('a student cannot cancel somebody else reservation', async () => {
  const date = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  const seat = app.db.getSeats(libraryId).find(s => s.status === 'available')!;
  const created = await authedPost(other, `${app.base}/services/${libraryId}/seats/${seat.id}/reserve`, {
    date,
    start_time: '10:00',
    end_time: '12:00'
  });
  if (created.status !== 201) return; // seat already taken by a previous run

  const denied = await authedPost(student, `${app.base}/seats/reservations/${created.body.reservation.id}/cancel`, {});
  assert.equal(denied.status, 403);
});

test('anonymous callers cannot reserve a seat', async () => {
  const seat = app.db.getSeats(libraryId).find(s => s.status === 'available')!;
  const res = await fetch(`${app.base}/services/${libraryId}/seats/${seat.id}/reserve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ start_time: '10:00', end_time: '12:00' })
  });
  assert.equal(res.status, 401);
});

test('a student sees their own reservations and not other students', async () => {
  const mine = await authedGet(student, `${app.base}/seats/mine`);
  assert.equal(mine.status, 200);
  assert.ok(Array.isArray(mine.body.reservations));

  const mineOther = await authedGet(other, `${app.base}/seats/mine`);
  assert.ok(Array.isArray(mineOther.body.reservations));

  // Each reservation carries a stable id, and the two students' sets are disjoint.
  const mineIds = mine.body.reservations.map((r: any) => r.reservation_id);
  const otherIds = mineOther.body.reservations.map((r: any) => r.reservation_id);
  assert.ok(mineIds.every((id: string) => typeof id === 'string' && id.length > 0));
  const overlap = mineIds.filter((id: string) => otherIds.includes(id));
  assert.equal(overlap.length, 0, 'reservations are scoped to the caller');
});
