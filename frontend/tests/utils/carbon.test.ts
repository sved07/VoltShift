import {
  CARBON_COLORS,
  carbonBand,
  carbonColor,
  carbonFillColorExpression,
  formatHour,
  formatPower,
  formatPowerDelta,
  markerLabel,
} from '../../src/utils/carbon';
import { makeWorkload } from '../fixtures';

describe('carbonBand (Green < 150, Amber 150-320, Red > 320)', () => {
  it.each([
    [0, 'green'],
    [149.9, 'green'],
    [150, 'amber'],
    [250, 'amber'],
    [320, 'amber'],
    [320.1, 'red'],
    [900, 'red'],
  ])('%s gCO2/kWh -> %s', (ci, band) => {
    expect(carbonBand(ci)).toBe(band);
  });

  it('maps bands to colours', () => {
    expect(carbonColor(100)).toBe(CARBON_COLORS.green);
    expect(carbonColor(200)).toBe(CARBON_COLORS.amber);
    expect(carbonColor(400)).toBe(CARBON_COLORS.red);
  });
});

describe('carbonFillColorExpression', () => {
  it('is a Mapbox interpolate expression on carbon_intensity', () => {
    expect(carbonFillColorExpression[0]).toBe('interpolate');
    expect(carbonFillColorExpression[2]).toEqual(['get', 'carbon_intensity']);
  });

  it('places stops at the spec thresholds with the right colours', () => {
    const stops = carbonFillColorExpression.slice(3) as (number | string)[];
    const pairs: [number, string][] = [];
    for (let i = 0; i < stops.length; i += 2) pairs.push([stops[i] as number, stops[i + 1] as string]);
    const inputs = pairs.map(([v]) => v);
    expect(inputs).toEqual([...inputs].sort((a, b) => a - b)); // Mapbox requires ascending stops
    expect(pairs).toContainEqual([150, CARBON_COLORS.amber]);
    expect(pairs).toContainEqual([320, CARBON_COLORS.amber]);
    expect(pairs.find(([v]) => v > 320)?.[1]).toBe(CARBON_COLORS.red);
    expect(pairs.find(([v]) => v < 150)?.[1]).toBe(CARBON_COLORS.green);
  });
});

describe('formatting', () => {
  it.each([
    [0, '00:00'],
    [9, '09:00'],
    [23, '23:00'],
    [24, '00:00'],
  ])('formatHour(%s) = %s', (h, out) => expect(formatHour(h)).toBe(out));

  it('formats power in kW below 1 MW and MW above', () => {
    expect(formatPower(150)).toBe('150 kW');
    expect(formatPower(12500)).toBe('12.5 MW');
  });

  it('formats signed deltas versus baseline', () => {
    expect(formatPowerDelta(makeWorkload({ current_kw: 650, baseline_kw: 500 }))).toBe('+150 kW');
    expect(formatPowerDelta(makeWorkload({ current_kw: 300, baseline_kw: 500 }))).toBe('-200 kW');
    expect(formatPowerDelta(makeWorkload({ current_kw: 500, baseline_kw: 500 }))).toBe('±0 kW');
    expect(formatPowerDelta(makeWorkload({ current_kw: 500, baseline_kw: undefined }))).toBe('±0 kW');
  });

  it('builds spec-style marker labels', () => {
    expect(markerLabel(makeWorkload({ current_kw: 650, baseline_kw: 500, status: 'BOOST' }))).toBe('+150 kW [BOOST]');
    expect(markerLabel(makeWorkload({ current_kw: 300, baseline_kw: 500, status: 'THROTTLE' }))).toBe('-200 kW [THROTTLED]');
    expect(markerLabel(makeWorkload({ current_kw: 0, baseline_kw: 800, status: 'DEFER' }))).toBe('-800 kW [DEFERRED]');
  });
});
