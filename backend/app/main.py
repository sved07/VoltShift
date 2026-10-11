"""
VoltShift API: FastAPI app streaming grid telemetry and agent decisions over WebSocket.

    uvicorn app.main:app --reload

WebSocket /ws/grid-telemetry pushes a TelemetryPacket every TICK_INTERVAL_SECONDS and
immediately after each accepted client action:
    {"action": "SET_HOUR", "hour": 0-23}
    {"action": "TOGGLE_MODE"}             autonomous agent <-> unmanaged baseline
    {"action": "TRIGGER_PEAKER_SPIKE"}    toggles the simulated gas peaker ramp
    {"action": "RESET_METRICS"}           zeroes the KPIs and restarts every site's SLA quota
    {"action": "TOGGLE_TICKER"}           pauses/resumes the simulation (packets keep flowing)

Each connection runs its own independent simulation.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from collections import Counter
from datetime import datetime, timezone
from statistics import fmean

from fastapi import FastAPI, Query, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from app.agents.dispatch_agent import DispatchAgent, Impact, estimate_impact, snapshot
from app.agents.grid_monitor import GridMonitor, load_iso_parameters, solar_factor, wind_factor
from app.agents.workload_manager import WorkloadManager, advance_progress
from app.ai.gemini_advisor import ForecastSummary, GeminiAdvisor, rule_based_explanation
from app.config import get_settings
from app.models.schemas import (
    GeminiAgentExplanation,
    GridZone,
    HourlyForecastPoint,
    IndustrialWorkload,
    TelemetryPacket,
)

logger = logging.getLogger("voltshift")

TICK_INTERVAL_SECONDS = 1.5
SIM_HOURS_PER_TICK = 0.1           # each live tick is a 6-minute slice of operation
GEMINI_MIN_INTERVAL_SECONDS = 8.0  # rate-limit live Gemini calls per connection
MAX_MESSAGE_BYTES = 2048
VALID_ACTIONS = {"SET_HOUR", "TOGGLE_MODE", "TRIGGER_PEAKER_SPIKE", "RESET_METRICS", "TOGGLE_TICKER"}
# The forecast's "recommended action" is what the rules tell a typical flexible site to do on the
# load-weighted average grid (individual sites in very clean or very dirty ISOs will differ).
REPRESENTATIVE_FLEXIBILITY = 0.8

settings = get_settings()
grid_monitor = GridMonitor(settings.electricity_maps_key)
workload_manager = WorkloadManager()
dispatch_agent = DispatchAgent()
advisor = GeminiAdvisor(settings.gemini_api_key, settings.gemini_model)

app = FastAPI(title="VoltShift: Autonomous Grid Load-Shifting Agent", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=False,
    allow_methods=["GET", "OPTIONS"],
    allow_headers=["*"],
)


def _recommended_action(carbon: float, renewable: float, hour: int, autonomous: bool) -> str:
    grid = GridZone(zone_id="AVG", name="Load-weighted average", carbon_intensity=carbon,
                    renewable_pct=renewable, solar_mw=0, wind_mw=0, coordinates=(0.0, 0.0))
    site = IndustrialWorkload(id="typical", site_name="Typical flexible site", type="AI_TRAINING", zone_id="AVG",
                              current_kw=1000, baseline_kw=1000, max_kw=1500,
                              flexibility_score=REPRESENTATIVE_FLEXIBILITY, deadline_hour=(hour + 12) % 24,
                              status="MAINTAIN")
    return dispatch_agent.decide(site, grid, hour, autonomous, progress=100.0).status


def build_forecast(start_hour: int, autonomous: bool, progress: dict[str, float] | None = None) -> ForecastSummary:
    """
    Replay the agent over the next 24 simulated hours: savings projections, each zone's
    cleanest window, and an hourly load-weighted carbon curve with the dominant action.
    """
    forecast = ForecastSummary()
    params = load_iso_parameters()["zones"]
    baseline = workload_manager.get_workloads()
    weights: Counter = Counter()
    for w in baseline:
        weights[w.zone_id] += w.baseline_kw or w.current_kw
    total_weight = sum(weights.values()) or 1.0

    total = Impact()
    hourly: dict[int, HourlyForecastPoint] = {}
    for offset in range(24):
        hour = (start_hour + offset) % 24
        zones = grid_monitor.get_zones(hour)
        dispatched = dispatch_agent.dispatch(baseline, zones, hour, autonomous=autonomous, progress=progress)
        if autonomous:
            total += estimate_impact(dispatched, zones)
        for z in zones:
            best = forecast.cleanest_window.get(z.zone_id)
            if best is None or z.carbon_intensity < best[1]:
                forecast.cleanest_window[z.zone_id] = (hour, z.carbon_intensity)
        carbon = round(sum(z.carbon_intensity * weights[z.zone_id] for z in zones) / total_weight, 1)
        renewable = round(sum(z.renewable_pct * weights[z.zone_id] for z in zones) / total_weight, 1)
        hourly[hour] = HourlyForecastPoint(
            hour=hour,
            carbon_intensity=carbon,
            renewable_pct=renewable,
            recommended_action=_recommended_action(carbon, renewable, hour, autonomous),
            solar_factor=round(solar_factor(hour), 3),
            wind_factor=round(fmean(wind_factor(hour, p["wind_peak_hour"]) for p in params.values()), 3),
        )

    forecast.hourly = [hourly[h] for h in range(24)]
    forecast.projected_co2_avoided_kg = total.co2_avoided_kg
    forecast.projected_cost_saved_usd = total.cost_savings_usd
    return forecast


class SimulationSession:
    """Per-connection simulation state: scenario controls plus cumulative KPIs."""

    def __init__(self, sim_hour: int | None = None):
        self.sim_hour = datetime.now().hour if sim_hour is None else sim_hour
        self.autonomous = True
        self.peaker_spike = False
        self.paused = False
        self.totals = Impact()
        self.progress = workload_manager.initial_progress_map()
        self._last_snapshot = None
        self._forecast_key: tuple | None = None
        self._forecast = ForecastSummary()
        self._gemini_cache: dict[tuple, GeminiAgentExplanation] = {}
        self._gemini_pending: set[tuple] = set()
        self._gemini_last_call = 0.0

    def apply_action(self, raw: str) -> bool:
        """Apply a client message. Returns True if state changed; ignores anything invalid."""
        if len(raw) > MAX_MESSAGE_BYTES:
            return False
        try:
            msg = json.loads(raw)
        except (json.JSONDecodeError, TypeError):
            return False
        if not isinstance(msg, dict) or msg.get("action") not in VALID_ACTIONS:
            return False

        action = msg["action"]
        if action == "SET_HOUR":
            hour = msg.get("hour")
            if isinstance(hour, bool) or not isinstance(hour, int) or not 0 <= hour <= 23:
                return False
            self.sim_hour = hour
        elif action == "TOGGLE_MODE":
            self.autonomous = not self.autonomous
        elif action == "TRIGGER_PEAKER_SPIKE":
            self.peaker_spike = not self.peaker_spike
        elif action == "RESET_METRICS":
            self.totals = Impact()
            self.progress = workload_manager.initial_progress_map()
        elif action == "TOGGLE_TICKER":
            self.paused = not self.paused
        return True

    def tick(self, accrue: bool = True) -> tuple[TelemetryPacket, tuple]:
        zones = grid_monitor.get_zones(self.sim_hour, peaker_spike=self.peaker_spike)
        workloads = dispatch_agent.dispatch(
            workload_manager.get_workloads(), zones, self.sim_hour, autonomous=self.autonomous, progress=self.progress
        )
        if accrue and not self.paused:
            self.totals += estimate_impact(workloads, zones, hours=SIM_HOURS_PER_TICK)
            self.progress = advance_progress(self.progress, workloads, SIM_HOURS_PER_TICK)
        self._last_snapshot = snapshot(workloads, zones)

        # SLA-critical boosts depend on quota progress, so re-plan when it moves meaningfully.
        forecast_key = (self.sim_hour, self.autonomous, tuple(round(v / 5) for v in self.progress.values()))
        if forecast_key != self._forecast_key:
            self._forecast = build_forecast(self.sim_hour, self.autonomous, self.progress)
            self._forecast_key = forecast_key

        fingerprint = (
            self.sim_hour,
            self.autonomous,
            self.peaker_spike,
            tuple((w.id, w.status) for w in workloads),
        )
        # Gemini answers arrive asynchronously (see refresh_gemini); until one is cached for
        # this exact decision state, show the instant rule-based explanation.
        explanation = self._gemini_cache.get(fingerprint)
        if explanation is None:
            explanation = rule_based_explanation(
                zones, workloads, self.sim_hour, self._forecast, self.peaker_spike, self.autonomous
            )
        elif explanation.hourly_forecast != self._forecast.hourly:
            explanation = explanation.model_copy(update={"hourly_forecast": self._forecast.hourly})

        packet = TelemetryPacket(
            timestamp=datetime.now(timezone.utc).isoformat(),
            sim_hour=self.sim_hour,
            zones=zones,
            workloads=workloads,
            ai_explanation=explanation,
            cumulative_metrics=self.metrics(),
        )
        return packet, fingerprint

    def metrics(self) -> dict:
        t = self.totals
        snap = self._last_snapshot
        return {
            "co2_avoided_kg": round(t.co2_avoided_kg, 2),
            "energy_shifted_mwh": round(t.energy_shifted_mwh, 3),
            "cost_savings_usd": round(t.cost_savings_usd, 2),
            "baseline_co2_kg": round(t.baseline_co2_kg, 2),
            # Load-weighted carbon of managed vs unmanaged draw right now (0 when the agent is off).
            "improvement_pct": snap.improvement_pct if snap and self.autonomous else 0.0,
            "avg_carbon_managed": snap.avg_carbon_managed if snap else 0.0,
            "avg_carbon_baseline": snap.avg_carbon_baseline if snap else 0.0,
            "total_active_kw": snap.total_active_kw if snap else 0.0,
            "clean_energy_share_pct": (
                round(100 * t.managed_renewable_mwh / t.managed_energy_mwh, 2) if t.managed_energy_mwh else 0.0
            ),
            "mode": "AUTONOMOUS" if self.autonomous else "UNMANAGED",
            "peaker_spike_active": self.peaker_spike,
            "simulation_paused": self.paused,
            "explainer": "gemini" if advisor.uses_gemini else "rule_based",
            "explainer_model": advisor.model if advisor.uses_gemini else None,
            "grid_source": grid_monitor.source,
        }

    def wants_gemini(self, fingerprint: tuple) -> bool:
        return (
            advisor.uses_gemini
            and fingerprint not in self._gemini_cache
            and fingerprint not in self._gemini_pending
            and not self._gemini_pending
            and time.monotonic() - self._gemini_last_call >= GEMINI_MIN_INTERVAL_SECONDS
        )

    async def refresh_gemini(self, packet: TelemetryPacket, fingerprint: tuple) -> None:
        self._gemini_pending.add(fingerprint)
        self._gemini_last_call = time.monotonic()
        try:
            result = await asyncio.to_thread(
                advisor.explain_with_gemini, packet.zones, packet.workloads, packet.sim_hour,
                forecast=self._forecast, peaker_spike=self.peaker_spike, autonomous=self.autonomous,
            )
            if result is None:  # failed (quota, 503, ...): leave uncached so a later tick retries
                return
            if len(self._gemini_cache) > 64:
                self._gemini_cache.clear()
            self._gemini_cache[fingerprint] = result
        finally:
            self._gemini_pending.discard(fingerprint)


@app.get("/health")
async def health() -> dict:
    return {"status": "ok", "explainer": "gemini" if advisor.uses_gemini else "rule_based", "grid_source": grid_monitor.source}


@app.get("/api/telemetry", response_model=TelemetryPacket)
async def telemetry_snapshot(
    hour: int = Query(12, ge=0, le=23),
    autonomous: bool = True,
    peaker_spike: bool = False,
) -> TelemetryPacket:
    """Single stateless packet — handy for debugging and for clients without WebSockets."""
    session = SimulationSession(sim_hour=hour)
    session.autonomous = autonomous
    session.peaker_spike = peaker_spike
    packet, _ = await asyncio.to_thread(session.tick, False)
    return packet


@app.websocket("/ws/grid-telemetry")
async def grid_telemetry(ws: WebSocket) -> None:
    await ws.accept()
    session = SimulationSession()
    wake = asyncio.Event()
    background: set[asyncio.Task] = set()

    async def receive_actions() -> None:
        while True:
            if session.apply_action(await ws.receive_text()):
                wake.set()

    receiver = asyncio.create_task(receive_actions())
    accrue = False  # the first packet is a snapshot; KPIs accrue on timed ticks
    try:
        while True:
            wake.clear()  # actions arriving during this tick will wake the next wait immediately
            packet, fingerprint = await asyncio.to_thread(session.tick, accrue)
            await ws.send_text(packet.model_dump_json())
            if session.wants_gemini(fingerprint):
                task = asyncio.create_task(session.refresh_gemini(packet, fingerprint))
                background.add(task)
                task.add_done_callback(background.discard)

            waiter = asyncio.create_task(wake.wait())
            done, _ = await asyncio.wait(
                {waiter, receiver}, timeout=TICK_INTERVAL_SECONDS, return_when=asyncio.FIRST_COMPLETED
            )
            waiter.cancel()
            if receiver in done:
                break
            accrue = waiter not in done  # action-triggered pushes don't double-count KPIs
    except (WebSocketDisconnect, RuntimeError):
        pass
    finally:
        receiver.cancel()
        for task in background:
            task.cancel()
        if receiver.done() and not receiver.cancelled() and receiver.exception():
            exc = receiver.exception()
            if not isinstance(exc, WebSocketDisconnect):
                logger.warning("WebSocket receiver stopped: %s", exc)
