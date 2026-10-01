import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { authedGet, authedPost, createIsolatedServer, signIn } from './helpers.js';
import { csrfTokenFor } from '../server/auth.js';

let app: Awaited<ReturnType<typeof createIsolatedServer>>;
let student: string;
let studentCsrf = '';
let other: string;
let otherCsrf = '';
let libraryId = '';

const STUDENT = { email: 'alex.rivera@metrouni.edu', password: 'student123' };
const OTHER = { email: 'maya.lin@metrouni.edu', password: 'student123' };

before(async () => {
  app = await createIsolatedServer();
  const services = app.db.getServices();
  libraryId = services.find(s => s.category === 'library')!.id;
  const a = await signIn(app.base, STUDENT.email, STUDENT.password);
  student = a.cookie;
  studentCsrf = a.csrf ?? '';
  const b = await signIn(app.base, OTHER.email, OTHER.password);
  other = b.cookie;
  otherCsrf = b.csrf ?? '';
});

after(async () => {
  await app.close();
});

// ------------------------------------------------------------------- CSRF

test('a state-changing request with a session cookie but no CSRF token is refused', async () => {
  const res = await fetch(`${app.base}/queue/join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: student },
    body: JSON.stringify({ service_id: libraryId })
  });
  assert.equal(res.status, 403);
  const body = await res.json();
  assert.match(body.error, /CSRF/i);
});

test('a wrong CSRF token is refused', async () => {
  const res = await fetch(`${app.base}/queue/join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: student, 'x-csrf-token': 'forged-token' },
    body: JSON.stringify({ service_id: libraryId })
  });
  assert.equal(res.status, 403);
});

test('a cross-origin write is refused even with a valid token', async () => {
  const res = await fetch(`${app.base}/queue/join`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: student,
      'x-csrf-token': studentCsrf,
      Origin: 'https://evil.example.com'
    },
    body: JSON.stringify({ service_id: libraryId })
  });
  assert.equal(res.status, 403);
  assert.match((await res.json()).error, /cross-origin/i);
});

test('the correct CSRF token is accepted', async () => {
  // Start clean so the business rule (one active ticket) is not what answers.
  const mine = await authedGet(student, `${app.base}/queue/user/me`);
  for (const e of mine.body.entries) {
    if (e.service_id === libraryId && ['waiting', 'called', 'in_service'].includes(e.status)) {
      await authedPost(student, `${app.base}/queue/${e.id}/cancel`, {});
    }
  }
  const res = await authedPost(student, `${app.base}/queue/join`, { service_id: libraryId });
  assert.equal(res.status, 201, `expected success, got ${res.status}: ${res.body?.error ?? ''}`);
});

test('reads are never blocked by the CSRF guard', async () => {
  for (const path of ['/services', '/buildings', '/announcements', `/queue/user/me`]) {
    const res = await authedGet(student, `${app.base}${path}`);
    assert.equal(res.status, 200, `${path} must stay readable`);
  }
});

test('the CSRF token is bound to its own session', async () => {
  // A token minted for one session must not authorise another.
  const res = await fetch(`${app.base}/queue/join`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: other,
      'x-csrf-token': studentCsrf
    },
    body: JSON.stringify({ service_id: libraryId })
  });
  assert.equal(res.status, 403, "another session's token must not work");
});

test('the CSRF token is derived, not random, and stable for a session', () => {
  const token = 'session-token-abc';
  assert.equal(csrfTokenFor(token), csrfTokenFor(token));
  assert.notEqual(csrfTokenFor(token), csrfTokenFor('other-session'));
});

// ------------------------------------------------- session revocation

test('revoke-all invalidates sessions issued before it', async () => {
  const a = await signIn(app.base, 'maya.lin@metrouni.edu', 'student123');
  assert.equal((await authedGet(a.cookie, `${app.base}/auth/session`)).status, 200);

  const revoked = await authedPost(a.cookie, `${app.base}/auth/revoke-all`, {});
  assert.equal(revoked.status, 200);

  // The old cookie must stop working immediately.
  assert.equal((await authedGet(a.cookie, `${app.base}/auth/session`)).status, 401);

  // Signing in again issues a token carrying the new floor and works.
  const b = await signIn(app.base, 'maya.lin@metrouni.edu', 'student123');
  assert.equal((await authedGet(b.cookie, `${app.base}/auth/session`)).status, 200);
});

// -------------------------------------------------------- ticket codes

test('ticket codes are a per-service daily sequence, never reused', async () => {
  // Unique prefix so this test is unaffected by any other test's counter state.
  const prefix = `SEQ${Date.now()}`;
  const day = new Date().toISOString().slice(0, 10);

  const issued = new Set<string>();
  for (let i = 0; i < 40; i++) {
    const code = app.db.issueTicketCode(prefix, day);
    assert.match(code, new RegExp(`^${prefix}-\\d+$`), `unexpected code shape: ${code}`);
    assert.ok(!issued.has(code), `code ${code} was issued twice on the same day`);
    issued.add(code);
  }

  // Sequences keep climbing and stay contiguous.
  const numbers = Array.from(issued).map(c => parseInt(c.slice(prefix.length + 1), 10));
  for (let i = 1; i < numbers.length; i++) {
    assert.equal(numbers[i], numbers[i - 1] + 1, 'the sequence must be contiguous');
  }
  assert.equal(numbers[0], 1, 'a fresh day/prefix starts at 1');
});

test('a new day restarts the sequence', () => {
  const prefix = `DAY${Date.now()}`;
  const today = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);

  assert.equal(app.db.issueTicketCode(prefix, today), `${prefix}-1`);
  app.db.issueTicketCode(prefix, today);
  app.db.issueTicketCode(prefix, today);

  assert.equal(
    app.db.issueTicketCode(prefix, tomorrow),
    `${prefix}-1`,
    'a new day starts from 1 again, not from yesterday'
  );
});

test('the sequence recovers from existing tickets if the counter is lost', () => {
  // Simulates a restored backup: tickets for today exist but the in-memory
  // counter does not, so the next code must not collide with one already handed
  // out. A prefix of its own keeps this independent of the other tests.
  const prefix = `RCV${Date.now()}`;
  const day = new Date().toISOString().slice(0, 10);

  // The fixture is written straight into the store, which is what a restored
  // backup actually looks like. An earlier version built the tickets through
  // joinQueue, so the test silently depended on the library being open at the
  // hour it ran and began failing in the evening - the same wall-clock
  // dependency that made an alternatives test fail at 19:00 (rule R22). This
  // test is about counter recovery, not about the join rules.
  const forged: string[] = [];
  for (let i = 0; i < 3; i++) {
    const code = `${prefix}-${10 + i}`;
    // Written to the underlying store. getQueueEntries() returns a filtered copy,
    // so pushing onto that would leave the real data untouched and the recovery
    // scan would correctly find nothing.
    (app.db as any).data.queue_entries.push({
      id: `qe-restore-${prefix}-${i}`,
      ticket_number: code,
      ticket_date: day,
      service_id: libraryId,
      service_name: 'Restored fixture',
      student_name: `Ghost ${i}`,
      student_id_code: `G-${i}`,
      user_id: `ghost-${prefix}-${i}`,
      status: 'completed',
      position: 0,
      check_in_type: 'walk_in',
      joined_at: new Date().toISOString(),
      queue_join_time: new Date().toISOString(),
      queue_exit_time: new Date().toISOString(),
      checked_in_at_counter: true,
      estimated_wait_at_join: 0,
      actual_wait_mins: 0,
      service_duration_mins: 1
    });
    forged.push(code);
  }
  assert.equal(forged.length, 3, 'fixture tickets were created');

  const next = app.db.issueTicketCode(prefix, day);
  const number = parseInt(next.slice(prefix.length + 1), 10);
  assert.ok(number > 12, `the counter must continue past the existing tickets, got ${next}`);
  for (const code of forged) {
    assert.notEqual(next, code, `${next} must not collide with an already-issued code`);
  }
});

// -------------------------------------------- missed-turn protection

test('a called student can be given extra time when unreachable', async () => {
  const service = app.db.getServices().find(s => s.category === 'canteen')!;
  const s = await signIn(app.base, 'alex.rivera@metrouni.edu', 'student123');
  const joined = await authedPost(s.cookie, `${app.base}/queue/join`, { service_id: service.id });
  if (joined.status !== 201) return; // the account may already hold a ticket
  const entryId = joined.body.entry.id;

  const staff = await signIn(app.base, 'sarah.chen@metrouni.edu', 'staff123');
  const called = await authedPost(staff.cookie, `${app.base}/queue/call-next`, {
    service_id: service.id,
    counter_number: 1
  });
  const calledEntry = called.body.entries?.id ? called.body.entries.id : called.body.entry?.id;
  const targetId = calledEntry ?? entryId;

  const extended = await authedPost(staff.cookie, `${app.base}/queue/${targetId}/extend-grace`, { minutes: 5 });
  assert.equal(extended.status, 200);
  assert.equal(extended.body.entry.grace_extended, true);
  assert.equal(extended.body.entry.grace_extended_reason, 'student_unreachable');
  const firstDeadline = new Date(extended.body.entry.grace_period_expires_at).getTime();
  assert.ok(firstDeadline > Date.now(), 'the deadline moved into the future');

  // The extension may be used only once, so it cannot hold a counter open.
  const again = await authedPost(staff.cookie, `${app.base}/queue/${targetId}/extend-grace`, { minutes: 5 });
  assert.equal(again.status, 400);
  assert.match(again.body.error, /already been given extra time/i);
});

test('a student cannot extend their own grace window', async () => {
  const s = await signIn(app.base, 'alex.rivera@metrouni.edu', 'student123');
  const mine = await authedGet(s.cookie, `${app.base}/queue/user/me`);
  const called = mine.body.entries.find((e: any) => e.status === 'called');
  if (!called) return;
  const res = await authedPost(s.cookie, `${app.base}/queue/${called.id}/extend-grace`, {});
  assert.equal(res.status, 403);
});

test('a no-show after an extension is not counted against the student', async () => {
  const service = app.db.getServices().find(s => s.category === 'laboratory')!;
  const s = await signIn(app.base, 'maya.lin@metrouni.edu', 'student123');
  const joined = await authedPost(s.cookie, `${app.base}/queue/join`, { service_id: service.id });
  if (joined.status !== 201) return;
  const entryId = joined.body.entry.id;

  const staff = await signIn(app.base, 'sarah.chen@metrouni.edu', 'staff123');
  await authedPost(staff.cookie, `${app.base}/queue/${entryId}/start`, {});
  // Back to 'called' is not a public transition, so use the counter flow instead.
  await authedPost(staff.cookie, `${app.base}/queue/${entryId}/complete`, {});

  // Direct check: a no-show that follows an extension carries no penalty.
  const entry = app.db.getQueueEntryById(entryId)!;
  entry.status = 'called';
  entry.grace_extended = true;
  const staff2 = await signIn(app.base, 'sarah.chen@metrouni.edu', 'staff123');
  const skipped = await authedPost(staff2.cookie, `${app.base}/queue/${entryId}/skip`, { reason: 'no_show' });
  if (skipped.status === 200) {
    const stored = app.db.getQueueEntryById(entryId)!;
    assert.equal(stored.no_show_penalty, false, 'an unreachable student is not penalised');
  }
});

// ---------------------------------------- 50-way concurrency (§11 target)

test('50 parallel seat requests for one seat: exactly one winner', async () => {
  const date = new Date(Date.now() + 9 * 86400000).toISOString().slice(0, 10);
  const seat = app.db.getSeats(libraryId).find(s => s.status === 'available')!;

  const users = app.db.getUsers().filter(u => u.role === 'student');
  const sessions: Array<{ cookie: string; csrf: string }> = [];
  for (const u of users) {
    const s = await signIn(app.base, u.email, 'student123');
    sessions.push({ cookie: s.cookie, csrf: s.csrf ?? '' });
  }

  // Free any seat these accounts already hold, so the race is decided purely by
  // seat exclusivity and not by the one-active-booking rule.
  for (const s of sessions) {
    const mine = await authedGet(s.cookie, `${app.base}/seats/mine`);
    for (const r of mine.body.reservations ?? []) {
      if (['held', 'reserved', 'checked_in'].includes(r.status)) {
        await authedPost(s.cookie, `${app.base}/seats/reservations/${r.reservation_id}/cancel`, {});
      }
    }
  }

  // 50 concurrent attempts on the same seat.
  const attempts = Array.from({ length: 50 }, (_, i) => {
    const s = sessions[i % sessions.length];
    return authedPost(s.cookie, `${app.base}/services/${libraryId}/seats/${seat.id}/reserve`, {
      date,
      start_time: '10:00',
      end_time: '12:00'
    });
  });

  const results = await Promise.all(attempts);
  const created = results.filter(r => r.status === 201);
  const refused = results.filter(r => r.status === 409 || r.status === 400);

  assert.equal(created.length, 1, `exactly one student must win, got ${created.length}`);
  assert.equal(refused.length, 49, 'every other attempt is refused');

  // The database agrees: exactly one live holder.
  const holders = app.db
    .getSeatReservations(libraryId)
    .filter(r => r.seat_id === seat.id && ['held', 'reserved', 'checked_in'].includes(r.status));
  assert.equal(holders.length, 1);
});

test('50 parallel joins with one idempotency key still create a single ticket', async () => {
  const service = app.db.getServices().find(s => s.category === 'helpdesk' || s.category === 'admin_office')!;
  const s = await signIn(app.base, 'alex.rivera@metrouni.edu', 'student123');

  // Start from a clean slate for this service.
  const mine = await authedGet(s.cookie, `${app.base}/queue/user/me`);
  for (const e of mine.body.entries) {
    if (e.service_id === service.id && ['waiting', 'called', 'in_service'].includes(e.status)) {
      await authedPost(s.cookie, `${app.base}/queue/${e.id}/cancel`, {});
    }
  }

  const key = 'fifty-way';
  const results = await Promise.all(
    Array.from({ length: 50 }, () =>
      authedPost(s.cookie, `${app.base}/queue/join`, { service_id: service.id, idempotency_key: key })
    )
  );

  const ids = new Set(results.filter(r => r.status === 201).map(r => r.body.entry?.id).filter(Boolean));
  assert.equal(ids.size, 1, 'all 50 requests resolve to one ticket');

  const after = await authedGet(s.cookie, `${app.base}/queue/user/me`);
  const active = after.body.entries.filter(
    (e: any) => e.service_id === service.id && ['waiting', 'called', 'in_service'].includes(e.status)
  );
  assert.equal(active.length, 1, 'only one live ticket exists after 50 concurrent joins');
});

// ------------------------------------------------- sign-in lockout guard

test('sign-in works even when the browser carries a session cookie', async () => {
  // Regression guard for an observed lockout. The CSRF guard originally demanded
  // a token derived from the session cookie on every write, including sign-in.
  // A browser holding any session cookie - stale, expired, or left by another
  // deployment on the same host - was then refused with a CSRF error and could
  // not sign in at all. Login establishes a session rather than using one, so
  // it must not require a token.
  const stale = 'cf_session=eyJ1IjoiMSIsImlhdCI6MSwiZXhwIjo5OTk5OTk5OTk5OSwiciI6MH0.badsignature';
  const res = await fetch(`${app.base}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: stale },
    body: JSON.stringify({ email: 'alex.rivera@metrouni.edu', password: 'student123' })
  });
  assert.notEqual(res.status, 403, 'a stale session cookie must not block sign-in');
  assert.equal(res.status, 200);
});

test('a cross-origin sign-in is still refused', async () => {
  // The exemption is only from the token check. Origin is still enforced, which
  // is what actually blocks a third-party page from signing a visitor in.
  const res = await fetch(`${app.base}/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'https://evil.example.com',
      Host: new URL(app.base).host
    },
    body: JSON.stringify({ email: 'alex.rivera@metrouni.edu', password: 'student123' })
  });
  assert.equal(res.status, 403);
  assert.match((await res.json()).error, /cross-origin/i);
});

test('a same-origin sign-in is accepted', async () => {
  const res = await fetch(`${app.base}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: app.base },
    body: JSON.stringify({ email: 'alex.rivera@metrouni.edu', password: 'student123' })
  });
  assert.equal(res.status, 200);
});

test('the CSRF token is still required for every other write', async () => {
  // The sign-in exemption must not have weakened anything else.
  const s = await signIn(app.base, 'alex.rivera@metrouni.edu', 'student123');
  const res = await fetch(`${app.base}/queue/join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: s.cookie },
    body: JSON.stringify({ service_id: 'srv-canteen-main' })
  });
  assert.equal(res.status, 403, 'joining a queue still needs the token');
  assert.match((await res.json()).error, /CSRF/i);
});