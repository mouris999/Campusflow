import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import {
  authedGet,
  authedPatch,
  authedPost,
  createIsolatedServer,
  getJson,
  patchJson,
  postJson,
  signIn
} from './helpers.js';

let app: Awaited<ReturnType<typeof createIsolatedServer>>;
let canteenId = '';
let cafeId = '';
// Staff- and admin-scoped routes require a real session.
let staffCookie = '';
let adminCookie = '';

before(async () => {
  app = await createIsolatedServer();
  const services = app.db.getServices();
  canteenId = services.find(s => s.name.includes('Central Canteen'))!.id;
  cafeId = services.find(s => s.name.includes('Cafe'))!.id;

  staffCookie = (await signIn(app.base, 'sarah.chen@metrouni.edu', 'staff123')).cookie;
  adminCookie = (await signIn(app.base, 'm.vance@metrouni.edu', 'admin123')).cookie;
});

after(async () => {
  await app.close();
});

test('the campus overview reports live traffic for every service', async () => {
  const { status, body } = await getJson(`${app.base}/intelligence/overview`);

  assert.equal(status, 200);
  assert.equal(body.success, true);
  assert.ok(body.services.length >= 8);
  const canteen = body.services.find((s: any) => s.service_id === canteenId);
  assert.ok(canteen.traffic_state);
  assert.ok(typeof canteen.current_wait_mins === 'number');
  assert.equal(typeof canteen.predicted_peak, 'object');
});

test('the peak endpoint returns a forecast with a stated confidence', async () => {
  const { status, body } = await getJson(`${app.base}/intelligence/services/${canteenId}/peak`);

  assert.equal(status, 200);
  assert.equal(body.forecast.service_id, canteenId);
  assert.ok(['low', 'medium', 'high'].includes(body.forecast.confidence));
  assert.ok(body.forecast.hours.length > 0);
  assert.ok(body.forecast.hours.every((h: any) => h.hour >= 0 && h.hour <= 23));
});

test('the peak endpoint 404s for a service that does not exist', async () => {
  const { status } = await getJson(`${app.base}/intelligence/services/srv-nope/peak`);
  assert.equal(status, 404);
});

test('alternatives are returned with the reasons that produced them', async () => {
  const { status, body } = await getJson(`${app.base}/intelligence/services/${canteenId}/alternatives?limit=3`);

  assert.equal(status, 200);
  assert.equal(body.origin.service_id, canteenId);
  assert.ok(Array.isArray(body.recommended));
  assert.ok(Array.isArray(body.not_usable));
  assert.ok(body.explanation.headline.length > 0);

  // Whether a branch can be recommended depends on the wall clock: a canteen
  // that is closed is correctly reported as unusable rather than suggested, so
  // the list is legitimately empty outside opening hours. The engine's own
  // filtering rules are covered deterministically in alternatives.test.ts, so
  // this test asserts the shape of whatever the campus can actually offer.
  for (const alternative of body.recommended) {
    assert.ok(alternative.service_id);
    assert.ok(alternative.reasons.length > 0, 'a recommendation must say why');
    assert.ok(alternative.time_saved_mins > 0, 'a recommendation must save time');
    assert.equal(alternative.availability.verified, true, 'availability must be real, not assumed');
    assert.equal(alternative.blocked_reason, null, 'a recommendation cannot also be blocked');
  }
  for (const blocked of body.not_usable) {
    assert.ok(blocked.blocked_reason, 'an unusable candidate must state why');
  }
});

test('a closed branch is reported as unusable, never as a recommendation', async () => {
  // Time-independent restatement of the invariant above: whatever the campus
  // state, the two lists must never contradict each other.
  const { body } = await getJson(`${app.base}/intelligence/services/${canteenId}/alternatives?limit=5`);
  const recommendedIds = new Set(body.recommended.map((a: any) => a.service_id));
  for (const blocked of body.not_usable) {
    assert.ok(
      !recommendedIds.has(blocked.service_id),
      `${blocked.service_id} was both recommended and blocked`
    );
  }
});

test('blocked candidates are reported as unusable, not as recommendations', async () => {
  const { body } = await getJson(`${app.base}/intelligence/services/${canteenId}/alternatives`);
  for (const blocked of body.not_usable ?? []) {
    assert.equal(blocked.usable, false);
    assert.ok(blocked.blocked_reason);
  }
});

test('alternatives for an unknown item are rejected', async () => {
  const { status } = await getJson(`${app.base}/intelligence/services/${canteenId}/alternatives?item_id=itm-nope`);
  assert.equal(status, 404);
});

test('the plan endpoint bundles now, peak, window and alternative', async () => {
  const { status, body } = await getJson(`${app.base}/intelligence/services/${canteenId}/plan`);

  assert.equal(status, 200);
  assert.equal(body.plan.service_id, canteenId);
  assert.equal(typeof body.plan.now.wait_mins, 'number');
  assert.ok('forecast' in body.plan);
  assert.ok('personalized' in body.plan);
  if (body.plan.suggested_window) {
    assert.ok(body.plan.suggested_window.expected_demand);
    assert.ok(body.plan.suggested_window.label.length > 0);
  }
});

test('item availability is only ever reported from stored records', async () => {
  const { status, body } = await getJson(`${app.base}/intelligence/items?service_id=${canteenId}`);

  assert.equal(status, 200);
  assert.ok(body.items.length > 0);
  const outOfStock = body.items.filter((i: any) => i.available === false);
  assert.ok(outOfStock.length > 0, 'the seeded catalogue should include a sold-out item');
  for (const item of outOfStock) {
    assert.equal(item.quantity_available, 0);
    assert.ok(item.updated_at);
  }
});

test('a staff availability update is stored and reflected in the catalogue', async () => {
  const before = await getJson(`${app.base}/intelligence/items?service_id=${cafeId}`);
  const item = before.body.items.find((i: any) => i.available === false);
  assert.ok(item, 'the cafe catalogue should include a sold-out item');

  const updated = await authedPatch(staffCookie, `${app.base}/intelligence/items/${item.id}`, {
    available: true,
    quantity_available: 9,
    actor: 'Test Staff'
  });

  assert.equal(updated.status, 200);
  assert.equal(updated.body.item.available, true);
  assert.equal(updated.body.item.quantity_available, 9);

  const after = await getJson(`${app.base}/intelligence/items?service_id=${cafeId}`);
  const stored = after.body.items.find((i: any) => i.id === item.id);
  assert.equal(stored.available, true);
});

test('the item update endpoint validates its payload', async () => {
  // Authenticated, but `available` is missing so the payload is rejected.
  const { status } = await authedPatch(staffCookie, `${app.base}/intelligence/items/itm-any`, { quantity_available: 4 });
  assert.equal(status, 400);
});

test('the item update endpoint is closed to anonymous callers', async () => {
  const { status } = await patchJson(`${app.base}/intelligence/items/itm-any`, { available: true });
  assert.equal(status, 401);
});

test('intent resolution answers from the catalogue', async () => {
  const { status, body } = await getJson(`${app.base}/intelligence/resolve?q=${encodeURIComponent('veg thali')}`);

  assert.equal(status, 200);
  assert.equal(body.resolution.verified, true);
  assert.ok(body.resolution.matches.length > 0);
});

test('intent resolution refuses to guess when nothing matches', async () => {
  const { body } = await getJson(`${app.base}/intelligence/resolve?q=${encodeURIComponent('hovercraft registration')}`);
  assert.equal(body.resolution.verified, false);
  assert.equal(body.resolution.message, "We couldn't verify availability for this request.");
});

test('the intent endpoint requires a query', async () => {
  const { status } = await getJson(`${app.base}/intelligence/resolve`);
  assert.equal(status, 400);
});

test('recommendation events and feedback are recorded', async () => {
  for (const event_type of ['shown', 'clicked', 'selected']) {
    const event = await postJson(`${app.base}/intelligence/events`, {
      user_id: 'u-api',
      origin_service_id: canteenId,
      recommended_service_id: cafeId,
      event_type
    });
    assert.equal(event.status, 201);
  }

  const feedback = await postJson(`${app.base}/intelligence/feedback`, {
    user_id: 'u-api',
    origin_service_id: canteenId,
    recommended_service_id: cafeId,
    useful: true
  });
  assert.equal(feedback.status, 201);

  const analytics = await authedGet(staffCookie, `${app.base}/intelligence/admin/peak-analytics`);
  assert.ok(analytics.body.analytics.per_service.some((s: any) => s.service_id === canteenId));
  const stats = analytics.body.analytics.per_service.find((s: any) => s.service_id === canteenId);
  assert.ok(stats.recommendations_shown >= 1);
  assert.ok(stats.acceptance_rate_pct > 0);
  assert.ok(analytics.body.analytics.totals.estimated_minutes_avoided >= 0);
});

test('the event endpoint validates its payload', async () => {
  const missing = await postJson(`${app.base}/intelligence/events`, { user_id: 'u-api' });
  assert.equal(missing.status, 400);

  const unknownType = await postJson(`${app.base}/intelligence/events`, {
    user_id: 'u-api',
    origin_service_id: canteenId,
    recommended_service_id: cafeId,
    event_type: 'invented'
  });
  assert.equal(unknownType.status, 400);
});

test('preferences round-trip and drive the recommendation context', async () => {
  const saved = await postJson(`${app.base}/intelligence/preferences`, {
    user_id: 'u-prefs',
    max_distance_meters: 800,
    avoid_peak: true
  });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.preference.max_distance_meters, 800);

  const read = await getJson(`${app.base}/intelligence/preferences/u-prefs`);
  assert.equal(read.body.preference.avoid_peak, true);

  const { body } = await getJson(`${app.base}/intelligence/services/${canteenId}/alternatives?user_id=u-prefs`);
  for (const alternative of body.recommended) {
    assert.ok(alternative.distance_meters <= 800);
  }
});

test('the admin analytics view summarises the recorded demand', async () => {
  const { status, body } = await authedGet(staffCookie, `${app.base}/intelligence/admin/peak-analytics`);

  assert.equal(status, 200);
  assert.equal(typeof body.analytics.model_version, 'string');
  assert.ok(body.analytics.per_service.length > 0);
  assert.ok(body.analytics.per_service.every((s: any) => s.confidence_pct >= 0 && s.confidence_pct <= 100));
  assert.ok(body.analytics.heatmap.cells.length > 0);
  assert.ok(body.analytics.heatmap.cells.every((c: any) => c.intensity >= 0 && c.intensity <= 100));
});

test('a manual rebuild reports the services it processed', async () => {
  // Rebuild is an administrator action.
  const { status, body } = await authedPost(adminCookie, `${app.base}/intelligence/admin/rebuild`, {});

  assert.equal(status, 200);
  assert.ok(body.run.services_evaluated > 0);
  assert.ok(body.run.duration_ms >= 0);

  const runs = await authedGet(adminCookie, `${app.base}/intelligence/admin/runs`);
  assert.equal(runs.body.runs[0].trigger, 'manual');
});

test('alerts require a user and never leak across users', async () => {
  const missing = await getJson(`${app.base}/intelligence/alerts`);
  assert.equal(missing.status, 400);

  const mine = await getJson(`${app.base}/intelligence/alerts?user_id=u-empty`);
  assert.equal(mine.status, 200);
  assert.ok(mine.body.alerts.every((a: any) => a.key.startsWith('u-empty|')));
  for (const alert of mine.body.alerts) {
    // no "1 minutes", and no claim that quiet traffic is already busy
    assert.ok(!/\b1 minutes\b/.test(alert.headline), alert.headline);
    assert.ok(!/already at low/.test(alert.body), alert.body);
    assert.ok(alert.suggested_action.length > 0);
  }

  const theirs = await getJson(`${app.base}/intelligence/alerts?user_id=someone-else`);
  assert.equal(theirs.body.alerts.every((a: any) => a.key.startsWith('someone-else|')), true);
});

test('concurrent requests all succeed', async () => {
  const requests = Array.from({ length: 12 }, (_, i) =>
    getJson(`${app.base}/intelligence/services/${i % 2 ? cafeId : canteenId}/alternatives`)
  );
  const results = await Promise.all(requests);
  assert.equal(results.every(r => r.status === 200), true);
});
