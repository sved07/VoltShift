"""Spec: app/models/schemas.py — Pydantic data contracts."""

import json

import pytest
from pydantic import ValidationError

from app.models.schemas import GeminiAgentExplanation, GeminiNarrative, GridZone, HourlyForecastPoint, TelemetryPacket


class TestGridZone:
    def test_valid_zone_round_trips(self, make_zone):
        zone = make_zone(zone_id="CAISO", carbon_intensity=120.5, renewable_pct=72.0)
        assert zone.carbon_intensity == pytest.approx(120.5)
        assert GridZone.model_validate(zone.model_dump()) == zone

    def test_coordinates_accept_list_as_lon_lat_pair(self, make_zone):
        assert tuple(make_zone(coordinates=[-119.4, 36.7]).coordinates) == (-119.4, 36.7)

    def test_coordinates_require_exactly_two_values(self, make_zone):
        with pytest.raises(ValidationError):
            make_zone(coordinates=(1.0, 2.0, 3.0))

    @pytest.mark.parametrize(
        "field", ["zone_id", "name", "carbon_intensity", "renewable_pct", "solar_mw", "wind_mw", "coordinates"]
    )
    def test_all_fields_required(self, make_zone, field):
        data = make_zone().model_dump()
        data.pop(field)
        with pytest.raises(ValidationError):
            GridZone(**data)

    def test_v2_grid_fields_default_and_validate(self, make_zone):
        zone = make_zone()
        assert zone.marginal_fuel and zone.color_tier == "green"
        assert make_zone(color_tier="red").color_tier == "red"
        with pytest.raises(ValidationError):
            make_zone(color_tier="purple")

    def test_non_numeric_carbon_rejected(self, make_zone):
        with pytest.raises(ValidationError):
            make_zone(carbon_intensity="very dirty")


class TestIndustrialWorkload:
    @pytest.mark.parametrize("wl_type", ["AI_TRAINING", "EV_FLEET"])
    def test_accepts_spec_workload_types(self, make_workload, wl_type):
        assert make_workload(type=wl_type).type == wl_type

    def test_rejects_unknown_workload_type(self, make_workload):
        with pytest.raises(ValidationError):
            make_workload(type="BITCOIN_MINING")

    @pytest.mark.parametrize("status", ["BOOST", "MAINTAIN", "THROTTLE", "DEFER"])
    def test_accepts_spec_statuses(self, make_workload, status):
        assert make_workload(status=status).status == status

    @pytest.mark.parametrize("status", ["boost", "PAUSE", "", "THROTTLED"])
    def test_rejects_unknown_status(self, make_workload, status):
        with pytest.raises(ValidationError):
            make_workload(status=status)

    @pytest.mark.parametrize("score", [0.0, 0.5, 1.0])
    def test_flexibility_score_bounds_inclusive(self, make_workload, score):
        assert make_workload(flexibility_score=score).flexibility_score == score

    @pytest.mark.parametrize("score", [-0.01, 1.01, 5])
    def test_flexibility_score_outside_0_1_rejected(self, make_workload, score):
        with pytest.raises(ValidationError):
            make_workload(flexibility_score=score)

    @pytest.mark.parametrize("hour", [-1, 24])
    def test_deadline_hour_outside_day_rejected(self, make_workload, hour):
        with pytest.raises(ValidationError):
            make_workload(deadline_hour=hour)

    @pytest.mark.parametrize("pct", [-1, 100.1])
    def test_sla_progress_bounded_0_100(self, make_workload, pct):
        with pytest.raises(ValidationError):
            make_workload(sla_progress_pct=pct)

    def test_forecast_point_validates_action_and_hour(self):
        ok = dict(hour=5, carbon_intensity=1, renewable_pct=1, recommended_action="DEFER", solar_factor=0, wind_factor=1)
        assert HourlyForecastPoint(**ok).recommended_action == "DEFER"
        with pytest.raises(ValidationError):
            HourlyForecastPoint(**(ok | {"hour": 24}))
        with pytest.raises(ValidationError):
            HourlyForecastPoint(**(ok | {"recommended_action": "PAUSE"}))

    def test_serializes_spec_fields(self, make_workload):
        payload = json.loads(make_workload().model_dump_json())
        assert set(payload) >= {
            "id", "site_name", "type", "zone_id", "current_kw",
            "max_kw", "flexibility_score", "deadline_hour", "status",
        }


class TestGeminiAgentExplanation:
    def test_packet_explanation_adds_the_hourly_forecast(self):
        props = GeminiAgentExplanation.model_json_schema()["properties"]
        assert "hourly_forecast" in props
        assert GeminiAgentExplanation(
            primary_driver="d", reasoning_summary="r", estimated_carbon_saved_kg=1,
            estimated_cost_saved_usd=1, forecast_recommendation="f",
        ).hourly_forecast == []

    def test_gemini_response_schema_exposes_exactly_spec_fields(self):
        # gemini_advisor passes GeminiNarrative as response_schema; the forecast is computed, not generated
        props = GeminiNarrative.model_json_schema()["properties"]
        assert set(props) == {
            "primary_driver",
            "reasoning_summary",
            "estimated_carbon_saved_kg",
            "estimated_cost_saved_usd",
            "forecast_recommendation",
        }

    def test_missing_field_rejected(self):
        with pytest.raises(ValidationError):
            GeminiAgentExplanation(primary_driver="x", reasoning_summary="y")


class TestTelemetryPacket:
    def test_full_packet_round_trips_through_json(self, make_zone, make_workload):
        packet = TelemetryPacket(
            timestamp="2026-10-10T12:00:00Z",
            sim_hour=12,
            zones=[make_zone()],
            workloads=[make_workload()],
            ai_explanation=GeminiAgentExplanation(
                primary_driver="d",
                reasoning_summary="r",
                estimated_carbon_saved_kg=1.0,
                estimated_cost_saved_usd=2.0,
                forecast_recommendation="f",
            ),
            cumulative_metrics={"co2_avoided_kg": 0.0},
        )
        data = json.loads(packet.model_dump_json())
        assert data["zones"][0]["zone_id"] == "ERCOT"
        assert data["ai_explanation"]["primary_driver"] == "d"
        assert TelemetryPacket.model_validate(data) == packet
