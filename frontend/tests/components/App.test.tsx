import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import App from '../../src/App';
import type { TelemetryPacket } from '../../src/types';
import { makeMetrics, makePacket } from '../fixtures';

const socket = vi.hoisted(() => ({
  state: {
    packet: null as TelemetryPacket | null,
    status: 'connecting' as 'connecting' | 'open' | 'closed',
    connected: false,
    lastMessageAt: null as number | null,
    sendAction: vi.fn(),
  },
}));

// One provider, mocked socket: every route reads the same telemetry.
vi.mock('../../src/app/TelemetryProvider', () => ({
  TelemetryProvider: ({ children }: { children: React.ReactNode }) => children,
  useTelemetry: () => socket.state,
}));
vi.mock('mapbox-gl', () => ({ default: {} }));
vi.mock('mapbox-gl/dist/mapbox-gl.css', () => ({}));
// No WebGL in jsdom: stand in for the 3D scene, but keep its click-to-select contract.
vi.mock('../../src/components/three/GridScene', () => ({
  default: ({ workloads, onSelectSite }: { workloads: { id: string }[]; onSelectSite?: (id: string) => void }) => (
    <div data-testid="grid-scene">
      {workloads.map((w) => (
        <button key={w.id} type="button" onClick={() => onSelectSite?.(w.id)}>
          3d:{w.id}
        </button>
      ))}
    </div>
  ),
}));

function LocationProbe() {
  const { pathname, search } = useLocation();
  return <output data-testid="location">{pathname + search}</output>;
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
      <LocationProbe />
    </MemoryRouter>,
  );
}

const live = (packet: TelemetryPacket = makePacket()) => {
  socket.state = { ...socket.state, packet, status: 'open', connected: true, lastMessageAt: Date.now() };
};

const liveIndicator = () => screen.getAllByRole('status').find((el) => el.hasAttribute('data-state'))!;

beforeEach(() => {
  vi.stubEnv('VITE_MAPBOX_TOKEN', ''); // schematic map — no WebGL in jsdom
  socket.state = { packet: null, status: 'connecting', connected: false, lastMessageAt: null, sendAction: vi.fn() };
});

afterEach(() => vi.unstubAllEnvs());

describe('routing shell', () => {
  it('renders a floating primary nav with all three routes', () => {
    renderAt('/');
    const nav = screen.getByRole('navigation', { name: /primary/i });
    for (const name of [/overview/i, /sites/i, /audit log/i, /analytics/i]) {
      expect(within(nav).getByRole('link', { name })).toBeInTheDocument();
    }
  });

  it.each([
    ['/', /overview/i],
    ['/sites', /sites/i],
    ['/audit', /audit log/i],
    ['/analytics', /analytics/i],
  ])('marks %s as the current page', async (path, name) => {
    live();
    renderAt(path);
    await screen.findByRole('main');
    const nav = screen.getByRole('navigation', { name: /primary/i });
    expect(within(nav).getByRole('link', { name })).toHaveAttribute('aria-current', 'page');
  });

  it('navigates between routes from the nav', () => {
    live();
    renderAt('/');
    fireEvent.click(within(screen.getByRole('navigation', { name: /primary/i })).getByRole('link', { name: /audit log/i }));
    expect(screen.getByTestId('location')).toHaveTextContent('/audit');
    expect(screen.getByRole('heading', { name: /gemini autonomous decision audit/i })).toBeInTheDocument();
  });

  it('redirects unknown paths to the overview', () => {
    renderAt('/nope');
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/$/);
  });

  it('keeps the scenario controls on every route', async () => {
    live();
    renderAt('/sites');
    await screen.findByText('Santa Clara GPU Cluster');
    fireEvent.click(screen.getByRole('button', { name: /simulate gas peaker/i }));
    expect(socket.state.sendAction).toHaveBeenCalledWith({ action: 'TRIGGER_PEAKER_SPIKE' });
  });

  it('shows connecting state before telemetry and live state after', () => {
    const { unmount } = renderAt('/');
    expect(liveIndicator()).toHaveAttribute('data-state', 'connecting');
    unmount();
    live();
    renderAt('/');
    expect(liveIndicator()).toHaveAttribute('data-state', 'live');
  });

  it('flags an active peaker ramp in the nav', () => {
    live(makePacket({ cumulative_metrics: makeMetrics({ peaker_spike_active: true }) }));
    renderAt('/');
    expect(within(screen.getByRole('navigation', { name: /primary/i })).getByText(/peaker ramp/i)).toBeInTheDocument();
  });
});

describe('Overview page', () => {
  it('shows a static backdrop (no 3D) until the first packet', () => {
    renderAt('/');
    expect(screen.getByTestId('scene-backdrop')).toBeInTheDocument();
    expect(screen.queryByTestId('grid-scene')).not.toBeInTheDocument();
  });

  it('renders the hero, 3D scene, zone status and KPIs from telemetry', async () => {
    live();
    renderAt('/');
    expect(screen.getByRole('heading', { level: 1, name: /load follows clean power/i })).toBeInTheDocument();
    expect(await screen.findByTestId('grid-scene')).toBeInTheDocument();
    const zones = screen.getByTestId('zone-status');
    expect(within(zones).getByText('[CAISO]')).toBeInTheDocument();
    expect(within(zones).getByText('490 g')).toBeInTheDocument();
    expect(screen.getByTestId('metric-co2')).toBeInTheDocument();
    expect(screen.getByTestId('baseline-badge')).toBeInTheDocument();
  });

  it('summarises routing from the cleanest zone and status counts', () => {
    live();
    renderAt('/');
    const routing = screen.getByText(/routing now/i).closest('div')!;
    expect(routing).toHaveTextContent('Drawing from [CAISO] at 90 gCO₂/kWh');
    expect(within(routing).getByText('Boosting').nextElementSibling).toHaveTextContent('1');
    expect(within(routing).getByText('Throttled').nextElementSibling).toHaveTextContent('1');
  });

  it('shows the latest agent decision with a link to the audit log', () => {
    live();
    renderAt('/');
    expect(screen.getByText('Solar Curtailment Window')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('link', { name: /open audit log/i }));
    expect(screen.getByTestId('location')).toHaveTextContent('/audit');
  });

  it('selecting a site in the 3D scene opens it on the Sites page', async () => {
    live();
    renderAt('/');
    fireEvent.click(await screen.findByText('3d:ev-chicago'));
    expect(screen.getByTestId('location')).toHaveTextContent('/sites?focus=ev-chicago');
    expect((await screen.findByText('Chicago Transit Bus Barn')).closest('button')).toHaveAttribute('aria-current', 'true');
  });

  it('hero CTAs route to sites and audit', () => {
    live();
    renderAt('/');
    fireEvent.click(screen.getByRole('link', { name: /inspect sites/i }));
    expect(screen.getByTestId('location')).toHaveTextContent('/sites');
  });
});
