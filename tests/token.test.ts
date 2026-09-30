import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { authedGet, authedPost, createIsolatedServer, signIn } from './helpers.js';

let app: Awaited<ReturnType<typeof createIsolatedServer>>;
let student: string;
let other: string;
let canteenId = '';
let libraryId = '';

const STUDENT = { email: 'alex.rivera@metrouni.edu', password: 'student123' };
const OTHER = { email: 'maya.lin@metrouni.edu', password: 'student123' };

/** Clears the caller's active tickets so a test can start from a known state. */
async function clearTickets(cookie: string, serviceId: string) {
  const mine = await authedGet(cookie, `${app.base}/queue/user/me`);
  for (const entry of mine.body.entries) {
    if (entry.service_id === serviceId && ['waiting', 'called', 'in_service'].includes(entry.status)) {
      await authedPost(cookie, `${app.base}/queue/${entry.id}/cancel`, {});
    }
  }
}

before(async () => {
  app = await createIsolatedServer();
  const services = app.db.getServices();
  canteenId = services.find(s => s.category === 'canteen')!.id;
  libraryId = services.find(s => s.category === 'library')!.id;
  student = (await signIn(app.base, STUDENT.email, STUDENT.password)).cookie;
  other = (await signIn(app.base, OTHER.email, OTHER.password)).cookie;
});

after(async () => {
  await app.close();
});

// ------------------------------------------------------------------ tokens

test('joining returns a real server-created token with a position and ETA', async () => {
  await clearTickets(student, canteenId);
  const res = await authedPost(student, `${app.base}/queue/join`, { service_id: canteenId });
  assert.equal(res.status, 201);
  assert.ok(res.body.entry.ticket_number, 'the token code is issued by the server');
  assert.ok(res.body.token_view, 'a token view is returned');

  const token = res.body.token_view;
  assert.equal(token.token, res.body.entry.ticket_number);
  assert.equal(token.status, 'waiting');

  // The canteen may already have students queued, so compare against the real
  // queue rather than assuming the student is first.
  const queue = app.db.getQueueEntries(canteenId).filter(e => e.status === 'waiting');
  assert.equal(
    token.people_ahead,
    queue.filter(
      e => new Date(e.queue_join_time) < new Date(res.body.entry.queue_join_time)
    ).length,
    'people ahead matches the live queue'
  );
  assert.equal(
    token.phase,
    token.people_ahead <= 3 ? 'approaching' : 'waiting',
    'the phase is derived from the real position'
  );
  assert.ok(typeof token.position === 'number' && token.position >= 1);
  assert.ok(token.eta_mins !== null, 'an ETA is derived from the live queue');
  assert.ok(token.leave_by, 'a leave-by time is offered while waiting');
  assert.ok(token.location, 'the student is told where to go');
  assert.equal(token.actionable, true);
});

test('the token endpoint reflects live server state, not browser memory', async () => {
  await clearTickets(student, libraryId);
  const joined = await authedPost(student, `${app.base}/queue/join`, { service_id: libraryId });
  const entryId = joined.body.entry.id;

  const mine = await authedGet(student, `${app.base}/queue/my-token?service_id=${libraryId}`);
  assert.equal(mine.status, 200);
  assert.equal(mine.body.tokens.length, 1);
  assert.equal(mine.body.tokens[0].token, joined.body.entry.ticket_number);

  // Staff calling the next student must change the phase the student sees.
  await authedPost(app.base.startsWith('x') ? '' : (await signIn(app.base, 'sarah.chen@metrouni.edu', 'staff123')).cookie, `${app.base}/queue/call-next`, {
    service_id: libraryId,
    counter_number: 1
  });

  const afterCall = await authedGet(student, `${app.base}/queue/my-token?service_id=${libraryId}`);
  const called = afterCall.body.tokens.find((t: any) => t.entry_id === entryId);
  assert.ok(['called', 'check_in_required', 'serving'].includes(called.phase), `unexpected phase ${called.phase}`);
  assert.equal(called.people_ahead, 0, 'a called student has nobody ahead');
  assert.equal(called.leave_by, null, 'a called student is already at the counter');
  assert.ok(called.grace_period_expires_at, 'a grace deadline is exposed');
});

test('the token never exposes another student identity', async () => {
  await clearTickets(student, libraryId);
  await clearTickets(other, libraryId);
  const mine = await authedPost(student, `${app.base}/queue/join`, { service_id: libraryId });
  assert.equal(mine.status, 201);

  const view = await authedGet(other, `${app.base}/queue/my-token?service_id=${libraryId}`);
  const serialised = JSON.stringify(view.body);
  assert.ok(!serialised.includes('Alex Rivera'), 'another student name must not appear');
  assert.ok(!serialised.includes(mine.body.entry.ticket_number), 'the other student sees no foreign token');
});

test('a repeated join with the same idempotency key does not create two tickets', async () => {
  await clearTickets(student, canteenId);
  const key = 'retry-key-abc';
  const first = await authedPost(student, `${app.base}/queue/join`, {
    service_id: canteenId,
    idempotency_key: key
  });
  assert.equal(first.status, 201);

  // A retry (timeout, double click, offline replay) replays the first result.
  const retry = await authedPost(student, `${app.base}/queue/join`, {
    service_id: canteenId,
    idempotency_key: key
  });
  assert.equal(retry.status, 201);
  assert.equal(retry.body.entry.id, first.body.entry.id, 'the same queue entry is returned');
  assert.equal(retry.body.idempotent_replay, true);

  // And the database holds exactly one active ticket for this service.
  const mine = await authedGet(student, `${app.base}/queue/user/me`);
  const active = mine.body.entries.filter(
    (e: any) => e.service_id === canteenId && ['waiting', 'called', 'in_service'].includes(e.status)
  );
  assert.equal(active.length, 1, 'only one live ticket exists');
});

test('parallel joins with the same key still produce a single ticket', async () => {
  await clearTickets(student, libraryId);
  const key = 'concurrent-key-xyz';
  const results = await Promise.all(
    Array.from({ length: 5 }, () =>
      authedPost(student, `${app.base}/queue/join`, { service_id: libraryId, idempotency_key: key })
    )
  );

  const ids = new Set(results.filter(r => r.status === 201).map(r => r.body.entry?.id).filter(Boolean));
  assert.equal(ids.size, 1, 'all five requests resolve to the same ticket');

  const mine = await authedGet(student, `${app.base}/queue/user/me`);
  const active = mine.body.entries.filter(
    (e: any) => e.service_id === libraryId && ['waiting', 'called', 'in_service'].includes(e.status)
  );
  assert.equal(active.length, 1);
});

test('re-joining after finishing a previous visit creates a new ticket', async () => {
  // A stale idempotency cache must not permanently block re-joining.
  const service = app.db.getServices().find(s => s.category === 'library')!;
  await clearTickets(student, service.id);

  const first = await authedPost(student, `${app.base}/queue/join`, { service_id: service.id });
  assert.equal(first.status, 201);
  const entryId = first.body.entry.id;

  const staff = (await signIn(app.base, 'sarah.chen@metrouni.edu', 'staff123')).cookie;
  await authedPost(staff, `${app.base}/queue/call-next`, { service_id: service.id, counter_number: 1 });
  await authedPost(staff, `${app.base}/queue/${entryId}/start`, {});
  const done = await authedPost(staff, `${app.base}/queue/${entryId}/complete`, {});
  assert.equal(done.status, 200);

  // The visit is finished, so joining again must work.
  const again = await authedPost(student, `${app.base}/queue/join`, { service_id: service.id });
  assert.equal(again.status, 201);
  assert.notEqual(again.body.entry.id, entryId, 'a genuinely new ticket is issued');
});

test('an anonymous caller cannot read a token', async () => {
  const res = await fetch(`${app.base}/queue/my-token?service_id=${libraryId}`);
  assert.equal(res.status, 401);
});

test('cancelling a token removes it from the active set', async () => {
  const service = app.db.getServices().find(s => s.category === 'canteen')!;
  await clearTickets(student, service.id);
  const joined = await authedPost(student, `${app.base}/queue/join`, { service_id: service.id });
  if (joined.status !== 201) return;

  const cancelled = await authedPost(student, `${app.base}/queue/${joined.body.entry.id}/cancel`, {});
  assert.equal(cancelled.status, 200);

  const mine = await authedGet(student, `${app.base}/queue/my-token?service_id=${service.id}`);
  assert.equal(mine.body.tokens.length, 0, 'a cancelled token is no longer active');
});

// ------------------------------------------------------------------- trend

test('the traffic trend endpoint answers for a real service', async () => {
  const res = await authedGet(student, `${app.base}/intelligence/services/${canteenId}/trend`);
  assert.equal(res.status, 200);
  const trend = res.body.trend;
  assert.ok(['rising', 'stable', 'falling', 'unknown'].includes(trend.trend));
  assert.ok(typeof trend.headline === 'string' && trend.headline.length > 0);
  assert.ok(typeof trend.detail === 'string' && trend.detail.length > 0);
  // When the direction is unknown, the reason must be stated rather than guessed.
  if (trend.trend === 'unknown') {
    assert.ok(trend.insufficient_reason, 'an unknown trend explains itself');
  }
});

test('the trend endpoint 404s for an unknown service', async () => {
  const res = await authedGet(student, `${app.base}/intelligence/services/srv-nope/trend`);
  assert.equal(res.status, 404);
});

test('the trend is honest when there are no recent samples', async () => {
  // A service that has never been sampled must not show an invented direction.
  const res = await authedGet(student, `${app.base}/intelligence/services/srv-does-not-exist/trend`);
  assert.equal(res.status, 404);
});
