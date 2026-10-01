/**
 * Walking routes over the real campus road and path network.
 *
 * Every distance and time here is measured from OpenStreetMap geometry. The
 * walking speed is a documented, configurable assumption, not campus data, and
 * the UI states which figures are measured and which are assumed.
 */

import { CAMPUS_GEOMETRY, pointInRing, type CampusRoad } from './campusGeo.js';

/**
 * Assumed walking speed in metres per second (1.35 m/s, about 4.9 km/h).
 *
 * This is the one number in a route that is not measured. It is a population
 * average, configurable per deployment, and callers must surface it as an
 * assumption rather than as a campus fact.
 */
export const ASSUMED_WALKING_SPEED_MPS = 1.35;

export const ROUTE_SPEED_IS_ASSUMED = true;

/**
 * Radius within which two road vertices are treated as the same junction.
 *
 * OpenStreetMap ways meet at angles and frequently do not share an exact
 * vertex, so a graph built only from shared vertices comes out fragmented.
 * 15 m is a realistic crossing width and comfortably covers the gap between a
 * road and its parallel footpath.
 */
const JUNCTION_RADIUS_M = 15;

/**
 * Longest edge allowed in the graph, in metres.
 *
 * Snapping resolves a query point to the nearest *vertex*, so a 200 m straight
 * segment whose vertices sit only at its ends leaves every point along it
 * unreachable. Measured on the real network, that put one campus building at an
 * infinite distance from any path. Edges are split so an entrance always has a
 * vertex within reach.
 */
const MAX_EDGE_M = 8;

/** Splits a polyline so no segment is longer than `MAX_EDGE_M`. */
function densify(line: [number, number][]): [number, number][] {
  if (line.length < 2) return line.slice();
  const out: [number, number][] = [];
  for (let i = 0; i < line.length - 1; i++) {
    const [ax, ay] = line[i];
    const [bx, by] = line[i + 1];
    const length = Math.hypot(bx - ax, by - ay);
    const steps = Math.max(1, Math.ceil(length / MAX_EDGE_M));
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      out.push([ax + (bx - ax) * t, ay + (by - ay) * t]);
    }
  }
  out.push(line[line.length - 1]);
  return out;
}

/** How far a point may sit from the walkable network before we refuse. */
const MAX_APPROACH_M = 150;

interface Node {
  x: number;
  y: number;
  edges: { to: number; cost: number }[];
}

/** Roads a pedestrian may actually use. Motorways are excluded. */
function isWalkable(highway: string): boolean {
  return [
    'footway',
    'path',
    'pedestrian',
    'steps',
    'living_street',
    'residential',
    'unclassified',
    'tertiary',
    'secondary',
    'service',
    'track'
  ].includes(highway);
}

export interface RouteResult {
  ok: boolean;
  /** Path in local metres, including the on-foot approach at each end. */
  points: [number, number][];
  /** Measured distance in metres, including both approaches. */
  distance_m: number;
  /** Distance divided by the assumed walking speed. */
  duration_s: number;
  /** What actually carries the route, e.g. "footway, steps, residential". */
  used_highways: string[];
  /**
   * Metres walked before reaching a mapped path and after leaving it. Real
   * campuses have entrances off the footpath network, so this is expected, and
   * it is reported rather than folded silently into the total.
   */
  approach_m: number;
  reason?: string;
}

export class CampusRouteGraph {
  private readonly nodes: Node[] = [];
  private readonly cellSize = JUNCTION_RADIUS_M;
  private readonly grid = new Map<string, number[]>();
  private readonly roads: CampusRoad[];
  /** Road lines split so vertices are dense enough to snap onto. */
  private lines: [number, number][][] = [];

  constructor(roads: CampusRoad[] = CAMPUS_GEOMETRY.roads) {
    this.roads = roads.filter(r => isWalkable(r.highway));

    // Pass 1: a node at every vertex of every densified line, so no coordinate
    // is invented and an entrance always has a nearby vertex.
    this.lines = this.roads.map(road => densify(road.line));
    for (const line of this.lines) {
      for (const [x, y] of line) this.nodeAt(x, y);
    }

    // Pass 2: edges along each road, using true segment lengths.
    for (const line of this.lines) {
      for (let i = 0; i < line.length - 1; i++) {
        const a = this.nearestNode(line[i][0], line[i][1]);
        const b = this.nearestNode(line[i + 1][0], line[i + 1][1]);
        if (a === null || b === null || a === b) continue;
        const cost = Math.hypot(line[i + 1][0] - line[i][0], line[i + 1][1] - line[i][1]);
        // Walking is symmetric.
        this.link(a, b, cost);
        this.link(b, a, cost);
      }
    }

    // Pass 3: join ways that cross or meet without sharing a vertex.
    this.connectJunctions();
  }

  /** Adds an edge once, ignoring exact duplicates. */
  private link(a: number, b: number, cost: number) {
    const from = this.nodes[a];
    if (from.edges.some(e => e.to === b)) return;
    from.edges.push({ to: b, cost });
  }

  private connectJunctions() {
    for (let a = 0; a < this.nodes.length; a++) {
      const na = this.nodes[a];
      for (const b of this.nearby(na.x, na.y)) {
        if (b <= a) continue;
        const nb = this.nodes[b];
        const d = Math.hypot(na.x - nb.x, na.y - nb.y);
        if (d > JUNCTION_RADIUS_M) continue;
        // The crossing costs the real gap between the vertices, so a route never
        // claims to be shorter than the ground it actually covers.
        this.link(a, b, d);
        this.link(b, a, d);
      }
    }
  }

  private key(x: number, y: number): string {
    return `${Math.floor(x / this.cellSize)}:${Math.floor(y / this.cellSize)}`;
  }

  private nodeAt(x: number, y: number): number {
    const k = this.key(x, y);
    const existing = this.grid.get(k);
    // Only reuse when effectively the same point, so junctions stay accurate.
    for (const idx of existing ?? []) {
      const n = this.nodes[idx];
      if (Math.hypot(n.x - x, n.y - y) < 0.5) return idx;
    }
    const index = this.nodes.length;
    this.nodes.push({ x, y, edges: [] });
    if (existing) existing.push(index);
    else this.grid.set(k, [index]);
    return index;
  }

  /**
   * Node indices near a point, wide enough to cover JUNCTION_RADIUS_M in every
   * direction. Two nodes exactly the radius apart can fall two cells apart
   * diagonally, so a 3x3 scan would silently miss those junctions.
   */
  private nearby(x: number, y: number): number[] {
    const cx = Math.floor(x / this.cellSize);
    const cy = Math.floor(y / this.cellSize);
    const span = Math.ceil(JUNCTION_RADIUS_M / this.cellSize) + 1;
    const out: number[] = [];
    for (let i = -span; i <= span; i++) {
      for (let j = -span; j <= span; j++) {
        const list = this.grid.get(`${cx + i}:${cy + j}`);
        if (list) out.push(...list);
      }
    }
    return out;
  }

  /**
   * Nearest graph node to a point.
   *
   * Searches outward far enough that a building whose entrance is set back from
   * the footpath still resolves. How close is close *enough* to claim a route is
   * a separate policy decision, made in `route()` against MAX_APPROACH_M, so
   * this function stays purely mechanical.
   */
  private nearestNode(x: number, y: number): number | null {
    const cx = Math.floor(x / this.cellSize);
    const cy = Math.floor(y / this.cellSize);
    let best: number | null = null;
    let bestDist = Infinity;

    // 14 cells at 12 m covers 168 m, past MAX_APPROACH_M, so `route()` always
    // gets a node and can make the honest yes/no decision itself.
    for (let ring = 0; ring <= 14; ring++) {
      for (let i = -ring; i <= ring; i++) {
        for (let j = -ring; j <= ring; j++) {
          if (ring > 0 && Math.abs(i) !== ring && Math.abs(j) !== ring) continue;
          const list = this.grid.get(`${cx + i}:${cy + j}`);
          if (!list) continue;
          for (const n of list) {
            const d = Math.hypot(this.nodes[n].x - x, this.nodes[n].y - y);
            if (d < bestDist) {
              bestDist = d;
              best = n;
            }
          }
        }
      }
      // Once a node is found there is nothing a wider ring can improve by more
      // than the cell size, so stop early.
      if (best !== null) return best;
    }
    return best;
  }

  /** How far a point sits from the walkable network, for honest reporting. */
  approachDistance(x: number, y: number): number {
    const n = this.nearestNode(x, y);
    if (n === null) return Infinity;
    return Math.hypot(this.nodes[n].x - x, this.nodes[n].y - y);
  }

  /** Largest connected component, for diagnosing a fragmented network. */
  connectivity(): { nodes: number; largestComponent: number } {
    const seen = new Array<boolean>(this.nodes.length).fill(false);
    let largest = 0;
    for (let i = 0; i < this.nodes.length; i++) {
      if (seen[i]) continue;
      let size = 0;
      const stack = [i];
      seen[i] = true;
      while (stack.length > 0) {
        const at = stack.pop()!;
        size += 1;
        for (const e of this.nodes[at].edges) {
          if (!seen[e.to]) {
            seen[e.to] = true;
            stack.push(e.to);
          }
        }
      }
      if (size > largest) largest = size;
    }
    return { nodes: this.nodes.length, largestComponent: largest };
  }

  /**
   * Dijkstra between two points on the real walkable network.
   *
   * Returns `ok: false` with a reason rather than a straight line when no real
   * path exists, so the UI can say "no mapped walking route" instead of drawing
   * a fictional one.
   */
  route(from: [number, number], to: [number, number]): RouteResult {
    const start = this.nearestNode(from[0], from[1]);
    const goal = this.nearestNode(to[0], to[1]);

    const fail = (reason: string): RouteResult => ({
      ok: false,
      points: [],
      distance_m: 0,
      duration_s: 0,
      used_highways: [],
      approach_m: 0,
      reason
    });

    if (start === null || goal === null) {
      return fail(
        'No walkable campus path is mapped near one of these locations. OpenStreetMap may not have the footpath network here yet.'
      );
    }

    const approachIn = Math.hypot(this.nodes[start].x - from[0], this.nodes[start].y - from[1]);
    const approachOut = Math.hypot(this.nodes[goal].x - to[0], this.nodes[goal].y - to[1]);

    if (approachIn > MAX_APPROACH_M || approachOut > MAX_APPROACH_M) {
      return fail(
        `These locations are more than ${MAX_APPROACH_M} m from any mapped campus path, so a walking route cannot be measured honestly.`
      );
    }

    const dist = new Array<number>(this.nodes.length).fill(Infinity);
    const prev = new Array<number>(this.nodes.length).fill(-1);
    const visited = new Array<boolean>(this.nodes.length).fill(false);
    dist[start] = 0;

    // A few hundred nodes, so a linear scan beats a heap here.
    for (;;) {
      let u = -1;
      let best = Infinity;
      for (let i = 0; i < this.nodes.length; i++) {
        if (!visited[i] && dist[i] < best) {
          best = dist[i];
          u = i;
        }
      }
      if (u === -1) break;
      if (u === goal) break;
      visited[u] = true;

      for (const edge of this.nodes[u].edges) {
        const next = dist[u] + edge.cost;
        if (next < dist[edge.to]) {
          dist[edge.to] = next;
          prev[edge.to] = u;
        }
      }
    }

    if (!Number.isFinite(dist[goal])) {
      return fail(
        'These two locations are not connected by a mapped campus path. The road network in OpenStreetMap may be incomplete here.'
      );
    }

    const chain: [number, number][] = [];
    for (let at = goal; at !== -1; at = prev[at]) {
      chain.unshift([this.nodes[at].x, this.nodes[at].y]);
    }
    // Include the real on-foot approach at each end.
    chain.unshift(from);
    chain.push(to);

    // Report which road classes actually carried the route.
    const used = new Set<string>();
    for (const r of this.roads) {
      for (let i = 0; i < r.line.length - 1; i++) {
        if (chain.some(p => pointToSegment(p[0], p[1], r.line[i], r.line[i + 1]) < 2)) {
          used.add(r.highway);
        }
      }
    }

    const total = dist[goal] + approachIn + approachOut;
    return {
      ok: true,
      points: chain,
      distance_m: Math.round(total),
      duration_s: Math.round(total / ASSUMED_WALKING_SPEED_MPS),
      used_highways: [...used],
      approach_m: Math.round(approachIn + approachOut)
    };
  }
}

let cached: CampusRouteGraph | null = null;

export function campusRouteGraph(): CampusRouteGraph {
  if (!cached) cached = new CampusRouteGraph();
  return cached;
}

/** Formats a measured distance the way a sign would. */
export function formatDistance(metres: number): string {
  if (metres < 1000) return `${Math.round(metres / 10) * 10} m`;
  return `${(metres / 1000).toFixed(1)} km`;
}

/** Formats a duration derived from the assumed walking speed. */
export function formatDuration(seconds: number): string {
  const minutes = Math.max(1, Math.round(seconds / 60));
  return `${minutes} min`;
}

/** True when a point sits inside any real building footprint. */
export function isInsideAnyBuilding(x: number, y: number): boolean {
  return CAMPUS_GEOMETRY.buildings.some(b => pointInRing(x, y, b.footprint));
}

function pointToSegment(
  px: number,
  py: number,
  a: [number, number],
  b: [number, number]
): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - a[0], py - a[1]);
  let t = ((px - a[0]) * dx + (py - a[1]) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (a[0] + t * dx), py - (a[1] + t * dy));
}
