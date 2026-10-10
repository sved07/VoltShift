"""
Spec: app/agents/dispatch_agent.py
  * renewable_pct > 60% or carbon < 180 gCO2      -> BOOST up to max_kw
  * carbon > 350 gCO2 and job is flexible         -> THROTTLE by 50-80% or DEFER
  * SLA deadlines enforced regardless of grid status
"""

import pytest

from app.agents.dispatch_agent import DispatchAgent, estimate_impact

FLEXIBLE = 0.9
RIGID = 0.05
NOW = 6  # sim hour; default deadline (23) is far away


@pytest.fixture
def agent():
    return DispatchAgent()


def run_one(agent, workload, zone, sim_hour=NOW, autonomous=True):
    [result] = agent.dispatch([workload], [zone], sim_hour, autonomous=autonomous)
    return result


class TestBoost:
    def test_low_carbon_boosts_to_max(self, agent, make_zone, make_workload):
        r = run_one(agent, make_workload(current_kw=400, max_kw=1000), make_zone(carbon_intensity=120))
        assert r.status == "BOOST" and r.current_kw == pytest.approx(1000)

    def test_high_renewables_boosts_even_with_mid_carbon(self, agent, make_zone, make_workload):
        assert run_one(agent, make_workload(), make_zone(carbon_intensity=250, renewable_pct=65)).status == "BOOST"

    def test_rigid_jobs_still_boost_on_clean_grid(self, agent, make_zone, make_workload):
        r = run_one(agent, make_workload(flexibility_score=RIGID), make_zone(carbon_intensity=100))
        assert r.status == "BOOST"

    def test_dirty_grid_never_boosts_even_with_high_renewables(self, agent, make_zone, make_workload):
        r = run_one(agent, make_workload(), make_zone(carbon_intensity=420, renewable_pct=70))
        assert r.status != "BOOST"


class TestBoundaries:
    def test_carbon_exactly_180_is_not_boost(self, agent, make_zone, make_workload):
        assert run_one(agent, make_workload(), make_zone(carbon_intensity=180)).status != "BOOST"

    def test_carbon_just_below_180_is_boost(self, agent, make_zone, make_workload):
        assert run_one(agent, make_workload(), make_zone(carbon_intensity=179.9)).status == "BOOST"

    def test_renewables_exactly_60_is_not_boost(self, agent, make_zone, make_workload):
        assert run_one(agent, make_workload(), make_zone(carbon_intensity=250, renewable_pct=60)).status != "BOOST"

    def test_carbon_exactly_350_is_not_curtailed(self, agent, make_zone, make_workload):
        r = run_one(agent, make_workload(), make_zone(carbon_intensity=350, renewable_pct=10))
        assert r.status not in {"THROTTLE", "DEFER"}

    def test_mid_band_maintains_current_load(self, agent, make_zone, make_workload):
        r = run_one(agent, make_workload(current_kw=500), make_zone(carbon_intensity=260, renewable_pct=35))
        assert r.status == "MAINTAIN" and r.current_kw == pytest.approx(500)


class TestCurtailment:
    def test_dirty_grid_curtails_flexible_job(self, agent, make_zone, make_workload):
        r = run_one(agent, make_workload(flexibility_score=FLEXIBLE), make_zone(carbon_intensity=480, renewable_pct=10))
        assert r.status in {"THROTTLE", "DEFER"}

    @pytest.mark.parametrize("flex", [0.5, 0.7, 0.9, 1.0])
    def test_throttle_cuts_load_by_50_to_80_percent(self, agent, make_zone, make_workload, flex):
        original = 1000.0
        r = run_one(agent, make_workload(current_kw=original, max_kw=1200, flexibility_score=flex),
                    make_zone(carbon_intensity=420, renewable_pct=10))
        assert r.status == "THROTTLE"
        assert 0.2 * original - 1e-6 <= r.current_kw <= 0.5 * original + 1e-6

    def test_more_flexible_jobs_are_throttled_harder(self, agent, make_zone, make_workload):
        zone = make_zone(carbon_intensity=420, renewable_pct=10)
        soft = run_one(agent, make_workload(flexibility_score=0.55), zone)
        hard = run_one(agent, make_workload(flexibility_score=0.95), zone)
        assert hard.current_kw < soft.current_kw

    def test_very_dirty_grid_defers_highly_flexible_job(self, agent, make_zone, make_workload):
        r = run_one(agent, make_workload(current_kw=800, flexibility_score=1.0), make_zone(carbon_intensity=700, renewable_pct=2))
        assert r.status == "DEFER" and r.current_kw == 0

    def test_rigid_job_not_curtailed_on_dirty_grid(self, agent, make_zone, make_workload):
        r = run_one(agent, make_workload(current_kw=600, flexibility_score=RIGID), make_zone(carbon_intensity=500, renewable_pct=5))
        assert r.status == "MAINTAIN" and r.current_kw == pytest.approx(600)


class TestSlaEnforcement:
    @pytest.mark.parametrize("deadline", [NOW, NOW + 1])
    def test_imminent_deadline_overrides_dirty_grid(self, agent, make_zone, make_workload, deadline):
        r = run_one(agent, make_workload(current_kw=700, flexibility_score=1.0, deadline_hour=deadline),
                    make_zone(carbon_intensity=650, renewable_pct=3))
        assert r.status == "MAINTAIN" and r.current_kw >= 700

    def test_short_runway_throttles_instead_of_deferring(self, agent, make_zone, make_workload):
        r = run_one(agent, make_workload(flexibility_score=1.0, deadline_hour=NOW + 3),
                    make_zone(carbon_intensity=700, renewable_pct=2))
        assert r.status == "THROTTLE" and r.current_kw > 0

    def test_distant_deadline_allows_defer(self, agent, make_zone, make_workload):
        r = run_one(agent, make_workload(flexibility_score=1.0, deadline_hour=NOW + 12),
                    make_zone(carbon_intensity=650, renewable_pct=3))
        assert r.status == "DEFER"

    def test_deadline_wraps_past_midnight(self, agent, make_zone, make_workload):
        # At 23:00 a 00:00 deadline is 1 hour away, not 23 hours ago
        r = run_one(agent, make_workload(flexibility_score=1.0, deadline_hour=0),
                    make_zone(carbon_intensity=650, renewable_pct=3), sim_hour=23)
        assert r.status == "MAINTAIN"


class TestUnmanagedBaseline:
    @pytest.mark.parametrize("carbon,renew", [(80, 80), (260, 30), (600, 3)])
    def test_baseline_mode_never_shifts_load(self, agent, make_zone, make_workload, carbon, renew):
        r = run_one(agent, make_workload(current_kw=500), make_zone(carbon_intensity=carbon, renewable_pct=renew),
                    autonomous=False)
        assert r.status == "MAINTAIN" and r.current_kw == pytest.approx(500)


class TestMultiZoneDispatch:
    def test_each_workload_uses_its_own_zone(self, agent, make_zone, make_workload):
        zones = [make_zone("CAISO", carbon_intensity=90, renewable_pct=75),
                 make_zone("PJM", carbon_intensity=520, renewable_pct=5)]
        workloads = [make_workload("a", zone_id="CAISO"), make_workload("b", zone_id="PJM")]
        results = {w.id: w for w in agent.dispatch(workloads, zones, NOW)}
        assert results["a"].status == "BOOST"
        assert results["b"].status in {"THROTTLE", "DEFER"}

    def test_preserves_order_and_identity_fields(self, agent, make_zone, make_workload):
        workloads = [make_workload(f"w{i}", type="EV_FLEET" if i % 2 else "AI_TRAINING") for i in range(5)]
        results = agent.dispatch(workloads, [make_zone(carbon_intensity=100)], NOW)
        assert [r.id for r in results] == [w.id for w in workloads]
        for before, after in zip(workloads, results):
            for field in ("site_name", "type", "zone_id", "max_kw", "deadline_hour", "flexibility_score"):
                assert getattr(after, field) == getattr(before, field)

    def test_records_baseline_kw(self, agent, make_zone, make_workload):
        r = run_one(agent, make_workload(current_kw=400), make_zone(carbon_intensity=100))
        assert r.baseline_kw == pytest.approx(400)

    def test_redispatch_uses_original_baseline(self, agent, make_zone, make_workload):
        boosted = run_one(agent, make_workload(current_kw=400), make_zone(carbon_intensity=100))
        again = run_one(agent, boosted, make_zone(carbon_intensity=260))
        assert again.status == "MAINTAIN" and again.current_kw == pytest.approx(400)

    def test_inputs_are_not_mutated(self, agent, make_zone, make_workload):
        workload = make_workload(current_kw=500)
        snapshot = workload.model_dump()
        agent.dispatch([workload], [make_zone(carbon_intensity=50, renewable_pct=90)], NOW)
        assert workload.model_dump() == snapshot

    def test_unknown_zone_is_left_unchanged(self, agent, make_zone, make_workload):
        [r] = agent.dispatch([make_workload(zone_id="SPP", current_kw=300)], [make_zone("ERCOT")], NOW)
        assert r.status == "MAINTAIN" and r.current_kw == pytest.approx(300)

    def test_empty_inputs(self, agent):
        assert agent.dispatch([], [], NOW) == []

    def test_power_always_within_bounds(self, agent, make_zone, make_workload):
        for carbon in (20, 150, 179, 181, 300, 351, 551, 900):
            for flex in (0.0, 0.49, 0.5, 0.8, 1.0):
                r = run_one(agent, make_workload(flexibility_score=flex), make_zone(carbon_intensity=carbon))
                assert 0 <= r.current_kw <= r.max_kw, (carbon, flex, r)


class TestImpactAccounting:
    def test_no_change_means_no_savings(self, make_zone, make_workload):
        w = make_workload(current_kw=500, baseline_kw=500)
        impact = estimate_impact([w], [make_zone(carbon_intensity=300)])
        assert impact.co2_avoided_kg == 0 and impact.cost_savings_usd == 0 and impact.energy_shifted_mwh == 0
        assert impact.baseline_co2_kg == pytest.approx(500 * 300 / 1000)

    def test_curtailing_dirty_load_avoids_co2(self, make_zone, make_workload):
        w = make_workload(current_kw=200, baseline_kw=1000)
        impact = estimate_impact([w], [make_zone(carbon_intensity=520)], hours=1)
        # 0.8 MWh shifted from 520 g to a 120 g clean window -> 320 kg
        assert impact.co2_avoided_kg == pytest.approx(0.8 * (520 - 120))
        assert impact.energy_shifted_mwh == pytest.approx(0.8)
        assert impact.cost_savings_usd > 0

    def test_boosting_into_clean_power_avoids_co2(self, make_zone, make_workload):
        w = make_workload(current_kw=1000, baseline_kw=400)
        impact = estimate_impact([w], [make_zone(carbon_intensity=100)], hours=1)
        assert impact.co2_avoided_kg == pytest.approx(0.6 * (400 - 100))
        assert impact.cost_savings_usd > 0

    def test_impact_scales_with_duration(self, make_zone, make_workload):
        w = make_workload(current_kw=200, baseline_kw=1000)
        zone = make_zone(carbon_intensity=520)
        assert estimate_impact([w], [zone], hours=2).co2_avoided_kg == pytest.approx(
            2 * estimate_impact([w], [zone], hours=1).co2_avoided_kg
        )

    def test_full_dispatch_never_reports_negative_savings(self, agent, make_zone, make_workload):
        for carbon in (50, 200, 360, 700):
            zone = make_zone(carbon_intensity=carbon)
            results = agent.dispatch([make_workload(flexibility_score=f) for f in (0.1, 0.6, 1.0)], [zone], NOW)
            impact = estimate_impact(results, [zone])
            assert impact.co2_avoided_kg >= 0 and impact.cost_savings_usd >= 0
