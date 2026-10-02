import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  CAMPUS_IDENTITY,
  CAMPUS_PLACES,
  CAMPUS_PLACES_FILE,
  PLACE_CATEGORIES,
  groupedPlaces,
  isPlaceAnchored,
  placeAnchor,
  placesByCategory,
  placesIntegrity,
  placesProvenance,
  type CampusPlaceCategory
} from '../src/lib/campusPlaces.js';
import { CAMPUS_GEOMETRY } from '../src/lib/campusGeo.js';

/**
 * The real Galgotias University directory must stay real.
 *
 * These tests exist to stop the directory decaying back into the thing FIX.md #12
 * removed from this map: places that look authoritative on screen but whose
 * position, name or existence nobody can check. Three properties are enforced:
 *
 *   1. No coordinates. The places file cannot contain a position, so a pin can
 *      only ever come from a surveyed OpenStreetMap element.
 *   2. Every entry is sourced, with a working-looking https link.
 *   3. Every claimed position traces to an element that is really in the
 *      committed geometry capture.
 */

// -------------------------------------------------------------- no invented data

test('the places file carries no coordinates of its own', () => {
  const raw = readFileSync(join(process.cwd(), 'src', 'data', 'campus-places.json'), 'utf-8');

  // A position field is the whole risk: any lat/lon or x/y here would be a
  // typed-in guess that the UI could present as a surveyed location.
  for (const forbidden of ['"lat"', '"lon"', '"x"', '"y"', '"coordinates"', '"map_coords"']) {
    assert.ok(
      !raw.includes(forbidden),
      `campus-places.json must not contain a ${forbidden} field; positions come from the survey only`
    );
  }

  // Nor should anything look like a coordinate pair.
  assert.ok(
    !/\d{2}\.\d{4,},\s*\d{2}\.\d{4,}/.test(raw),
    'campus-places.json must not contain a lat/lon pair'
  );
});

test('every place is sourced and internally consistent', () => {
  assert.deepEqual(placesIntegrity(), [], 'the places data has integrity problems');
});

test('the places file declares its schema', () => {
  assert.equal(CAMPUS_PLACES_FILE.$schema, 'campus-places/v1');
});

test('the directory actually contains the real university, not a token entry or two', () => {
  // A regression guard: if someone trims this to a handful of entries the map
  // stops being a description of Galgotias University.
  assert.ok(CAMPUS_PLACES.length >= 40, `expected a real directory, got ${CAMPUS_PLACES.length}`);

  const names = CAMPUS_PLACES.map(p => p.name.toLowerCase()).join(' ');
  for (const real of [
    'galgotias university',
    'school of computer science and engineering',
    'school of hospitality',
    'school of law',
    'central library',
    'registrar'
  ]) {
    assert.ok(names.includes(real), `the directory is missing a real GU unit: ${real}`);
  }
});

// -------------------------------------------------------- positions are surveyed

test('a place is pinned only when the survey names it', () => {
  const anchored = CAMPUS_PLACES.filter(isPlaceAnchored);
  const unanchored = CAMPUS_PLACES.filter(p => !isPlaceAnchored(p));

  assert.ok(anchored.length > 0, 'at least some places must resolve to a surveyed position');
  assert.ok(unanchored.length > 0, 'the unpositioned case must be covered by this test too');

  for (const place of anchored) {
    assert.ok(
      place.osm_element_id,
      `${place.name} has a position but names no OpenStreetMap element`
    );
  }
  for (const place of unanchored) {
    assert.equal(
      placeAnchor(place),
      null,
      `${place.name} must have no position, because nothing surveys one`
    );
  }
});

test('every pinned place resolves to a feature that is really in the capture', () => {
  const present = new Set<string>();
  for (const layer of [
    CAMPUS_GEOMETRY.buildings,
    CAMPUS_GEOMETRY.sports,
    CAMPUS_GEOMETRY.green,
    CAMPUS_GEOMETRY.water,
    CAMPUS_GEOMETRY.parking,
    CAMPUS_GEOMETRY.wood,
    CAMPUS_GEOMETRY.other,
    CAMPUS_GEOMETRY.trees
  ]) {
    for (const feature of layer) present.add(feature.id);
  }

  for (const place of CAMPUS_PLACES) {
    if (!place.osm_element_id) continue;
    assert.ok(
      present.has(place.osm_element_id),
      `${place.name} points at ${place.osm_element_id}, which is not in campus-geometry.json`
    );
  }
});

test('a pinned place resolves to its real geometry, not a nominal coordinate', () => {
  const block = CAMPUS_PLACES.find(p => p.id === 'gu-block-c')!;
  const surveyed = CAMPUS_GEOMETRY.buildings.find(b => b.id === 'w630317457')!;

  const anchor = placeAnchor(block);
  assert.ok(anchor, 'C-Block is named by the survey, so it must resolve');

  const xs = surveyed.footprint.map(p => p[0]);
  const ys = surveyed.footprint.map(p => p[1]);
  assert.ok(
    anchor[0] >= Math.min(...xs) && anchor[0] <= Math.max(...xs),
    'the anchor must lie inside the real footprint it came from'
  );
  assert.ok(
    anchor[1] >= Math.min(...ys) && anchor[1] <= Math.max(...ys),
    'the anchor must lie inside the real footprint it came from'
  );
});

test('a point-mapped place is anchored at its point, not given a footprint', () => {
  // The School of Hospitality is a node in OpenStreetMap. It must resolve to a
  // point, and must never acquire an invented outline. FIX.md #13.
  const hospitality = CAMPUS_PLACES.find(p => p.id === 'gu-school-hospitality')!;
  const anchor = placeAnchor(hospitality);
  assert.ok(anchor, 'the School of Hospitality is named by the survey');

  const recorded = CAMPUS_GEOMETRY.other.find(f => f.id === hospitality.osm_element_id)!;
  assert.equal((recorded as { footprint?: unknown }).footprint, undefined);
  assert.equal(anchor[0], recorded.x);
  assert.equal(anchor[1], recorded.y);
});

test('the survey only names a handful of campus features, and the counts say so', () => {
  const provenance = placesProvenance();

  assert.equal(provenance.total, CAMPUS_PLACES.length);
  assert.equal(provenance.anchored + provenance.unanchored, provenance.total);

  // OpenStreetMap names five features on this campus. If this count jumps, the
  // capture was refreshed and the copy in CampusPlaces.tsx and the docs need to
  // match, so fail here rather than let the UI quietly disagree.
  assert.equal(
    provenance.anchored,
    5,
    'expected exactly the five campus features the survey names to be pinnable'
  );

  // And the unpositioned majority is the honest reason the directory exists.
  assert.ok(
    provenance.unanchored > provenance.anchored,
    'most real GU places cannot be positioned; the UI must present that plainly'
  );
});

// ------------------------------------------------------------- grouping and copy

test('every place belongs to a category the UI can label', () => {
  const known = new Set<CampusPlaceCategory>(PLACE_CATEGORIES.map(c => c.id));
  for (const place of CAMPUS_PLACES) {
    assert.ok(known.has(place.category), `${place.name} has an unlabelable category`);
  }
});

test('grouping is complete and loses nothing', () => {
  const grouped = groupedPlaces();
  const flattened = grouped.flatMap(g => g.places);
  assert.equal(flattened.length, CAMPUS_PLACES.length, 'grouping dropped or duplicated a place');

  for (const group of grouped) {
    assert.ok(group.places.length > 0, 'an empty group must not be rendered');
    assert.ok(group.label.length > 0 && group.blurb.length > 0);
  }
});

test('category lookups agree with the raw list', () => {
  const schools = placesByCategory('school');
  assert.ok(schools.length >= 20, `expected the real school list, got ${schools.length}`);
  assert.ok(schools.every(p => p.category === 'school'));
});

// ------------------------------------------------------------- campus identity

test('the campus identity on the map is the real university', () => {
  assert.match(CAMPUS_IDENTITY.name, /Galgotias University/);
  assert.match(CAMPUS_IDENTITY.address, /Sector 17-A/);
  assert.match(CAMPUS_IDENTITY.address, /Greater Noida/);
  assert.equal(CAMPUS_IDENTITY.established, 2011);
  assert.match(CAMPUS_IDENTITY.founder, /Galgotia/);
  assert.match(CAMPUS_IDENTITY.accreditation, /NAAC/);
  assert.match(CAMPUS_IDENTITY.website, /^https:\/\//);
});

// ------------------------------------------------------ the view tells the truth

test('the directory states the difference between pinned and unpositioned', () => {
  const src = readFileSync(join(process.cwd(), 'src', 'components', 'CampusPlaces.tsx'), 'utf-8');

  // Both states must be visibly distinct in the UI, not just in the data.
  assert.ok(src.includes("anchored ? 'PINNED' : 'NO PIN'"), 'each place must show its pin state');
  assert.ok(
    src.includes('position not confirmed'),
    'an unpositioned place must say why it has no pin'
  );
  assert.ok(
    src.includes('placesIntegrity') === false,
    'integrity checking belongs in tests, not in the shipped component'
  );
});

test('the service map shows the real campus it is drawing', () => {
  const src = readFileSync(join(process.cwd(), 'src', 'components', 'CampusMap.tsx'), 'utf-8');
  assert.ok(src.includes('CAMPUS_IDENTITY'), 'the map header must name the real campus');
  assert.ok(src.includes('CampusPlaces'), 'the map must host the real campus directory');
});
