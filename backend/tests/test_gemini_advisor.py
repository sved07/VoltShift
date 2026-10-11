"""Spec: app/ai/gemini_advisor.py — structured Gemini explanations with rule-based fallback."""

from types import SimpleNamespace

import pytest

from app.ai import gemini_advisor as ga
from app.ai.gemini_advisor import ForecastSummary, GeminiAdvisor, rule_based_explanation
from app.config import DEFAULT_GEMINI_MODEL
from app.models.schemas import GeminiAgentExplanation, GeminiNarrative, HourlyForecastPoint

GEMINI_RESULT = GeminiAgentExplanation(
    primary_driver="Solar Curtailment Window",
    reasoning_summary="CAISO solar surplus absorbed by GPU training.",
    estimated_carbon_saved_kg=1234.5,
    estimated_cost_saved_usd=321.0,
    forecast_recommendation="Defer EV charging to 11:00.",
)


class FakeClient:
    """Stands in for google.genai.Client and records generate_content calls."""

    instances: list["FakeClient"] = []

    def __init__(self, api_key=None, response=None, error=None):
        self.api_key = api_key
        self.calls = []
        self._response = response if response is not None else SimpleNamespace(parsed=GEMINI_RESULT, text=None)
        self._error = error
        self.models = SimpleNamespace(generate_content=self._generate)
        FakeClient.instances.append(self)

    def _generate(self, **kwargs):
        self.calls.append(kwargs)
        if self._error:
            raise self._error
        return self._response


@pytest.fixture
def fake_genai(monkeypatch):
    FakeClient.instances = []

    def install(**client_kwargs):
        def make(api_key=None, http_options=None):
            client = FakeClient(api_key=api_key, **client_kwargs)
            client.http_options = http_options
            return client

        monkeypatch.setattr(ga.genai, "Client", make)
        return FakeClient.instances

    return install


@pytest.fixture
def scenario(make_zone, make_workload):
    zones = [
        make_zone("CAISO", carbon_intensity=60, renewable_pct=85, solar_mw=15000, wind_mw=2000),
        make_zone("MISO", carbon_intensity=610, renewable_pct=20, solar_mw=0, wind_mw=9000),
    ]
    workloads = [
        make_workload("gpu", zone_id="CAISO", current_kw=1000, baseline_kw=600, status="BOOST"),
        make_workload("ev", zone_id="MISO", type="EV_FLEET", current_kw=150, baseline_kw=500, status="THROTTLE"),
        make_workload("bus", zone_id="MISO", type="EV_FLEET", current_kw=400, baseline_kw=400,
                      flexibility_score=0.1, status="MAINTAIN"),
    ]
    return zones, workloads


class TestFallbackWithoutKey:
    def test_no_key_uses_rule_based_without_constructing_client(self, fake_genai, scenario):
        instances = fake_genai()
        advisor = GeminiAdvisor()
        result = advisor.explain(*scenario, sim_hour=12)
        assert isinstance(result, GeminiAgentExplanation)
        assert advisor.uses_gemini is False
        assert instances == []

    def test_blank_key_treated_as_missing(self, fake_genai, scenario):
        instances = fake_genai()
        assert GeminiAdvisor(api_key="   ").uses_gemini is False
        assert instances == []

    def test_fallback_fields_are_populated(self, scenario):
        result = GeminiAdvisor().explain(*scenario, sim_hour=12)
        assert result.primary_driver and result.reasoning_summary and result.forecast_recommendation
        assert result.estimated_carbon_saved_kg > 0
        assert result.estimated_cost_saved_usd > 0


class TestGeminiCall:
    def test_calls_gemini_25_flash_with_structured_schema(self, fake_genai, scenario):
        instances = fake_genai()
        result = GeminiAdvisor(api_key="test-key").explain(*scenario, sim_hour=12)
        assert result == GEMINI_RESULT
        [client] = instances
        assert client.api_key == "test-key"
        [call] = client.calls
        assert call["model"] == DEFAULT_GEMINI_MODEL == "gemini-3.8-flash"
        assert call["config"].response_schema is GeminiNarrative
        assert client.http_options.timeout == ga.REQUEST_TIMEOUT_MS
        assert call["config"].response_mime_type == "application/json"

    def test_model_overridable_by_argument_and_env(self, fake_genai, scenario, monkeypatch):
        instances = fake_genai()
        GeminiAdvisor(api_key="k", model="gemini-2.5-flash").explain(*scenario, sim_hour=12)
        monkeypatch.setenv("GEMINI_MODEL", "gemini-3.5-flash")
        advisor = GeminiAdvisor(api_key="k")
        advisor.explain(*scenario, sim_hour=12)
        assert [c.calls[0]["model"] for c in instances] == ["gemini-2.5-flash", "gemini-3.5-flash"]
        assert advisor.model == "gemini-3.5-flash"

    def test_prompt_contains_grid_and_workload_context(self, fake_genai, scenario):
        instances = fake_genai()
        GeminiAdvisor(api_key="k").explain(*scenario, sim_hour=12, peaker_spike=True)
        prompt = instances[0].calls[0]["contents"]
        for needle in ("CAISO", "MISO", "THROTTLE", "BOOST", "12:00", "fossil_peaker_spike_active"):
            assert needle in prompt

    def test_parses_json_text_when_parsed_missing(self, fake_genai, scenario):
        fake_genai(response=SimpleNamespace(parsed=None, text=GEMINI_RESULT.model_dump_json()))
        assert GeminiAdvisor(api_key="k").explain(*scenario, sim_hour=12) == GEMINI_RESULT

    def test_accepts_parsed_dict(self, fake_genai, scenario):
        fake_genai(response=SimpleNamespace(parsed=GEMINI_RESULT.model_dump(), text=None))
        assert GeminiAdvisor(api_key="k").explain(*scenario, sim_hour=12) == GEMINI_RESULT

    @pytest.mark.parametrize("error", [RuntimeError("quota exceeded"), TimeoutError(), ValueError("bad")])
    def test_api_error_falls_back_gracefully(self, fake_genai, scenario, error):
        fake_genai(error=error)
        result = GeminiAdvisor(api_key="k").explain(*scenario, sim_hour=12)
        assert result == rule_based_explanation(*scenario, 12)

    def test_attaches_the_agents_forecast_not_a_generated_one(self, fake_genai, scenario):
        fake_genai()
        point = HourlyForecastPoint(hour=3, carbon_intensity=200, renewable_pct=40, recommended_action="BOOST",
                                    solar_factor=0, wind_factor=0.9)
        forecast = ForecastSummary(hourly=[point])
        result = GeminiAdvisor(api_key="k").explain(*scenario, sim_hour=12, forecast=forecast)
        assert result.primary_driver == GEMINI_RESULT.primary_driver
        assert result.hourly_forecast == [point]

    def test_rate_limit_triggers_cooldown(self, fake_genai, scenario, monkeypatch):
        instances = fake_genai(error=RuntimeError("429 RESOURCE_EXHAUSTED"))
        advisor = GeminiAdvisor(api_key="k")
        assert advisor.explain_with_gemini(*scenario, sim_hour=12) is None
        assert advisor.explain_with_gemini(*scenario, sim_hour=12) is None
        assert len(instances[0].calls) == 1  # second call skipped during cooldown
        monkeypatch.setattr(ga.time, "monotonic", lambda: 10**9)
        advisor.explain_with_gemini(*scenario, sim_hour=12)
        assert len(instances[0].calls) == 2

    def test_other_errors_do_not_cool_down(self, fake_genai, scenario):
        instances = fake_genai(error=RuntimeError("503 UNAVAILABLE"))
        advisor = GeminiAdvisor(api_key="k")
        advisor.explain_with_gemini(*scenario, sim_hour=12)
        advisor.explain_with_gemini(*scenario, sim_hour=12)
        assert len(instances[0].calls) == 2

    def test_explain_with_gemini_returns_none_on_failure(self, fake_genai, scenario):
        fake_genai(error=RuntimeError("503 UNAVAILABLE"))
        assert GeminiAdvisor(api_key="k").explain_with_gemini(*scenario, sim_hour=12) is None
        assert GeminiAdvisor().explain_with_gemini(*scenario, sim_hour=12) is None  # no key

    def test_garbage_response_falls_back(self, fake_genai, scenario):
        fake_genai(response=SimpleNamespace(parsed=None, text="not json"))
        result = GeminiAdvisor(api_key="k").explain(*scenario, sim_hour=12)
        assert isinstance(result, GeminiAgentExplanation)

    def test_client_construction_failure_falls_back(self, monkeypatch, scenario):
        def broken(**_):
            raise RuntimeError("sdk misconfigured")

        monkeypatch.setattr(ga.genai, "Client", broken)
        advisor = GeminiAdvisor(api_key="k")
        assert advisor.uses_gemini is False
        assert isinstance(advisor.explain(*scenario, sim_hour=12), GeminiAgentExplanation)


class TestRuleBasedDrivers:
    def test_peaker_spike_driver(self, scenario):
        assert rule_based_explanation(*scenario, 18, peaker_spike=True).primary_driver == "Grid Fossil Peaker Spike"

    def test_unmanaged_mode_driver_and_summary(self, scenario):
        result = rule_based_explanation(*scenario, 18, autonomous=False)
        assert result.primary_driver == "Unmanaged Baseline"
        assert "disabled" in result.reasoning_summary

    def test_curtailment_driver_mentions_fossil(self, scenario):
        assert "Fossil" in rule_based_explanation(*scenario, 18).primary_driver

    def test_solar_boost_driver(self, make_zone, make_workload):
        zones = [make_zone("CAISO", carbon_intensity=60, renewable_pct=85, solar_mw=15000, wind_mw=1000)]
        workloads = [make_workload(zone_id="CAISO", current_kw=1000, baseline_kw=500, status="BOOST")]
        assert rule_based_explanation(zones, workloads, 12).primary_driver == "Solar Curtailment Window"

    def test_wind_boost_driver(self, make_zone, make_workload):
        zones = [make_zone("PJM", carbon_intensity=160, renewable_pct=40, solar_mw=0, wind_mw=13000)]
        workloads = [make_workload(zone_id="PJM", current_kw=1000, baseline_kw=500, status="BOOST")]
        assert rule_based_explanation(zones, workloads, 3).primary_driver == "Overnight Wind Surplus"

    def test_summary_names_affected_sites(self, scenario):
        summary = rule_based_explanation(*scenario, 12).reasoning_summary
        assert "Site gpu" in summary and "Site ev" in summary
        assert "12:00" in summary

    def test_forecast_drives_estimates_and_recommendation(self, scenario):
        forecast = ForecastSummary(
            projected_co2_avoided_kg=9876.0,
            projected_cost_saved_usd=543.21,
            cleanest_window={"CAISO": (12, 37.5), "MISO": (3, 288.0)},
        )
        result = rule_based_explanation(*scenario, 18, forecast=forecast)
        assert result.estimated_carbon_saved_kg == pytest.approx(9876.0)
        assert result.estimated_cost_saved_usd == pytest.approx(543.21)
        assert "CAISO" in result.forecast_recommendation and "12:00" in result.forecast_recommendation

    def test_estimates_never_negative(self, make_zone, make_workload):
        zones = [make_zone(carbon_intensity=300)]
        result = rule_based_explanation(zones, [make_workload(current_kw=500, baseline_kw=500)], 10)
        assert result.estimated_carbon_saved_kg >= 0 and result.estimated_cost_saved_usd >= 0

    def test_handles_empty_inputs(self):
        result = rule_based_explanation([], [], 0)
        assert isinstance(result, GeminiAgentExplanation)
