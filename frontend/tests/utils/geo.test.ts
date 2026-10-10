import {
  ISO_POLYGONS,
  buildSiteFeatureCollection,
  buildZoneFeatureCollection,
  siteFootprint,
  siteHeight,
} from '../../src/utils/geo';
import { makeWorkload, makeZone } from '../fixtures';

describe('ISO polygons', () => {
  it('covers all four ISOs with closed rings', () => {
    expect(Object.keys(ISO_POLYGONS).sort()).toEqual(['CAISO', 'ERCOT', 'MISO', 'PJM']);
    for (const ring of Object.values(ISO_POLYGONS)) {
      expect(ring.length).toBeGreaterThanOrEqual(4);
      expect(ring[0]).toEqual(ring[ring.length - 1]);
    }
  });
});

describe('buildZoneFeatureCollection', () => {
  it('emits one polygon per known zone carrying carbon_intensity for data-driven styling', () => {
    const fc = buildZoneFeatureCollection([makeZone({ carbon_intensity: 123 }), makeZone({ zone_id: 'PJM', carbon_intensity: 333 })]);
    expect(fc.features).toHaveLength(2);
    expect(fc.features[0].geometry.type).toBe('Polygon');
    expect(fc.features.map((f) => f.properties?.carbon_intensity)).toEqual([123, 333]);
    expect(fc.features[0].properties?.label).toContain('CAISO');
  });

  it('skips zones without a polygon', () => {
    expect(buildZoneFeatureCollection([makeZone({ zone_id: 'SPP' })]).features).toHaveLength(0);
  });
});

describe('site extrusions', () => {
  it('creates a closed square footprint centred on the site', () => {
    const ring = siteFootprint([-100, 40], 0.1);
    expect(ring).toHaveLength(5);
    expect(ring[0]).toEqual(ring[4]);
    const lons = ring.map(([lon]) => lon);
    expect(Math.min(...lons)).toBeCloseTo(-100.1);
    expect(Math.max(...lons)).toBeCloseTo(-99.9);
  });

  it('scales building height with utilisation', () => {
    const idle = siteHeight(makeWorkload({ current_kw: 0, max_kw: 1000 }));
    const full = siteHeight(makeWorkload({ current_kw: 1000, max_kw: 1000 }));
    expect(idle).toBeGreaterThan(0);
    expect(full).toBeGreaterThan(idle);
    expect(siteHeight(makeWorkload({ current_kw: 5000, max_kw: 1000 }))).toBe(full); // clamped
  });

  it('includes status colour + height and skips sites without coordinates', () => {
    const fc = buildSiteFeatureCollection([
      makeWorkload({ status: 'DEFER' }),
      makeWorkload({ id: 'nowhere', coordinates: null }),
    ]);
    expect(fc.features).toHaveLength(1);
    expect(fc.features[0].properties).toMatchObject({ id: 'dc-santaclara', status: 'DEFER', color: '#ef4444' });
    expect(fc.features[0].properties?.height).toBeGreaterThan(0);
  });
});
