"""Shared fixtures for the VoltShift backend test suite."""

from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

# Blank the keys before `app` is imported so a developer's local .env (load_dotenv
# does not override existing variables) can never make the suite hit real APIs.
os.environ["GEMINI_API_KEY"] = ""
os.environ["ELECTRICITY_MAPS_KEY"] = ""
os.environ["GEMINI_MODEL"] = ""

ISO_IDS = {"ERCOT", "CAISO", "PJM", "MISO"}
STATUSES = {"BOOST", "MAINTAIN", "THROTTLE", "DEFER"}


@pytest.fixture(autouse=True)
def _no_api_keys(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "")
    monkeypatch.setenv("ELECTRICITY_MAPS_KEY", "")
    monkeypatch.setenv("GEMINI_MODEL", "")


@pytest.fixture
def block_network(monkeypatch):
    """Make any real HTTP call through httpx fail."""
    import httpx

    def _boom(*_args, **_kwargs):
        raise httpx.ConnectError("network disabled in tests")

    async def _aboom(*_args, **_kwargs):
        raise httpx.ConnectError("network disabled in tests")

    monkeypatch.setattr(httpx.Client, "send", _boom)
    monkeypatch.setattr(httpx.AsyncClient, "send", _aboom)


@pytest.fixture
def make_zone():
    from app.models.schemas import GridZone

    def _make(zone_id="ERCOT", carbon_intensity=250.0, renewable_pct=30.0, **overrides) -> GridZone:
        data = dict(
            zone_id=zone_id,
            name=f"{zone_id} Test Zone",
            carbon_intensity=carbon_intensity,
            renewable_pct=renewable_pct,
            solar_mw=1000.0,
            wind_mw=2000.0,
            coordinates=(-97.7, 30.3),
        )
        data.update(overrides)
        return GridZone(**data)

    return _make


@pytest.fixture
def make_workload():
    from app.models.schemas import IndustrialWorkload

    def _make(
        workload_id="wl-1",
        zone_id="ERCOT",
        current_kw=500.0,
        max_kw=1000.0,
        flexibility_score=0.9,
        deadline_hour=23,
        type="AI_TRAINING",
        status="MAINTAIN",
        **overrides,
    ) -> IndustrialWorkload:
        data = dict(
            id=workload_id,
            site_name=f"Site {workload_id}",
            type=type,
            zone_id=zone_id,
            current_kw=current_kw,
            max_kw=max_kw,
            flexibility_score=flexibility_score,
            deadline_hour=deadline_hour,
            status=status,
        )
        data.update(overrides)
        return IndustrialWorkload(**data)

    return _make
