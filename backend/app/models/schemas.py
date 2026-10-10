"""Pydantic data contracts shared by the agents, the Gemini layer and the WebSocket API."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

WorkloadType = Literal["AI_TRAINING", "EV_FLEET"]
DispatchStatus = Literal["BOOST", "MAINTAIN", "THROTTLE", "DEFER"]
LonLat = tuple[float, float]


class GridZone(BaseModel):
    zone_id: str
    name: str
    carbon_intensity: float = Field(description="gCO2/kWh")
    renewable_pct: float = Field(description="Share of load served by solar+wind+hydro, 0-100")
    solar_mw: float
    wind_mw: float
    coordinates: LonLat = Field(description="(longitude, latitude) of the zone centroid")


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


class GeminiAgentExplanation(BaseModel):
    primary_driver: str
    reasoning_summary: str
    estimated_carbon_saved_kg: float
    estimated_cost_saved_usd: float
    forecast_recommendation: str


class TelemetryPacket(BaseModel):
    timestamp: str
    sim_hour: int
    zones: list[GridZone]
    workloads: list[IndustrialWorkload]
    ai_explanation: GeminiAgentExplanation
    cumulative_metrics: dict
