"""
Grid monitor: regional carbon intensity and renewable share for ERCOT, CAISO, PJM and MISO.

Data comes from a deterministic diurnal model parameterised by mock_iso_telemetry.json.
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
MAX_CLEAN_SHARE = 0.95
LIFECYCLE_FLOOR_CI = 15.0


@lru_cache(maxsize=4)
def load_iso_parameters(path: Path = TELEMETRY_FILE) -> dict:
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def solar_factor(hour: float) -> float:
    """0 at night, peaking near 12:30; zero outside 06:00-19:00."""
    return max(0.0, math.sin(math.pi * (hour - 6) / 13)) if 6 < hour < 19 else 0.0


def wind_factor(hour: float, amplitude: float) -> float:
    """Wind is strongest overnight (~03:00) and weakest mid-afternoon."""
    return 1 + amplitude * math.cos(2 * math.pi * (hour - 3) / 24)


def load_factor(hour: float) -> float:
    """Baseline demand with a daytime bump and an evening (18:00) peak."""
    return 0.72 + 0.12 * solar_factor(hour) + 0.28 * math.exp(-((hour - 18) ** 2) / 12.5)


def model_zone(zone_id: str, params: dict, hour: int) -> GridZone:
    solar_mw = params["solar_capacity_mw"] * solar_factor(hour)
    wind_mw = params["wind_base_mw"] * wind_factor(hour, params["wind_amplitude"])
    load_mw = params["base_load_mw"] * load_factor(hour)

    renewable_share = min(MAX_CLEAN_SHARE, (solar_mw + wind_mw + params["hydro_mw"]) / load_mw)
    clean_share = min(MAX_CLEAN_SHARE, renewable_share + params["nuclear_mw"] / load_mw)
    carbon = params["fossil_ci"] * (1 - clean_share) + LIFECYCLE_FLOOR_CI

    return GridZone(
        zone_id=zone_id,
        name=params["name"],
        carbon_intensity=round(carbon, 1),
        renewable_pct=round(renewable_share * 100, 1),
        solar_mw=round(solar_mw, 1),
        wind_mw=round(wind_mw, 1),
        coordinates=tuple(params["coordinates"]),
    )


def apply_peaker_spike(zone: GridZone, spike: dict) -> GridZone:
    """A gas peaker ramp adds fossil generation: dirtier and a smaller renewable share."""
    return zone.model_copy(
        update={
            "carbon_intensity": round(zone.carbon_intensity * spike["carbon_multiplier"] + spike["carbon_adder"], 1),
            "renewable_pct": round(zone.renewable_pct * spike["renewable_share_multiplier"], 1),
        }
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
        spike = self._params["peaker_spike"]
        zones = []
        for zone_id, params in self._params["zones"].items():
            zone = model_zone(zone_id, params, sim_hour)
            if zone_id in live:
                zone = zone.model_copy(update={"carbon_intensity": round(live[zone_id], 1)})
            if peaker_spike:
                zone = apply_peaker_spike(zone, spike)
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
