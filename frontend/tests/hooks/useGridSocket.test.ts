import { act, renderHook } from '@testing-library/react';
import {
  MAX_RECONNECT_DELAY_MS,
  defaultSocketUrl,
  isTelemetryPacket,
  reconnectDelay,
  useGridSocket,
} from '../../src/hooks/useGridSocket';
import { makePacket } from '../fixtures';

class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances: MockWebSocket[] = [];

  readyState = MockWebSocket.CONNECTING;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;

  constructor(public url: string) {
    MockWebSocket.instances.push(this);
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    if (this.readyState === MockWebSocket.CLOSED) return;
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.();
  }
  // test helpers
  open() {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.();
  }
  emit(data: unknown) {
    this.onmessage?.({ data: typeof data === 'string' ? data : JSON.stringify(data) });
  }
}

const URL = 'ws://test/ws/grid-telemetry';
const latest = () => MockWebSocket.instances[MockWebSocket.instances.length - 1];

beforeEach(() => {
  MockWebSocket.instances = [];
  vi.stubGlobal('WebSocket', MockWebSocket);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe('useGridSocket', () => {
  it('connects to the telemetry endpoint and reports status', () => {
    const { result } = renderHook(() => useGridSocket(URL));
    expect(latest().url).toBe(URL);
    expect(result.current.status).toBe('connecting');
    act(() => latest().open());
    expect(result.current.connected).toBe(true);
  });

  it('exposes the latest telemetry packet', () => {
    const { result } = renderHook(() => useGridSocket(URL));
    act(() => latest().open());
    act(() => latest().emit(makePacket({ sim_hour: 7 })));
    expect(result.current.packet?.sim_hour).toBe(7);
    act(() => latest().emit(makePacket({ sim_hour: 8 })));
    expect(result.current.packet?.sim_hour).toBe(8);
  });

  it('ignores malformed and non-telemetry frames', () => {
    const { result } = renderHook(() => useGridSocket(URL));
    act(() => latest().open());
    act(() => latest().emit(makePacket({ sim_hour: 3 })));
    act(() => latest().emit('{not json'));
    act(() => latest().emit({ type: 'error', message: 'nope' }));
    expect(result.current.packet?.sim_hour).toBe(3);
  });

  it('sends actions as JSON only while open', () => {
    const { result } = renderHook(() => useGridSocket(URL));
    expect(result.current.sendAction({ action: 'TOGGLE_MODE' })).toBe(false);
    act(() => latest().open());
    expect(result.current.sendAction({ action: 'SET_HOUR', hour: 14 })).toBe(true);
    result.current.sendAction({ action: 'TRIGGER_PEAKER_SPIKE' });
    expect(latest().sent.map((s) => JSON.parse(s))).toEqual([
      { action: 'SET_HOUR', hour: 14 },
      { action: 'TRIGGER_PEAKER_SPIKE' },
    ]);
  });

  it('reconnects with backoff after the socket drops', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useGridSocket(URL));
    act(() => latest().open());
    act(() => latest().close());
    expect(result.current.status).toBe('closed');
    expect(MockWebSocket.instances).toHaveLength(1);
    act(() => vi.advanceTimersByTime(reconnectDelay(0)));
    expect(MockWebSocket.instances).toHaveLength(2);
    act(() => latest().open());
    expect(result.current.connected).toBe(true);
  });

  it('closes the socket on unmount without reconnecting', () => {
    vi.useFakeTimers();
    const { unmount } = renderHook(() => useGridSocket(URL));
    const ws = latest();
    act(() => ws.open());
    unmount();
    expect(ws.readyState).toBe(MockWebSocket.CLOSED);
    act(() => vi.advanceTimersByTime(MAX_RECONNECT_DELAY_MS * 2));
    expect(MockWebSocket.instances).toHaveLength(1);
  });
});

describe('helpers', () => {
  it('caps the reconnect delay', () => {
    expect(reconnectDelay(0)).toBe(1000);
    expect(reconnectDelay(1)).toBe(2000);
    expect(reconnectDelay(20)).toBe(MAX_RECONNECT_DELAY_MS);
  });

  it('validates packet shape', () => {
    expect(isTelemetryPacket(makePacket())).toBe(true);
    expect(isTelemetryPacket(null)).toBe(false);
    expect(isTelemetryPacket({ sim_hour: 1, zones: [] })).toBe(false);
  });

  it('uses VITE_WS_URL when configured, else port 8000 on the current host', () => {
    vi.stubEnv('VITE_WS_URL', 'wss://grid.example/ws/grid-telemetry');
    expect(defaultSocketUrl()).toBe('wss://grid.example/ws/grid-telemetry');
    vi.stubEnv('VITE_WS_URL', '');
    expect(defaultSocketUrl()).toBe(`ws://${window.location.hostname || 'localhost'}:8000/ws/grid-telemetry`);
  });
});
