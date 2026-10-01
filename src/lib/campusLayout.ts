/**
 * Projects the product's schematic 2D campus layout onto the real campus.
 *
 * The CampusFlow campus is a stylised plan: each building carries an `x`/`y`
 * percentage that places it on the 2D map. The 3D campus is real OpenStreetMap
 * geometry in metres. Both the 2D map's walking distances and the 3D markers use
 * this one function, so a distance shown in either view refers to the same place.
 *
 * This is a layout correspondence, not a survey claim. A position derived this way
 * is always reported as `verified: false` - only an admin-configured link to a
 * real OSM element is verified.
 */

import type { Building } from '../types/index.js';
import { CAMPUS_GEOMETRY } from './campusGeo.js';

export function projectLayout(building: Building): [number, number] {
  const r = CAMPUS_GEOMETRY.radius_m;
  // Inset so a service at 0% or 100% lands on the campus, not past its edge.
  const inset = r * 0.78;
  const x = (building.map_coords.x / 100) * 2 * inset - inset;
  // SVG y grows downward; the 3D plane's z grows south, so negate to keep the
  // same visual orientation as the 2D map.
  const z = -((building.map_coords.y / 100) * 2 * inset - inset);
  return [x, z];
}
