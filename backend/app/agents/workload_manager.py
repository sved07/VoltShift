"""Simulated heavy industrial workloads: AI training clusters and commercial EV fleet depots."""

from __future__ import annotations

from app.agents.grid_monitor import load_iso_parameters
from app.models.schemas import IndustrialWorkload

# Share of a day's quota delivered by one kW running for one hour (a full day ~ 180 kWh-units).
PROGRESS_PER_KWH = 1.0 / 180.0


class WorkloadManager:
    def __init__(self, sites: list[dict] | None = None):
        data = load_iso_parameters()
        self._initial_progress = float(data.get("initial_sla_progress_pct", 35.0))
        templates = sites if sites is not None else data["workloads"]
        self._workloads = [
            IndustrialWorkload(
                status="MAINTAIN",
                current_kw=site["baseline_kw"],
                **{k: v for k, v in site.items() if k != "current_kw"},
            )
            for site in templates
        ]

    @property
    def initial_progress(self) -> float:
        return self._initial_progress

    def get_workloads(self) -> list[IndustrialWorkload]:
        """Unmanaged baseline workloads. Returns copies, so callers may freely modify them."""
        return [w.model_copy(deep=True) for w in self._workloads]

    def initial_progress_map(self) -> dict[str, float]:
        """Fresh per-session SLA progress (percent of today's quota delivered)."""
        return {w.id: self._initial_progress for w in self._workloads}


def advance_progress(progress: dict[str, float], workloads: list[IndustrialWorkload], hours: float) -> dict[str, float]:
    """Credit each site for the energy it drew over `hours`. Returns a new map, capped at 100%."""
    updated = dict(progress)
    for w in workloads:
        current = updated.get(w.id, 0.0)
        updated[w.id] = round(min(100.0, current + w.current_kw * hours * PROGRESS_PER_KWH), 1)
    return updated
