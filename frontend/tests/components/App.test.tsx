import { fireEvent, render, screen } from '@testing-library/react';
import App from '../../src/App';
import type { TelemetryPacket } from '../../src/types';
import { makeMetrics, makePacket } from '../fixtures';

const socket = vi.hoisted(() => ({
  state: {
    packet: null as TelemetryPacket | null,
    status: 'connecting' as 'connecting' | 'open' | 'closed',
    connected: false,
    sendAction: vi.fn(),
  },
}));

vi.mock('../../src/hooks/useGridSocket', () => ({ useGridSocket: () => socket.state }));
vi.mock('mapbox-gl', () => ({ default: {} }));
vi.mock('mapbox-gl/dist/mapbox-gl.css', () => ({}));

beforeEach(() => {
  vi.stubEnv('VITE_MAPBOX_TOKEN', ''); // schematic view — no WebGL in jsdom
  socket.state.sendAction = vi.fn();
});

afterEach(() => vi.unstubAllEnvs());

describe('App', () => {
  it('shows a waiting state before telemetry arrives', () => {
    socket.state = { ...socket.state, packet: null, status: 'connecting', connected: false };
    render(<App />);
    expect(screen.getByText(/waiting for grid telemetry/i)).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(/connecting/i);
  });

  it('renders the full dashboard from a packet', () => {
    socket.state = { ...socket.state, packet: makePacket(), status: 'open', connected: true };
    render(<App />);
    expect(screen.getByRole('status')).toHaveTextContent(/live telemetry/i);
    expect(screen.getByRole('heading', { name: /gemini autonomous decision audit/i })).toBeInTheDocument();
    expect(screen.getAllByText('Santa Clara GPU Cluster').length).toBeGreaterThan(0);
    expect(screen.getByTestId('sim-hour')).toHaveTextContent('12:00');
    expect(screen.getByTestId('baseline-badge')).toBeInTheDocument();
  });

  it('wires controls to the socket', () => {
    socket.state = { ...socket.state, packet: makePacket(), status: 'open', connected: true };
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /simulate gas peaker/i }));
    expect(socket.state.sendAction).toHaveBeenCalledWith({ action: 'TRIGGER_PEAKER_SPIKE' });
  });

  it('shows the peaker alert and unmanaged mode from metrics', () => {
    socket.state = {
      ...socket.state,
      packet: makePacket({ cumulative_metrics: makeMetrics({ peaker_spike_active: true, mode: 'UNMANAGED' }) }),
      status: 'open',
      connected: true,
    };
    render(<App />);
    expect(screen.getByText('GAS PEAKER RAMP')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /unmanaged baseline/i })).toHaveAttribute('aria-pressed', 'true');
  });
});
