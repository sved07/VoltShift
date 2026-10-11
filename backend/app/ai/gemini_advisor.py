"""
Gemini explanation layer.

Asks a Gemini Flash model (GEMINI_MODEL, default gemini-3.8-flash) for a structured GeminiAgentExplanation describing the agent's current
dispatch decisions. Falls back to a deterministic rule-based explainer when GEMINI_API_KEY
is not configured or the API call fails, so the demo never crashes.
"""

from __future__ import annotations

import json
import logging
import os
import time
from dataclasses import dataclass, field

from google import genai
from google.genai import types

from app.agents.dispatch_agent import CURTAIL_CARBON_ABOVE, estimate_impact
from app.config import DEFAULT_GEMINI_MODEL
from app.models.schemas import (
    GeminiAgentExplanation,
    GeminiNarrative,
    GridZone,
    HourlyForecastPoint,
    IndustrialWorkload,
)

logger = logging.getLogger(__name__)

REQUEST_TIMEOUT_MS = 20_000  # a hung call is dropped and retried later, never blocks the stream
RATE_LIMIT_COOLDOWN_SECONDS = 45.0
RATE_LIMIT_MARKERS = ("429", "RESOURCE_EXHAUSTED", "Quota exceeded")

SYSTEM_INSTRUCTION = (
    "You are VoltShift, an autonomous grid load-shifting agent. Explain the dispatch decisions "
    "you were given to an energy operations audience in 2-3 crisp sentences. Ground every claim "
    "in the supplied numbers; never invent zones, sites or figures. primary_driver is a short "
    "Title Case tag (e.g. 'Solar Curtailment Window', 'Grid Fossil Peaker Spike'). "
    "estimated_* fields are 24-hour forward projections in kg CO2 and USD."
)


@dataclass
class ForecastSummary:
    """24-hour forward projection computed by replaying the agent over the next day."""

    projected_co2_avoided_kg: float = 0.0
    projected_cost_saved_usd: float = 0.0
    cleanest_window: dict[str, tuple[int, float]] = field(default_factory=dict)  # zone -> (hour, gCO2)
    hourly: list[HourlyForecastPoint] = field(default_factory=list)  # 00:00..23:00 projection


class GeminiAdvisor:
    def __init__(self, api_key: str | None = None, model: str | None = None):
        key = api_key if api_key is not None else os.getenv("GEMINI_API_KEY", "")
        self._api_key = (key or "").strip() or None
        self._model = (model or os.getenv("GEMINI_MODEL", "")).strip() or DEFAULT_GEMINI_MODEL
        self._client = None
        self._cooldown_until = 0.0
        if self._api_key:
            try:
                self._client = genai.Client(
                    api_key=self._api_key, http_options=types.HttpOptions(timeout=REQUEST_TIMEOUT_MS)
                )
            except Exception as exc:  # misconfigured SDK must not take the demo down
                logger.warning("Gemini client init failed, using rule-based explanations: %s", exc)

    @property
    def uses_gemini(self) -> bool:
        return self._client is not None

    @property
    def model(self) -> str:
        return self._model

    def explain(
        self,
        zones: list[GridZone],
        workloads: list[IndustrialWorkload],
        sim_hour: int,
        *,
        forecast: ForecastSummary | None = None,
        peaker_spike: bool = False,
        autonomous: bool = True,
    ) -> GeminiAgentExplanation:
        """Gemini's explanation, or the rule-based one if Gemini is unavailable. Never raises."""
        fallback = rule_based_explanation(zones, workloads, sim_hour, forecast, peaker_spike, autonomous)
        result = self.explain_with_gemini(
            zones, workloads, sim_hour, forecast=forecast, peaker_spike=peaker_spike,
            autonomous=autonomous, fallback=fallback,
        )
        return result if result is not None else fallback

    def explain_with_gemini(
        self,
        zones: list[GridZone],
        workloads: list[IndustrialWorkload],
        sim_hour: int,
        *,
        forecast: ForecastSummary | None = None,
        peaker_spike: bool = False,
        autonomous: bool = True,
        fallback: GeminiAgentExplanation | None = None,
    ) -> GeminiAgentExplanation | None:
        """Gemini's explanation, or None if there is no client or the call fails (so callers can retry)."""
        if self._client is None or time.monotonic() < self._cooldown_until:
            return None
        if fallback is None:
            fallback = rule_based_explanation(zones, workloads, sim_hour, forecast, peaker_spike, autonomous)
        try:
            narrative = self._ask_gemini(zones, workloads, sim_hour, forecast, peaker_spike, autonomous, fallback)
        except Exception as exc:
            if any(marker in str(exc) for marker in RATE_LIMIT_MARKERS):
                self._cooldown_until = time.monotonic() + RATE_LIMIT_COOLDOWN_SECONDS
                logger.warning("Gemini rate-limited; pausing calls for %.0fs: %s", RATE_LIMIT_COOLDOWN_SECONDS, exc)
            else:
                logger.warning("Gemini call failed, using rule-based explanation: %s", exc)
            return None
        narrative_fields = narrative.model_dump(include=set(GeminiNarrative.model_fields))
        return GeminiAgentExplanation(**narrative_fields, hourly_forecast=fallback.hourly_forecast)

    def _ask_gemini(self, zones, workloads, sim_hour, forecast, peaker_spike, autonomous, fallback):
        context = {
            "sim_hour": f"{sim_hour:02d}:00",
            "mode": "AUTONOMOUS" if autonomous else "UNMANAGED_BASELINE",
            "fossil_peaker_spike_active": peaker_spike,
            "zones": [z.model_dump(exclude={"coordinates"}) for z in zones],
            "workloads": [w.model_dump(exclude={"coordinates"}) for w in workloads],
            "rule_based_projection": fallback.model_dump(exclude={"hourly_forecast"}),
        }
        if forecast:
            context["forecast_24h"] = {
                "projected_co2_avoided_kg": round(forecast.projected_co2_avoided_kg, 1),
                "projected_cost_saved_usd": round(forecast.projected_cost_saved_usd, 2),
                "cleanest_window_by_zone": {
                    z: {"hour": f"{h:02d}:00", "carbon_intensity": ci} for z, (h, ci) in forecast.cleanest_window.items()
                },
            }
        response = self._client.models.generate_content(
            model=self._model,
            contents=json.dumps(context),
            config=types.GenerateContentConfig(
                system_instruction=SYSTEM_INSTRUCTION,
                response_mime_type="application/json",
                response_schema=GeminiNarrative,
                temperature=0.3,
            ),
        )
        parsed = getattr(response, "parsed", None)
        if isinstance(parsed, GeminiNarrative):
            return parsed
        if isinstance(parsed, dict):
            return GeminiNarrative.model_validate(parsed)
        return GeminiNarrative.model_validate_json(response.text)


def _primary_driver(zones, workloads, peaker_spike, autonomous) -> str:
    statuses = {w.status for w in workloads}
    if not autonomous:
        return "Unmanaged Baseline"
    if peaker_spike:
        return "Grid Fossil Peaker Spike"
    if statuses & {"THROTTLE", "DEFER"}:
        return "Fossil-Heavy Grid Window"
    if "BOOST" in statuses:
        clean = [z for z in zones if any(w.zone_id == z.zone_id and w.status == "BOOST" for w in workloads)]
        if clean and sum(z.solar_mw for z in clean) >= sum(z.wind_mw for z in clean):
            return "Solar Curtailment Window"
        return "Overnight Wind Surplus"
    if any(z.carbon_intensity > CURTAIL_CARBON_ABOVE for z in zones):
        return "SLA-Protected Fossil Exposure"
    return "Balanced Grid Conditions"


def rule_based_explanation(
    zones: list[GridZone],
    workloads: list[IndustrialWorkload],
    sim_hour: int,
    forecast: ForecastSummary | None = None,
    peaker_spike: bool = False,
    autonomous: bool = True,
) -> GeminiAgentExplanation:
    zone_map = {z.zone_id: z for z in zones}
    driver = _primary_driver(zones, workloads, peaker_spike, autonomous)
    by_status: dict[str, list[IndustrialWorkload]] = {}
    for w in workloads:
        by_status.setdefault(w.status, []).append(w)

    if forecast is not None:
        co2, cost = forecast.projected_co2_avoided_kg, forecast.projected_cost_saved_usd
    else:  # naive projection: current hour's impact held for 24h
        impact = estimate_impact(workloads, zones, hours=24)
        co2, cost = impact.co2_avoided_kg, impact.cost_savings_usd

    hour = f"{sim_hour:02d}:00"
    if not autonomous:
        summary = (
            f"At {hour} the agent is disabled: all {len(workloads)} sites draw their unmanaged baseline "
            f"regardless of grid carbon intensity. Re-enable autonomous dispatch to capture savings."
        )
    else:
        parts = []
        for status, verb in (("BOOST", "boosting"), ("THROTTLE", "throttling"), ("DEFER", "deferring")):
            sites = by_status.get(status, [])
            if sites:
                detail = ", ".join(
                    f"{w.site_name} ({zone_map[w.zone_id].carbon_intensity:.0f} g)" if w.zone_id in zone_map else w.site_name
                    for w in sites[:3]
                )
                parts.append(f"{verb} {len(sites)} site(s): {detail}")
        protected = [
            w for w in by_status.get("MAINTAIN", [])
            if w.zone_id in zone_map and zone_map[w.zone_id].carbon_intensity > CURTAIL_CARBON_ABOVE
        ]
        if protected:
            parts.append(f"holding {len(protected)} SLA-bound or inflexible site(s) steady despite dirty power")
        action = "; ".join(parts) if parts else "holding every site at baseline — no zone is clean or dirty enough to act"
        summary = f"At {hour} the agent is {action}."
        if peaker_spike:
            summary += " A gas peaker ramp has pushed regional carbon intensity sharply higher."

    if forecast and forecast.cleanest_window:
        zone_id, (best_hour, best_ci) = min(forecast.cleanest_window.items(), key=lambda kv: kv[1][1])
        recommendation = (
            f"Next 24h: route deferred work to {zone_id} around {best_hour:02d}:00 (~{best_ci:.0f} gCO2/kWh); "
            f"projected {co2:,.0f} kg CO2 avoided."
        )
    else:
        cleanest = min(zones, key=lambda z: z.carbon_intensity, default=None)
        recommendation = (
            f"Favour {cleanest.zone_id} ({cleanest.carbon_intensity:.0f} gCO2/kWh) for flexible load."
            if cleanest else "No grid data available."
        )

    return GeminiAgentExplanation(
        primary_driver=driver,
        reasoning_summary=summary,
        estimated_carbon_saved_kg=round(max(co2, 0.0), 1),
        estimated_cost_saved_usd=round(max(cost, 0.0), 2),
        forecast_recommendation=recommendation,
        hourly_forecast=list(forecast.hourly) if forecast else [],
    )
