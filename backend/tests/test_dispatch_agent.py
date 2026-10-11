"""
Spec: app/agents/dispatch_agent.py (rules ported from the VoltShift v2 backend)
  1. unmanaged or unknown zone                    -> MAINTAIN at baseline
  2. deadline <= 3h and quota < 85%               -> BOOST to max_kw (SLA beats the grid)
  3. renewables >= 60% or carbon < 180            -> BOOST into 70-100% of headroom
  4. carbon > 350: flex >= 0.7 -> DEFER (15%) with > 5h runway, else THROTTLE (40%);
                   less flexible -> THROTTLE by flex * 55%
  5. carbon > 240 and flex >= 0.8                 -> THROTTLE to 70%
  6. otherwise                                    -> MAINTAIN
"""

import pytest

from app.agents.dispatch_agent import (
    DispatchAgent,
    estimate_impact,
    hours_until,
    snapshot,
    tariff_usd_per_kwh,
)

NOW = 6          # sim hour; default deadline (23) is far away
ON_TRACK = 90.0  # SLA progress that never triggers the critical-boost rule


@pytest.fixture
def agent():
    return DispatchAgent()


def run_one(agent, workload, zone, sim_hour=NOW, autonomous=True, progress=ON_TRACK):
    [result] = agent.dispatch([workload], [zone], sim_hour, autonomous=autonomous, progress={workload.id: progress})
    return result


def wl(make_workload, **kw):
    kw.setdefault("baseline_kw", 1000.0)
    kw.setdefault("current_kw", kw["baseline_kw"])
    kw.setdefault("max_kw", 2000.0)
    return make_workload(**kw)


class TestBoost:
    @pytest.mark.parametrize("renew", [0, 30, 60, 100])
    def test_low_carbon_boosts_into_headroom_scaled_by_renewables(self, agent, make_zone, make_workload, renew):
        r = run_one(agent, wl(make_workload), make_zone(carbon_intensity=120, renewable_pct=renew))
        assert r.status == "BOOST"
        assert r.current_kw == pytest.approx(1000 + 1000 * (0.7 + renew / 100 * 0.3), abs=0.1)

    def test_renewables_at_60_boosts_even_with_mid_carbon(self, agent, make_zone, make_workload):
        assert run_one(agent, wl(make_workload), make_zone(carbon_intensity=250, renewable_pct=60)).status == "BOOST"

    def test_rigid_jobs_still_boost_on_clean_grid(self, agent, make_zone, make_workload):
        r = run_one(agent, wl(make_workload, flexibility_score=0.05), make_zone(carbon_intensity=100))
        assert r.status == "BOOST"

    def test_boost_never_exceeds_max(self, agent, make_zone, make_workload):
        r = run_one(agent, wl(make_workload, max_kw=1000.0), make_zone(carbon_intensity=50, renewable_pct=100))
        assert r.current_kw <= r.max_kw


class TestBoundaries:
    def test_carbon_exactly_180_is_not_boost(self, agent, make_zone, make_workload):
        assert run_one(agent, wl(make_workload), make_zone(carbon_intensity=180, renewable_pct=30)).status != "BOOST"

    def test_renewables_just_below_60_is_not_boost(self, agent, make_zone, make_workload):
        assert run_one(agent, wl(make_workload), make_zone(carbon_intensity=250, renewable_pct=59.9)).status != "BOOST"

    def test_carbon_exactly_350_is_not_deferred(self, agent, make_zone, make_workload):
        r = run_one(agent, wl(make_workload, flexibility_score=1.0), make_zone(carbon_intensity=350, renewable_pct=10))
        assert r.status != "DEFER"

    def test_mid_band_maintains_baseline_for_moderate_flex(self, agent, make_zone, make_workload):
        r = run_one(agent, wl(make_workload, flexibility_score=0.7), make_zone(carbon_intensity=260, renewable_pct=35))
        assert r.status == "MAINTAIN" and r.current_kw == pytest.approx(1000)

    def test_quiet_band_maintains_everyone(self, agent, make_zone, make_workload):
        r = run_one(agent, wl(make_workload, flexibility_score=1.0), make_zone(carbon_intensity=200, renewable_pct=35))
        assert r.status == "MAINTAIN"


class TestCurtailment:
    def test_mild_peak_throttles_very_flexible_jobs_to_70pct(self, agent, make_zone, make_workload):
        r = run_one(agent, wl(make_workload, flexibility_score=0.8), make_zone(carbon_intensity=300, renewable_pct=20))
        assert r.status == "THROTTLE" and r.current_kw == pytest.approx(700)

    def test_dirty_grid_defers_flexible_job_with_runway(self, agent, make_zone, make_workload):
        r = run_one(agent, wl(make_workload, flexibility_score=0.7), make_zone(carbon_intensity=400, renewable_pct=10))
        assert r.status == "DEFER" and r.current_kw == pytest.approx(150)

    def test_dirty_grid_short_runway_throttles_to_40pct(self, agent, make_zone, make_workload):
        r = run_one(agent, wl(make_workload, flexibility_score=0.9, deadline_hour=NOW + 5),
                    make_zone(carbon_intensity=400, renewable_pct=10))
        assert r.status == "THROTTLE" and r.current_kw == pytest.approx(400)

    @pytest.mark.parametrize("flex", [0.0, 0.3, 0.6])
    def test_less_flexible_jobs_throttle_by_flex_share(self, agent, make_zone, make_workload, flex):
        r = run_one(agent, wl(make_workload, flexibility_score=flex), make_zone(carbon_intensity=420, renewable_pct=10))
        assert r.status == "THROTTLE"
        assert r.current_kw == pytest.approx(1000 * (1 - flex * 0.55), abs=0.1)

    def test_delta_kw_reports_change_vs_baseline(self, agent, make_zone, make_workload):
        r = run_one(agent, wl(make_workload, flexibility_score=0.7), make_zone(carbon_intensity=400, renewable_pct=10))
        assert r.delta_kw == pytest.approx(-850)


class TestSlaEnforcement:
    @pytest.mark.parametrize("deadline", [NOW + 1, NOW + 3])
    def test_behind_schedule_near_deadline_boosts_to_max_even_on_dirty_grid(self, agent, make_zone, make_workload, deadline):
        r = run_one(agent, wl(make_workload, flexibility_score=1.0, deadline_hour=deadline),
                    make_zone(carbon_intensity=650, renewable_pct=3), progress=50.0)
        assert r.status == "BOOST" and r.current_kw == pytest.approx(2000)

    def test_on_track_jobs_are_not_force_boosted(self, agent, make_zone, make_workload):
        r = run_one(agent, wl(make_workload, flexibility_score=1.0, deadline_hour=NOW + 2),
                    make_zone(carbon_intensity=650, renewable_pct=3), progress=ON_TRACK)
        assert r.status == "THROTTLE"

    def test_four_hours_out_is_not_critical(self, agent, make_zone, make_workload):
        r = run_one(agent, wl(make_workload, flexibility_score=1.0, deadline_hour=NOW + 4),
                    make_zone(carbon_intensity=650, renewable_pct=3), progress=10.0)
        assert r.status != "BOOST"

    def test_deadline_wraps_past_midnight(self):
        assert hours_until(1, 23) == 2

    def test_unfinished_quota_at_deadline_rolls_to_tomorrow(self):
        assert hours_until(6, 6, progress=50) == 24
        assert hours_until(6, 6, progress=99) == 0

    def test_progress_is_reported_on_the_workload(self, agent, make_zone, make_workload):
        r = run_one(agent, wl(make_workload), make_zone(), progress=42.0)
        assert r.sla_progress_pct == 42.0

    def test_missing_progress_defaults_to_initial_quota(self, agent, make_zone, make_workload):
        [r] = agent.dispatch([wl(make_workload)], [make_zone()], NOW)
        assert r.sla_progress_pct == 35.0


class TestUnmanagedBaseline:
    @pytest.mark.parametrize("carbon,renew", [(80, 80), (260, 30), (600, 3)])
    def test_baseline_mode_never_shifts_load(self, agent, make_zone, make_workload, carbon, renew):
        r = run_one(agent, wl(make_workload), make_zone(carbon_intensity=carbon, renewable_pct=renew),
                    autonomous=False, progress=10.0)
        assert r.status == "MAINTAIN" and r.current_kw == pytest.approx(1000) and r.delta_kw == 0


class TestMultiZoneDispatch:
    def test_each_workload_uses_its_own_zone(self, agent, make_zone, make_workload):
        zones = [make_zone("CAISO", carbon_intensity=90, renewable_pct=75),
                 make_zone("PJM", carbon_intensity=520, renewable_pct=5)]
        workloads = [wl(make_workload, workload_id="a", zone_id="CAISO"),
                     wl(make_workload, workload_id="b", zone_id="PJM")]
        results = {w.id: w for w in agent.dispatch(workloads, zones, NOW, progress={"a": 90, "b": 90})}
        assert results["a"].status == "BOOST"
        assert results["b"].status == "DEFER"

    def test_redispatch_uses_original_baseline(self, agent, make_zone, make_workload):
        boosted = run_one(agent, wl(make_workload), make_zone(carbon_intensity=100))
        again = run_one(agent, boosted, make_zone(carbon_intensity=200))
        assert again.status == "MAINTAIN" and again.current_kw == pytest.approx(1000)

    def test_inputs_are_not_mutated(self, agent, make_zone, make_workload):
        workload = wl(make_workload)
        snapshot_before = workload.model_dump()
        agent.dispatch([workload], [make_zone(carbon_intensity=50, renewable_pct=90)], NOW)
        assert workload.model_dump() == snapshot_before

    def test_unknown_zone_is_left_at_baseline(self, agent, make_zone, make_workload):
        [r] = agent.dispatch([wl(make_workload, zone_id="SPP")], [make_zone("ERCOT")], NOW)
        assert r.status == "MAINTAIN" and r.current_kw == pytest.approx(1000)

    def test_empty_inputs(self, agent):
        assert agent.dispatch([], [], NOW) == []

    def test_power_always_within_bounds(self, agent, make_zone, make_workload):
        for carbon in (20, 150, 179, 181, 245, 351, 900):
            for flex in (0.0, 0.5, 0.7, 0.8, 1.0):
                for progress in (0.0, 50.0, 100.0):
                    r = run_one(agent, wl(make_workload, flexibility_score=flex), make_zone(carbon_intensity=carbon),
                                progress=progress)
                    assert 0 <= r.current_kw <= r.max_kw, (carbon, flex, r)


class TestImpactAccounting:
    def test_tariffs(self):
        assert tariff_usd_per_kwh(400) == 0.24
        assert tariff_usd_per_kwh(100) == 0.05
        assert tariff_usd_per_kwh(250) == 0.12

    def test_unchanged_load_saves_no_co2(self, make_zone, make_workload):
        w = make_workload(current_kw=500, baseline_kw=500)
        impact = estimate_impact([w], [make_zone(carbon_intensity=250)])
        assert impact.co2_avoided_kg == 0 and impact.energy_shifted_mwh == 0
        assert impact.baseline_co2_kg == pytest.approx(500 * 250 / 1000)
        # flat $0.15 baseline vs $0.12 normal tariff still saves money
        assert impact.cost_savings_usd == pytest.approx(500 * (0.15 - 0.12))

    def test_curtailing_dirty_load_avoids_its_emissions(self, make_zone, make_workload):
        w = make_workload(current_kw=200, baseline_kw=1000, status="THROTTLE")
        impact = estimate_impact([w], [make_zone(carbon_intensity=500)], hours=1)
        assert impact.co2_avoided_kg == pytest.approx(0.8 * 500)
        assert impact.cost_savings_usd == pytest.approx(1000 * 0.15 - 200 * 0.24)

    def test_boosting_counts_clean_energy_shifted(self, make_zone, make_workload):
        w = make_workload(current_kw=1600, baseline_kw=1000, status="BOOST")
        impact = estimate_impact([w], [make_zone(carbon_intensity=100)], hours=1)
        assert impact.energy_shifted_mwh == pytest.approx(0.6)
        assert impact.co2_avoided_kg == 0  # extra draw adds emissions; floored at zero per step

    def test_impact_scales_with_duration(self, make_zone, make_workload):
        w = make_workload(current_kw=200, baseline_kw=1000)
        zone = make_zone(carbon_intensity=520)
        assert estimate_impact([w], [zone], hours=2).co2_avoided_kg == pytest.approx(
            2 * estimate_impact([w], [zone], hours=1).co2_avoided_kg
        )

    def test_never_reports_negative_savings(self, agent, make_zone, make_workload):
        for carbon in (50, 200, 300, 360, 700):
            zone = make_zone(carbon_intensity=carbon)
            results = agent.dispatch([wl(make_workload, flexibility_score=f) for f in (0.1, 0.6, 1.0)], [zone], NOW)
            impact = estimate_impact(results, [zone])
            assert impact.co2_avoided_kg >= 0 and impact.cost_savings_usd >= 0


class TestSnapshot:
    def test_load_weighted_carbon_and_improvement(self, make_zone, make_workload):
        zones = [make_zone("CAISO", carbon_intensity=100), make_zone("PJM", carbon_intensity=400)]
        workloads = [
            make_workload("a", zone_id="CAISO", current_kw=1500, baseline_kw=1000),
            make_workload("b", zone_id="PJM", current_kw=500, baseline_kw=1000),
        ]
        snap = snapshot(workloads, zones)
        assert snap.total_active_kw == 2000
        assert snap.avg_carbon_baseline == pytest.approx(250)
        assert snap.avg_carbon_managed == pytest.approx((1500 * 100 + 500 * 400) / 2000)
        assert snap.improvement_pct == pytest.approx(round((250 - 175) / 250 * 100, 1))

    def test_empty(self):
        snap = snapshot([], [])
        assert snap.total_active_kw == 0 and snap.improvement_pct == 0
