/**
 * Real Galgotias University places, sourced from the university and OpenStreetMap.
 *
 * Why this is separate from the queue data
 * ---------------------------------------
 * `campus-geometry.json` holds the physical campus: real footprints, roads and
 * land use captured from OpenStreetMap. `campus-places.json` holds the campus's
 * real *institution*: the schools, centres, offices and facilities Galgotias
 * University actually publishes, each with the page it was taken from.
 *
 * The rule this module exists to enforce
 * -------------------------------------
 * A place in this file may carry an `osm_element_id`, and nothing else that
 * describes where it is. There is deliberately no `x`, no `y`, no `lat`, no
 * `lon` field anywhere in the schema, so a coordinate cannot be typed in by
 * mistake or drift out of step with the survey. `placeAnchor()` resolves a
 * position only by looking that identifier up in the committed OpenStreetMap
 * geometry, and returns `null` when the survey has no such element.
 *
 * That is why 5 of the 70-odd places carry a pin and the rest do not:
 * OpenStreetMap names only B-Block, C-Block, School of Hospitality, the Sports
 * Ground and the BasketBall Ground on this campus, and tags the other ~330
 * footprints with nothing but `building=house` or `building=yes`. The university
 * publishes its schools and facilities but never publishes coordinates for them.
 * Pinning them anyway would mean inventing 65 positions, which is precisely the
 * class of fabrication FIX.md #12 removed from this map.
 *
 * `placesIntegrity()` reports what is and is not anchored so the UI, and the
 * tests, can state the difference rather than hide it.
 *
 * Attribution: OpenStreetMap contributors, ODbL 1.0, for the anchored features.
 */

import { CAMPUS_GEOMETRY, ringCentroid, type CampusArea } from './campusGeo.js';

export type CampusPlaceCategory =
  | 'academic_block'
  | 'school'
  | 'industry_centre'
  | 'research'
  | 'academic_office'
  | 'student_affairs'
  | 'library'
  | 'dining'
  | 'health'
  | 'sports'
  | 'residential'
  | 'retail'
  | 'transport';

export interface CampusPlace {
  id: string;
  /** Exactly as the university or the survey publishes it. Never reworded. */
  name: string;
  category: CampusPlaceCategory;
  /** Where this entry came from. Required on every single entry. */
  source_url: string;
  /**
   * The OpenStreetMap element that anchors this place, when the survey names
   * it. This is the only thing that can place a place on the map.
   */
  osm_element_id?: string;
  /** A qualification taken from the source, not an inference. */
  note?: string;
}

export interface CampusIdentity {
  name: string;
  location: string;
  address: string;
  established: number;
  founder: string;
  accreditation: string;
  website: string;
  registrar_email: string;
  phone: string;
}

export interface CampusPlacesFile {
  $schema: 'campus-places/v1';
  campus: CampusIdentity;
  places: CampusPlace[];
}

import placesJson from '../data/campus-places.json' with { type: 'json' };

export const CAMPUS_PLACES_FILE = placesJson as unknown as CampusPlacesFile;

export const CAMPUS_IDENTITY: CampusIdentity = CAMPUS_PLACES_FILE.campus;

export const CAMPUS_PLACES: CampusPlace[] = CAMPUS_PLACES_FILE.places;

/** Display order and label for each category, so the UI never invents wording. */
export const PLACE_CATEGORIES: Array<{ id: CampusPlaceCategory; label: string; blurb: string }> = [
  { id: 'academic_block', label: 'Academic blocks', blurb: 'Teaching blocks named by the survey' },
  { id: 'school', label: 'Schools', blurb: 'Academic schools listed by the university' },
  { id: 'industry_centre', label: 'Industry centres', blurb: 'Industry-integrated academic centres' },
  { id: 'research', label: 'Research', blurb: 'Research cells and laboratories' },
  { id: 'academic_office', label: 'Academic offices', blurb: 'Registrar, examinations and student welfare' },
  { id: 'student_affairs', label: 'Student affairs', blurb: 'Councils, schemes and student support' },
  { id: 'library', label: 'Library', blurb: 'Borrowing and study' },
  { id: 'dining', label: 'Dining', blurb: 'Catering and food outlets' },
  { id: 'health', label: 'Health', blurb: 'Medical and fitness' },
  { id: 'sports', label: 'Sports', blurb: 'Play and athletics' },
  { id: 'residential', label: 'Residential', blurb: 'Hostel and everyday services' },
  { id: 'retail', label: 'Retail and banking', blurb: 'Shops, stores and cash points' },
  { id: 'transport', label: 'Transport', blurb: 'Campus bus services' }
];

const CATEGORY_IDS = new Set(PLACE_CATEGORIES.map(c => c.id));

/**
 * Every geometry feature that has a real position, keyed by OSM element id.
 *
 * Polygon features resolve to their centroid, point features (the School of
 * Hospitality is mapped as a node) to their own coordinate. Built once.
 */
const anchors = new Map<string, [number, number]>();

function registerAnchors(features: Array<CampusArea & { x?: number; y?: number }>): void {
  for (const feature of features) {
    if (Array.isArray(feature.footprint) && feature.footprint.length >= 3) {
      anchors.set(feature.id, ringCentroid(feature.footprint));
    } else if (typeof feature.x === 'number' && typeof feature.y === 'number') {
      anchors.set(feature.id, [feature.x, feature.y]);
    }
  }
}

for (const layer of [
  CAMPUS_GEOMETRY.buildings,
  CAMPUS_GEOMETRY.sports,
  CAMPUS_GEOMETRY.green,
  CAMPUS_GEOMETRY.water,
  CAMPUS_GEOMETRY.parking,
  CAMPUS_GEOMETRY.wood,
  CAMPUS_GEOMETRY.other
] as Array<Array<CampusArea & { x?: number; y?: number }>>) {
  registerAnchors(layer);
}
for (const point of CAMPUS_GEOMETRY.trees) {
  anchors.set(point.id, [point.x, point.y]);
}

/**
 * The surveyed position of a place, in local metres.
 *
 * Returns `null` unless the place names an OpenStreetMap element that is present
 * in the committed capture. A place the survey does not name has no honest
 * position, and callers must show it without a pin rather than guess one.
 */
export function placeAnchor(place: CampusPlace): [number, number] | null {
  if (!place.osm_element_id) return null;
  return anchors.get(place.osm_element_id) ?? null;
}

/** True when this place's position comes from survey data rather than a guess. */
export function isPlaceAnchored(place: CampusPlace): boolean {
  return placeAnchor(place) !== null;
}

export function placesByCategory(category: CampusPlaceCategory): CampusPlace[] {
  return CAMPUS_PLACES.filter(p => p.category === category);
}

/** Groups the directory into display order, dropping categories with no entries. */
export function groupedPlaces(): Array<{
  id: CampusPlaceCategory;
  label: string;
  blurb: string;
  places: CampusPlace[];
}> {
  return PLACE_CATEGORIES.map(meta => ({
    ...meta,
    places: placesByCategory(meta.id)
  })).filter(group => group.places.length > 0);
}

export interface PlacesProvenance {
  total: number;
  /** Places with a real surveyed position, and therefore a pin on the plan. */
  anchored: number;
  /**
   * Places the university names but the survey does not position. Listed, never
   * pinned. This number is reported in the UI so the gap stays visible.
   */
  unanchored: number;
  byCategory: Record<CampusPlaceCategory, number>;
}

export function placesProvenance(): PlacesProvenance {
  const byCategory = Object.fromEntries(
    PLACE_CATEGORIES.map(c => [c.id, 0])
  ) as Record<CampusPlaceCategory, number>;

  let anchored = 0;
  for (const place of CAMPUS_PLACES) {
    byCategory[place.category] = (byCategory[place.category] ?? 0) + 1;
    if (isPlaceAnchored(place)) anchored += 1;
  }

  return {
    total: CAMPUS_PLACES.length,
    anchored,
    unanchored: CAMPUS_PLACES.length - anchored,
    byCategory
  };
}

/**
 * Everything wrong with the places data, as a list of plain-English problems.
 *
 * Exported so the test suite can assert it is empty, and so a future edit that
 * drops a source link or points at a deleted OSM element fails loudly instead of
 * quietly rendering a place nobody can verify.
 */
export function placesIntegrity(): string[] {
  const problems: string[] = [];
  const seenIds = new Set<string>();
  const seenNames = new Set<string>();

  for (const place of CAMPUS_PLACES) {
    if (!place.id) problems.push('a place has no id');
    if (seenIds.has(place.id)) problems.push(`duplicate id: ${place.id}`);
    seenIds.add(place.id);

    if (!place.name || place.name.trim().length < 2) {
      problems.push(`${place.id} has no usable name`);
    }
    const nameKey = place.name.toLowerCase();
    if (seenNames.has(nameKey)) problems.push(`duplicate name: ${place.name}`);
    seenNames.add(nameKey);

    if (!CATEGORY_IDS.has(place.category)) {
      problems.push(`${place.id} uses unknown category "${place.category}"`);
    }
    if (!/^https:\/\//.test(place.source_url)) {
      problems.push(`${place.id} has no https source link`);
    }
    if (place.osm_element_id && !anchors.has(place.osm_element_id)) {
      problems.push(`${place.id} points at ${place.osm_element_id}, which the capture does not contain`);
    }
  }

  // The identity block is quoted on the map, so it has to be real too.
  for (const field of ['name', 'address', 'website', 'registrar_email'] as const) {
    if (!CAMPUS_IDENTITY[field]) problems.push(`campus identity is missing ${field}`);
  }
  if (!/^\d{4}$/.test(String(CAMPUS_IDENTITY.established))) {
    problems.push('campus identity has no 4-digit founding year');
  }

  if (anchoredCount() === 0) {
    problems.push('no place resolves to a surveyed position');
  }

  return problems;
}

function anchoredCount(): number {
  return CAMPUS_PLACES.filter(isPlaceAnchored).length;
}
