"""
Autonomous dispatch agent: decides BOOST / MAINTAIN / THROTTLE / DEFER per workload.

Rules (checked in this order):
  1. Unmanaged baseline mode, or unknown zone              -> MAINTAIN at baseline
  2. SLA critical: deadline <= 3h away and quota < 85%     -> BOOST to max_kw (SLA beats the grid)
  3. renewable_pct >= 60% or carbon < 180 gCO2/kWh         -> BOOST into 70-100% of headroom,
                                                              scaled by renewable share
  4. carbon > 350 gCO2/kWh
       - flexibility >= 0.7 and > 5h runway                -> DEFER to 15% idle draw
       - flexibility >= 0.7, short runway                  -> THROTTLE to 40%
       - less flexible                                     -> THROTTLE by flexibility * 55%
  5. carbon > 240 gCO2/kWh and flexibility >= 0.8          -> THROTTLE to 70%
  6. otherwise                                             -> MAINTAIN at baseline

The agent is stateless: per-session SLA progress is passed in. Also provides the impact
accounting (CO2 / energy / cost) behind the KPIs and the 24h forecast.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.models.schemas import GridZone, IndustrialWorkload

BOOST_CARBON_BELOW = 180.0
BOOST_RENEWABLE_AT_LEAST = 60.0
CURTAIL_CARBON_ABOVE = 350.0
MILD_THROTTLE_CARBON_ABOVE = 240.0
HIGH_FLEXIBILITY = 0.7
MILD_THROTTLE_FLEXIBILITY = 0.8
DEFER_MIN_RUNWAY_HOURS = 5
DEFER_IDLE_FRACTION = 0.15
SHORT_RUNWAY_THROTTLE_FRACTION = 0.40
MILD_THROTTLE_FRACTION = 0.70
SLA_CRITICAL_HOURS = 3
SLA_CRITICAL_PROGRESS_BELOW = 85.0
SLA_DONE_PROGRESS = 95.0
DEFAULT_PROGRESS = 35.0

# Tariff model ($/kWh): peaker-priced dirty hours, cheap surplus green hours, flat unmanaged rate.
TARIFF_DIRTY_ABOVE, TARIFF_DIRTY = 300.0, 0.24
TARIFF_CLEAN_BELOW, TARIFF_CLEAN = 180.0, 0.05
TARIFF_NORMAL = 0.12
TARIFF_BASELINE = 0.15


def hours_until(deadline_hour: int, sim_hour: int, progress: float = 0.0) -> int:
    """Hours to the SLA deadline. At the deadline hour, an unfinished quota rolls to tomorrow."""
    hours = (deadline_hour - sim_hour) % 24
    if hours == 0 and progress < SLA_DONE_PROGRESS:
        return 24
    return hours


def tariff_usd_per_kwh(carbon_intensity: float) -> float:
    if carbon_intensity > TARIFF_DIRTY_ABOVE:
        return TARIFF_DIRTY
    if carbon_intensity < TARIFF_CLEAN_BELOW:
        return TARIFF_CLEAN
    return TARIFF_NORMAL


class DispatchAgent:
    def dispatch(
        self,
        workloads: list[IndustrialWorkload],
        zones: list[GridZone],
        sim_hour: int,
        autonomous: bool = True,
        progress: dict[str, float] | None = None,
    ) -> list[IndustrialWorkload]:
        zone_map = {z.zone_id: z for z in zones}
        progress = progress or {}
        return [
            self.decide(w, zone_map.get(w.zone_id), sim_hour, autonomous, progress.get(w.id, w.sla_progress_pct))
            for w in workloads
        ]

    def decide(
        self,
        workload: IndustrialWorkload,
        zone: GridZone | None,
        sim_hour: int,
        autonomous: bool = True,
        progress: float | None = None,
    ) -> IndustrialWorkload:
        baseline = workload.baseline_kw if workload.baseline_kw is not None else workload.current_kw
        pct = DEFAULT_PROGRESS if progress is None else progress

        def result(status: str, kw: float) -> IndustrialWorkload:
            kw = round(min(max(kw, 0.0), workload.max_kw), 1)
            return workload.model_copy(
                update={
                    "status": status,
                    "current_kw": kw,
                    "baseline_kw": baseline,
                    "delta_kw": round(kw - baseline, 1),
                    "sla_progress_pct": pct,
                }
            )

        if not autonomous or zone is None:
            return result("MAINTAIN", baseline)

        runway = hours_until(workload.deadline_hour, sim_hour, pct)
        flex = workload.flexibility_score

        if runway <= SLA_CRITICAL_HOURS and pct < SLA_CRITICAL_PROGRESS_BELOW:
            return result("BOOST", workload.max_kw)

        if zone.renewable_pct >= BOOST_RENEWABLE_AT_LEAST or zone.carbon_intensity < BOOST_CARBON_BELOW:
            boost_factor = 0.7 + (zone.renewable_pct / 100.0) * 0.3
            return result("BOOST", baseline + (workload.max_kw - baseline) * boost_factor)

        if zone.carbon_intensity > CURTAIL_CARBON_ABOVE:
            if flex >= HIGH_FLEXIBILITY:
                if runway > DEFER_MIN_RUNWAY_HOURS:
                    return result("DEFER", baseline * DEFER_IDLE_FRACTION)
                return result("THROTTLE", baseline * SHORT_RUNWAY_THROTTLE_FRACTION)
            return result("THROTTLE", baseline * (1.0 - flex * 0.55))

        if zone.carbon_intensity > MILD_THROTTLE_CARBON_ABOVE and flex >= MILD_THROTTLE_FLEXIBILITY:
            return result("THROTTLE", baseline * MILD_THROTTLE_FRACTION)

        return result("MAINTAIN", baseline)


@dataclass
class Impact:
    co2_avoided_kg: float = 0.0
    energy_shifted_mwh: float = 0.0
    cost_savings_usd: float = 0.0
    baseline_co2_kg: float = 0.0
    managed_co2_kg: float = 0.0
    managed_energy_mwh: float = 0.0
    managed_renewable_mwh: float = 0.0

    def __iadd__(self, other: "Impact") -> "Impact":
        for name in self.__dataclass_fields__:
            setattr(self, name, getattr(self, name) + getattr(other, name))
        return self


def estimate_impact(dispatched: list[IndustrialWorkload], zones: list[GridZone], hours: float = 1.0) -> Impact:
    """
    Impact of the dispatched state versus the unmanaged baseline over `hours`.

    CO2 avoided = baseline emissions - managed emissions (floored at 0 for the step).
    Energy shifted = extra energy absorbed by BOOSTed sites in clean windows.
    Cost saved = per site, baseline flat tariff - managed time-of-use tariff (floored at 0).
    """
    zone_map = {z.zone_id: z for z in zones}
    impact = Impact()
    for w in dispatched:
        zone = zone_map.get(w.zone_id)
        if zone is None:
            continue
        baseline_kw = w.baseline_kw if w.baseline_kw is not None else w.current_kw
        ci = zone.carbon_intensity
        managed_kwh = w.current_kw * hours
        baseline_kwh = baseline_kw * hours

        impact.baseline_co2_kg += baseline_kwh * ci / 1000
        impact.managed_co2_kg += managed_kwh * ci / 1000
        impact.managed_energy_mwh += managed_kwh / 1000
        impact.managed_renewable_mwh += managed_kwh / 1000 * zone.renewable_pct / 100
        impact.cost_savings_usd += max(0.0, baseline_kwh * TARIFF_BASELINE - managed_kwh * tariff_usd_per_kwh(ci))
        if w.status == "BOOST" and w.current_kw > baseline_kw:
            impact.energy_shifted_mwh += (w.current_kw - baseline_kw) * hours / 1000

    impact.co2_avoided_kg = max(0.0, impact.baseline_co2_kg - impact.managed_co2_kg)
    return impact


@dataclass
class DispatchSnapshot:
    """Instantaneous, load-weighted view of the current dispatch."""

    avg_carbon_managed: float
    avg_carbon_baseline: float
    total_active_kw: float
    improvement_pct: float


def snapshot(dispatched: list[IndustrialWorkload], zones: list[GridZone]) -> DispatchSnapshot:
    zone_map = {z.zone_id: z for z in zones}
    rows = [(w, zone_map[w.zone_id]) for w in dispatched if w.zone_id in zone_map]
    active = sum(w.current_kw for w, _ in rows)
    baseline = sum((w.baseline_kw if w.baseline_kw is not None else w.current_kw) for w, _ in rows)
    managed_ci = sum(w.current_kw * z.carbon_intensity for w, z in rows) / max(1.0, active)
    baseline_ci = (
        sum((w.baseline_kw if w.baseline_kw is not None else w.current_kw) * z.carbon_intensity for w, z in rows)
        / max(1.0, baseline)
    )
    improvement = (baseline_ci - managed_ci) / baseline_ci * 100.0 if baseline_ci > 0 else 0.0
    return DispatchSnapshot(
        avg_carbon_managed=round(managed_ci, 1),
        avg_carbon_baseline=round(baseline_ci, 1),
        total_active_kw=round(active, 1),
        improvement_pct=round(improvement, 1),
    )
