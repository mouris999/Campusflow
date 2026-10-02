/**
 * Build-time script: pulls REAL campus geometry from OpenStreetMap and bakes it
 * into a static data file.
 *
 * Why this exists
 * ---------------
 * The campus is real: Galgotias University, Greater Noida. To show real satellite
 * imagery and real building shapes, geometry has to come from an authoritative
 * source rather than from anything invented here. OpenStreetMap is
 * authoritative, openly licensed (ODbL), and needs no API key.
 *
 * The output is committed, so the running app never depends on Overpass being up.
 * Swap this file for a higher-fidelity capture (or official CAD) later without
 * touching the application - see ARCHITECTURE.md "Geometry replacement".
 *
 * Usage:  node --import tsx scripts/build-campus-geometry.mts
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Real campus centre.
 *
 * The owner supplied 28.364714, 77.539902. A first capture at that point put the
 * campus core ~275 m north-east, on the far edge of the view, and cut off half
 * the campus. The centre below is the centroid of the two blocks that
 * OpenStreetMap actually names for this campus ("B-Block (Galgotias University)"
 * and "C-Block (Galgotias University)"), so the whole campus sits in frame.
 * Derived from the source data, not guessed.
 */
const CENTER = { lat: 28.365858, lon: 77.542225 };

/** Capture radius in metres. Wide enough to show the whole campus and its edge. */
const RADIUS_M = 900;

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter'
];

// ---------------------------------------------------------------- projection

/** Metres per degree at this latitude. Good enough over ~1.5 km. */
const M_PER_DEG_LAT = 111_320;
function metresPerDegLon(lat: number): number {
  return 111_320 * Math.cos((lat * Math.PI) / 180);
}

/**
 * Projects WGS84 to a local metre grid centred on the campus, x = east,
 * y = north. Local metres are what the renderer wants (no projection distortion
 * at this scale) and keep the JSON small.
 */
function makeProjector(lat: number, lon: number) {
  const mPerLon = metresPerDegLon(lat);
  return {
    toLocal(p: { lat: number; lon: number }): [number, number] {
      return [
        Math.round((p.lon - lon) * mPerLon),
        Math.round((p.lat - lat) * M_PER_DEG_LAT)
      ];
    }
  };
}

// ----------------------------------------------------------------- simplify

/**
 * Ramer-Douglas-Peucker on a local-metre polyline.
 *
 * Overpass returns full-resolution geometry, which is far more detail than a
 * campus-scale massing model can use. Simplifying here keeps the committed file
 * small and the render cheap, without inventing anything: the remaining corners
 * are still real surveyed points.
 */
function simplify(points: [number, number][], toleranceM: number): [number, number][] {
  if (points.length < 3) return points;

  const sqTol = toleranceM * toleranceM;
  const keep = new Array<boolean>(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;

  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [first, last] = stack.pop()!;
    let maxSq = 0;
    let index = -1;
    const [ax, ay] = points[first];
    const [bx, by] = points[last];
    const dx = bx - ax;
    const dy = by - ay;
    const denom = dx * dx + dy * dy;

    for (let i = first + 1; i < last; i++) {
      const [px, py] = points[i];
      let t = denom === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / denom;
      t = Math.max(0, Math.min(1, t));
      const cx = ax + t * dx;
      const cy = ay + t * dy;
      const ddx = px - cx;
      const ddy = py - cy;
      const sq = ddx * ddx + ddy * ddy;
      if (sq > maxSq) {
        maxSq = sq;
        index = i;
      }
    }

    if (maxSq > sqTol && index !== -1) {
      keep[index] = true;
      stack.push([first, index], [index, last]);
    }
  }

  return points.filter((_, i) => keep[i]);
}

// ------------------------------------------------------------------ classify

/**
 * Maps OSM tags to the layers the 3D scene renders. Classification is derived
 * only from tags present in the source data - nothing here guesses a use.
 */
function classify(tags: Record<string, string> = {}): string {
  if (tags.leisure) {
    if (['pitch', 'track', 'sports_centre', 'stadium', 'tennis', 'basketball'].includes(tags.leisure)) {
      return 'sports';
    }
    if (['park', 'garden', 'pitch'].includes(tags.leisure)) return 'green';
    if (['grass', 'recreation_ground'].includes(tags.leisure)) return 'green';
  }
  if (tags.natural === 'water' || tags.waterway) return 'water';
  if (tags.natural === 'wood' || tags.landuse === 'forest') return 'wood';
  if (tags.amenity === 'parking' || tags.parking) return 'parking';
  if (tags.building) {
    if (tags.building === 'yes' || tags.building === 'house') return 'building';
    if (['apartments', 'residential', 'university', 'school', 'college', 'hospital',
         'retail', 'commercial', 'office', 'industrial', 'warehouse', 'church',
         'garage', 'garages', 'civic', 'public'].includes(tags.building)) {
      return 'building';
    }
    return 'building';
  }
  if (tags.highway) return 'road';
  if (tags.barrier === 'wall' || tags.man_made) return 'structure';
  return 'other';
}

/** OSM "height" / building:levels, where present, in metres. */
function heightOf(tags: Record<string, string> = {}): number | null {
  const raw = tags.height;
  if (raw) {
    const m = raw.match(/^([\d.]+)\s*m?$/);
    if (m) return Math.round(Number(m[1]));
  }
  const levels = tags['building:levels'] ?? tags['building:levels:underground'];
  if (levels) {
    const n = Number(levels);
    if (Number.isFinite(n) && n > 0) return Math.round(n * 3.2);
  }
  return null;
}

// --------------------------------------------------------------------- fetch

async function overpass(query: string): Promise<any> {
  let lastError = '';
  for (const endpoint of OVERPASS_ENDPOINTS) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': 'CampusFlow/1.0 (campus geometry build; one-off)'
          },
          body: new URLSearchParams({ data: query })
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.json();
      } catch (err) {
        lastError = `${endpoint} attempt ${attempt}: ${(err as Error).message}`;
        await new Promise(r => setTimeout(r, 2500 * attempt));
      }
    }
  }
  throw new Error(`all Overpass endpoints failed - last: ${lastError}`);
}

async function main() {
  console.log(`Campus geometry build`);
  console.log(`  centre : ${CENTER.lat}, ${CENTER.lon}`);
  console.log(`  radius : ${RADIUS_M} m`);

  // Bounding box in degrees for the radius. Small enough to be fast, large
  // enough to include the whole campus edge.
  const dLat = RADIUS_M / M_PER_DEG_LAT;
  const dLon = RADIUS_M / metresPerDegLon(CENTER.lat);
  const bbox = [
    (CENTER.lat - dLat).toFixed(6),
    (CENTER.lon - dLon).toFixed(6),
    (CENTER.lat + dLat).toFixed(6),
    (CENTER.lon + dLon).toFixed(6)
  ].join(',');

  const query = `[out:json][timeout:180];
(
  way["building"](${bbox});
  way["building:part"](${bbox});
  relation["building"](${bbox});
  way["leisure"](${bbox});
  way["natural"](${bbox});
  way["amenity"="parking"](${bbox});
  way["landuse"](${bbox});
  way["waterway"](${bbox});
  way["highway"](${bbox});
  way["barrier"="wall"](${bbox});
  node["natural"="tree"](${bbox});
  node["leisure"](${bbox});
  node["amenity"](${bbox});
);
out geom qt;`;

  console.log('  querying OpenStreetMap Overpass ...');
  const data = await overpass(query);
  const elements: any[] = data.elements ?? [];
  console.log(`  received ${elements.length} real OSM elements`);

  const project = makeProjector(CENTER.lat, CENTER.lon);

  const out = {
    buildings: [] as any[],
    roads: [] as any[],
    sports: [] as any[],
    green: [] as any[],
    water: [] as any[],
    parking: [] as any[],
    wood: [] as any[],
    trees: [] as any[],
    other: [] as any[]
  };

  // The longest lat/lon chain in a multi-way/relation element is its outer ring.
  function rings(el: any): [number, number][][] {
    if (el.geometry) return [el.geometry.filter((g: any) => g).map(project.toLocal)];
    if (Array.isArray(el.members)) {
      const chains = el.members
        .filter((m: any) => Array.isArray(m.geometry) && m.geometry.length)
        .map((m: any) => m.geometry.filter((g: any) => g).map(project.toLocal));
      return chains;
    }
    return [];
  }

  for (const el of elements) {
    const tags = el.tags ?? {};
    const kind = classify(tags);

    // Roads are linear, handled separately.
    if (kind === 'road' && el.geometry) {
      const line = simplify(
        el.geometry.filter((g: any) => g).map(project.toLocal),
        1.5
      );
      if (line.length >= 2) {
        out.roads.push({
          id: `w${el.id}`,
          name: tags.name ?? tags.ref ?? null,
          highway: tags.highway,
          surface: tags.surface ?? null,
          line
        });
      }
      continue;
    }

    // Trees and point amenities.
    if (el.type === 'node' && el.lat != null) {
      const [x, y] = project.toLocal({ lat: el.lat, lon: el.lon });
      if (tags.natural === 'tree' || kind === 'green') {
        out.trees.push({ id: `n${el.id}`, x, y, kind });
      } else {
        out.other.push({ id: `n${el.id}`, x, y, kind, name: tags.name ?? null });
      }
      continue;
    }

    const polygons = rings(el).filter(r => r.length >= 3);
    for (const ring of polygons) {
      const simplified = simplify(ring, 2.0);
      if (simplified.length < 3) continue;

      const area = Math.abs(
        simplified.reduce((acc, p, i) => {
          const q = simplified[(i + 1) % simplified.length];
          return acc + p[0] * q[1] - q[0] * p[1];
        }, 0) / 2
      );

      const record: any = {
        id: `${el.type[0]}${el.id}`,
        name: tags.name ?? null,
        footprint: simplified,
        area_m2: Math.round(area)
      };

      if (kind === 'building') {
        record.height_m = heightOf(tags);
        record.levels = tags['building:levels'] ? Number(tags['building:levels']) : null;
        record.building_type = tags.building ?? 'yes';
        record.kind_hint =
          tags.amenity ?? tags.building ?? tags['building:use'] ?? null;
        out.buildings.push(record);
      } else if (kind === 'sports') {
        record.sport = tags.sport ?? tags.leisure ?? null;
        out.sports.push(record);
      } else if (kind === 'green') {
        out.green.push(record);
      } else if (kind === 'water') {
        out.water.push(record);
      } else if (kind === 'wood') {
        out.wood.push(record);
      } else if (kind === 'parking') {
        out.parking.push(record);
      } else {
        out.other.push({ ...record, kind });
      }
    }
  }

  const payload = {
    $schema: 'campus-geometry/v1',
    source: 'OpenStreetMap via Overpass API (ODbL 1.0)',
    source_url: 'https://www.openstreetmap.org/copyright',
    captured_at: new Date().toISOString().slice(0, 10),
    centre: CENTER,
    radius_m: RADIUS_M,
    projection: 'local metric grid, x = east metres, y = north metres, origin at centre',
    counts: {
      buildings: out.buildings.length,
      roads: out.roads.length,
      sports: out.sports.length,
      green: out.green.length,
      water: out.water.length,
      parking: out.parking.length,
      wood: out.wood.length,
      trees: out.trees.length,
      other: out.other.length
    },
    ...out
  };

  const target = join(__dirname, '..', 'src', 'data', 'campus-geometry.json');
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, JSON.stringify(payload), 'utf-8');

  const bytes = JSON.stringify(payload).length;
  console.log('  wrote', target);
  console.log('  counts:', JSON.stringify(payload.counts));
  console.log(`  size: ${(bytes / 1024).toFixed(0)} kB`);
  console.log('  attribution: OpenStreetMap contributors, ODbL 1.0 - must be displayed');
}

main().catch(err => {
  console.error('FAILED:', err);
  process.exit(1);
});
