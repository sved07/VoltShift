import type { FeatureCollection, Polygon } from 'geojson';
import type { GridZone, IndustrialWorkload, LonLat } from '../types';
import { STATUS_META } from './carbon';

/** Coarse, hand-simplified ISO territory outlines (lon, lat) — good enough for a dashboard. */
export const ISO_POLYGONS: Record<string, LonLat[]> = {
  CAISO: [
    [-124.2, 42.0], [-120.0, 42.0], [-120.0, 39.0], [-114.6, 35.0], [-114.5, 32.7], [-117.1, 32.5],
    [-118.5, 34.0], [-120.6, 34.6], [-122.4, 37.2], [-123.8, 39.5], [-124.2, 42.0],
  ],
  ERCOT: [
    [-103.0, 36.5], [-100.0, 36.5], [-100.0, 34.6], [-94.5, 33.6], [-94.0, 31.0], [-93.8, 29.7],
    [-97.2, 26.0], [-99.5, 27.5], [-101.4, 29.8], [-103.2, 29.0], [-104.7, 30.0], [-106.6, 32.0],
    [-103.0, 32.0], [-103.0, 36.5],
  ],
  MISO: [
    [-97.2, 49.0], [-89.5, 48.0], [-84.5, 46.5], [-82.4, 43.0], [-84.8, 41.7], [-84.8, 39.1],
    [-88.0, 37.0], [-89.5, 36.5], [-90.2, 35.0], [-91.0, 33.0], [-89.6, 30.2], [-93.8, 29.7],
    [-94.0, 31.0], [-94.5, 33.6], [-94.6, 36.5], [-95.8, 40.6], [-96.5, 43.5], [-96.6, 45.9],
    [-97.2, 49.0],
  ],
  PJM: [
    [-84.8, 41.7], [-80.5, 42.0], [-79.8, 42.3], [-75.1, 41.9], [-74.7, 41.4], [-73.9, 40.9],
    [-74.0, 39.6], [-75.0, 38.8], [-75.2, 38.0], [-76.0, 37.0], [-77.5, 36.5], [-81.7, 36.6],
    [-83.7, 36.6], [-82.6, 38.2], [-84.8, 39.1], [-84.8, 41.7],
  ],
};

export const SITE_FOOTPRINT_DEG = 0.025;
const MIN_HEIGHT_M = 400;
const MAX_EXTRA_HEIGHT_M = 2600;

export function buildZoneFeatureCollection(zones: GridZone[]): FeatureCollection<Polygon> {
  return {
    type: 'FeatureCollection',
    features: zones
      .filter((z) => ISO_POLYGONS[z.zone_id])
      .map((z) => ({
        type: 'Feature',
        id: z.zone_id,
        properties: {
          zone_id: z.zone_id,
          name: z.name,
          carbon_intensity: z.carbon_intensity,
          renewable_pct: z.renewable_pct,
          label: `${z.zone_id}\n${Math.round(z.carbon_intensity)} g · ${Math.round(z.renewable_pct)}% RE`,
        },
        geometry: { type: 'Polygon', coordinates: [ISO_POLYGONS[z.zone_id]] },
      })),
  };
}

export function siteFootprint([lon, lat]: LonLat, half = SITE_FOOTPRINT_DEG): LonLat[] {
  return [
    [lon - half, lat - half],
    [lon + half, lat - half],
    [lon + half, lat + half],
    [lon - half, lat + half],
    [lon - half, lat - half],
  ];
}

export function siteHeight(w: IndustrialWorkload): number {
  const utilisation = w.max_kw > 0 ? Math.min(1, Math.max(0, w.current_kw / w.max_kw)) : 0;
  return MIN_HEIGHT_M + MAX_EXTRA_HEIGHT_M * utilisation;
}

export function buildSiteFeatureCollection(
  workloads: IndustrialWorkload[],
): FeatureCollection<Polygon> {
  return {
    type: 'FeatureCollection',
    features: workloads
      .filter((w): w is IndustrialWorkload & { coordinates: LonLat } => Array.isArray(w.coordinates))
      .map((w) => ({
        type: 'Feature',
        id: w.id,
        properties: {
          id: w.id,
          site_name: w.site_name,
          status: w.status,
          height: siteHeight(w),
          color: STATUS_META[w.status].color,
        },
        geometry: { type: 'Polygon', coordinates: [siteFootprint(w.coordinates)] },
      })),
  };
}
