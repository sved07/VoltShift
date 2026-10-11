"""Spec: app/agents/grid_monitor.py — diurnal ISO telemetry with live/mock sources."""

import httpx
import pytest

from app.agents import grid_monitor as gm
from app.agents.grid_monitor import GridMonitor
from app.models.schemas import GridZone
from tests.conftest import ISO_IDS


@pytest.fixture
def monitor(block_network):
    return GridMonitor()


def by_id(zones):
    return {z.zone_id: z for z in zones}


class TestZoneCoverage:
    @pytest.mark.parametrize("hour", range(24))
    def test_returns_all_four_isos_every_hour(self, monitor, hour):
        zones = monitor.get_zones(hour)
        assert all(isinstance(z, GridZone) for z in zones)
        assert {z.zone_id for z in zones} == ISO_IDS

    @pytest.mark.parametrize("hour", range(24))
    def test_values_are_physically_plausible(self, monitor, hour):
        for z in monitor.get_zones(hour):
            assert 0 < z.carbon_intensity < 1200, z
            assert 0 <= z.renewable_pct <= 100, z
            assert z.solar_mw >= 0 and z.wind_mw >= 0, z
            lon, lat = z.coordinates
            assert -125 <= lon <= -66 and 24 <= lat <= 50, z  # continental US

    def test_zone_coordinates_match_geography(self, monitor):
        zones = by_id(monitor.get_zones(12))
        assert zones["CAISO"].coordinates[0] < zones["ERCOT"].coordinates[0]  # CA west of TX
        assert zones["PJM"].coordinates[0] > zones["MISO"].coordinates[0]     # PJM east of MISO


class TestDiurnalCurves:
    @pytest.mark.parametrize("night_hour", [0, 1, 2, 3, 4, 5, 19, 20, 21, 22, 23])
    def test_no_solar_at_night(self, monitor, night_hour):
        for z in monitor.get_zones(night_hour):
            assert z.solar_mw == pytest.approx(0, abs=1e-6), z

    def test_solar_peaks_midday(self, monitor):
        for iso in ISO_IDS:
            assert by_id(monitor.get_zones(13))[iso].solar_mw > by_id(monitor.get_zones(7))[iso].solar_mw

    def test_wind_peaks_at_each_zones_configured_hour(self, monitor):
        params = gm.load_iso_parameters()["zones"]
        for iso in ISO_IDS:
            peak = params[iso]["wind_peak_hour"]
            winds = {h: by_id(monitor.get_zones(h))[iso].wind_mw for h in range(24)}
            assert max(winds, key=winds.get) == peak, iso
            assert winds[peak] == pytest.approx(params[iso]["wind_max_mw"])
            assert min(winds.values()) == pytest.approx(0.4 * params[iso]["wind_max_mw"], rel=0.02)

    @pytest.mark.parametrize("hour", range(24))
    def test_color_tier_and_marginal_fuel_follow_the_numbers(self, monitor, hour):
        for z in monitor.get_zones(hour):
            assert z.color_tier == gm.color_tier(z.carbon_intensity)
            assert z.marginal_fuel == gm.marginal_fuel(z.renewable_pct, peaker=False)

    def test_caiso_is_cleanest_at_solar_noon(self, monitor):
        noon = by_id(monitor.get_zones(13))
        assert noon["CAISO"].marginal_fuel.startswith("Surplus Solar")
        assert min(noon.values(), key=lambda z: z.carbon_intensity).zone_id == "CAISO"

    def test_caiso_duck_curve_cleaner_at_noon_than_evening_peak(self, monitor):
        noon, evening = by_id(monitor.get_zones(12))["CAISO"], by_id(monitor.get_zones(19))["CAISO"]
        assert noon.carbon_intensity < evening.carbon_intensity
        assert noon.renewable_pct > evening.renewable_pct

    def test_caiso_midday_reaches_boost_band(self, monitor):
        caiso = [by_id(monitor.get_zones(h))["CAISO"] for h in range(10, 16)]
        assert any(z.carbon_intensity < 180 or z.renewable_pct > 60 for z in caiso)

    def test_some_zone_reaches_curtailment_band(self, monitor):
        assert any(z.carbon_intensity > 350 for h in range(24) for z in monitor.get_zones(h))

    def test_hours_differ(self, monitor):
        assert monitor.get_zones(3) != monitor.get_zones(13)


class TestDeterminismAndValidation:
    def test_mock_mode_is_deterministic(self, monitor):
        assert monitor.get_zones(9) == monitor.get_zones(9)
        assert GridMonitor().get_zones(17) == GridMonitor().get_zones(17)

    @pytest.mark.parametrize("bad_hour", [-1, 24, 100, 3.5, "12", True])
    def test_invalid_hour_rejected(self, monitor, bad_hour):
        with pytest.raises(ValueError):
            monitor.get_zones(bad_hour)


class TestPeakerSpike:
    def test_spike_adds_peaker_carbon_to_fossil_heavy_isos_only(self, monitor):
        params = gm.load_iso_parameters()["zones"]
        normal, spiked = by_id(monitor.get_zones(14)), by_id(monitor.get_zones(14, peaker_spike=True))
        for iso in ("ERCOT", "PJM", "MISO"):
            assert spiked[iso].carbon_intensity == pytest.approx(
                normal[iso].carbon_intensity + params[iso]["peaker_spike_addition"], abs=0.11
            )
            assert spiked[iso].marginal_fuel.startswith("Simple-Cycle Gas Peaker")
            assert spiked[iso].color_tier == "red"
        assert spiked["CAISO"] == normal["CAISO"]

    def test_spike_leaves_renewable_share_unchanged(self, monitor):
        normal, spiked = by_id(monitor.get_zones(14)), by_id(monitor.get_zones(14, peaker_spike=True))
        assert all(spiked[i].renewable_pct == normal[i].renewable_pct for i in ISO_IDS)

    @pytest.mark.parametrize("hour", [4, 12, 20])
    def test_spike_pushes_some_zone_above_throttle_threshold(self, monitor, hour):
        assert any(z.carbon_intensity > 350 for z in monitor.get_zones(hour, peaker_spike=True))


class TestDataSourceFallback:
    def test_no_key_uses_mock_without_network(self, monitor):
        assert len(monitor.get_zones(10)) == 4
        assert monitor.source == "mock"

    def test_empty_key_treated_as_missing(self, block_network):
        assert GridMonitor(api_key="  ").source == "mock"
        assert len(GridMonitor(api_key="").get_zones(10)) == 4

    def test_live_api_failure_falls_back_to_mock(self, block_network):
        live = GridMonitor(api_key="fake-electricity-maps-key")
        assert live.get_zones(10) == GridMonitor().get_zones(10)
        assert live.source == "mock"

    def test_reads_key_from_environment(self, monkeypatch):
        monkeypatch.setenv("ELECTRICITY_MAPS_KEY", "env-key")
        calls = []
        monkeypatch.setattr(gm.ElectricityMapsClient, "latest_carbon_intensity",
                            lambda self, zone: calls.append(zone) or 222.0)
        GridMonitor().get_zones(10)
        assert calls

    def test_live_values_override_model_carbon(self, monkeypatch):
        monkeypatch.setattr(gm.ElectricityMapsClient, "latest_carbon_intensity", lambda self, zone: 222.0)
        live = GridMonitor(api_key="k")
        assert all(z.carbon_intensity == 222.0 for z in live.get_zones(10))
        assert live.source == "electricity_maps"

    def test_live_values_are_cached_between_ticks(self, monkeypatch):
        calls = []
        monkeypatch.setattr(gm.ElectricityMapsClient, "latest_carbon_intensity",
                            lambda self, zone: calls.append(zone) or 200.0)
        live = GridMonitor(api_key="k")
        live.get_zones(10)
        live.get_zones(11)
        assert len(calls) == 4  # one fetch per ISO, not per tick

    def test_failed_fetch_is_not_retried_every_tick(self, monkeypatch):
        calls = []

        def fail(self, zone):
            calls.append(zone)
            raise httpx.ConnectError("down")

        monkeypatch.setattr(gm.ElectricityMapsClient, "latest_carbon_intensity", fail)
        live = GridMonitor(api_key="k")
        for hour in range(5):
            live.get_zones(hour)
        assert len(calls) == 1

    def test_client_sends_auth_header_and_zone(self, monkeypatch):
        seen = {}

        def handler(request: httpx.Request) -> httpx.Response:
            seen["token"] = request.headers.get("auth-token")
            seen["zone"] = request.url.params.get("zone")
            return httpx.Response(200, json={"carbonIntensity": 301})

        transport = httpx.MockTransport(handler)
        real_client = httpx.Client
        monkeypatch.setattr(gm.httpx, "Client", lambda **kw: real_client(transport=transport, **kw))
        assert gm.ElectricityMapsClient("secret").latest_carbon_intensity("US-CAL-CISO") == 301.0
        assert seen == {"token": "secret", "zone": "US-CAL-CISO"}

    def test_client_rejects_malformed_payload(self, monkeypatch):
        transport = httpx.MockTransport(lambda r: httpx.Response(200, json={"carbonIntensity": None}))
        real_client = httpx.Client
        monkeypatch.setattr(gm.httpx, "Client", lambda **kw: real_client(transport=transport, **kw))
        with pytest.raises(ValueError):
            gm.ElectricityMapsClient("k").latest_carbon_intensity("US-TEX-ERCO")
