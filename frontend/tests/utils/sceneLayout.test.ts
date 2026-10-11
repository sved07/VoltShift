import {
  arcMidpoint,
  layoutSites,
  layoutZones,
  project,
  routingFlows,
  utilisation,
  ZONE_ELEVATION,
} from '../../src/components/three/sceneLayout';
import { makeWorkload, makeZone } from '../fixtures';

const zones = [
  makeZone({ zone_id: 'CAISO', carbon_intensity: 90, coordinates: [-119.6, 37.2] }),
  makeZone({ zone_id: 'ERCOT', carbon_intensity: 410, coordinates: [-99.0, 31.2] }),
  makeZone({ zone_id: 'PJM', carbon_intensity: 300, coordinates: [-77.8, 39.9] }),
  makeZone({ zone_id: 'MISO', carbon_intensity: 620, coordinates: [-91.5, 42.0] }),
];

describe('project', () => {
  it('keeps geography: west is -x, north is -z', () => {
    const [caisoX] = project([-119.6, 37.2]);
    const [pjmX] = project([-77.8, 39.9]);
    expect(caisoX).toBeLessThan(0);
    expect(pjmX).toBeGreaterThan(0);
    expect(project([-96, 45])[2]).toBeLessThan(project([-96, 30])[2]);
  });

  it('fits the continental US inside a ~10 unit wide stage', () => {
    for (const z of layoutZones(zones)) expect(Math.abs(z.position[0])).toBeLessThan(6);
  });
});

describe('layout', () => {
  it('elevates zone nodes and rings sites around their zone without overlap', () => {
    const zl = layoutZones(zones);
    expect(zl.every((z) => z.position[1] === ZONE_ELEVATION)).toBe(true);
    const sites = layoutSites(
      [makeWorkload({ id: 'a', zone_id: 'CAISO' }), makeWorkload({ id: 'b', zone_id: 'CAISO' })],
      zl,
    );
    expect(sites).toHaveLength(2);
    const [a, b] = sites.map((s) => s.position);
    expect(Math.hypot(a[0] - b[0], a[2] - b[2])).toBeGreaterThan(1);
    expect(a[1]).toBe(0);
  });

  it('drops sites whose zone is unknown', () => {
    expect(layoutSites([makeWorkload({ zone_id: 'SPP' })], layoutZones(zones))).toHaveLength(0);
  });

  it('arcs links upward, higher for longer spans', () => {
    const short = arcMidpoint([0, 0.6, 0], [1, 0.6, 0]);
    const long = arcMidpoint([0, 0.6, 0], [8, 0.6, 0]);
    expect(short[1]).toBeGreaterThan(0.6);
    expect(long[1]).toBeGreaterThan(short[1]);
  });
});

describe('routingFlows', () => {
  it('routes from the cleanest zone to every other, dirtiest first', () => {
    const flows = routingFlows(layoutZones(zones));
    expect(flows.map((f) => f.from.zone.zone_id)).toEqual(['CAISO', 'CAISO', 'CAISO']);
    expect(flows.map((f) => f.to.zone.zone_id)).toEqual(['MISO', 'ERCOT', 'PJM']);
  });

  it('needs at least two zones', () => {
    expect(routingFlows(layoutZones(zones.slice(0, 1)))).toEqual([]);
  });
});

it('utilisation is clamped to 0..1', () => {
  expect(utilisation(makeWorkload({ current_kw: 50, max_kw: 100 }))).toBe(0.5);
  expect(utilisation(makeWorkload({ current_kw: 500, max_kw: 100 }))).toBe(1);
  expect(utilisation(makeWorkload({ current_kw: 5, max_kw: 0 }))).toBe(0);
});
