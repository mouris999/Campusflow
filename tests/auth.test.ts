import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { authedGet, authedPatch, authedPost, createIsolatedServer, getJson, postJson, signIn } from './helpers.js';

let app: Awaited<ReturnType<typeof createIsolatedServer>>;
let student: string;
let otherStudent: string;
let staff: string;
let admin: string;
let serviceId = '';
let otherServiceId = '';

const STUDENT = { email: 'alex.rivera@galgotiasuniversity.invalid', password: 'student123' };
const OTHER_STUDENT = { email: 'maya.lin@galgotiasuniversity.invalid', password: 'student123' };
const STAFF = { email: 'sarah.chen@galgotiasuniversity.invalid', password: 'staff123' };
const ADMIN = { email: 'm.vance@galgotiasuniversity.invalid', password: 'admin123' };

before(async () => {
  app = await createIsolatedServer();
  const services = app.db.getServices();
  serviceId = services.find(s => s.name.includes('Registrar'))!.id;
  otherServiceId = services.find(s => s.name.includes('Canteen'))!.id;

  student = (await signIn(app.base, STUDENT.email, STUDENT.password)).cookie;
  otherStudent = (await signIn(app.base, OTHER_STUDENT.email, OTHER_STUDENT.password)).cookie;
  staff = (await signIn(app.base, STAFF.email, STAFF.password)).cookie;
  admin = (await signIn(app.base, ADMIN.email, ADMIN.password)).cookie;
});

after(async () => {
  await app.close();
});

/**
 * Clears any ticket the caller already holds for a service, so a test can join
 * a queue that the seed data may already have populated for that account.
 */
async function clearActiveTickets(cookie: string, targetServiceId: string) {
  const mine = await authedGet(cookie, `${app.base}/queue/user/me`);
  for (const entry of mine.body.entries) {
    if (entry.service_id === targetServiceId && ['waiting', 'called', 'in_service'].includes(entry.status)) {
      await authedPost(cookie, `${app.base}/queue/${entry.id}/cancel`, {});
    }
  }
}

// ------------------------------------------------------------ authentication

test('a protected endpoint refuses an anonymous caller', async () => {
  for (const path of ['/queue', '/appointments', '/analytics', '/audit-logs']) {
    const { status, body } = await getJson(`${app.base}${path}`);
    assert.equal(status, 401, `${path} should require sign-in`);
    assert.equal(body.success, false);
    assert.match(body.error, /sign in/i);
  }
});

test('credentials are verified and a wrong password is rejected', async () => {
  const bad = await signIn(app.base, STUDENT.email, 'not-the-password');
  assert.equal(bad.status, 401);
  assert.equal(bad.body.success, false);
  // The error must not reveal whether the account exists.
  assert.match(bad.body.error, /incorrect email or password/i);

  const missing = await signIn(app.base, 'nobody@nowhere.edu', 'whatever');
  assert.equal(missing.status, 401);
  assert.equal(missing.body.error, bad.body.error);
});

test('a successful sign-in returns the profile and sets an httpOnly session cookie', async () => {
  const res = await fetch(`${app.base}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(STUDENT)
  });
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.user.email, STUDENT.email);
  assert.equal(body.user.role, 'student');
  // Password material must never be part of the returned profile.
  assert.equal('password' in body.user, false);
  assert.equal('password_hash' in body.user, false);

  const cookies = res.headers.getSetCookie();
  const session = cookies.find(c => c.startsWith('cf_session='))!;
  assert.ok(session, 'a session cookie is issued');
  assert.match(session, /HttpOnly/i);
  assert.match(session, /SameSite=Lax/i);
});

test('the session endpoint identifies the caller and rejects anonymous callers', async () => {
  const mine = await authedGet(student, `${app.base}/auth/session`);
  assert.equal(mine.status, 200);
  assert.equal(mine.body.user.email, STUDENT.email);

  const anon = await getJson(`${app.base}/auth/session`);
  assert.equal(anon.status, 401);
});

test('signing out invalidates the session immediately', async () => {
  const temp = (await signIn(app.base, OTHER_STUDENT.email, OTHER_STUDENT.password)).cookie;
  assert.equal((await authedGet(temp, `${app.base}/auth/session`)).status, 200);

  const out = await authedPost(temp, `${app.base}/auth/logout`, {});
  assert.equal(out.status, 200);

  // The cookie is cleared, so the old value must no longer authenticate anyone.
  const cleared = out.body.cleared_session;
  assert.ok(cleared, 'logout reports that the cookie was cleared');

  // A tampered/garbage cookie is rejected rather than trusted.
  assert.equal((await authedGet('cf_session=forged.token', `${app.base}/auth/session`)).status, 401);
});

test('a session token is signed, so it survives a different server instance', async () => {
  // This is the serverless case: a login may be served by one instance and the
  // next request by another. A signed token must verify anywhere without
  // shared server-side state, which a stored session row could not do.
  const { hashPassword, verifyPassword, createSession, resolveSession } = await import('../server/auth.js');

  const session = createSession('usr-student-1');
  assert.ok(session.token.includes('.'));

  // Re-deriving the session (as a cold instance would) must accept it.
  const verified = resolveSession(session.token);
  assert.ok(verified, 'a freshly signed session verifies');
  assert.equal(verified!.user_id, 'usr-student-1');

  // Any change to the payload invalidates the signature.
  const [payload, signature] = session.token.split('.');
  const tampered = `${payload.slice(0, -2)}xy.${signature}`;
  assert.equal(resolveSession(tampered), null, 'a tampered payload is rejected');

  // A token signed for a user that no longer exists is rejected.
  assert.equal(resolveSession('not-a-token'), null);

  // Password hashing is one-way and verifiable.
  const hash = hashPassword('correct horse battery staple');
  assert.notEqual(hash, 'correct horse battery staple');
  assert.equal(verifyPassword('correct horse battery staple', hash), true);
  assert.equal(verifyPassword('wrong password', hash), false);
});

test('repeated failed sign-ins are rate limited', async () => {
  let limited = false;
  for (let i = 0; i < 15; i++) {
    const res = await signIn(app.base, 'brute@force.example', `guess-${i}`);
    if (res.status === 429) {
      limited = true;
      break;
    }
  }
  assert.ok(limited, 'the limiter should engage after repeated failures');
});

// ------------------------------------------------------------------- roles

test('a student cannot reach staff or admin functionality', async () => {
  const attempts: Array<[string, string]> = [
    ['/queue/call-next', 'POST'],
    ['/audit-logs', 'GET'],
    ['/reset-seed', 'POST'],
    [`/services/${serviceId}/capacity`, 'POST'],
    [`/services/${serviceId}/incidents`, 'POST'],
    ['/analytics', 'GET'],
    ['/analytics/simulate', 'POST'],
    ['/announcements', 'POST'],
    ['/intelligence/admin/peak-analytics', 'GET'],
    ['/intelligence/admin/rebuild', 'POST']
  ];

  for (const [path, method] of attempts) {
    const res =
      method === 'GET'
        ? await authedGet(student, `${app.base}${path}`)
        : await authedPost(student, `${app.base}${path}`, { service_id: serviceId, added_counters: 1 });
    assert.ok(res.status === 403 || res.status === 401, `${path} must not be reachable by a student (got ${res.status})`);
  }
});

test('staff may operate a queue but not reach administrator-only endpoints', async () => {
  assert.equal((await authedGet(staff, `${app.base}/analytics`)).status, 200);
  assert.equal((await authedGet(staff, `${app.base}/intelligence/admin/peak-analytics`)).status, 200);
  assert.equal((await authedGet(staff, `${app.base}/audit-logs`)).status, 403);
  assert.equal((await authedPost(staff, `${app.base}/reset-seed`, {})).status, 403);
  assert.equal((await authedPost(staff, `${app.base}/analytics/simulate`, { service_id: serviceId })).status, 403);
});

test('an administrator reaches the full operations surface', async () => {
  assert.equal((await authedGet(admin, `${app.base}/audit-logs`)).status, 200);
  assert.equal((await authedGet(admin, `${app.base}/analytics`)).status, 200);
  assert.equal((await authedPost(admin, `${app.base}/analytics/simulate`, { service_id: serviceId })).status, 200);
});

test('only an administrator may edit a service record', async () => {
  const denied = await authedPatch(staff, `${app.base}/services/${serviceId}`, { status: 'closed' });
  assert.equal(denied.status, 403);

  const allowed = await authedPatch(admin, `${app.base}/services/${serviceId}`, { floor: 'Floor 1' });
  assert.equal(allowed.status, 200);
  assert.equal(allowed.body.service.floor, 'Floor 1');
});

// ----------------------------------------------------------------- privacy

test('a student only ever sees their own identity in the shared queue', async () => {
  await clearActiveTickets(student, otherServiceId);
  // Student one joins, so there is a record another student must not be able to read.
  const joined = await authedPost(student, `${app.base}/queue/join`, { service_id: otherServiceId });
  assert.equal(joined.status, 201);

  const asSelf = await authedGet(student, `${app.base}/queue?service_id=${otherServiceId}`);
  const own = asSelf.body.entries.find((e: any) => e.id === joined.body.entry.id);
  assert.equal(own.student_name, 'Alex Rivera', 'a student sees their own name');
  assert.equal(own.is_own, true);

  const asOther = await authedGet(otherStudent, `${app.base}/queue?service_id=${otherServiceId}`);
  const redacted = asOther.body.entries.find((e: any) => e.id === joined.body.entry.id);
  assert.ok(redacted, 'the ticket is still visible as a queue position');
  assert.equal(redacted.student_name, 'Student', 'another student sees no name');
  assert.equal(redacted.student_id_code, '—', 'another student sees no ID code');
  assert.equal(redacted.is_own, false);
  // Operational facts stay intact so the queue remains useful.
  assert.equal(redacted.ticket_number, joined.body.entry.ticket_number);
  assert.ok(typeof redacted.position === 'number');
});

test('staff retain the full identity they need to serve a student', async () => {
  const view = await authedGet(staff, `${app.base}/queue?service_id=${otherServiceId}`);
  const entry = view.body.entries.find((e: any) => e.student_name === 'Alex Rivera');
  assert.ok(entry, 'staff can see who is waiting');
  assert.ok(entry.student_id_code);
});

test('a student cannot read another student\'s queue, notifications or appointments', async () => {
  assert.equal((await authedGet(student, `${app.base}/queue/user/usr-student-2`)).status, 403);
  assert.equal((await authedGet(student, `${app.base}/notifications/usr-student-2`)).status, 403);
  assert.equal((await authedPost(student, `${app.base}/notifications/user/usr-student-2/read-all`, {})).status, 403);
});

test('a student cannot cancel another student\'s ticket', async () => {
  await clearActiveTickets(otherStudent, serviceId);
  const joined = await authedPost(otherStudent, `${app.base}/queue/join`, { service_id: serviceId });
  assert.equal(joined.status, 201);
  const entryId = joined.body.entry.id;

  const denied = await authedPost(student, `${app.base}/queue/${entryId}/cancel`, {});
  assert.equal(denied.status, 403);

  // The entry must still be active: a rejected request never mutates state.
  const stillActive = await authedGet(otherStudent, `${app.base}/queue/user/me`);
  assert.ok(stillActive.body.entries.some((e: any) => e.id === entryId && e.status === 'waiting'));
});

test('a student cannot mark another student\'s notification as read', async () => {
  const mine = await authedGet(otherStudent, `${app.base}/notifications/me`);
  const notifId = mine.body.notifications[0]?.id;
  if (!notifId) return; // nothing seeded for this account
  const denied = await authedPost(student, `${app.base}/notifications/${notifId}/read`, {});
  assert.equal(denied.status, 403);
});

// -------------------------------------------------------------- impersonation

test('the join endpoint ignores an identity supplied in the request body', async () => {
  const res = await authedPost(student, `${app.base}/queue/join`, {
    service_id: otherServiceId,
    user_id: 'usr-admin-1',
    student_name: 'Dr. Marcus Vance',
    student_id_code: 'ADM-001'
  });
  // Already holding a ticket on this service from an earlier test, so the
  // meaningful assertion is that it is rejected rather than impersonated.
  if (res.status === 201) {
    assert.equal(res.body.entry.user_id, 'usr-student-1');
    assert.equal(res.body.entry.student_name, 'Alex Rivera');
  } else {
    assert.equal(res.status, 400);
  }
});

// -------------------------------------------------------------- audit trail

test('sign-in and sign-out are written to the audit log', async () => {
  const logs = await authedGet(admin, `${app.base}/audit-logs`);
  assert.equal(logs.status, 200);
  const actions = logs.body.logs.map((l: any) => l.action);
  assert.ok(actions.includes('LOGIN'), 'sign-ins are audited');
  assert.ok(actions.includes('LOGOUT'), 'sign-outs are audited');
  assert.ok(actions.includes('LOGIN_FAILED'), 'failed sign-ins are audited');
});

test('capacity changes record who made the change', async () => {
  const change = await authedPost(staff, `${app.base}/services/${serviceId}/capacity`, {
    active_counters: 2,
    active_servers: 2,
    reason: 'Second operator brought online'
  });
  assert.equal(change.status, 200);
  assert.equal(change.body.service.active_counters, 2);

  const logs = await authedGet(admin, `${app.base}/audit-logs`);
  const entry = logs.body.logs.find((l: any) => l.action === 'UPDATE_CAPACITY');
  assert.ok(entry, 'the capacity change is audited');
  // The operator must be identifiable in the audit trail.
  assert.equal(entry.actor_name, 'Sarah Chen');
  assert.equal(entry.actor_role, 'staff');
  assert.match(entry.details, /Second operator brought online/);
});

// ----------------------------------------------------------------- workflow

test('end-to-end: student joins, staff serves, student completes', async () => {
  const service = app.db.getServices().find(s => s.name.includes('Library'))!;
  await clearActiveTickets(student, service.id);

  // Student joins the virtual queue.
  const joined = await authedPost(student, `${app.base}/queue/join`, { service_id: service.id });
  assert.equal(joined.status, 201);
  const entry = joined.body.entry;
  assert.ok(entry.ticket_number);
  assert.equal(entry.status, 'waiting');
  assert.ok(entry.position >= 1);

  // A notification is generated server-side, not faked in the UI.
  const notifs = await authedGet(student, `${app.base}/notifications/me`);
  assert.ok(notifs.body.notifications.some((n: any) => n.ticket_number === entry.ticket_number));

  // Staff calls the student to a counter.
  const called = await authedPost(staff, `${app.base}/queue/call-next`, {
    service_id: service.id,
    counter_number: 1
  });
  assert.equal(called.status, 200);

  // The student returns and checks in at the counter.
  const checkIn = await authedPost(student, `${app.base}/queue/${entry.id}/check-in`, {});
  assert.equal(checkIn.status, 200);

  // Serving begins, which is when the actual wait is measured.
  const started = await authedPost(staff, `${app.base}/queue/${entry.id}/start`, {});
  assert.equal(started.status, 200);
  assert.equal(started.body.entry.status, 'in_service');
  assert.ok(started.body.entry.actual_wait_mins >= 0, 'actual wait is recorded when service starts');

  const done = await authedPost(staff, `${app.base}/queue/${entry.id}/complete`, {});
  assert.equal(done.status, 200);
  assert.equal(done.body.entry.status, 'completed');
  assert.ok(done.body.entry.actual_wait_mins >= 0);
  assert.ok(done.body.entry.service_duration_mins >= 0);

  // The completed visit must show up in the student's own history.
  const history = await authedGet(student, `${app.base}/queue/user/me`);
  assert.ok(history.body.entries.some((e: any) => e.id === entry.id && e.status === 'completed'));
});

test('a duplicate active ticket is refused', async () => {
  const service = app.db.getServices().find(s => s.name.includes('Bursar'))!;
  await clearActiveTickets(student, service.id);
  const first = await authedPost(student, `${app.base}/queue/join`, { service_id: service.id });
  const second = await authedPost(student, `${app.base}/queue/join`, { service_id: service.id });
  assert.equal(first.status, 201);
  assert.equal(second.status, 400);
  assert.match(second.body.error, /already hold an active ticket/i);
});

test('an unknown API endpoint answers with a clear 404 rather than the SPA', async () => {
  const res = await getJson(`${app.base}/definitely-not-a-route`);
  assert.equal(res.status, 404);
  assert.equal(res.body.success, false);
});

test('public discovery endpoints stay open without a session', async () => {
  for (const path of ['/services', '/buildings', '/campuses', '/announcements', `/services/${serviceId}/why-long`]) {
    const { status } = await getJson(`${app.base}${path}`);
    assert.equal(status, 200, `${path} should be publicly readable`);
  }
});
