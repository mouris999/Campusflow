import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { authedGet, authedPost, createIsolatedServer, signIn } from './helpers.js';
import { CAMPUS_GEOMETRY } from '../src/lib/campusGeo.js';

let app: Awaited<ReturnType<typeof createIsolatedServer>>;
let admin: string;
let staff: string;
let student: string;

const ADMIN = { email: 'm.vance@metrouni.edu', password: 'admin123' };
const STAFF = { email: 'sarah.chen@metrouni.edu', password: 'staff123' };
const STUDENT = { email: 'alex.rivera@metrouni.edu', password: 'student123' };

before(async () => {
  app = await createIsolatedServer();
  admin = (await signIn(app.base, ADMIN.email, ADMIN.password)).cookie;
  staff = (await signIn(app.base, STAFF.email, STAFF.password)).cookie;
  student = (await signIn(app.base, STUDENT.email, STUDENT.password)).cookie;
});

after(async () => {
  await app.close();
});

const target = () => CAMPUS_GEOMETRY.buildings[0].id;

/**
 * A real DELETE with the session cookie and CSRF header. The shared helper only
 * speaks POST, and a GET-shaped request to a delete route would prove nothing.
 */
async function deleteAs(who: { email: string; password: string }, buildingId: string) {
  const session = await signIn(app.base, who.email, who.password);
  const res = await fetch(`${app.base}/campus/links/${buildingId}`, {
    method: 'DELETE',
    headers: {
      Cookie: session.cookie,
      ...(session.csrf ? { 'x-csrf-token': session.csrf } : {})
    }
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

// ------------------------------------------------------------------ read

test('campus links are readable without signing in', async () => {
  // The student-facing 3D map needs to know which positions are verified.
  const res = await fetch(`${app.base}/campus/links`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.success, true);
  assert.ok(Array.isArray(body.links));
});

// ----------------------------------------------------------------- write

test('an admin can link a CampusFlow building to a real OSM element', async () => {
  const res = await authedPost(admin, `${app.base}/campus/links`, {
    campusflow_building_id: 'bld-lib',
    osm_element_id: target()
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.link.campusflow_building_id, 'bld-lib');
  assert.equal(res.body.link.osm_element_id, target());
  assert.ok(res.body.link.verified_by, 'the link must record who confirmed it');
  assert.ok(res.body.link.verified_at, 'the link must record when');
});

test('the link is readable by the student-facing endpoint', async () => {
  const { body } = await authedGet(student, `${app.base}/campus/links`);
  const link = body.links.find((l: any) => l.campusflow_building_id === 'bld-lib');
  assert.ok(link, 'the student view must be able to see which positions are verified');
  assert.equal(link.osm_element_id, target());
});

test('a student cannot create a link', async () => {
  const res = await authedPost(student, `${app.base}/campus/links`, {
    campusflow_building_id: 'bld-adm',
    osm_element_id: target()
  });
  assert.equal(res.status, 403, 'placing live data on a building is an admin action');
});

test('staff cannot create a link either', async () => {
  const res = await authedPost(staff, `${app.base}/campus/links`, {
    campusflow_building_id: 'bld-adm',
    osm_element_id: target()
  });
  assert.equal(res.status, 403);
});

test('an anonymous caller cannot create a link', async () => {
  const res = await fetch(`${app.base}/campus/links`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ campusflow_building_id: 'bld-adm', osm_element_id: target() })
  });
  // 401 with no session at all; 403 for a session with the wrong role. Both refuse.
  assert.ok([401, 403].includes(res.status), 'expected a refusal, got ' + res.status);
});

test('a link without an OSM element is refused', async () => {
  const res = await authedPost(admin, `${app.base}/campus/links`, {
    campusflow_building_id: 'bld-adm'
  });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /both/i);
});

test('a link to an unknown CampusFlow building is refused', async () => {
  const res = await authedPost(admin, `${app.base}/campus/links`, {
    campusflow_building_id: 'bld-does-not-exist',
    osm_element_id: target()
  });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /not found/i);
});

test('one building keeps at most one verified position', async () => {
  // Two verified positions for one service would be ambiguous on the 3D map.
  const other = CAMPUS_GEOMETRY.buildings[1].id;
  await authedPost(admin, `${app.base}/campus/links`, {
    campusflow_building_id: 'bld-lib',
    osm_element_id: other
  });
  const { body } = await authedGet(admin, `${app.base}/campus/links`);
  const forLibrary = body.links.filter((l: any) => l.campusflow_building_id === 'bld-lib');
  assert.equal(forLibrary.length, 1, 're-linking must replace, not accumulate');
  assert.equal(forLibrary[0].osm_element_id, other);
});

// ---------------------------------------------------------------- removal

test('an admin can remove a link, returning the 3D map to a projected position', async () => {
  const created = await authedPost(admin, `${app.base}/campus/links`, {
    campusflow_building_id: 'bld-sci',
    osm_element_id: target()
  });
  assert.equal(created.status, 200);

  const removed = await deleteAs(ADMIN, 'bld-sci');
  assert.equal(removed.status, 200);

  const { body } = await authedGet(admin, `${app.base}/campus/links`);
  assert.equal(
    body.links.find((l: any) => l.campusflow_building_id === 'bld-sci'),
    undefined,
    'the link must be gone, so the 3D map falls back to a projected position'
  );
});

test('removing a link that does not exist is reported, not silently ignored', async () => {
  const res = await deleteAs(ADMIN, 'bld-nor');
  assert.equal(res.status, 400);
  assert.match(res.body.error, /no link/i);
});

test('a student cannot remove a link', async () => {
  const res = await deleteAs(STUDENT, 'bld-lib');
  assert.equal(res.status, 403);
});

test('an anonymous caller cannot remove a link', async () => {
  const res = await fetch(`${app.base}/campus/links/bld-lib`, { method: 'DELETE' });
  assert.ok([401, 403].includes(res.status), 'expected a refusal, got ' + res.status);
});

// ------------------------------------------------------------------ audit

test('setting a link is written to the audit log', async () => {
  const res = await authedGet(admin, `${app.base}/audit-logs`);
  const logs = res.body.logs ?? res.body.audit_logs ?? [];
  const actions = logs.map((l: any) => l.action);
  assert.ok(
    actions.includes('CAMPUS_LINK_SET'),
    'placing live data on a real building is an operational action and must be audited'
  );
});
