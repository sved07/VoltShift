"""Spec: app/agents/workload_manager.py — simulated AI training + EV fleet loads."""

import pytest

from app.agents.workload_manager import WorkloadManager, advance_progress
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


def test_mix_of_flexibility_levels():
    # Needs both DEFER-able (>= 0.7) and partially-throttled (< 0.7) jobs to demo every curtailment path
    scores = [w.flexibility_score for w in WorkloadManager().get_workloads()]
    assert max(scores) >= 0.9 and min(scores) < 0.7


def test_sites_start_at_baseline_with_headroom():
    for w in WorkloadManager().get_workloads():
        assert w.current_kw == w.baseline_kw < w.max_kw


def test_initial_progress_map_and_advance():
    manager = WorkloadManager()
    progress = manager.initial_progress_map()
    assert set(progress) == {w.id for w in manager.get_workloads()}
    assert all(v == manager.initial_progress for v in progress.values())

    workloads = manager.get_workloads()
    advanced = advance_progress(progress, workloads, hours=1.0)
    w = workloads[0]
    assert advanced[w.id] == pytest.approx(min(100.0, progress[w.id] + w.current_kw / 180.0), abs=0.05)
    assert progress[w.id] == manager.initial_progress  # input untouched
    assert all(v <= 100 for v in advance_progress(advanced, workloads, hours=100).values())


def test_returns_independent_copies():
    manager = WorkloadManager()
    manager.get_workloads()[0].current_kw = -999
    assert manager.get_workloads()[0].current_kw != -999
