/**
 * Where a CampusFlow service sits on the real campus.
 *
 * The CampusFlow campus is a schematic layout: each building has an `x`/`y`
 * percentage that places it on the existing 2D map. The 3D campus is real
 * OpenStreetMap geometry centred on real coordinates. Reconciling the two is
 * this module's job, and the rule is strict:
 *
 *   1. A verified position comes only from an admin-configured link to a real
 *      OSM building. That is the only source marked `verified: true`.
 *   2. Without a link, the schematic layout position is projected onto the real
 *      campus extent and marked `verified: false`. It is the app's own layout
 *      expressed in real-campus coordinates - it is NOT a claim that a given
 *      real structure is this service.
 *   3. If neither is available, the service is omitted from the 3D scene. It is
 *      never placed at an arbitrary point.
 *
 * The distinction is surfaced in the UI so a reader can tell a surveyed location
 * from a schematic one.
 */

import { CAMPUS_GEOMETRY, FootprintIndex, ringCentroid } from './campusGeo.js';
import { projectLayout } from './campusLayout.js';
import type { Building } from '../types/index.js';

/** An admin's explicit link from a CampusFlow building to a real OSM element. */
export interface CampusLink {
  campusflow_building_id: string;
  osm_element_id: string;
  /** How the link was established, for display and audit. */
  verified_by?: string | null;
  verified_at?: string | null;
  note?: string | null;
}

export interface PositionResult {
  position: [number, number];
  verified: boolean;
  /** Why this position, shown in the info panel. */
  source: 'admin_link' | 'layout_projection' | null;
  osmElementId?: string;
  osmElementName?: string | null;
}

const index = new FootprintIndex(CAMPUS_GEOMETRY.buildings);

export class CampusPositioner {
  private readonly links: Map<string, CampusLink>;

  constructor(links: CampusLink[] = []) {
    this.links = new Map(links.map(l => [l.campusflow_building_id, l]));
  }

  /** Returns the position for a CampusFlow building, or null if it cannot be placed. */
  positionFor(building: Building): PositionResult | null {
    // 1. An explicit admin link always wins, because it is the only verified source.
    const link = this.links.get(building.id);
    if (link) {
      const target = CAMPUS_GEOMETRY.buildings.find(b => b.id === link.osm_element_id);
      if (target) {
        return {
          position: ringCentroid(target.footprint),
          verified: true,
          source: 'admin_link',
          osmElementId: target.id,
          osmElementName: target.name
        };
      }
    }

    // 2. Fall back to the schematic layout, clearly marked unverified.
    if (building.map_coords && Number.isFinite(building.map_coords.x)) {
      return {
        position: projectLayout(building),
        verified: false,
        source: 'layout_projection'
      };
    }

    return null;
  }

  /** Nearest real OSM building to a point, for reverse lookup in the admin screen. */
  nearestRealBuilding(x: number, y: number, maxMetres = 120) {
    return index.nearest(x, y, maxMetres);
  }

  /** Real OSM elements that an admin could plausibly link to, for the picker. */
  linkableBuildings() {
    return CAMPUS_GEOMETRY.buildings
      .map(b => ({
        id: b.id,
        name: b.name,
        area_m2: b.area_m2,
        height_m: b.height_m,
        centre: ringCentroid(b.footprint)
      }))
      .sort((a, b) => b.area_m2 - a.area_m2);
  }
}

/**
 * Suggested link targets for a CampusFlow building.
 *
 * These are candidates for an admin to confirm, never applied automatically. A
 * name match is a hint, not proof, so nothing here is treated as verified until
 * a person saves it.
 */
export function suggestLinks(building: Building, all: Building[]): CampusLink[] {
  const words = building.name.toLowerCase().split(/\s+/).filter(w => w.length > 3);
  const out: CampusLink[] = [];

  for (const candidate of CAMPUS_GEOMETRY.buildings) {
    if (!candidate.name) continue;
    const target = candidate.name.toLowerCase();
    const score = words.filter(w => target.includes(w)).length;
    if (score > 0) {
      out.push({
        campusflow_building_id: building.id,
        osm_element_id: candidate.id,
        note: `Name match (${score} keyword${score > 1 ? 's' : ''}) - needs human confirmation`
      });
    }
  }

  void all;
  return out.slice(0, 8);
}
