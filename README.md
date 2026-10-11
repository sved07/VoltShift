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

## Deploy

The frontend goes on **Vercel** and the backend on **Render**. Vercel can't host the backend
because its serverless functions don't support persistent WebSockets.

**Backend (Render).** In Render, choose New → **Blueprint**, then pick this repo. Render reads
[`render.yaml`](render.yaml) and runs:

```
uvicorn app.main:app --host 0.0.0.0 --port $PORT
```

It starts from `backend/`, with health check `/health`. Enter `GEMINI_API_KEY` (and optionally
`ELECTRICITY_MAPS_KEY`) when Render prompts for them. On the free plan the service sleeps when
idle, so the first connection after a while can take ~1 minute.

**Frontend (Vercel).** Set the project's **Root Directory** to `frontend`.
[`frontend/vercel.json`](frontend/vercel.json) handles the build and client-side routing. Add
these environment variables:

| Variable            | Value                                                  |
|---------------------|--------------------------------------------------------|
| `VITE_MAPBOX_TOKEN` | your `pk.…` Mapbox token                               |
| `VITE_WS_URL`       | `wss://<your-render-service>.onrender.com/ws/grid-telemetry` |

If your Vercel domain changes, update `CORS_ORIGINS` in Render to match.

## How the agent decides

Each site is checked against these rules in order, and the first match wins:

| Condition                                                    | Action                                        |
|--------------------------------------------------------------|-----------------------------------------------|
| Deadline ≤ 3 h away and today's quota < 85%                  | **BOOST** to `max_kw` (the SLA wins over the grid) |
| Renewables ≥ 60% or carbon < 180 g                           | **BOOST** into 70–100% of headroom            |
| Carbon > 350 g, flexibility ≥ 0.7, more than 5 h of runway   | **DEFER** to 15% idle draw                    |
| Carbon > 350 g, flexibility ≥ 0.7, short runway              | **THROTTLE** to 40%                           |
| Carbon > 350 g, less flexible                                | **THROTTLE** by flexibility × 55%             |
| Carbon > 240 g and flexibility ≥ 0.8                         | **THROTTLE** to 70%                           |
| Anything else                                                | **MAINTAIN**                                  |

Each site's quota fills up as it draws power. Every connection runs its own simulation,
and each update covers a 6-minute slice. KPIs start at zero:

- **CO₂ avoided:** baseline emissions minus managed emissions.
- **Clean energy shifted:** extra MWh drawn by boosted sites.
- **Cost saved:** a flat $0.15/kWh baseline compared with time-of-use tariffs ($0.05 clean, $0.12 normal, $0.24 peaker).

A gas peaker ramp adds fossil carbon to ERCOT, PJM and MISO; CAISO is unaffected.

## WebSocket API: `ws://localhost:8000/ws/grid-telemetry`

The server pushes a `TelemetryPacket` every 1.5 s, and again right away after each client action:

```json
{"action": "SET_HOUR", "hour": 14}
{"action": "TOGGLE_MODE"}
{"action": "TRIGGER_PEAKER_SPIKE"}
{"action": "RESET_METRICS"}
{"action": "TOGGLE_TICKER"}
```

`TOGGLE_MODE` switches between the autonomous agent and the unmanaged baseline. `TRIGGER_PEAKER_SPIKE`
turns the gas peaker spike on and off. `RESET_METRICS` zeroes the KPIs and restarts every quota.
`TOGGLE_TICKER` pauses or resumes the simulation; updates keep arriving while it's paused. The server
ignores invalid messages.

Each packet also carries:

- **Per region:** `marginal_fuel` and `color_tier`.
- **Per site:** `sla_progress_pct` and `delta_kw`.
- **Forecast:** a 24-point `ai_explanation.hourly_forecast`.
- **Load-weighted metrics:** `avg_carbon_managed`, `avg_carbon_baseline` and `total_active_kw`.

The **Analytics** page (`/analytics`) shows all of this.

HTTP endpoints: `GET /health` and `GET /api/telemetry?hour=12&autonomous=true&peaker_spike=false`.

## Tests

```bash
cd backend && pip install -r requirements-dev.txt && pytest
cd frontend && npm test
```
