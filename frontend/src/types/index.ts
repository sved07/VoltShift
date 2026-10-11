// Mirrors backend/app/models/schemas.py — keep in sync.

export type WorkloadType = 'AI_TRAINING' | 'EV_FLEET';
export type DispatchStatus = 'BOOST' | 'MAINTAIN' | 'THROTTLE' | 'DEFER';
export type LonLat = [number, number];
export type ColorTier = 'green' | 'amber' | 'red';

export interface GridZone {
  zone_id: string;
  name: string;
  carbon_intensity: number; // gCO2/kWh
  renewable_pct: number; // 0-100
  solar_mw: number;
  wind_mw: number;
  coordinates: LonLat;
  marginal_fuel?: string;
  color_tier?: ColorTier;
}

export interface IndustrialWorkload {
  id: string;
  site_name: string;
  type: WorkloadType;
  zone_id: string;
  current_kw: number;
  max_kw: number;
  flexibility_score: number; // 0-1
  deadline_hour: number;
  status: DispatchStatus;
  coordinates?: LonLat | null;
  baseline_kw?: number | null;
  sla_progress_pct?: number | null; // share of today's quota delivered, 0-100
  delta_kw?: number;
}

export interface HourlyForecastPoint {
  hour: number;
  carbon_intensity: number; // load-weighted across ISOs
  renewable_pct: number;
  recommended_action: DispatchStatus;
  solar_factor: number;
  wind_factor: number;
}

export interface GeminiAgentExplanation {
  primary_driver: string;
  reasoning_summary: string;
  estimated_carbon_saved_kg: number;
  estimated_cost_saved_usd: number;
  forecast_recommendation: string;
  hourly_forecast?: HourlyForecastPoint[];
}

export interface CumulativeMetrics {
  co2_avoided_kg: number;
  energy_shifted_mwh: number;
  cost_savings_usd: number;
  baseline_co2_kg: number;
  improvement_pct: number;
  clean_energy_share_pct: number;
  mode: 'AUTONOMOUS' | 'UNMANAGED';
  peaker_spike_active: boolean;
  explainer: 'gemini' | 'rule_based';
  explainer_model?: string | null;
  grid_source: string;
  avg_carbon_managed?: number;
  avg_carbon_baseline?: number;
  total_active_kw?: number;
  simulation_paused?: boolean;
}

export interface TelemetryPacket {
  timestamp: string;
  sim_hour: number;
  zones: GridZone[];
  workloads: IndustrialWorkload[];
  ai_explanation: GeminiAgentExplanation;
  cumulative_metrics: CumulativeMetrics;
}

export type ClientAction =
  | { action: 'SET_HOUR'; hour: number }
  | { action: 'TOGGLE_MODE' }
  | { action: 'TRIGGER_PEAKER_SPIKE' }
  | { action: 'RESET_METRICS' }
  | { action: 'TOGGLE_TICKER' };
