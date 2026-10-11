"""Pydantic data contracts shared by the agents, the Gemini layer and the WebSocket API."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

WorkloadType = Literal["AI_TRAINING", "EV_FLEET"]
ColorTier = Literal["green", "amber", "red"]
DispatchStatus = Literal["BOOST", "MAINTAIN", "THROTTLE", "DEFER"]
LonLat = tuple[float, float]


class GridZone(BaseModel):
    zone_id: str
    name: str
    carbon_intensity: float = Field(description="gCO2/kWh")
    renewable_pct: float = Field(description="Solar + wind share of generation, 0-100")
    solar_mw: float
    wind_mw: float
    coordinates: LonLat = Field(description="(longitude, latitude) of the zone centroid")
    marginal_fuel: str = Field(default="Combined-Cycle Gas", description="Fuel setting the marginal carbon price")
    color_tier: ColorTier = Field(default="green", description="green < 150, amber 150-320, red > 320 gCO2/kWh")


class IndustrialWorkload(BaseModel):
    id: str
    site_name: str
    type: WorkloadType
    zone_id: str
    current_kw: float
    max_kw: float
    flexibility_score: float = Field(ge=0.0, le=1.0)
    deadline_hour: int = Field(ge=0, le=23)
    status: DispatchStatus
    # Extensions beyond the core spec, used by the map and the KPI accounting.
    coordinates: LonLat | None = Field(default=None, description="(longitude, latitude) of the site")
    baseline_kw: float | None = Field(default=None, description="Unmanaged draw before dispatch")
    sla_progress_pct: float | None = Field(default=None, ge=0.0, le=100.0, description="Share of today's quota delivered")
    delta_kw: float = Field(default=0.0, description="Dispatched draw minus baseline (+ boost, - curtail)")


class HourlyForecastPoint(BaseModel):
    hour: int = Field(ge=0, le=23)
    carbon_intensity: float = Field(description="Load-weighted gCO2/kWh across the ISOs")
    renewable_pct: float
    recommended_action: DispatchStatus
    solar_factor: float = Field(ge=0.0, le=1.0)
    wind_factor: float = Field(ge=0.0, le=1.0)


class GeminiNarrative(BaseModel):
    """The part Gemini writes (passed as response_schema)."""

    primary_driver: str
    reasoning_summary: str
    estimated_carbon_saved_kg: float
    estimated_cost_saved_usd: float
    forecast_recommendation: str


class GeminiAgentExplanation(GeminiNarrative):
    """Narrative plus the agent's own 24h projection (computed, never generated)."""

    hourly_forecast: list[HourlyForecastPoint] = Field(default_factory=list)


class TelemetryPacket(BaseModel):
    timestamp: str
    sim_hour: int
    zones: list[GridZone]
    workloads: list[IndustrialWorkload]
    ai_explanation: GeminiAgentExplanation
    cumulative_metrics: dict
