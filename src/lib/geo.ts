/**
 * Campus geometry helpers.
 *
 * The campus map renders buildings on a 0-100 coordinate plane. The same scale
 * constants are used by the server-side alternative engine so the distance a
 * student is shown always matches the distance that was scored on.
 */

export const CAMPUS_METERS_PER_MAP_UNIT = 9.5;
export const WALK_METERS_PER_MINUTE = 80;

export interface MapPoint {
  x: number;
  y: number;
}

export function campusDistanceMeters(from: MapPoint, to: MapPoint): number {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  return Math.round(Math.sqrt(dx * dx + dy * dy) * CAMPUS_METERS_PER_MAP_UNIT);
}

export function walkingMinutes(meters: number): number {
  if (meters <= 0) return 0;
  return Math.max(1, Math.round(meters / WALK_METERS_PER_MINUTE));
}

export function formatDistance(meters: number): string {
  if (meters < 1000) return `${meters}m`;
  return `${(meters / 1000).toFixed(1)}km`;
}
