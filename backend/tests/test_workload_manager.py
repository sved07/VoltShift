"""Spec: app/agents/workload_manager.py — simulated AI training + EV fleet loads."""

from app.agents.workload_manager import WorkloadManager
from app.models.schemas import IndustrialWorkload
from tests.conftest import ISO_IDS, STATUSES


def test_returns_typed_workloads():
    workloads = WorkloadManager().get_workloads()
    assert workloads and all(isinstance(w, IndustrialWorkload) for w in workloads)


def test_includes_both_workload_types():
    assert {w.type for w in WorkloadManager().get_workloads()} == {"AI_TRAINING", "EV_FLEET"}


def test_every_iso_hosts_a_site_and_no_unknown_zones():
    assert {w.zone_id for w in WorkloadManager().get_workloads()} == ISO_IDS


def test_ids_are_unique():
    ids = [w.id for w in WorkloadManager().get_workloads()]
    assert len(ids) == len(set(ids))


def test_load_values_are_consistent():
    for w in WorkloadManager().get_workloads():
        assert w.max_kw > 0, w
        assert 0 <= w.current_kw <= w.max_kw, w
        assert w.status in STATUSES, w


def test_sites_have_map_coordinates():
    for w in WorkloadManager().get_workloads():
        lon, lat = w.coordinates
        assert -125 <= lon <= -66 and 24 <= lat <= 50, w


def test_mix_of_flexible_and_rigid_jobs():
    # Without both, the THROTTLE path and the SLA/rigid protection path can't be demoed
    scores = [w.flexibility_score for w in WorkloadManager().get_workloads()]
    assert max(scores) >= 0.8 and min(scores) <= 0.3


def test_returns_independent_copies():
    manager = WorkloadManager()
    manager.get_workloads()[0].current_kw = -999
    assert manager.get_workloads()[0].current_kw != -999
