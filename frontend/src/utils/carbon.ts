import type { DispatchStatus, IndustrialWorkload } from '../types';

export const CARBON_GREEN_BELOW = 150;
export const CARBON_RED_ABOVE = 320;

export const CARBON_COLORS = {
  green: '#22c55e',
  amber: '#f59e0b',
  red: '#ef4444',
} as const;

export type CarbonBand = keyof typeof CARBON_COLORS;

/** Green < 150 gCO2/kWh, Amber 150-320, Red > 320. */
export function carbonBand(carbonIntensity: number): CarbonBand {
  if (carbonIntensity < CARBON_GREEN_BELOW) return 'green';
  if (carbonIntensity <= CARBON_RED_ABOVE) return 'amber';
  return 'red';
}

export function carbonColor(carbonIntensity: number): string {
  return CARBON_COLORS[carbonBand(carbonIntensity)];
}

/** Mapbox data-driven fill colour keyed on the feature's `carbon_intensity` property. */
export const carbonFillColorExpression = [
  'interpolate',
  ['linear'],
  ['get', 'carbon_intensity'],
  0, CARBON_COLORS.green,
  CARBON_GREEN_BELOW - 0.01, CARBON_COLORS.green,
  CARBON_GREEN_BELOW, CARBON_COLORS.amber,
  CARBON_RED_ABOVE, CARBON_COLORS.amber,
  CARBON_RED_ABOVE + 0.01, CARBON_COLORS.red,
  1000, '#b91c1c',
] as const;

export const STATUS_META: Record<DispatchStatus, { label: string; color: string; badge: string }> = {
  BOOST: { label: 'BOOST', color: '#39ff88', badge: 'bg-emerald-500/15 text-emerald-300 ring-emerald-400/40' },
  MAINTAIN: { label: 'MAINTAIN', color: '#22d3ee', badge: 'bg-cyan-500/10 text-cyan-300 ring-cyan-400/30' },
  THROTTLE: { label: 'THROTTLED', color: '#f97316', badge: 'bg-orange-500/15 text-orange-300 ring-orange-400/40' },
  DEFER: { label: 'DEFERRED', color: '#ef4444', badge: 'bg-red-500/15 text-red-300 ring-red-400/40' },
};

export function formatHour(hour: number): string {
  return `${String(((hour % 24) + 24) % 24).padStart(2, '0')}:00`;
}

export function formatPower(kw: number): string {
  const abs = Math.abs(kw);
  if (abs >= 1000) return `${(kw / 1000).toLocaleString('en-US', { maximumFractionDigits: 1 })} MW`;
  return `${Math.round(kw).toLocaleString('en-US')} kW`;
}

/** Change versus the unmanaged baseline, e.g. "+150 kW" or "-12.5 MW". */
export function powerDelta(workload: IndustrialWorkload): number {
  return workload.current_kw - (workload.baseline_kw ?? workload.current_kw);
}

export function formatPowerDelta(workload: IndustrialWorkload): string {
  const delta = powerDelta(workload);
  if (Math.abs(delta) < 0.5) return '±0 kW';
  return `${delta > 0 ? '+' : '-'}${formatPower(Math.abs(delta))}`;
}

export function markerLabel(workload: IndustrialWorkload): string {
  return `${formatPowerDelta(workload)} [${STATUS_META[workload.status].label}]`;
}
