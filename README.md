# VoltShift: Autonomous Grid Load-Shifting Agent

VoltShift moves heavy industrial load (AI training clusters and EV fleet depots) toward clean power across
ERCOT, CAISO, PJM and MISO. Gemini explains each decision in plain language.

## Run it

**Backend** (Python 3.11+):

```bash
cd backend
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env        # optional: add GEMINI_API_KEY / ELECTRICITY_MAPS_KEY
uvicorn app.main:app --reload
```

**Frontend** (Node 18+):

```bash
cd frontend
npm install
cp .env.example .env        # optional: add VITE_MAPBOX_TOKEN for the 3D map
npm run dev                 # http://localhost:5173
```

Every API key is optional. If one is missing, VoltShift falls back as follows:

| Missing key            | Fallback                                                         |
|------------------------|------------------------------------------------------------------|
| `GEMINI_API_KEY`       | Deterministic rule-based explanations and 24h projections        |
| `ELECTRICITY_MAPS_KEY` | Diurnal grid model from `app/data/mock_iso_telemetry.json`       |
| `VITE_MAPBOX_TOKEN`    | Schematic zone grid in place of the 3D Mapbox map                |

## How the agent decides

Rules are checked in this order:

| Condition                                                                     | Action                                       |
|-------------------------------------------------------------------------------|----------------------------------------------|
| Carbon > 350 g and deadline ≤ 1 h away                                        | **MAINTAIN** (the SLA wins over the grid)    |
| Carbon > 550 g, flexibility ≥ 0.8 and ≥ 6 h of runway                         | **DEFER** to a projected clean window        |
| Carbon > 350 g and flexibility ≥ 0.5                                          | **THROTTLE** by 50–80%, scaled by flexibility |
| Carbon > 350 g and an inflexible job                                          | **MAINTAIN**                                 |
| Renewables > 60% or carbon < 180 g                                            | **BOOST** to `max_kw`                        |
| Anything else                                                                 | **MAINTAIN**                                 |

When the agent curtails load, the energy is assumed to run later in a 120 g clean window. When it boosts
load, that work is assumed to displace 400 g energy later in the day. KPIs and savings are measured
against the unmanaged baseline.

## WebSocket API: `ws://localhost:8000/ws/grid-telemetry`

The server pushes a `TelemetryPacket` every 1.5 s, and again right away after each client action:

```json
{"action": "SET_HOUR", "hour": 14}
{"action": "TOGGLE_MODE"}
{"action": "TRIGGER_PEAKER_SPIKE"}
```

`TOGGLE_MODE` switches between the autonomous agent and the unmanaged baseline. `TRIGGER_PEAKER_SPIKE`
turns the gas peaker spike on and off. The server ignores invalid messages.

HTTP endpoints: `GET /health` and `GET /api/telemetry?hour=12&autonomous=true&peaker_spike=false`.

## Tests

```bash
cd backend && pip install -r requirements-dev.txt && pytest     # 221 tests
cd frontend && npm test                                         # 71 tests
```
