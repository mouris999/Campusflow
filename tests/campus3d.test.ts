import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  CAMPUS_GEOMETRY,
  campusTileRange,
  geometryProvenance,
  latLonToLocal,
  localToLatLon,
  massingHeight,
  metresPerPixel,
  pointInRing,
  ringCentroid,
  FootprintIndex
} from '../src/lib/campusGeo.js';
import {
  CampusRouteGraph,
  ASSUMED_WALKING_SPEED_MPS,
  ROUTE_SPEED_IS_ASSUMED,
  formatDistance,
  isInsideAnyBuilding
} from '../src/lib/campusRoute.js';
import { CampusPositioner } from '../src/lib/campusPosition.js';
import { projectLayout } from '../src/lib/campusLayout.js';
import type { Building } from '../src/types/index.js';

// ------------------------------------------------------- real geometry

test('the committed geometry is real OpenStreetMap data, not hand-authored', () => {
  const raw = readFileSync(join(process.cwd(), 'src', 'data', 'campus-geometry.json'), 'utf-8');
  const parsed = JSON.parse(raw);

  assert.equal(parsed.$schema, 'campus-geometry/v1');
  assert.match(parsed.source, /OpenStreetMap/i, 'the source must name OpenStreetMap');
  assert.match(parsed.source_url, /openstreetmap\.org/, 'an attribution URL is required by ODbL');
  assert.match(parsed.captured_at, /^\d{4}-\d{2}-\d{2}$/);
});

test('the capture covers a whole campus, not a handful of boxes', () => {
  assert.ok(
    CAMPUS_GEOMETRY.buildings.length > 100,
    `expected a real campus footprint set, got ${CAMPUS_GEOMETRY.buildings.length}`
  );
  assert.ok(
    CAMPUS_GEOMETRY.roads.length > 50,
    `expected a real road network, got ${CAMPUS_GEOMETRY.roads.length}`
  );
  assert.ok(CAMPUS_GEOMETRY.sports.length > 0, 'sports facilities must be present');
});

test('every footprint is a real closed ring of plausible coordinates', () => {
  for (const b of CAMPUS_GEOMETRY.buildings) {
    assert.ok(b.footprint.length >= 3, `${b.id} has too few vertices`);
    assert.ok(b.area_m2 > 0, `${b.id} has no area`);
    // Local metre grid centred on the campus, 900 m radius.
    for (const [x, y] of b.footprint) {
      assert.ok(Number.isFinite(x) && Number.isFinite(y), `${b.id} has a non-finite vertex`);
      assert.ok(
        Math.abs(x) <= 1200 && Math.abs(y) <= 1200,
        `${b.id} vertex (${x}, ${y}) lies outside the captured extent`
      );
    }
  }
});

test('the real campus is recognisable from the source names', () => {
  // Proves the capture landed on the actual campus rather than empty coordinates.
  const names = CAMPUS_GEOMETRY.buildings.map(b => b.name ?? '').join(' ').toLowerCase();
  assert.match(names, /galgotias/, 'the two named university blocks should be present');

  // The School of Hospitality is mapped in OSM as a point, not a polygon, so it
  // is captured as a named point. It is deliberately NOT given an invented
  // footprint: that is exactly the kind of invented geometry this project refuses.
  const all = [
    ...CAMPUS_GEOMETRY.buildings,
    ...CAMPUS_GEOMETRY.sports,
    ...CAMPUS_GEOMETRY.green,
    ...CAMPUS_GEOMETRY.other
  ];
  const hospitality = all.find(x => (x.name ?? '').toLowerCase().includes('hospitality'));
  assert.ok(hospitality, 'the School of Hospitality should be captured somewhere');
  assert.equal(
    (hospitality as { footprint?: unknown }).footprint,
    undefined,
    'a point-mapped feature must not be given a fabricated footprint'
  );
});

// ---------------------------------------------------- no invented values

test('building height is measured when OSM has it, and one documented default otherwise', () => {
  let surveyed = 0;
  let assumed = 0;

  for (const b of CAMPUS_GEOMETRY.buildings) {
    const { metres, source } = massingHeight(b);
    assert.ok(metres > 0 && metres < 400, `${b.id} has an implausible height of ${metres}`);

    if (source === 'osm') {
      surveyed += 1;
      assert.ok(
        b.height_m != null || b.levels != null,
        `${b.id} claims an OSM height but records neither height nor levels`
      );
    } else {
      assumed += 1;
      // The assumed case must always be the same documented constant, never random.
      assert.equal(metres, 12, 'assumed heights must be one fixed documented value');
    }
  }

  assert.ok(surveyed > 0, 'at least some heights should come from the source data');
  assert.ok(assumed > 0, 'and the test must cover the assumed case too');

  const p = geometryProvenance();
  assert.equal(p.surveyed, surveyed);
  assert.equal(p.assumed, assumed);
  assert.equal(p.total, CAMPUS_GEOMETRY.buildings.length);
});

test('provenance is reportable, so assumed geometry is never presented as surveyed', () => {
  const p = geometryProvenance();
  assert.ok(p.total > 0);
  assert.ok(p.surveyed + p.assumed === p.total);
  // Named buildings come from the source, so the UI can show what is actually known.
  assert.ok(Array.isArray(p.namedBuildings));
});

// --------------------------------------------------------- position honesty

const fakeBuildings: Building[] = [
  {
    id: 'bld-adm',
    campus_id: 'camp-main',
    name: 'Main Administration Building',
    code: 'ADM',
    floor_count: 4,
    description: '',
    map_coords: { x: 28, y: 35 }
  },
  {
    id: 'bld-lib',
    campus_id: 'camp-main',
    name: 'Williamson Central Library',
    code: 'LIB',
    floor_count: 5,
    description: '',
    map_coords: { x: 68, y: 30 }
  }
];

test('a service position is unverified until an admin confirms a real building', () => {
  const positioner = new CampusPositioner([]);
  const at = positioner.positionFor(fakeBuildings[0])!;

  assert.ok(at, 'a schematically placed building must still get a position');
  assert.equal(at.verified, false, 'a projected position must never claim to be surveyed');
  assert.equal(at.source, 'layout_projection');
});

test('an admin link produces a verified position on the real footprint', () => {
  const target = CAMPUS_GEOMETRY.buildings[0];
  const positioner = new CampusPositioner([
    { campusflow_building_id: 'bld-adm', osm_element_id: target.id, verified_by: 'admin' }
  ]);
  const at = positioner.positionFor(fakeBuildings[0])!;

  assert.equal(at.verified, true);
  assert.equal(at.source, 'admin_link');
  assert.equal(at.osmElementId, target.id);

  // The position must be the real footprint's centroid, not a projection.
  const expected = ringCentroid(target.footprint);
  assert.ok(Math.abs(at.position[0] - expected[0]) < 1, 'x should be the real centroid');
  assert.ok(Math.abs(at.position[1] - expected[1]) < 1, 'y should be the real centroid');
});

test('a link pointing at a missing OSM element falls back to unverified, not a crash', () => {
  const positioner = new CampusPositioner([
    { campusflow_building_id: 'bld-adm', osm_element_id: 'w-does-not-exist' }
  ]);
  const at = positioner.positionFor(fakeBuildings[0])!;
  assert.equal(at.verified, false);
  assert.equal(at.source, 'layout_projection');
});

test('the schematic projection lands inside the captured campus extent', () => {
  for (const b of fakeBuildings) {
    const [x, y] = projectLayout(b);
    assert.ok(Math.abs(x) < CAMPUS_GEOMETRY.radius_m, `${b.id} x is outside the campus`);
    assert.ok(Math.abs(y) < CAMPUS_GEOMETRY.radius_m, `${b.id} y is outside the campus`);
  }
});

test('relative layout order is preserved by the projection', () => {
  // The library is right of and above the admin block in the 2D map; the
  // projection must keep that relationship rather than scrambling it.
  const [ax, ay] = projectLayout(fakeBuildings[0]);
  const [lx, ly] = projectLayout(fakeBuildings[1]);
  assert.ok(lx > ax, 'library should stay east of admin');
  assert.ok(ly > ay, 'library should stay north of admin on the 3D plane');
});

// ------------------------------------------------------------- walking routes

test('walking routes are measured along real mapped paths', () => {
  const graph = new CampusRouteGraph();
  // Two real road vertices from the captured network.
  const first = CAMPUS_GEOMETRY.roads.find(r => r.line.length >= 4);
  assert.ok(first, 'the capture must contain a usable road');
  const from = first.line[0];
  const to = first.line[first.line.length - 1];

  const result = graph.route(from, to);
  assert.equal(result.ok, true, `expected a real route, got: ${result.reason}`);
  assert.ok(result.distance_m > 0);
  assert.ok(result.used_highways.length > 0, 'the route must report what it walked on');
  assert.ok(result.points.length >= 2);
});

test('a route between unconnected points fails loudly instead of drawing a straight line', () => {
  const graph = new CampusRouteGraph();
  // Far outside the campus: no mapped path can exist here.
  const result = graph.route([9000, 9000], [-9000, -9000]);
  assert.equal(result.ok, false, 'an unmapped route must not be invented');
  assert.equal(result.distance_m, 0);
  assert.ok(result.reason && result.reason.length > 0, 'a failure must explain itself');
});

test('walking time is derived from a stated assumption, and the assumption is exposed', () => {
  assert.equal(ROUTE_SPEED_IS_ASSUMED, true, 'the UI depends on this flag being true');
  assert.ok(ASSUMED_WALKING_SPEED_MPS > 0.5 && ASSUMED_WALKING_SPEED_MPS < 2);
});

test('distances format the way a sign would', () => {
  assert.equal(formatDistance(640), '640 m');
  assert.equal(formatDistance(1540), '1.5 km');
});

// -------------------------------------------------------------- tile maths

test('the campus maps to a real tile range inside the request budget', () => {
  const range = campusTileRange(18, 64);
  assert.ok(range.count > 0, 'a real campus must need at least one tile');
  assert.ok(range.count <= 64, 'tile budget exceeded: ' + range.count);
  assert.ok(range.maxX >= range.minX && range.maxY >= range.minY);
  // z=18 alone is 210 tiles and a 52 MB compositing canvas, so the budget must
  // have stepped the zoom down. A performance requirement, not a preference.
  assert.equal(range.reduced, true, 'the zoom should have been reduced to fit the budget');
  assert.ok(range.z < 18);
  assert.ok(metresPerPixel(range.z) > 0.1 && metresPerPixel(range.z) < 3);
});

test('the tile budget is respected for any requested zoom', () => {
  for (const z of [15, 16, 17, 18, 19, 20]) {
    const range = campusTileRange(z, 64);
    assert.ok(range.count <= 64, 'z=' + z + ' resolved to ' + range.count + ' tiles, over budget');
  }
});

test('a generous budget keeps the requested zoom', () => {
  const range = campusTileRange(18, 4096);
  assert.equal(range.z, 18);
  assert.equal(range.reduced, false);
});

test('local coordinates round-trip through WGS84', () => {
  const { lat, lon } = localToLatLon(120, -80);
  const [x, y] = latLonToLocal(lat, lon);
  assert.ok(Math.abs(x - 120) < 0.5, `x drifted: ${x}`);
  assert.ok(Math.abs(y - -80) < 0.5, `y drifted: ${y}`);
});

// ------------------------------------------------------------ spatial index

test('the footprint index finds the building a point is inside', () => {
  const index = new FootprintIndex(CAMPUS_GEOMETRY.buildings);
  const b = CAMPUS_GEOMETRY.buildings.find(x => x.area_m2 > 1500)!;
  const [cx, cy] = ringCentroid(b.footprint);
  assert.equal(pointInRing(cx, cy, b.footprint), true, 'a centroid must be inside its own ring');

  const found = index.nearest(cx, cy, 30);
  assert.ok(found, 'the index should resolve a point inside a known building');
  assert.equal(found.id, b.id);
});

test('inside/outside tests agree with a point far off campus', () => {
  assert.equal(isInsideAnyBuilding(5000, 5000), false);
});

// ------------------------------------------------- regression guard

test('the old invented walking-distance fudge factor is gone from the 2D map', () => {
  // Regression guard. CampusMap previously computed distance as
  // sqrt(dx^2 + dy^2) * 9.5 and called it "distanceMeters" - a plausible but
  // entirely invented number presented to students as a real distance.
  const src = readFileSync(join(process.cwd(), 'src', 'components', 'CampusMap.tsx'), 'utf-8');
  assert.ok(
    !/\*\s*9\.5\b/.test(src),
    'CampusMap must not scale map percentages by an invented factor again'
  );
  assert.ok(
    !/Math\.sqrt\(dx \* dx \+ dy \* dy\)/.test(src),
    'CampusMap must not derive walking distance from map percentages'
  );
  assert.ok(
    src.includes('campusRouteGraph'),
    'CampusMap must measure distance on the real path network'
  );
});

test('the 3D layers never import a random source for operational values', () => {
  // Any Math.random in the 3D layer would let a displayed value differ run to
  // run, which is exactly the failure mode the no-fakes rule exists to prevent.
  for (const name of [
    'CampusScene.ts',
    'TrafficLayer.ts',
    'BuildingsLayer.ts',
    'SurfacesLayer.ts',
    'NavigationLayer.ts',
    'SatelliteGround.ts'
  ]) {
    const src = readFileSync(join(process.cwd(), 'src', 'three', name), 'utf-8');
    assert.ok(
      !/Math\.random/.test(src),
      `${name} uses Math.random, which would make a displayed value non-reproducible`
    );
  }
});

test('the walkable network is connected enough to route between real places', () => {
  // Regression guard. Snapping resolves a point to the nearest *vertex*, so a
  // long straight segment with vertices only at its ends left every point along
  // it unreachable: one campus building measured an infinite distance from any
  // path, and only 1 of 21 building pairs could be routed. Edges are now split
  // so vertices are dense, which is what makes a route possible at all.
  const graph = new CampusRouteGraph();
  const conn = graph.connectivity();
  assert.ok(conn.nodes > 5000, `expected a densified network, got ${conn.nodes} nodes`);
  assert.ok(
    conn.largestComponent / conn.nodes > 0.9,
    `the walkable network is fragmented: only ${conn.largestComponent} of ${conn.nodes} nodes are reachable together`
  );
});

test('every projected campus building is near a real walkable path', () => {
  // A building whose entrance is unreachable from the network cannot be routed
  // to, and the student is told there is no route rather than shown a straight line.
  const graph = new CampusRouteGraph();
  const projections: Array<[string, [number, number]]> = [
    ['bld-adm', [-309, 211]],
    ['bld-stu', [28, -70]],
    ['bld-lib', [253, 281]],
    ['bld-sci', [-421, -281]],
    ['bld-eng', [421, -211]],
    ['bld-nor', [-70, 491]],
    ['bld-lrn', [168, -449]]
  ];

  for (const [id, at] of projections) {
    const approach = graph.approachDistance(at[0], at[1]);
    assert.ok(
      Number.isFinite(approach),
      `${id} is unreachable: no walkable path node anywhere near it`
    );
    assert.ok(approach < 200, `${id} sits ${approach.toFixed(0)} m from the nearest path`);
  }
});

test('most building pairs produce a real measured route', () => {
  const graph = new CampusRouteGraph();
  const points: Array<[string, [number, number]]> = [
    ['bld-adm', [-309, 211]],
    ['bld-stu', [28, -70]],
    ['bld-lib', [253, 281]],
    ['bld-sci', [-421, -281]],
    ['bld-eng', [421, -211]],
    ['bld-nor', [-70, 491]],
    ['bld-lrn', [168, -449]]
  ];

  let routed = 0;
  let pairs = 0;
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      pairs += 1;
      const r = graph.route(points[i][1], points[j][1]);
      if (r.ok) {
        routed += 1;
        assert.ok(r.distance_m > 0, 'a routed pair must have a positive measured distance');
        assert.ok(r.approach_m >= 0, 'the off-path approach must be reported, not hidden');
      }
    }
  }

  assert.ok(
    routed / pairs > 0.9,
    `only ${routed} of ${pairs} building pairs could be routed; the network is too fragmented`
  );
});