"""Spec: app/main.py — FastAPI app, CORS, and the /ws/grid-telemetry tick loop + client actions."""

import json

import pytest
from fastapi.testclient import TestClient

from app import main
from app.main import SimulationSession, app
from app.models.schemas import TelemetryPacket
from tests.conftest import ISO_IDS

METRIC_KEYS = {"co2_avoided_kg", "energy_shifted_mwh", "cost_savings_usd", "improvement_pct", "clean_energy_share_pct"}


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(main, "TICK_INTERVAL_SECONDS", 0.02)
    with TestClient(app) as c:
        yield c


def receive_until(ws, predicate, max_packets=60):
    for _ in range(max_packets):
        packet = ws.receive_json()
        if predicate(packet):
            return packet
    raise AssertionError("condition never met in streamed packets")


def by_id(packet):
    return {z["zone_id"]: z for z in packet["zones"]}


def test_tick_interval_is_one_and_a_half_seconds():
    assert main.TICK_INTERVAL_SECONDS == 1.5


class TestWebSocketStream:
    def test_streams_valid_telemetry_packets(self, client):
        with client.websocket_connect("/ws/grid-telemetry") as ws:
            for _ in range(3):
                packet = TelemetryPacket.model_validate(ws.receive_json())
                assert {z.zone_id for z in packet.zones} == ISO_IDS
                assert {w.type for w in packet.workloads} == {"AI_TRAINING", "EV_FLEET"}
                assert 0 <= packet.sim_hour <= 23
                assert METRIC_KEYS <= set(packet.cumulative_metrics)

    def test_set_hour_changes_sim_hour(self, client):
        with client.websocket_connect("/ws/grid-telemetry") as ws:
            ws.receive_json()
            ws.send_json({"action": "SET_HOUR", "hour": 14})
            assert receive_until(ws, lambda p: p["sim_hour"] == 14)["sim_hour"] == 14
            ws.send_json({"action": "SET_HOUR", "hour": 0})
            receive_until(ws, lambda p: p["sim_hour"] == 0)

    @pytest.mark.parametrize("bad", [
        {"action": "SET_HOUR", "hour": 24},
        {"action": "SET_HOUR", "hour": -1},
        {"action": "SET_HOUR", "hour": "5"},
        {"action": "SET_HOUR", "hour": True},
        {"action": "SET_HOUR"},
        {"action": "REBOOT_GRID"},
        {"hour": 3},
        [1, 2, 3],
    ])
    def test_invalid_actions_are_ignored_and_connection_survives(self, client, bad):
        with client.websocket_connect("/ws/grid-telemetry") as ws:
            ws.send_json({"action": "SET_HOUR", "hour": 9})
            receive_until(ws, lambda p: p["sim_hour"] == 9)
            ws.send_json(bad)
            for _ in range(3):
                assert ws.receive_json()["sim_hour"] == 9
            ws.send_json({"action": "SET_HOUR", "hour": 10})
            receive_until(ws, lambda p: p["sim_hour"] == 10)

    def test_malformed_json_does_not_crash(self, client):
        with client.websocket_connect("/ws/grid-telemetry") as ws:
            ws.receive_json()
            ws.send_text("{not json")
            ws.send_text("x" * 10_000)
            ws.send_json({"action": "SET_HOUR", "hour": 4})
            receive_until(ws, lambda p: p["sim_hour"] == 4)

    def test_toggle_mode_switches_to_unmanaged_baseline(self, client):
        with client.websocket_connect("/ws/grid-telemetry") as ws:
            ws.send_json({"action": "SET_HOUR", "hour": 12})
            receive_until(ws, lambda p: p["sim_hour"] == 12)
            ws.send_json({"action": "TOGGLE_MODE"})
            packet = receive_until(ws, lambda p: p["cumulative_metrics"]["mode"] == "UNMANAGED")
            assert {w["status"] for w in packet["workloads"]} == {"MAINTAIN"}
            assert packet["ai_explanation"]["primary_driver"] == "Unmanaged Baseline"
            ws.send_json({"action": "TOGGLE_MODE"})
            packet = receive_until(ws, lambda p: p["cumulative_metrics"]["mode"] == "AUTONOMOUS")
            assert "BOOST" in {w["status"] for w in packet["workloads"]}

    def test_peaker_spike_raises_carbon_and_toggles_off(self, client):
        with client.websocket_connect("/ws/grid-telemetry") as ws:
            ws.send_json({"action": "SET_HOUR", "hour": 14})
            normal = receive_until(ws, lambda p: p["sim_hour"] == 14)
            ws.send_json({"action": "TRIGGER_PEAKER_SPIKE"})
            spiked = receive_until(ws, lambda p: p["cumulative_metrics"]["peaker_spike_active"])
            for iso in ("ERCOT", "PJM", "MISO"):
                assert by_id(spiked)[iso]["carbon_intensity"] > by_id(normal)[iso]["carbon_intensity"]
            assert by_id(spiked)["CAISO"]["carbon_intensity"] == by_id(normal)["CAISO"]["carbon_intensity"]
            assert spiked["ai_explanation"]["primary_driver"] == "Grid Fossil Peaker Spike"
            assert {"THROTTLE", "DEFER"} & {w["status"] for w in spiked["workloads"]}
            ws.send_json({"action": "TRIGGER_PEAKER_SPIKE"})
            cleared = receive_until(ws, lambda p: not p["cumulative_metrics"]["peaker_spike_active"])
            assert by_id(cleared)["CAISO"]["carbon_intensity"] == by_id(normal)["CAISO"]["carbon_intensity"]

    def test_cumulative_metrics_grow_monotonically_in_autonomous_mode(self, client):
        with client.websocket_connect("/ws/grid-telemetry") as ws:
            ws.send_json({"action": "SET_HOUR", "hour": 12})
            receive_until(ws, lambda p: p["sim_hour"] == 12)
            history = [ws.receive_json()["cumulative_metrics"] for _ in range(6)]
        for key in ("co2_avoided_kg", "energy_shifted_mwh", "cost_savings_usd"):
            values = [m[key] for m in history]
            assert values == sorted(values), key
            assert values[-1] > 0, key

    def test_unmanaged_mode_accrues_no_savings(self, client):
        with client.websocket_connect("/ws/grid-telemetry") as ws:
            ws.receive_json()
            ws.send_json({"action": "TOGGLE_MODE"})
            receive_until(ws, lambda p: p["cumulative_metrics"]["mode"] == "UNMANAGED")
            first = ws.receive_json()["cumulative_metrics"]["co2_avoided_kg"]
            for _ in range(4):
                assert ws.receive_json()["cumulative_metrics"]["co2_avoided_kg"] == first

    def test_sessions_are_isolated_per_connection(self, client):
        with client.websocket_connect("/ws/grid-telemetry") as a, client.websocket_connect("/ws/grid-telemetry") as b:
            a.send_json({"action": "TOGGLE_MODE"})
            receive_until(a, lambda p: p["cumulative_metrics"]["mode"] == "UNMANAGED")
            assert b.receive_json()["cumulative_metrics"]["mode"] == "AUTONOMOUS"

    def test_uses_rule_based_explainer_without_key(self, client):
        with client.websocket_connect("/ws/grid-telemetry") as ws:
            assert ws.receive_json()["cumulative_metrics"]["explainer"] == "rule_based"


class TestSimulationSession:
    def test_apply_action_reports_state_changes(self):
        s = SimulationSession(sim_hour=5)
        assert s.apply_action(json.dumps({"action": "SET_HOUR", "hour": 7})) and s.sim_hour == 7
        assert s.apply_action(json.dumps({"action": "TOGGLE_MODE"})) and s.autonomous is False
        assert s.apply_action(json.dumps({"action": "TRIGGER_PEAKER_SPIKE"})) and s.peaker_spike is True
        assert not s.apply_action("garbage")
        assert not s.apply_action(json.dumps({"action": "SET_HOUR", "hour": 99}))
        assert s.sim_hour == 7

    def test_snapshot_tick_does_not_accrue(self):
        s = SimulationSession(sim_hour=12)
        s.tick(accrue=False)
        assert s.metrics()["co2_avoided_kg"] == 0

    def test_accruing_tick_updates_kpis(self):
        s = SimulationSession(sim_hour=12)
        s.tick(accrue=True)
        m = s.metrics()
        assert m["co2_avoided_kg"] > 0 and m["baseline_co2_kg"] > 0
        assert 0 < m["improvement_pct"] < 100
        assert 0 < m["clean_energy_share_pct"] <= 100

    def test_explanation_uses_24h_forecast(self):
        packet, _ = SimulationSession(sim_hour=18).tick(accrue=False)
        assert packet.ai_explanation.estimated_carbon_saved_kg > 0
        assert "Next 24h" in packet.ai_explanation.forecast_recommendation


class TestV2Features:
    def test_packet_carries_v2_fields(self):
        packet, _ = SimulationSession(sim_hour=13).tick(accrue=False)
        m = packet.cumulative_metrics
        for key in ("avg_carbon_managed", "avg_carbon_baseline", "total_active_kw", "simulation_paused"):
            assert key in m
        assert m["total_active_kw"] == pytest.approx(sum(w.current_kw for w in packet.workloads), abs=1)
        assert all(z.marginal_fuel and z.color_tier in {"green", "amber", "red"} for z in packet.zones)
        assert all(w.sla_progress_pct is not None for w in packet.workloads)
        assert all(w.delta_kw == pytest.approx(w.current_kw - w.baseline_kw, abs=0.11) for w in packet.workloads)

    def test_coordinates_are_lon_lat_for_the_map(self):
        packet, _ = SimulationSession(sim_hour=13).tick(accrue=False)
        for item in [*packet.zones, *packet.workloads]:
            lon, lat = item.coordinates
            assert -125 <= lon <= -66 and 24 <= lat <= 50, item

    def test_hourly_forecast_covers_the_day_in_order(self):
        packet, _ = SimulationSession(sim_hour=18).tick(accrue=False)
        forecast = packet.ai_explanation.hourly_forecast
        assert [p.hour for p in forecast] == list(range(24))
        assert forecast[13].solar_factor > forecast[7].solar_factor
        assert forecast[2].solar_factor == 0
        assert {p.recommended_action for p in forecast} <= {"BOOST", "MAINTAIN", "THROTTLE", "DEFER"}

    def test_forecast_reflects_unmanaged_mode(self):
        s = SimulationSession(sim_hour=12)
        s.apply_action(json.dumps({"action": "TOGGLE_MODE"}))
        forecast = s.tick(accrue=False)[0].ai_explanation.hourly_forecast
        assert {p.recommended_action for p in forecast} == {"MAINTAIN"}

    def test_sla_progress_advances_on_ticks_only(self):
        s = SimulationSession(sim_hour=13)
        before = dict(s.progress)
        s.tick(accrue=False)
        assert s.progress == before
        s.tick(accrue=True)
        assert all(s.progress[k] > before[k] for k in before)

    def test_reset_metrics_zeroes_kpis_and_restarts_quotas(self):
        s = SimulationSession(sim_hour=13)
        for _ in range(5):
            s.tick(accrue=True)
        assert s.metrics()["co2_avoided_kg"] > 0 or s.metrics()["cost_savings_usd"] > 0
        assert s.apply_action(json.dumps({"action": "RESET_METRICS"}))
        assert s.metrics()["co2_avoided_kg"] == 0 and s.metrics()["cost_savings_usd"] == 0
        assert set(s.progress.values()) == {35.0}

    def test_toggle_ticker_pauses_simulation_but_not_packets(self):
        s = SimulationSession(sim_hour=13)
        assert s.apply_action(json.dumps({"action": "TOGGLE_TICKER"}))
        before_progress, before_cost = dict(s.progress), s.metrics()["cost_savings_usd"]
        packet, _ = s.tick(accrue=True)
        assert packet.cumulative_metrics["simulation_paused"] is True
        assert s.progress == before_progress and s.metrics()["cost_savings_usd"] == before_cost
        s.apply_action(json.dumps({"action": "TOGGLE_TICKER"}))
        s.tick(accrue=True)
        assert s.metrics()["cost_savings_usd"] > before_cost

    def test_kpis_start_from_zero(self):
        m = SimulationSession(sim_hour=13).metrics()
        assert m["co2_avoided_kg"] == 0 and m["energy_shifted_mwh"] == 0 and m["cost_savings_usd"] == 0

    def test_reset_over_websocket(self, client):
        with client.websocket_connect("/ws/grid-telemetry") as ws:
            ws.send_json({"action": "SET_HOUR", "hour": 13})
            receive_until(ws, lambda p: p["cumulative_metrics"]["cost_savings_usd"] > 0)
            ws.send_json({"action": "RESET_METRICS"})
            receive_until(ws, lambda p: p["cumulative_metrics"]["cost_savings_usd"] == 0)


class TestGeminiRefresh:
    @pytest.fixture
    def session(self, monkeypatch):
        monkeypatch.setattr(type(main.advisor), "uses_gemini", property(lambda self: True))
        return SimulationSession(sim_hour=12)

    def test_successful_answer_is_cached_and_served(self, session, monkeypatch):
        import asyncio
        from app.models.schemas import GeminiAgentExplanation

        answer = GeminiAgentExplanation(primary_driver="From Gemini", reasoning_summary="s",
                                        estimated_carbon_saved_kg=1, estimated_cost_saved_usd=1,
                                        forecast_recommendation="f")
        monkeypatch.setattr(main.advisor, "explain_with_gemini", lambda *a, **k: answer)
        packet, fp = session.tick(accrue=False)
        assert session.wants_gemini(fp)
        asyncio.run(session.refresh_gemini(packet, fp))
        served = session.tick(accrue=False)[0].ai_explanation
        assert served.primary_driver == "From Gemini"
        assert len(served.hourly_forecast) == 24  # the agent's own forecast is attached
        assert not session.wants_gemini(fp)

    def test_failed_call_is_not_cached_and_retries_later(self, session, monkeypatch):
        import asyncio

        monkeypatch.setattr(main.advisor, "explain_with_gemini", lambda *a, **k: None)
        packet, fp = session.tick(accrue=False)
        asyncio.run(session.refresh_gemini(packet, fp))
        assert fp not in session._gemini_cache
        assert not session.wants_gemini(fp)  # rate-limited right after the attempt
        session._gemini_last_call -= main.GEMINI_MIN_INTERVAL_SECONDS
        assert session.wants_gemini(fp)       # ...then retried


class TestHttpEndpoints:
    def test_health(self, client):
        assert client.get("/health").json()["status"] == "ok"

    def test_telemetry_snapshot(self, client):
        packet = TelemetryPacket.model_validate(client.get("/api/telemetry", params={"hour": 19}).json())
        assert packet.sim_hour == 19

    def test_snapshot_respects_mode_and_spike(self, client):
        data = client.get("/api/telemetry", params={"hour": 12, "autonomous": False, "peaker_spike": True}).json()
        assert {w["status"] for w in data["workloads"]} == {"MAINTAIN"}
        assert data["cumulative_metrics"]["peaker_spike_active"] is True

    @pytest.mark.parametrize("hour", [-1, 24, "noon"])
    def test_snapshot_validates_hour(self, client, hour):
        assert client.get("/api/telemetry", params={"hour": hour}).status_code == 422

    def test_cors_allows_vite_dev_origin(self, client):
        r = client.options("/health", headers={
            "Origin": "http://localhost:5173", "Access-Control-Request-Method": "GET"})
        assert r.headers.get("access-control-allow-origin") == "http://localhost:5173"

    def test_cors_rejects_unknown_origin(self, client):
        r = client.get("/health", headers={"Origin": "https://evil.example"})
        assert "access-control-allow-origin" not in r.headers
