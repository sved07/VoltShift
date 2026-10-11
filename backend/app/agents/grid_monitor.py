"""
Grid monitor: regional carbon intensity and renewable share for ERCOT, CAISO, PJM and MISO.

Data comes from a deterministic diurnal model parameterised by mock_iso_telemetry.json
(solar bell curve, per-zone wind peak, carbon falling with renewable share). A gas peaker
ramp hits ERCOT, PJM and MISO; CAISO's hydro/solar mix rides through it.
When ELECTRICITY_MAPS_KEY is set, the live carbon intensity from the Electricity Maps
API overrides the modelled value (cached, with automatic fallback to the model on error).
"""

from __future__ import annotations

import json
import logging
import math
import os
import time
from functools import lru_cache
from pathlib import Path

import httpx

from app.config import DATA_DIR
from app.models.schemas import GridZone

logger = logging.getLogger(__name__)

TELEMETRY_FILE = DATA_DIR / "mock_iso_telemetry.json"
ELECTRICITY_MAPS_URL = "https://api.electricitymap.org/v3/carbon-intensity/latest"
LIVE_CACHE_SECONDS = 300
LIVE_RETRY_AFTER_FAILURE_SECONDS = 60
LIVE_TIMEOUT_SECONDS = 3.0
RENEWABLE_PCT_FLOOR = 5.0
CARBON_FLOOR_CI = 45.0
GREEN_BELOW, RED_ABOVE = 150.0, 320.0


@lru_cache(maxsize=4)
def load_iso_parameters(path: Path = TELEMETRY_FILE) -> dict:
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def solar_factor(hour: float) -> float:
    """Daylight bell curve: 0 before 06:00 and after 19:00, peaking ~12:30."""
    if hour < 6 or hour > 19:
        return 0.0
    return max(0.0, math.sin((hour - 6) / 13.0 * math.pi))


def wind_factor(hour: float, peak_hour: int) -> float:
    """0.4 at the far side of the day from the zone's wind peak, 1.0 at the peak."""
    distance = abs(hour - peak_hour)
    if distance > 12:
        distance = 24 - distance
    return 0.4 + 0.6 * math.cos(distance / 12.0 * math.pi * 0.5)


def color_tier(carbon_intensity: float) -> str:
    if carbon_intensity < GREEN_BELOW:
        return "green"
    return "amber" if carbon_intensity <= RED_ABOVE else "red"


def marginal_fuel(renewable_pct: float, peaker: bool) -> str:
    if peaker:
        return "Simple-Cycle Gas Peaker / Distillate Fuel Oil"
    if renewable_pct > 65.0:
        return "Surplus Solar / Wind (Curtailment Risk)"
    if renewable_pct > 40.0:
        return "Hydro / Natural Gas"
    return "Combined-Cycle Gas"


def model_zone(zone_id: str, params: dict, hour: int, peaker: bool = False) -> GridZone:
    """Deterministic diurnal model. A peaker ramp adds `peaker_spike_addition` gCO2/kWh."""
    solar_mw = round(params["solar_max_mw"] * solar_factor(hour), 1)
    wind_mw = round(params["wind_max_mw"] * wind_factor(hour, params["wind_peak_hour"]), 1)
    renewable = solar_mw + wind_mw
    renewable_pct = min(100.0, max(RENEWABLE_PCT_FLOOR, round(renewable / (renewable + params["fossil_base_mw"]) * 100.0, 1)))

    carbon = params["base_carbon"] * (1.15 - (renewable_pct / 100.0) * 0.85)
    if peaker:
        carbon += params["peaker_spike_addition"]
    carbon = round(max(CARBON_FLOOR_CI, carbon), 1)

    return GridZone(
        zone_id=zone_id,
        name=params["name"],
        carbon_intensity=carbon,
        renewable_pct=renewable_pct,
        solar_mw=solar_mw,
        wind_mw=wind_mw,
        coordinates=tuple(params["coordinates"]),
        marginal_fuel=marginal_fuel(renewable_pct, peaker),
        color_tier=color_tier(carbon),
    )


class ElectricityMapsClient:
    """Minimal client for the Electricity Maps latest carbon-intensity endpoint."""

    def __init__(self, api_key: str, timeout: float = LIVE_TIMEOUT_SECONDS):
        self._api_key = api_key
        self._timeout = timeout

    def latest_carbon_intensity(self, em_zone: str) -> float:
        with httpx.Client(timeout=self._timeout) as client:
            response = client.get(
                ELECTRICITY_MAPS_URL,
                params={"zone": em_zone},
                headers={"auth-token": self._api_key},
            )
            response.raise_for_status()
            value = response.json()["carbonIntensity"]
        if not isinstance(value, (int, float)) or value <= 0:
            raise ValueError(f"unexpected carbonIntensity {value!r} for {em_zone}")
        return float(value)


class GridMonitor:
    def __init__(self, api_key: str | None = None):
        key = api_key if api_key is not None else os.getenv("ELECTRICITY_MAPS_KEY", "")
        key = (key or "").strip()
        self._client = ElectricityMapsClient(key) if key else None
        self._params = load_iso_parameters()
        self._live_cache: dict[str, float] = {}
        self._live_fetched_at = 0.0
        self._live_failed_at = 0.0

    @property
    def source(self) -> str:
        return "electricity_maps" if self._client and self._live_cache else "mock"

    def get_zones(self, sim_hour: int, peaker_spike: bool = False) -> list[GridZone]:
        if isinstance(sim_hour, bool) or not isinstance(sim_hour, int) or not 0 <= sim_hour <= 23:
            raise ValueError(f"sim_hour must be an integer in 0..23, got {sim_hour!r}")

        live = self._live_carbon()
        peaker_zones = set(self._params["peaker_spike_zones"]) if peaker_spike else set()
        zones = []
        for zone_id, params in self._params["zones"].items():
            peaker = zone_id in peaker_zones
            zone = model_zone(zone_id, params, sim_hour, peaker)
            if zone_id in live:
                carbon = round(live[zone_id] + (params["peaker_spike_addition"] if peaker else 0.0), 1)
                zone = zone.model_copy(update={"carbon_intensity": carbon, "color_tier": color_tier(carbon)})
            zones.append(zone)
        return zones

    def _live_carbon(self) -> dict[str, float]:
        if self._client is None:
            return {}
        now = time.monotonic()
        if self._live_cache and now - self._live_fetched_at < LIVE_CACHE_SECONDS:
            return self._live_cache
        if self._live_failed_at and now - self._live_failed_at < LIVE_RETRY_AFTER_FAILURE_SECONDS:
            return {}
        try:
            self._live_cache = {
                zone_id: self._client.latest_carbon_intensity(params["electricity_maps_zone"])
                for zone_id, params in self._params["zones"].items()
            }
            self._live_fetched_at = now
            return self._live_cache
        except (httpx.HTTPError, KeyError, ValueError, TypeError) as exc:
            logger.warning("Electricity Maps unavailable, using mock telemetry: %s", exc)
            self._live_cache = {}
            self._live_failed_at = now
            return {}
