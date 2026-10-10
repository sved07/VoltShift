import type {
  CumulativeMetrics,
  GeminiAgentExplanation,
  GridZone,
  IndustrialWorkload,
  TelemetryPacket,
} from '../src/types';

export function makeZone(overrides: Partial<GridZone> = {}): GridZone {
  return {
    zone_id: 'CAISO',
    name: 'CAISO (California)',
    carbon_intensity: 90,
    renewable_pct: 78,
    solar_mw: 15000,
    wind_mw: 2500,
    coordinates: [-119.6, 37.2],
    ...overrides,
  };
}

export function makeWorkload(overrides: Partial<IndustrialWorkload> = {}): IndustrialWorkload {
  return {
    id: 'dc-santaclara',
    site_name: 'Santa Clara GPU Cluster',
    type: 'AI_TRAINING',
    zone_id: 'CAISO',
    current_kw: 45000,
    max_kw: 45000,
    flexibility_score: 0.9,
    deadline_hour: 20,
    status: 'BOOST',
    coordinates: [-121.96, 37.35],
    baseline_kw: 30000,
    ...overrides,
  };
}

export function makeExplanation(overrides: Partial<GeminiAgentExplanation> = {}): GeminiAgentExplanation {
  return {
    primary_driver: 'Solar Curtailment Window',
    reasoning_summary: 'CAISO solar surplus: boosting Santa Clara GPU Cluster to full power.',
    estimated_carbon_saved_kg: 18450.4,
    estimated_cost_saved_usd: 2310.75,
    forecast_recommendation: 'Next 24h: route deferred work to CAISO around 12:00.',
    ...overrides,
  };
}

export function makeMetrics(overrides: Partial<CumulativeMetrics> = {}): CumulativeMetrics {
  return {
    co2_avoided_kg: 1234.5,
    energy_shifted_mwh: 12.345,
    cost_savings_usd: 987.65,
    baseline_co2_kg: 20000,
    improvement_pct: 6.17,
    clean_energy_share_pct: 58.4,
    mode: 'AUTONOMOUS',
    peaker_spike_active: false,
    explainer: 'rule_based',
    grid_source: 'mock',
    ...overrides,
  };
}

export function makePacket(overrides: Partial<TelemetryPacket> = {}): TelemetryPacket {
  return {
    timestamp: '2026-10-10T12:00:00Z',
    sim_hour: 12,
    zones: [
      makeZone(),
      makeZone({ zone_id: 'MISO', name: 'MISO (Midwest)', carbon_intensity: 490, renewable_pct: 31, coordinates: [-91.5, 42] }),
    ],
    workloads: [
      makeWorkload(),
      makeWorkload({
        id: 'ev-chicago',
        site_name: 'Chicago Transit Bus Barn',
        type: 'EV_FLEET',
        zone_id: 'MISO',
        current_kw: 1000,
        max_kw: 4500,
        baseline_kw: 3900,
        status: 'THROTTLE',
        coordinates: [-87.63, 41.88],
      }),
    ],
    ai_explanation: makeExplanation(),
    cumulative_metrics: makeMetrics(),
    ...overrides,
  };
}
