/**
 * Straight-line (haversine) distance between two GPS points, in metres.
 * Deliberately NOT road distance — no routing/mapping provider is used
 * (Phase 4, ADR 0033). `null` in means the calculation is skipped, never
 * faked (e.g. a visit with no known site coordinates).
 */
const EARTH_RADIUS_METERS = 6_371_000;

export interface GeoPoint {
  lat: number;
  lng: number;
}

export function haversineDistanceMeters(a: GeoPoint, b: GeoPoint): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return EARTH_RADIUS_METERS * c;
}

/** Returns `null` when either point is missing — a visit may have no known
 *  site coordinates, and that must not be treated as (0, 0). */
export function computeGpsDistanceMeters(
  site: GeoPoint | null,
  point: GeoPoint | null,
): number | null {
  if (!site || !point) return null;
  return haversineDistanceMeters(site, point);
}
