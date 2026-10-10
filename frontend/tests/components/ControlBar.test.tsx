import { act, fireEvent, render, screen } from '@testing-library/react';
import { ControlBar, PLAY_INTERVAL_MS } from '../../src/components/ControlBar';

function setup(overrides: Partial<React.ComponentProps<typeof ControlBar>> = {}) {
  const onAction = vi.fn();
  const props = { simHour: 14, autonomous: true, peakerActive: false, connected: true, onAction, ...overrides };
  const view = render(<ControlBar {...props} />);
  return { onAction, props, ...view };
}

afterEach(() => vi.useRealTimers());

describe('ControlBar', () => {
  it('renders a 00-23 hour slider showing the current hour', () => {
    setup();
    const slider = screen.getByLabelText(/simulated hour/i);
    expect(slider).toHaveAttribute('min', '0');
    expect(slider).toHaveAttribute('max', '23');
    expect(slider).toHaveValue('14');
    expect(screen.getByTestId('sim-hour')).toHaveTextContent('14:00');
  });

  it('sends SET_HOUR when the slider moves', () => {
    const { onAction } = setup();
    fireEvent.change(screen.getByLabelText(/simulated hour/i), { target: { value: '3' } });
    expect(onAction).toHaveBeenCalledWith({ action: 'SET_HOUR', hour: 3 });
  });

  it('sends TRIGGER_PEAKER_SPIKE from the disruption button', () => {
    const { onAction } = setup();
    fireEvent.click(screen.getByRole('button', { name: /simulate gas peaker plant ramp/i }));
    expect(onAction).toHaveBeenCalledWith({ action: 'TRIGGER_PEAKER_SPIKE' });
  });

  it('shows the active peaker state', () => {
    setup({ peakerActive: true });
    expect(screen.getByRole('button', { name: /peaker ramp active/i })).toHaveAttribute('aria-pressed', 'true');
  });

  it('toggles between Autonomous Agent Dispatch and Unmanaged Baseline', () => {
    const { onAction, rerender, props } = setup();
    const autonomous = screen.getByRole('button', { name: /autonomous agent dispatch/i });
    const baseline = screen.getByRole('button', { name: /unmanaged baseline/i });
    expect(autonomous).toHaveAttribute('aria-pressed', 'true');
    expect(autonomous).toBeDisabled(); // already active
    fireEvent.click(baseline);
    expect(onAction).toHaveBeenCalledWith({ action: 'TOGGLE_MODE' });

    rerender(<ControlBar {...props} autonomous={false} />);
    expect(screen.getByRole('button', { name: /unmanaged baseline/i })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: /autonomous agent dispatch/i }));
    expect(onAction).toHaveBeenCalledTimes(2);
  });

  it('play advances the hour on an interval and wraps 23 -> 0', () => {
    vi.useFakeTimers();
    const { onAction, rerender, props } = setup({ simHour: 22 });
    fireEvent.click(screen.getByRole('button', { name: /play simulation/i }));
    act(() => vi.advanceTimersByTime(PLAY_INTERVAL_MS));
    expect(onAction).toHaveBeenLastCalledWith({ action: 'SET_HOUR', hour: 23 });

    rerender(<ControlBar {...props} simHour={23} />);
    act(() => vi.advanceTimersByTime(PLAY_INTERVAL_MS));
    expect(onAction).toHaveBeenLastCalledWith({ action: 'SET_HOUR', hour: 0 });
  });

  it('pause stops the ticker', () => {
    vi.useFakeTimers();
    const { onAction } = setup();
    fireEvent.click(screen.getByRole('button', { name: /play simulation/i }));
    fireEvent.click(screen.getByRole('button', { name: /pause simulation/i }));
    act(() => vi.advanceTimersByTime(PLAY_INTERVAL_MS * 3));
    expect(onAction).not.toHaveBeenCalled();
  });

  it('disables controls while disconnected', () => {
    setup({ connected: false });
    expect(screen.getByLabelText(/simulated hour/i)).toBeDisabled();
    expect(screen.getByRole('button', { name: /simulate gas peaker/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /play simulation/i })).toBeDisabled();
  });
});
