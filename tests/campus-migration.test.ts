import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * An install created before this campus became Galgotias University must not stay
 * fictional forever.
 *
 * `migrateSchema()` is additive by design, which is the right default: nothing it
 * does may lose a student's queue, booking or ticket. But additive-only has a blind
 * spot. Once a record exists, nothing will ever correct it, so an install that
 * predates the rename keeps the old campus name, code, timezone and building list
 * on disk while the map above it draws real Galgotias geometry.
 *
 * These tests boot the real database against a deliberately stale store in a child
 * process, because the ESM module cache means `db.ts` cannot be re-instantiated
 * with a different data directory inside one process.
 */

const OLD_DOMAIN = 'metrouni.edu';

interface StoredCampus {
  id: string;
  name: string;
  code: string;
  timezone: string;
  centre_lat?: number;
  centre_lon?: number;
}

/** The store as an install from before the rename would have left it. */
function writeStaleStore(dir: string) {
  const store = {
    campuses: [
      {
        id: 'camp-main',
        name: 'Metropolitan University Central Campus',
        code: 'MU-CENTRAL',
        timezone: 'America/New_York'
      }
    ],
    buildings: [
      {
        id: 'bld-adm',
        campus_id: 'camp-main',
        name: 'Main Administration Building',
        code: 'ADM',
        floor_count: 4,
        description: 'Central registrar.',
        map_coords: { x: 28, y: 35 }
      }
    ],
    services: [],
    counters: [],
    queue_entries: [],
    appointments: [],
    incidents: [],
    wait_measurements: [],
    announcements: [
      {
        id: 'anc-legacy',
        title: 'Legacy notice',
        message: 'This record must survive the migration.',
        severity: 'info',
        active: true,
        created_at: '2026-01-01T00:00:00.000Z'
      }
    ],
    notifications: [],
    audit_logs: [],
    users: [
      {
        id: 'usr-student-1',
        name: 'Alex Rivera',
        role: 'student',
        id_code: 'STU-8821',
        email: `alex.rivera@${OLD_DOMAIN}`
      }
    ],
    user_credentials: {},
    service_items: [],
    seat_zones: [],
    seats: [],
    seat_reservations: [],
    ticket_counters: {},
    session_revocation: {},
    campus_links: [
      {
        campusflow_building_id: 'bld-adm',
        osm_element_id: 'w630317457',
        verified_by: 'admin',
        verified_at: '2026-02-02T00:00:00.000Z'
      }
    ]
  };

  writeFileSync(join(dir, 'campusflow.json'), JSON.stringify(store, null, 2), 'utf-8');
  return store;
}

/** Boots the real database against `dir` and returns what it ended up holding. */
function boot(dir: string) {
  // The database logs its migration to stdout, so the result goes to a file and
  // is read back, rather than trying to parse log lines out of the pipe.
  const resultFile = join(dir, 'migration-result.json');

  const script = `
    import { writeFileSync } from 'node:fs';
    const { db } = await import('./server/db.js');
    writeFileSync(${JSON.stringify(resultFile)}, JSON.stringify({
      campuses: db.getCampuses(),
      buildings: db.getBuildings(),
      users: db.getUsers(),
      timezone: db.campusTimezone(),
      announcements: db.getAnnouncements(),
      links: db.getCampusLinks()
    }));
  `;
  execFileSync(
    process.execPath,
    ['--import', 'tsx', '-e', script],
    {
      cwd: process.cwd(),
      env: { ...process.env, CAMPUSFLOW_DATA_DIR: dir },
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe']
    }
  );
  return JSON.parse(readFileSync(resultFile, 'utf-8'));
}

function withStaleStore(run: (store: ReturnType<typeof boot>) => void) {
  const dir = mkdtempSync(join(tmpdir(), 'campusflow-migrate-'));
  try {
    writeStaleStore(dir);
    run(boot(dir));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('an existing install is moved onto the real campus identity', () => {
  withStaleStore(store => {
    const campus = store.campuses[0] as StoredCampus;

    assert.match(campus.name, /Galgotias University/,
      'the stored campus name must stop claiming a fictional university');
    assert.equal(campus.code, 'GU-CENTRAL');
    assert.equal(campus.timezone, 'Asia/Kolkata');
    assert.equal(typeof campus.centre_lat, 'number',
      'the campus centre is what the map is drawn around; it must be recorded');
    assert.equal(typeof campus.centre_lon, 'number');
  });
});

test('the stale timezone fallback cannot survive', () => {
  withStaleStore(store => {
    // Regression guard. campusTimezone() resolves wall-clock booking times, so a
    // fallback in the wrong country shifts every appointment by half a day.
    assert.equal(store.timezone, 'Asia/Kolkata');
    assert.notEqual(store.timezone, 'America/New_York');
  });
});

test('surveyed campus buildings are added to a store that predates them', () => {
  withStaleStore(store => {
    const ids = store.buildings.map((b: { id: string }) => b.id);
    for (const expected of [
      'bld-gu-bblock',
      'bld-gu-cblock',
      'bld-gu-hospitality',
      'bld-gu-sports',
      'bld-gu-basketball'
    ]) {
      assert.ok(ids.includes(expected), `the real campus building ${expected} is missing`);
    }

    const block = store.buildings.find((b: { id: string }) => b.id === 'bld-gu-cblock');
    assert.equal(block.osm_element_id, 'w630317457',
      'a surveyed building must carry the element it came from');
  });
});

test('demo accounts are refreshed, not merely inserted when missing', () => {
  withStaleStore(store => {
    // The bug this guards: insert-only left the stored user on the old address,
    // so renaming the demo domain silently broke sign-in for every existing
    // install with no error to explain it.
    const student = store.users.find((u: { id: string }) => u.id === 'usr-student-1');
    assert.ok(student, 'the demo student must still exist');
    assert.notEqual(
      student.email,
      `alex.rivera@${OLD_DOMAIN}`,
      'the demo account is still on the old address, so sign-in would fail'
    );
    assert.match(student.email, /\.invalid$/,
      'a demo address must sit on a TLD that cannot resolve, so it is never deliverable');
  });
});

test('the migration loses nothing it did not have to change', () => {
  withStaleStore(store => {
    assert.ok(
      store.announcements.some((a: { id: string }) => a.id === 'anc-legacy'),
      'an unrelated record was destroyed by the migration'
    );
    assert.ok(
      store.buildings.some((b: { id: string }) => b.id === 'bld-adm'),
      'an existing service location was removed'
    );
    assert.equal(store.links.length, 1,
      "an administrator's confirmed building link must survive an upgrade");
  });
});

test('a migrated store is written back, so the fix survives a restart', () => {
  const dir = mkdtempSync(join(tmpdir(), 'campusflow-migrate-'));
  try {
    writeStaleStore(dir);
    boot(dir);
    const onDisk = JSON.parse(readFileSync(join(dir, 'campusflow.json'), 'utf-8'));
    assert.match(onDisk.campuses[0].name, /Galgotias University/,
      'the migration was not persisted, so it would repeat on every boot');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
