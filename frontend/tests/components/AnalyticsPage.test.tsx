import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AnalyticsPage } from '../../src/routes/AnalyticsPage';
import { ForecastChart } from '../../src/components/analytics/ForecastChart';
import type { HourlyForecastPoint, TelemetryPacket } from '../../src/types';
import { makeExplanation, makeMetrics, makePacket, makeWorkload, makeZone } from '../fixtures';

const socket = vi.hoisted(() => ({
  state: { packet: null as TelemetryPacket | null, connected: true, sendAction: vi.fn() },
}));
vi.mock('../../src/app/TelemetryProvider', () => ({ useTelemetry: () => socket.state }));

const forecast: HourlyForecastPoint[] = Array.from({ length: 24 }, (_, hour) => ({
  hour,
  carbon_intensity: hour === 13 ? 90 : 300,
  renewable_pct: hour === 13 ? 70 : 25,
  recommended_action: hour === 13 ? 'BOOST' : hour === 19 ? 'DEFER' : 'MAINTAIN',
  solar_factor: hour === 13 ? 1 : 0,
  wind_factor: 0.6,
}));

function v2Packet(overrides: Partial<TelemetryPacket> = {}): TelemetryPacket {
  return makePacket({
    sim_hour: 18,
    zones: [
      makeZone({ zone_id: 'CAISO', carbon_intensity: 82, color_tier: 'green', marginal_fuel: 'Surplus Solar / Wind (Curtailment Risk)', solar_mw: 16380, wind_mw: 2887 }),
      makeZone({ zone_id: 'MISO', carbon_intensity: 640, color_tier: 'red', marginal_fuel: 'Simple-Cycle Gas Peaker / Distillate Fuel Oil' }),
    ],
    workloads: [
      makeWorkload({ id: 'a', site_name: 'Austin Cluster', deadline_hour: 20, sla_progress_pct: 62, status: 'BOOST' }),
      makeWorkload({ id: 'b', site_name: 'Twin Cities Hub', deadline_hour: 5, sla_progress_pct: 100, status: 'DEFER' }),
    ],
    ai_explanation: makeExplanation({ hourly_forecast: forecast }),
    cumulative_metrics: makeMetrics({
      avg_carbon_managed: 204.2,
      avg_carbon_baseline: 226.6,
      total_active_kw: 12709.5,
      improvement_pct: 9.9,
      simulation_paused: false,
    }),
    ...overrides,
  });
}

function renderPage() {
  return render(
    <MemoryRouter>
      <AnalyticsPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  socket.state = { packet: v2Packet(), connected: true, sendAction: vi.fn() };
});

describe('AnalyticsPage', () => {
  it('shows the load-weighted dispatch snapshot', () => {
    renderPage();
    const snap = screen.getByTestId('dispatch-snapshot');
    expect(snap).toHaveTextContent('204.2 g/kWh');
    expect(snap).toHaveTextContent('226.6 g/kWh');
    expect(snap).toHaveTextContent('12.7 MW');
    expect(snap).toHaveTextContent('9.9 %');
  });

  it('lists each ISO with carbon tier, generation mix and marginal fuel', () => {
    renderPage();
    const table = screen.getByTestId('iso-table');
    const miso = within(table).getByText('[MISO]').closest('tr')!;
    expect(miso).toHaveTextContent('640 g');
    expect(miso).toHaveTextContent('Red');
    expect(miso).toHaveTextContent('Simple-Cycle Gas Peaker');
    const caiso = within(table).getByText('[CAISO]').closest('tr')!;
    expect(caiso).toHaveTextContent('16,380 MW / 2,887 MW');
  });

  it('orders SLA quotas by nearest deadline with progress bars', () => {
    renderPage();
    const items = within(screen.getByTestId('sla-list')).getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('Austin Cluster'); // due 20:00, 2h from 18:00
    expect(items[0]).toHaveTextContent('due 20:00 · 2h');
    expect(items[1]).toHaveTextContent('Twin Cities Hub'); // due 05:00, 11h away
    expect(screen.getByRole('progressbar', { name: /austin cluster sla quota/i })).toHaveAttribute('aria-valuenow', '62');
  });

  it('pauses / resumes the simulation and resets metrics', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /pause simulation/i }));
    expect(socket.state.sendAction).toHaveBeenCalledWith({ action: 'TOGGLE_TICKER' });
    fireEvent.click(screen.getByRole('button', { name: /reset metrics/i }));
    expect(socket.state.sendAction).toHaveBeenCalledWith({ action: 'RESET_METRICS' });
  });

  it('reflects the paused state', () => {
    socket.state.packet = v2Packet({ cumulative_metrics: makeMetrics({ simulation_paused: true }) });
    renderPage();
    expect(screen.getByRole('button', { name: /resume simulation/i })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Simulation paused')).toBeInTheDocument();
  });

  it('disables controls while disconnected', () => {
    socket.state.connected = false;
    renderPage();
    expect(screen.getByRole('button', { name: /reset metrics/i })).toBeDisabled();
  });

  it('degrades gracefully before telemetry or with a v1 backend', () => {
    socket.state.packet = null;
    const { unmount } = renderPage();
    expect(screen.getAllByText(/awaiting telemetry/i).length).toBe(2);
    expect(screen.getByText(/forecast will appear/i)).toBeInTheDocument();
    unmount();
    socket.state.packet = makePacket(); // no v2 fields at all
    renderPage();
    expect(screen.getByTestId('dispatch-snapshot')).toHaveTextContent('—');
    expect(document.body).not.toHaveTextContent('NaN');
  });
});

describe('ForecastChart', () => {
  it('reads out the current hour by default and the hovered hour on hover', () => {
    const { container } = render(<ForecastChart points={forecast} currentHour={18} />);
    const readout = screen.getByTestId('forecast-readout');
    expect(readout).toHaveTextContent('18:00 · now');
    expect(readout).toHaveTextContent('300 gCO₂/kWh');

    const columns = container.querySelectorAll('svg > g > rect:first-child');
    fireEvent.pointerEnter(columns[13]);
    expect(readout).toHaveTextContent('13:00');
    expect(readout).toHaveTextContent('90 gCO₂/kWh');
    expect(readout).toHaveTextContent('70% renewable');
    expect(readout).toHaveTextContent('BOOST');
  });

  it('draws one action cell per hour, colored by recommended action', () => {
    const { container } = render(<ForecastChart points={forecast} currentHour={0} />);
    const cells = container.querySelectorAll('rect[data-action]');
    expect(cells).toHaveLength(24);
    expect(cells[19]).toHaveAttribute('data-action', 'DEFER');
    expect(cells[19]).toHaveAttribute('fill', '#ef4444');
  });

  it('names the cleanest hour for screen readers and includes a data table', () => {
    render(<ForecastChart points={forecast} currentHour={0} />);
    expect(screen.getByRole('img', { name: /cleanest hour 13:00/i })).toBeInTheDocument();
    expect(screen.getAllByRole('row')).toHaveLength(25);
  });
});
