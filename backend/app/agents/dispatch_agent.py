"""
Autonomous dispatch agent: decides BOOST / MAINTAIN / THROTTLE / DEFER per workload.

Rules (checked in this order):
  1. Unmanaged baseline mode, or unknown zone          -> MAINTAIN at current draw
  2. carbon > 350 gCO2/kWh
       - deadline within SLA_GUARD_HOURS               -> MAINTAIN (SLA wins over grid)
       - flexible job, very dirty grid, long runway    -> DEFER to a projected clean window
       - flexible job                                  -> THROTTLE by 50-80% (scaled by flexibility)
       - rigid job                                     -> MAINTAIN
  3. renewable_pct > 60% or carbon < 180 gCO2/kWh      -> BOOST to max_kw
  4. otherwise                                         -> MAINTAIN

Also provides the impact accounting (CO2 / energy / cost) used for KPIs and forecasts.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.models.schemas import GridZone, IndustrialWorkload

BOOST_CARBON_BELOW = 180.0
BOOST_RENEWABLE_ABOVE = 60.0
CURTAIL_CARBON_ABOVE = 350.0
DEFER_CARBON_ABOVE = 550.0
FLEXIBLE_THRESHOLD = 0.5
DEFER_FLEXIBILITY = 0.8
DEFER_MIN_RUNWAY_HOURS = 6
SLA_GUARD_HOURS = 1
MIN_THROTTLE, MAX_THROTTLE = 0.5, 0.8

# Impact accounting assumptions
CLEAN_WINDOW_CI = 120.0      # gCO2/kWh where deferred energy is assumed to be consumed later
DISPLACED_CI = 400.0         # gCO2/kWh of the later window that boosted energy displaces
BASE_PRICE_USD_MWH = 25.0
PRICE_PER_GRAM = 0.12        # $/MWh per gCO2/kWh — dirty hours are peaker-priced


def hours_until(deadline_hour: int, sim_hour: int) -> int:
    return (deadline_hour - sim_hour) % 24


def price_usd_per_mwh(carbon_intensity: float) -> float:
    return BASE_PRICE_USD_MWH + PRICE_PER_GRAM * carbon_intensity


class DispatchAgent:
    def dispatch(
        self,
        workloads: list[IndustrialWorkload],
        zones: list[GridZone],
        sim_hour: int,
        autonomous: bool = True,
    ) -> list[IndustrialWorkload]:
        zone_map = {z.zone_id: z for z in zones}
        return [self.decide(w, zone_map.get(w.zone_id), sim_hour, autonomous) for w in workloads]

    def decide(
        self,
        workload: IndustrialWorkload,
        zone: GridZone | None,
        sim_hour: int,
        autonomous: bool = True,
    ) -> IndustrialWorkload:
        baseline = workload.baseline_kw if workload.baseline_kw is not None else workload.current_kw

        def result(status: str, kw: float) -> IndustrialWorkload:
            kw = min(max(kw, 0.0), workload.max_kw)
            return workload.model_copy(update={"status": status, "current_kw": round(kw, 1), "baseline_kw": baseline})

        if not autonomous or zone is None:
            return result("MAINTAIN", baseline)

        if zone.carbon_intensity > CURTAIL_CARBON_ABOVE:
            if hours_until(workload.deadline_hour, sim_hour) <= SLA_GUARD_HOURS:
                return result("MAINTAIN", baseline)
            if workload.flexibility_score < FLEXIBLE_THRESHOLD:
                return result("MAINTAIN", baseline)
            if (
                zone.carbon_intensity > DEFER_CARBON_ABOVE
                and workload.flexibility_score >= DEFER_FLEXIBILITY
                and hours_until(workload.deadline_hour, sim_hour) >= DEFER_MIN_RUNWAY_HOURS
            ):
                return result("DEFER", 0.0)
            span = (workload.flexibility_score - FLEXIBLE_THRESHOLD) / (1 - FLEXIBLE_THRESHOLD)
            cut = MIN_THROTTLE + (MAX_THROTTLE - MIN_THROTTLE) * span
            return result("THROTTLE", baseline * (1 - cut))

        if zone.renewable_pct > BOOST_RENEWABLE_ABOVE or zone.carbon_intensity < BOOST_CARBON_BELOW:
            return result("BOOST", workload.max_kw)

        return result("MAINTAIN", baseline)


@dataclass
class Impact:
    co2_avoided_kg: float = 0.0
    energy_shifted_mwh: float = 0.0
    cost_savings_usd: float = 0.0
    baseline_co2_kg: float = 0.0
    managed_energy_mwh: float = 0.0
    managed_renewable_mwh: float = 0.0

    def __iadd__(self, other: "Impact") -> "Impact":
        for name in self.__dataclass_fields__:
            setattr(self, name, getattr(self, name) + getattr(other, name))
        return self


def estimate_impact(
    dispatched: list[IndustrialWorkload], zones: list[GridZone], hours: float = 1.0
) -> Impact:
    """
    Impact of the dispatched state versus the unmanaged baseline over `hours`.

    Curtailed energy is assumed to run later in a clean window; boosted energy pulls
    work forward from a dirtier future window. Both count as avoided CO2 and cost.
    """
    zone_map = {z.zone_id: z for z in zones}
    impact = Impact()
    for w in dispatched:
        zone = zone_map.get(w.zone_id)
        if zone is None:
            continue
        baseline_kw = w.baseline_kw if w.baseline_kw is not None else w.current_kw
        ci = zone.carbon_intensity
        impact.baseline_co2_kg += baseline_kw * hours * ci / 1000
        impact.managed_energy_mwh += w.current_kw * hours / 1000
        impact.managed_renewable_mwh += w.current_kw * hours / 1000 * zone.renewable_pct / 100

        shifted_mwh = (baseline_kw - w.current_kw) * hours / 1000
        if shifted_mwh > 0 and ci > CLEAN_WINDOW_CI:  # curtailed now, consumed later when clean
            impact.co2_avoided_kg += shifted_mwh * (ci - CLEAN_WINDOW_CI)
            impact.cost_savings_usd += shifted_mwh * (price_usd_per_mwh(ci) - price_usd_per_mwh(CLEAN_WINDOW_CI))
            impact.energy_shifted_mwh += shifted_mwh
        elif shifted_mwh < 0 and ci < DISPLACED_CI:  # boosted now, displacing dirtier later work
            pulled = -shifted_mwh
            impact.co2_avoided_kg += pulled * (DISPLACED_CI - ci)
            impact.cost_savings_usd += pulled * (price_usd_per_mwh(DISPLACED_CI) - price_usd_per_mwh(ci))
            impact.energy_shifted_mwh += pulled
    return impact
