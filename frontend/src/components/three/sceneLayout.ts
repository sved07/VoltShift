import type { GridZone, IndustrialWorkload, LonLat } from '../../types';

export type Vec3 = [number, number, number];

const MAP_CENTER: LonLat = [-96, 38];
const X_SCALE = 0.2;
const Z_SCALE = 0.32;
export const ZONE_ELEVATION = 0.6;
const SITE_RING_RADIUS = 1.05;

/** Lon/lat -> scene space. +x is east, +z is south (towards the camera). */
export function project([lon, lat]: LonLat, y = 0): Vec3 {
  return [(lon - MAP_CENTER[0]) * X_SCALE, y, -(lat - MAP_CENTER[1]) * Z_SCALE];
}

/** Sites orbit their ISO node in a ring, so dense metros don't overlap their zone. */
export function sitePosition(zonePos: Vec3, index: number, count: number): Vec3 {
  const angle = (index / Math.max(count, 1)) * Math.PI * 2 + Math.PI / 4;
  return [zonePos[0] + Math.cos(angle) * SITE_RING_RADIUS, 0, zonePos[2] + Math.sin(angle) * SITE_RING_RADIUS];
}

/** Control point lifting a link into an arc; longer links arc higher. */
export function arcMidpoint(a: Vec3, b: Vec3, lift = 0.9): Vec3 {
  const span = Math.hypot(a[0] - b[0], a[2] - b[2]);
  return [(a[0] + b[0]) / 2, Math.max(a[1], b[1]) + lift + span * 0.18, (a[2] + b[2]) / 2];
}

export interface ZoneLayout {
  zone: GridZone;
  position: Vec3;
}

export interface SiteLayout {
  workload: IndustrialWorkload;
  position: Vec3;
  zonePosition: Vec3;
}

export interface Flow {
  from: ZoneLayout;
  to: ZoneLayout;
}

export function layoutZones(zones: GridZone[]): ZoneLayout[] {
  return zones.map((zone) => ({ zone, position: project(zone.coordinates, ZONE_ELEVATION) }));
}

export function layoutSites(workloads: IndustrialWorkload[], zones: ZoneLayout[]): SiteLayout[] {
  const byZone = new Map(zones.map((z) => [z.zone.zone_id, z.position]));
  const counts = new Map<string, number>();
  for (const w of workloads) counts.set(w.zone_id, (counts.get(w.zone_id) ?? 0) + 1);
  const seen = new Map<string, number>();

  return workloads.flatMap((workload) => {
    const zonePosition = byZone.get(workload.zone_id);
    if (!zonePosition) return [];
    const index = seen.get(workload.zone_id) ?? 0;
    seen.set(workload.zone_id, index + 1);
    return [{ workload, zonePosition, position: sitePosition(zonePosition, index, counts.get(workload.zone_id)!) }];
  });
}

/**
 * Energy "routing": clean power is drawn from the cleanest zone toward every dirtier one.
 * Flows are ordered so the dirtiest destination comes first.
 */
export function routingFlows(zones: ZoneLayout[]): Flow[] {
  if (zones.length < 2) return [];
  const sorted = [...zones].sort((a, b) => a.zone.carbon_intensity - b.zone.carbon_intensity);
  const [cleanest, ...rest] = sorted;
  return rest.reverse().map((to) => ({ from: cleanest, to }));
}

/** Utilisation 0..1, used for building height. */
export function utilisation(w: IndustrialWorkload): number {
  return w.max_kw > 0 ? Math.min(1, Math.max(0, w.current_kw / w.max_kw)) : 0;
}
