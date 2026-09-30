import { Router, type Request } from 'express';
import { db, subscribeSSE } from './db.js';
import { geminiRouter } from './gemini.js';
import { intelligenceRouter } from './intelligence-api.js';
import { trafficIntelligence } from './intelligence/index.js';
import {
  SESSION_COOKIE,
  attachUser,
  authenticate,
  clearSessionCookie,
  createSession,
  csrfGuard,
  csrfTokenFor,
  demoAuthEnabled,
  destroySession,
  revokeAllSessionsFor,
  hashPassword,
  parseCookies,
  requireAuth,
  requireRole,
  requireSelfOrRole,
  setSessionCookie,
  type AuthenticatedRequest
} from './auth.js';
import {
  DEFAULT_SEAT_MINUTES,
  addMinutesToClock,
  allocateSeat,
  buildSeatViews,
  cancelReservation,
  checkInReservation,
  minutesOfDay,
  summariseSeating
} from './intelligence/seating.js';
import { buildSeatReservationView, buildTokenView, countPeopleAhead } from './intelligence/token.js';

export const apiRouter = Router();

// Every request is resolved against the session cookie first. Routes decide
// whether an anonymous caller is acceptable.
apiRouter.use(attachUser);

// State-changing requests must prove same-origin intent before any handler runs.
apiRouter.use(csrfGuard);

// Mount Gemini AI & Veo Video Router
apiRouter.use(geminiRouter);

// Mount Smart Traffic Intelligence Router (peak prediction + smart alternatives)
apiRouter.use('/intelligence', intelligenceRouter);

// Prepare the verified catalogue, the demand history and the first prediction
// run before any traffic request is served.
trafficIntelligence.bootstrap();

// ---------------------------------------------------------------- auth

/** Simple fixed-window limiter, used to blunt credential stuffing. */
const loginAttempts = new Map<string, { count: number; first_at: number }>();
const LOGIN_WINDOW_MS = 10 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 10;

function clientKey(req: Request): string {
  const ip =
    (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ||
    req.socket?.remoteAddress ||
    'unknown';
  return ip;
}

function isRateLimited(key: string): boolean {
  const now = Date.now();
  const entry = loginAttempts.get(key);
  if (!entry || now - entry.first_at > LOGIN_WINDOW_MS) {
    loginAttempts.set(key, { count: 1, first_at: now });
    return false;
  }
  entry.count += 1;
  return entry.count > LOGIN_MAX_ATTEMPTS;
}

function clearRateLimit(key: string): void {
  loginAttempts.delete(key);
}

/** Demo accounts shown on the sign-in screen so the platform can be tried. */
apiRouter.get('/auth/demo-accounts', (_req, res) => {
  if (!demoAuthEnabled()) {
    res.json({ success: true, demo_accounts: [] });
    return;
  }
  res.json({
    success: true,
    demo_accounts: [
      { email: 'alex.rivera@metrouni.edu', password: 'student123', role: 'student', name: 'Alex Rivera' },
      { email: 'sarah.chen@metrouni.edu', password: 'staff123', role: 'staff', name: 'Sarah Chen' },
      { email: 'm.vance@metrouni.edu', password: 'admin123', role: 'admin', name: 'Dr. Marcus Vance' }
    ]
  });
});

apiRouter.post('/auth/login', (req, res) => {
  const { email, password } = req.body ?? {};
  const key = clientKey(req);

  if (isRateLimited(key)) {
    res.status(429).json({
      success: false,
      error: 'Too many sign-in attempts. Please wait a few minutes and try again.'
    });
    return;
  }

  if (typeof email !== 'string' || typeof password !== 'string' || !email || !password) {
    res.status(400).json({ success: false, error: 'Email and password are required.' });
    return;
  }

  const user = authenticate(email, password);
  if (!user) {
    db.recordAudit({
      actor_id: 'anonymous',
      actor_name: String(email).slice(0, 120),
      actor_role: 'student',
      action: 'LOGIN_FAILED',
      details: `Failed sign-in attempt for ${String(email).slice(0, 120)}.`
    });
    res.status(401).json({ success: false, error: 'Incorrect email or password.' });
    return;
  }

  clearRateLimit(key);
  const session = createSession(user.id);
  setSessionCookie(res, session.token);
  db.recordAudit({
    actor_id: user.id,
    actor_name: user.name,
    actor_role: user.role,
    action: 'LOGIN',
    details: `${user.name} signed in.`
  });

  res.json({ success: true, user });
});

apiRouter.post('/auth/logout', (req, res) => {
  const authed = req as AuthenticatedRequest;
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (token) destroySession(token);
  // The cookie is cleared client-side; the audit entry records the event.
  if (authed.user) {
    db.recordAudit({
      actor_id: authed.user.id,
      actor_name: authed.user.name,
      actor_role: authed.user.role,
      action: 'LOGOUT',
      details: `${authed.user.name} signed out.`
    });
  }
  clearSessionCookie(res);
  res.json({ success: true, cleared_session: true });
});

/** Who am I? Drives the client boot sequence. */
apiRouter.get('/auth/session', (req, res) => {
  const authed = req as AuthenticatedRequest;
  if (!authed.user || !authed.session) {
    res.status(401).json({ success: false, error: 'Not signed in.', user: null });
    return;
  }
  // The client echoes this token on writes, which is what proves the request
  // came from this app and not from a third-party page.
  res.json({
    success: true,
    user: authed.user,
    csrf_token: csrfTokenFor(authed.session.token)
  });
});

/** Sign out everywhere: invalidates every session already issued. */
apiRouter.post('/auth/revoke-all', requireAuth, (req, res) => {
  const actor = (req as AuthenticatedRequest).user!;
  revokeAllSessionsFor(actor.id);
  clearSessionCookie(res);
  db.recordAudit({
    actor_id: actor.id,
    actor_name: actor.name,
    actor_role: actor.role,
    action: 'REVOKE_ALL_SESSIONS',
    details: `${actor.name} signed out of all devices.`
  });
  res.json({ success: true, revoked: true });
});

// Server-Sent Events Realtime Endpoint
apiRouter.get('/realtime', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*'
  });

  const clientId = `client-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
  res.write(`event: CONNECTED\ndata: ${JSON.stringify({ clientId, timestamp: new Date().toISOString() })}\n\n`);

  subscribeSSE(clientId, res);
  // Comment frames keep intermediaries from closing an idle stream.
  const keepAlive = setInterval(() => {
    try {
      res.write(': keep-alive\n\n');
    } catch {
      clearInterval(keepAlive);
    }
  }, 20000);
  res.on('close', () => clearInterval(keepAlive));
});

// CAMPUS & BUILDINGS
apiRouter.get('/campuses', (req, res) => {
  res.json({ success: true, campuses: db.getCampuses() });
});

apiRouter.get('/buildings', (req, res) => {
  res.json({ success: true, buildings: db.getBuildings() });
});

// SERVICES
apiRouter.get('/services', (req, res) => {
  const category = req.query.category as string | undefined;
  const services = db.getServices(category);
  res.json({ success: true, services });
});

apiRouter.get('/services/:id', (req, res) => {
  const service = db.getServiceById(req.params.id);
  if (!service) {
    return res.status(404).json({ success: false, error: 'Service not found.' });
  }
  res.json({ success: true, service });
});

apiRouter.get('/services/:id/counters', (req, res) => {
  const counters = db.getCountersByServiceId(req.params.id);
  res.json({ success: true, counters });
});

apiRouter.get('/services/:id/why-long', (req, res) => {
  const why = db.getWhyQueueIsLong(req.params.id);
  if (!why) {
    return res.status(404).json({ success: false, error: 'Service not found.' });
  }
  res.json({ success: true, analysis: why });
});

apiRouter.get('/services/:id/best-time', (req, res) => {
  const bestTime = db.getBestTimeToVisit(req.params.id);
  if (!bestTime) {
    return res.status(404).json({ success: false, error: 'Service not found.' });
  }
  res.json({ success: true, best_time: bestTime });
});

apiRouter.get('/services/:id/alternatives', (req, res) => {
  const alts = db.getAlternatives(req.params.id);
  res.json({ success: true, alternatives: alts });
});

apiRouter.patch('/services/:id', requireRole('admin'), (req, res) => {
  const updated = db.updateService(req.params.id, req.body);
  if (!updated) {
    return res.status(404).json({ success: false, error: 'Service not found.' });
  }
  const actor = (req as AuthenticatedRequest).user!;
  db.recordAudit({
    actor_id: actor.id,
    actor_name: actor.name,
    actor_role: actor.role,
    action: 'UPDATE_SERVICE',
    details: `Administrator updated ${updated.name}.`,
    service_id: updated.id
  });
  res.json({ success: true, service: updated });
});

// QUEUE OPERATIONS
apiRouter.get('/queue', requireAuth, (req, res) => {
  const serviceId = req.query.service_id as string | undefined;
  const status = req.query.status as string | undefined;
  const viewer = (req as AuthenticatedRequest).user;
  const entries = db.getQueueEntriesForViewer(serviceId, status, viewer);
  res.json({ success: true, entries });
});

/** The signed-in caller's own queue entries. */
apiRouter.get('/queue/user/me', (req, res) => {
  const viewer = (req as AuthenticatedRequest).user;
  if (!viewer) {
    return res.status(401).json({ success: false, error: 'Authentication required. Please sign in.' });
  }
  res.json({ success: true, entries: db.getUserQueueEntries(viewer.id) });
});

// Kept for compatibility, but a student may only ever read their own record.
apiRouter.get('/queue/user/:userId', requireSelfOrRole(req => req.params.userId, 'staff', 'admin'), (req, res) => {
  res.json({ success: true, entries: db.getUserQueueEntries(req.params.userId) });
});

apiRouter.post('/queue/call-next', requireRole('staff', 'admin'), (req, res) => {
  const { service_id, counter_id, counter_number } = req.body ?? {};
  const actor = (req as AuthenticatedRequest).user!;
  if (!service_id || !counter_number) {
    return res.status(400).json({ success: false, error: 'Missing required staff/counter parameters.' });
  }

  const result = db.callNextStudent({
    service_id,
    counter_id,
    counter_number: parseInt(counter_number, 10),
    staff_id: actor.id,
    staff_name: actor.name
  });

  if (!result.success) {
    return res.status(400).json(result);
  }
  trafficIntelligence.sampleLiveDemand(service_id);
  res.json(result);
});

/** A student may only start/complete/skip their own ticket; staff may act on any. */
const queueEntryOwner = (req: Request) => db.getQueueEntryById(req.params.id)?.user_id;

apiRouter.post('/queue/:id/start', requireSelfOrRole(queueEntryOwner, 'staff', 'admin'), (req, res) => {
  const actor = (req as AuthenticatedRequest).user!;
  const result = db.startService(req.params.id, actor.name);
  if (!result.success) {
    return res.status(400).json(result);
  }
  res.json(result);
});

apiRouter.post('/queue/:id/complete', requireSelfOrRole(queueEntryOwner, 'staff', 'admin'), (req, res) => {
  const actor = (req as AuthenticatedRequest).user!;
  const result = db.completeService(req.params.id, actor.name);
  if (!result.success) {
    return res.status(400).json(result);
  }
  // Close the Smart Traffic loop: record what the redirect actually saved.
  trafficIntelligence.sampleLiveDemand(result.entry?.service_id ?? '');
  trafficIntelligence.finalizeRedirect(req.params.id);
  res.json(result);
});

/**
 * Gives a called student extra time when they could not have known they were
 * called (offline device, failed notification). Extends once, records no
 * penalty, and tells the student. Staff-initiated because staff can see the
 * student is not at the counter.
 */
apiRouter.post('/queue/:id/extend-grace', requireRole('staff', 'admin'), (req, res) => {
  const minutes = Number.isFinite(Number(req.body?.minutes)) ? Number(req.body.minutes) : 5;
  const result = db.extendGraceForMissedTurn(req.params.id, Math.min(30, Math.max(1, minutes)));
  if (!result.success) {
    return res.status(400).json({ success: false, error: result.error });
  }
  res.json({ success: true, entry: result.entry });
});

apiRouter.post('/queue/:id/skip', requireRole('staff', 'admin'), (req, res) => {
  const { reason } = req.body ?? {};
  const actor = (req as AuthenticatedRequest).user!;
  const result = db.skipStudent(req.params.id, reason === 'no_show' ? 'no_show' : 'skipped', actor.name);
  if (!result.success) {
    return res.status(400).json(result);
  }
  res.json(result);
});

apiRouter.post('/queue/:id/cancel', requireSelfOrRole(queueEntryOwner, 'staff', 'admin'), (req, res) => {
  const actor = (req as AuthenticatedRequest).user!;
  const result = db.cancelQueue(req.params.id, actor.name);
  if (!result.success) {
    return res.status(400).json(result);
  }
  res.json(result);
});

apiRouter.post('/queue/:id/check-in', requireSelfOrRole(queueEntryOwner, 'staff', 'admin'), (req, res) => {
  const result = db.checkInAtCounter(req.params.id);
  if (!result.success) {
    return res.status(400).json(result);
  }
  res.json(result);
});

// ---------------------------------------------------------------- TOKENS
// A token is a real queue entry. Position, ETA and state are always read back
// from the stored record, never computed in the browser.

apiRouter.get('/queue/my-token', requireAuth, (req, res) => {
  const actor = (req as AuthenticatedRequest).user!;
  const live = db.getQueueEntries();
  const mine = live
    .filter(e => e.user_id === actor.id && ['waiting', 'called', 'in_service'].includes(e.status))
    .sort((a, b) => new Date(a.queue_join_time).getTime() - new Date(b.queue_join_time).getTime());

  const serviceId = (req.query.service_id as string) || mine[0]?.service_id;
  if (!serviceId) {
    res.json({ success: true, tokens: [] });
    return;
  }

  const service = db.getServiceById(serviceId);
  const queue = live.filter(e => e.service_id === serviceId);

  const tokens = mine
    .filter(e => e.service_id === serviceId)
    .map(entry =>
      buildTokenView({
        entry,
        peopleAhead: countPeopleAhead(queue, entry),
        avgServiceMins: service?.avg_service_duration_mins ?? 5,
        buildingName: service?.building_name,
        location: service?.room_counter
      })
    );

  res.json({ success: true, tokens });
});

/**
 * Idempotency guard for queue joins.
 *
 * Only engaged when the client supplies a key, which is how a genuine retry
 * (double click, offline replay) is told apart from a fresh intent. Without a
 * key the server's own "you already hold a ticket" rule is the authority, so
 * re-joining after finishing a visit still works.
 */
const joinIdempotency = new Map<string, { status: number; body: any; at: number }>();
const JOIN_IDEMPOTENCY_TTL_MS = 10 * 60 * 1000;

function pruneIdempotency(store: Map<string, { at: number }>): void {
  const cutoff = Date.now() - JOIN_IDEMPOTENCY_TTL_MS;
  for (const [key, value] of store) {
    if (value.at < cutoff) store.delete(key);
  }
}

apiRouter.post('/queue/join', requireAuth, (req, res) => {
  const { service_id, check_in_type, recommendation_id, redirected_from_service_id } = req.body ?? {};
  const actor = (req as AuthenticatedRequest).user!;

  if (!service_id) {
    return res.status(400).json({ success: false, error: 'service_id is required.' });
  }

  const providedKey = typeof req.body?.idempotency_key === 'string' ? req.body.idempotency_key : undefined;
  const key = providedKey ? `${actor.id}:${service_id}:${providedKey}` : null;
  if (key) {
    pruneIdempotency(joinIdempotency);
    const cached = joinIdempotency.get(key);
    if (cached) {
      return res.status(cached.status).json({ ...cached.body, idempotent_replay: true });
    }
  }

  const result = db.joinQueue({
    service_id,
    // Identity always comes from the verified session, never the request body.
    user_id: actor.id,
    student_name: actor.name,
    student_id_code: actor.id_code,
    check_in_type: check_in_type || 'remote',
    recommendation_id: recommendation_id || undefined,
    redirected_from_service_id: redirected_from_service_id || undefined
  });

  if (!result.success) {
    if (key) joinIdempotency.set(key, { status: 400, body: result, at: Date.now() });
    return res.status(400).json(result);
  }

  const service = db.getServiceById(service_id);
  const queue = db.getQueueEntries(service_id);
  const token = buildTokenView({
    entry: result.entry!,
    peopleAhead: countPeopleAhead(queue, result.entry!),
    avgServiceMins: service?.avg_service_duration_mins ?? 5,
    buildingName: service?.building_name,
    location: service?.room_counter
  });

  const payload = { ...result, token_view: token };
  if (key) joinIdempotency.set(key, { status: 201, body: payload, at: Date.now() });
  res.status(201).json(payload);
});

// ---------------------------------------------------------------- SEATING
// Seating is server-authoritative: availability is read from stored
// reservations and every allocation is written here, never in the browser.

/** Resolves a requested window, defaulting to the next sensible slot. */
function resolveWindow(req: Request) {
  const service = req.params.id;
  const now = new Date();
  const date = (req.query.date as string) || now.toISOString().slice(0, 10);
  const start = (req.query.start_time as string) || `${String(now.getHours()).padStart(2, '0')}:00`;
  const end =
    (req.query.end_time as string) ||
    addMinutesToClock(start, DEFAULT_SEAT_MINUTES);
  return { date, start, end };
}

function isOutsideOpeningHours(service: { operating_hours: { open: string; close: string } }, start: string, end: string) {
  const startM = minutesOfDay(start);
  const endM = minutesOfDay(end);
  return startM < minutesOfDay(service.operating_hours.open) || endM > minutesOfDay(service.operating_hours.close);
}

apiRouter.get('/services/:id/seating', (req, res) => {
  const service = db.getServiceById(req.params.id);
  if (!service) {
    return res.status(404).json({ success: false, error: 'Service not found.' });
  }

  const zones = db.getSeatZones(service.id);
  const seats = db.getSeats(service.id);
  if (seats.length === 0) {
    return res.status(404).json({
      success: false,
      error: `${service.name} does not offer managed seating.`,
      code: 'no_seating'
    });
  }

  // Release any abandoned holds before reporting availability.
  db.sweepSeatReservations();

  const { date, start, end } = resolveWindow(req);
  const viewer = (req as AuthenticatedRequest).user;
  const views = buildSeatViews({
    seats,
    zones,
    reservations: db.getSeatReservations(service.id),
    serviceId: service.id,
    date,
    startTime: start,
    endTime: end,
    viewerId: viewer?.id
  });

  const summary = summariseSeating({
    seats,
    zones,
    views,
    serviceId: service.id,
    serviceName: service.name,
    date,
    startTime: start,
    endTime: end,
    outsideOpeningHours: isOutsideOpeningHours(service, start, end)
  });

  res.json({ success: true, seating: summary, seats: views });
});

apiRouter.post('/services/:id/seats/:seatId/reserve', requireAuth, (req, res) => {
  const actor = (req as AuthenticatedRequest).user!;
  const service = db.getServiceById(req.params.id);
  if (!service) {
    return res.status(404).json({ success: false, error: 'Service not found.' });
  }

  const seat = db.getSeatById(req.params.seatId);
  if (!seat || seat.service_id !== service.id) {
    return res.status(404).json({ success: false, error: 'Seat not found at this location.' });
  }

  const { start_time, end_time, date } = req.body ?? {};
  if (typeof start_time !== 'string' || typeof end_time !== 'string') {
    return res.status(400).json({ success: false, error: 'start_time and end_time are required (HH:mm).' });
  }
  if (minutesOfDay(end_time) <= minutesOfDay(start_time)) {
    return res.status(400).json({ success: false, error: 'The end time must be after the start time.' });
  }
  if (isOutsideOpeningHours(service, start_time, end_time)) {
    return res.status(400).json({
      success: false,
      error: `${service.name} seating is only available between ${service.operating_hours.open} and ${service.operating_hours.close}.`
    });
  }

  db.sweepSeatReservations();

  // The availability check and the write are performed together, so two
  // simultaneous requests for the same seat cannot both succeed.
  const result = allocateSeat({
    reservations: db.getSeatReservations(service.id),
    seat,
    serviceId: service.id,
    userId: actor.id,
    date: typeof date === 'string' ? date : new Date().toISOString().slice(0, 10),
    startTime: start_time,
    endTime: end_time,
    timeZone: db.campusTimezone()
  });

  if (!result.success) {
    const status = result.error_code === 'already_held' ? 409 : 409;
    return res.status(status).json({ success: false, error: result.error, code: result.error_code });
  }

  db.addSeatReservation(result.reservation!, actor);
  res.status(201).json({ success: true, reservation: result.reservation });
});

apiRouter.post('/seats/reservations/:reservationId/check-in', requireSelfOrRole(
  req => db.getSeatReservationById(req.params.reservationId)?.user_id,
  'staff',
  'admin'
), (req, res) => {
  db.sweepSeatReservations();
  const reservation = db.getSeatReservationById(req.params.reservationId);
  const actor = (req as AuthenticatedRequest).user!;
  const result = checkInReservation(reservation);
  if (!result.success) {
    return res.status(400).json({ success: false, error: result.error });
  }
  db.applySeatReservationUpdate(result.reservation!, 'SEAT_CHECK_IN', actor);
  res.json({ success: true, reservation: result.reservation });
});

apiRouter.post('/seats/reservations/:reservationId/cancel', requireSelfOrRole(
  req => db.getSeatReservationById(req.params.reservationId)?.user_id,
  'staff',
  'admin'
), (req, res) => {
  const reservation = db.getSeatReservationById(req.params.reservationId);
  const actor = (req as AuthenticatedRequest).user!;
  const result = cancelReservation(reservation);
  if (!result.success) {
    return res.status(400).json({ success: false, error: result.error });
  }
  db.applySeatReservationUpdate(result.reservation!, 'SEAT_CANCEL', actor);
  res.json({ success: true, reservation: result.reservation });
});

/** Marks a finished stay so the seat returns to the pool. */
apiRouter.post('/seats/reservations/:reservationId/complete', requireSelfOrRole(
  req => db.getSeatReservationById(req.params.reservationId)?.user_id,
  'staff',
  'admin'
), (req, res) => {
  const reservation = db.getSeatReservationById(req.params.reservationId);
  const actor = (req as AuthenticatedRequest).user!;
  if (!reservation) {
    return res.status(404).json({ success: false, error: 'Reservation not found.' });
  }
  if (!['held', 'reserved', 'checked_in'].includes(reservation.status)) {
    return res.status(400).json({ success: false, error: 'This reservation is no longer active.' });
  }
  reservation.status = 'completed';
  reservation.released_at = new Date().toISOString();
  db.applySeatReservationUpdate(reservation, 'SEAT_COMPLETE', actor);
  res.json({ success: true, reservation });
});

apiRouter.get('/seats/mine', requireAuth, (req, res) => {
  const actor = (req as AuthenticatedRequest).user!;
  db.sweepSeatReservations();
  const mine = db.getSeatReservations().filter(r => r.user_id === actor.id);
  res.json({
    success: true,
    reservations: mine.map(r => {
      const seat = db.getSeatById(r.seat_id);
      const zone = seat ? db.getSeatZones(seat.service_id).find(z => z.id === seat.zone_id) : undefined;
      const service = seat ? db.getServiceById(seat.service_id) : undefined;
      return buildSeatReservationView(r, {
        seat_label: seat?.label ?? null,
        zone_name: zone?.name ?? null,
        floor: zone?.floor ?? null,
        service_name: service?.name ?? null,
        timeZone: db.campusTimezone()
      });
    })
  });
});

// CAPACITY & INCIDENTS
apiRouter.post('/services/:id/capacity', requireRole('staff', 'admin'), (req, res) => {
  const { active_counters, active_servers, reason } = req.body ?? {};
  const actor = (req as AuthenticatedRequest).user!;
  if (active_counters === undefined || active_servers === undefined) {
    return res.status(400).json({ success: false, error: 'active_counters and active_servers are required.' });
  }
  const updated = db.updateCapacity({
    service_id: req.params.id,
    active_counters: parseInt(active_counters, 10),
    active_servers: parseInt(active_servers, 10),
    staff_name: actor.name,
    reason
  });
  if (!updated) {
    return res.status(404).json({ success: false, error: 'Service not found.' });
  }
  trafficIntelligence.sampleLiveDemand(req.params.id);
  res.json({ success: true, service: updated });
});

apiRouter.post('/services/:id/incidents', requireRole('staff', 'admin'), (req, res) => {
  const { reason, notes } = req.body ?? {};
  const actor = (req as AuthenticatedRequest).user!;
  if (!reason || !notes) {
    return res.status(400).json({ success: false, error: 'Reason and notes are required.' });
  }
  const incident = db.recordIncident({
    service_id: req.params.id,
    reason,
    notes,
    reported_by: `${actor.name} (${actor.role})`
  });
  if (!incident) {
    return res.status(404).json({ success: false, error: 'Service not found.' });
  }
  trafficIntelligence.sampleLiveDemand(req.params.id);
  res.status(201).json({ success: true, incident });
});

apiRouter.post('/incidents/:id/resolve', requireRole('staff', 'admin'), (req, res) => {
  const actor = (req as AuthenticatedRequest).user!;
  const inc = db.resolveIncident(req.params.id, actor.name);
  if (!inc) {
    return res.status(404).json({ success: false, error: 'Incident not found.' });
  }
  res.json({ success: true, incident: inc });
});

// APPOINTMENTS
apiRouter.get('/appointments', requireAuth, (req, res) => {
  const serviceId = req.query.service_id as string | undefined;
  const requestedUserId = req.query.user_id as string | undefined;
  const viewer = (req as AuthenticatedRequest).user!;

  // Students are always scoped to themselves; staff/admin may query anyone.
  const userId = viewer.role === 'student' ? viewer.id : requestedUserId;
  const appointments = db.getAppointments(userId, serviceId);
  res.json({ success: true, appointments });
});

apiRouter.post('/appointments/book', requireAuth, (req, res) => {
  const { service_id, date, slot_time, duration_mins, service_purpose } = req.body ?? {};
  const actor = (req as AuthenticatedRequest).user!;
  if (!service_id || !date || !slot_time) {
    return res.status(400).json({ success: false, error: 'service_id, date and slot_time are required.' });
  }

  const result = db.bookAppointment({
    service_id,
    // Identity comes from the session, never the body.
    user_id: actor.id,
    student_name: actor.name,
    student_id_code: actor.id_code,
    date,
    slot_time,
    duration_mins: duration_mins || 15,
    service_purpose: service_purpose || 'General Academic Inquiries'
  });

  if (!result.success) {
    return res.status(409).json(result);
  }
  res.status(201).json(result);
});

apiRouter.post('/appointments/:id/cancel', requireSelfOrRole(req => db.getAppointmentById(req.params.id)?.user_id, 'staff', 'admin'), (req, res) => {
  const actor = (req as AuthenticatedRequest).user!;
  const apt = db.cancelAppointment(req.params.id, actor.name);
  if (!apt) {
    return res.status(404).json({ success: false, error: 'Appointment not found.' });
  }
  res.json({ success: true, appointment: apt });
});

// NOTIFICATIONS
apiRouter.get('/notifications/me', (req, res) => {
  const viewer = (req as AuthenticatedRequest).user;
  if (!viewer) {
    return res.status(401).json({ success: false, error: 'Authentication required. Please sign in.' });
  }
  res.json({ success: true, notifications: db.getNotifications(viewer.id) });
});

apiRouter.get('/notifications/:userId', requireSelfOrRole(req => req.params.userId, 'staff', 'admin'), (req, res) => {
  res.json({ success: true, notifications: db.getNotifications(req.params.userId) });
});

apiRouter.post('/notifications/:id/read', requireAuth, (req, res) => {
  const notif = db.getNotificationById(req.params.id);
  const actor = (req as AuthenticatedRequest).user!;
  if (!notif) {
    return res.status(404).json({ success: false, error: 'Notification not found.' });
  }
  if (notif.user_id !== actor.id && actor.role === 'student') {
    return res.status(403).json({ success: false, error: 'You can only mark your own notifications as read.' });
  }
  res.json({ success: true, notification: db.markNotificationAsRead(req.params.id) });
});

apiRouter.post('/notifications/user/me/read-all', (req, res) => {
  const viewer = (req as AuthenticatedRequest).user;
  if (!viewer) {
    return res.status(401).json({ success: false, error: 'Authentication required. Please sign in.' });
  }
  db.markAllNotificationsAsRead(viewer.id);
  res.json({ success: true });
});

apiRouter.post('/notifications/user/:userId/read-all', requireSelfOrRole(req => req.params.userId, 'staff', 'admin'), (req, res) => {
  db.markAllNotificationsAsRead(req.params.userId);
  res.json({ success: true });
});

// ANNOUNCEMENTS
apiRouter.get('/announcements', (req, res) => {
  res.json({ success: true, announcements: db.getAnnouncements() });
});

apiRouter.post('/announcements', requireRole('staff', 'admin'), (req, res) => {
  const { title, message, severity, target_service_id } = req.body ?? {};
  if (!title || !message) {
    return res.status(400).json({ success: false, error: 'Title and message are required.' });
  }
  const anc = db.createAnnouncement({
    title,
    message,
    severity: severity || 'info',
    target_service_id
  });
  res.status(201).json({ success: true, announcement: anc });
});

// OPERATIONAL ANALYTICS
apiRouter.get('/analytics', requireRole('staff', 'admin'), (req, res) => {
  const time_range = req.query.time_range as string | undefined;
  const service_id = req.query.service_id as string | undefined;
  const building_id = req.query.building_id as string | undefined;

  const data = db.getCampusAnalytics({ time_range, service_id, building_id });
  res.json({ success: true, analytics: data });
});

apiRouter.post('/analytics/simulate', requireRole('admin'), (req, res) => {
  const { service_id, added_counters, avg_service_time_mins, arrival_rate_multiplier, appointment_percentage } = req.body ?? {};
  if (!service_id) {
    return res.status(400).json({ success: false, error: 'service_id is required.' });
  }
  const result = db.simulateCapacity({
    service_id,
    added_counters: parseInt(added_counters || '0', 10),
    avg_service_time_mins: parseFloat(avg_service_time_mins || '5'),
    arrival_rate_multiplier: parseFloat(arrival_rate_multiplier || '1.0'),
    appointment_percentage: parseFloat(appointment_percentage || '0')
  });
  if (!result) {
    return res.status(404).json({ success: false, error: 'Service not found.' });
  }
  res.json({ success: true, simulation: result });
});

// AUDIT LOGS
apiRouter.get('/audit-logs', requireRole('admin'), (req, res) => {
  const logs = db.getAuditLogs(100);
  res.json({ success: true, logs });
});

// SYSTEM RESET TO PRISTINE SEED
apiRouter.post('/reset-seed', requireRole('admin'), (req, res) => {
  const actor = (req as AuthenticatedRequest).user!;
  const seed = db.resetToSeed();
  db.recordAudit({
    actor_id: actor.id,
    actor_name: actor.name,
    actor_role: actor.role,
    action: 'RESET_SEED',
    details: `${actor.name} reset the campus database to the pristine seed.`
  });
  res.json({ success: true, message: 'Campus database reset to initial seed state.', schema: seed });
});

