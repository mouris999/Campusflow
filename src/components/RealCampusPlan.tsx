import React, { useMemo } from 'react';
import {
  CAMPUS_GEOMETRY,
  OSM_ATTRIBUTION,
  SATELLITE_ATTRIBUTION,
  type CampusRoad
} from '../lib/campusGeo.js';

/**
 * The real campus plan, drawn from OpenStreetMap geometry.
 *
 * This replaces a decorative SVG that was not a map of anything: it had a
 * fabricated "Central Quad" circle, three invented walkway curves, and a
 * caption reading "UNIVERSITY CENTRAL QUAD - 1892", a founding year for a
 * university that does not exist. Every shape here is a real surveyed feature.
 *
 * Rendered into the same 0..100 viewBox the CampusFlow service pins already use,
 * so the pins, the route line and the rest of the service map drop straight in
 * without changing any of their coordinates.
 */

/** Local metres to the 0..100 plan space, inset so nothing clips the edge. */
function project(x: number, y: number): [number, number] {
  const r = CAMPUS_GEOMETRY.radius_m;
  const inset = r * 0.94;
  return [50 + (x / inset) * 50, 50 - (y / inset) * 50];
}

function ringPath(ring: [number, number][]): string {
  return ring
    .map((p, i) => {
      const [sx, sy] = project(p[0], p[1]);
      return `${i === 0 ? 'M' : 'L'} ${sx.toFixed(2)} ${sy.toFixed(2)}`;
    })
    .join(' ') + ' Z';
}

function linePath(line: [number, number][]): string {
  return line
    .map((p, i) => {
      const [sx, sy] = project(p[0], p[1]);
      return `${i === 0 ? 'M' : 'L'} ${sx.toFixed(2)} ${sy.toFixed(2)}`;
    })
    .join(' ');
}

function centroid(ring: [number, number][]): [number, number] {
  let cx = 0;
  let cy = 0;
  for (const p of ring) {
    cx += p[0];
    cy += p[1];
  }
  return [cx / ring.length, cy / ring.length];
}

/**
 * Position for a feature that may be a polygon or a bare point.
 *
 * OpenStreetMap maps some campus features, including the School of
 * Hospitality, as a node with no outline. Those still have a real location, so
 * they are placed at that point rather than given an invented footprint.
 */
function anchorOf(feature: { footprint?: [number, number][]; x?: number; y?: number }):
  | [number, number]
  | null {
  if (Array.isArray(feature.footprint) && feature.footprint.length >= 3) {
    return centroid(feature.footprint);
  }
  if (typeof feature.x === 'number' && typeof feature.y === 'number') {
    return [feature.x, feature.y];
  }
  return null;
}

/** Road width in plan units, from the OSM class. Keeps footpaths visible. */
function planWidth(highway: string): number {
  switch (highway) {
    case 'motorway':
    case 'motorway_link':
    case 'trunk':
    case 'primary':
      return 0.95;
    case 'secondary':
      return 0.7;
    case 'tertiary':
      return 0.5;
    case 'residential':
    case 'unclassified':
      return 0.38;
    case 'service':
      return 0.26;
    default:
      return 0.2; // footway, path, steps, track
  }
}

export const RealCampusPlan: React.FC<{ children?: React.ReactNode }> = ({ children }) => {
  const { roads, buildings, green, water, parking, sports, wood, other } = CAMPUS_GEOMETRY;

  // Real features OpenStreetMap actually names, for labelling.
  const named = useMemo(() => {
    const out: Array<{ id: string; name: string; at: [number, number]; isPoint: boolean }> = [];
    const add = (feature: {
      id: string;
      name?: string | null;
      footprint?: [number, number][];
      x?: number;
      y?: number;
    }) => {
      if (!feature.name) return;
      const at = anchorOf(feature);
      if (!at) return;
      out.push({
        id: feature.id,
        name: feature.name,
        at,
        isPoint: !Array.isArray(feature.footprint)
      });
    };
    for (const b of buildings) add(b);
    for (const a of sports) add(a);
    for (const a of green) add(a);
    for (const a of other) add(a);
    return out;
  }, [buildings, sports, green, other]);

  // Roads grouped by width band, so we emit far fewer path elements.
  const roadBands = useMemo(() => {
    const bands = new Map<number, string[]>();
    for (const road of roads as CampusRoad[]) {
      if (road.line.length < 2) continue;
      const w = planWidth(road.highway);
      const list = bands.get(w) ?? [];
      list.push(linePath(road.line));
      bands.set(w, list);
    }
    return [...bands.entries()].sort((a, b) => b[0] - a[0]);
  }, [roads]);

  return (
    <svg
      className="w-full h-full"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      role="img"
      aria-label={
        `Plan of the real campus, drawn from OpenStreetMap: ${buildings.length} building footprints, ` +
        `${roads.length} roads and paths, ${sports.length} sports pitches, ` +
        `${green.length} green areas. CampusFlow service markers sit on top of this plan.`
      }
    >
      <rect width="100" height="100" fill="#0b1016" />

      {/* Green space, water, woodland, parking - real land-use polygons. */}
      {green.map(a => (
        <path key={a.id} d={ringPath(a.footprint)} fill="#16301f" stroke="#2c5c3a" strokeWidth={0.12} />
      ))}
      {wood.map(a => (
        <path key={a.id} d={ringPath(a.footprint)} fill="#16301f" stroke="#2c5c3a" strokeWidth={0.12} />
      ))}
      {water.map(a => (
        <path key={a.id} d={ringPath(a.footprint)} fill="#12324e" stroke="#2b5f8a" strokeWidth={0.12} />
      ))}
      {parking.map(a => (
        <path key={a.id} d={ringPath(a.footprint)} fill="#1c2027" stroke="#3a414b" strokeWidth={0.1} />
      ))}

      {/* Sports pitches, marked as such so they are not read as buildings. */}
      {sports.map(a => (
        <path
          key={a.id}
          d={ringPath(a.footprint)}
          fill="#1d4230"
          stroke="#4ec27f"
          strokeWidth={0.22}
          strokeDasharray="1 0.6"
        />
      ))}

      {/* Roads, widest first so junctions read correctly. */}
      {roadBands.map(([width, paths]) => (
        <g key={width}>
          {paths.map((d, i) => (
            <path
              key={i}
              d={d}
              fill="none"
              stroke={width > 0.6 ? '#4b5563' : width > 0.3 ? '#3f4854' : '#5b6472'}
              strokeWidth={width}
              strokeLinecap="round"
            />
          ))}
        </g>
      ))}

      {/* Real building footprints. Unnamed ones stay plain: no invented labels. */}
      {buildings.map(b => (
        <path
          key={b.id}
          d={ringPath(b.footprint)}
          fill="#39414d"
          stroke="#5b6572"
          strokeWidth={0.1}
        />
      ))}

      {/* Labels for the features the source data actually names. */}
      {named.map(n => {
        const [x, y] = project(n.at[0], n.at[1]);
        return (
          <g key={`label-${n.id}`}>
            <text
              x={x}
              y={y}
              fill="#e6e9ef"
              fontSize={n.isPoint ? 1.5 : 1.9}
              fontWeight="700"
              textAnchor="middle"
              paintOrder="stroke"
              stroke="#0b1016"
              strokeWidth={0.45}
              style={{ letterSpacing: '0.02em' }}
            >
              {n.name}
            </text>
            {n.isPoint && (
              // A point-mapped feature gets a dot rather than massing, so it is
              // not mistaken for a surveyed outline.
              <circle cx={x} cy={y} r={0.7} fill="#e6e9ef" opacity={0.75} />
            )}
          </g>
        );
      })}

      {children}

      {/* Attribution is a licence condition of using OpenStreetMap data. */}
      <text
        x="1.2"
        y="98.4"
        fill="#7b8595"
        fontSize="1.5"
        paintOrder="stroke"
        stroke="#0b1016"
        strokeWidth={0.3}
      >
        Plan: {OSM_ATTRIBUTION.replace('© ', '')} · {SATELLITE_ATTRIBUTION}
      </text>
    </svg>
  );
};
