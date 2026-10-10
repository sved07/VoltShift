"""Simulated heavy industrial workloads: AI training clusters and commercial EV fleet depots."""

from __future__ import annotations

from app.models.schemas import IndustrialWorkload

_SITES: list[dict] = [
    # ERCOT
    dict(id="dc-abilene", site_name="Abilene AI Campus", type="AI_TRAINING", zone_id="ERCOT",
         current_kw=42000, max_kw=60000, flexibility_score=0.85, deadline_hour=22, coordinates=(-99.73, 32.45)),
    dict(id="ev-dallas", site_name="Dallas Logistics EV Depot", type="EV_FLEET", zone_id="ERCOT",
         current_kw=6500, max_kw=9000, flexibility_score=0.55, deadline_hour=5, coordinates=(-96.80, 32.78)),
    # CAISO
    dict(id="dc-santaclara", site_name="Santa Clara GPU Cluster", type="AI_TRAINING", zone_id="CAISO",
         current_kw=30000, max_kw=45000, flexibility_score=0.9, deadline_hour=20, coordinates=(-121.96, 37.35)),
    dict(id="ev-oakland", site_name="Port of Oakland Drayage Hub", type="EV_FLEET", zone_id="CAISO",
         current_kw=4800, max_kw=7200, flexibility_score=0.7, deadline_hour=6, coordinates=(-122.28, 37.80)),
    # PJM
    dict(id="dc-ashburn", site_name="Ashburn Hyperscale DC", type="AI_TRAINING", zone_id="PJM",
         current_kw=55000, max_kw=70000, flexibility_score=0.6, deadline_hour=23, coordinates=(-77.49, 39.04)),
    dict(id="ev-newark", site_name="Newark Parcel Fleet Depot", type="EV_FLEET", zone_id="PJM",
         current_kw=5200, max_kw=6000, flexibility_score=0.2, deadline_hour=6, coordinates=(-74.17, 40.73)),
    # MISO
    dict(id="dc-desmoines", site_name="Des Moines Model Foundry", type="AI_TRAINING", zone_id="MISO",
         current_kw=38000, max_kw=50000, flexibility_score=0.95, deadline_hour=21, coordinates=(-93.61, 41.59)),
    dict(id="ev-chicago", site_name="Chicago Transit Bus Barn", type="EV_FLEET", zone_id="MISO",
         current_kw=3900, max_kw=4500, flexibility_score=0.1, deadline_hour=4, coordinates=(-87.63, 41.88)),
]


class WorkloadManager:
    def __init__(self, sites: list[dict] | None = None):
        self._workloads = [
            IndustrialWorkload(status="MAINTAIN", **site) for site in (sites if sites is not None else _SITES)
        ]

    def get_workloads(self) -> list[IndustrialWorkload]:
        """Unmanaged baseline workloads. Returns copies, so callers may freely modify them."""
        return [w.model_copy(deep=True) for w in self._workloads]
