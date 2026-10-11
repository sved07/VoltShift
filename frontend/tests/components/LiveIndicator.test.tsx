import { act, render, screen } from '@testing-library/react';
import { LiveIndicator, STALE_AFTER_MS, ageLabel, freshness } from '../../src/components/LiveIndicator';

afterEach(() => vi.useRealTimers());

describe('freshness', () => {
  const now = 100_000;
  it.each([
    ['connecting', null, 'connecting'],
    ['open', null, 'connecting'],
    ['open', now - 1000, 'live'],
    ['open', now - STALE_AFTER_MS - 1, 'stale'],
    ['closed', now - 1000, 'offline'],
    ['closed', null, 'offline'],
  ] as const)('%s with last=%s -> %s', (status, last, expected) => {
    expect(freshness(status, last, now)).toBe(expected);
  });

  it('formats ages', () => {
    expect(ageLabel(400)).toBe('0s ago');
    expect(ageLabel(12_000)).toBe('12s ago');
    expect(ageLabel(125_000)).toBe('2m ago');
  });
});

describe('LiveIndicator', () => {
  it('labels telemetry live only while packets are fresh, then flags it stale', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    render(<LiveIndicator status="open" lastMessageAt={Date.now()} />);
    const el = screen.getByRole('status');
    expect(el).toHaveAttribute('data-state', 'live');
    expect(el).toHaveTextContent('Live telemetry · updated 0s ago');

    act(() => vi.advanceTimersByTime(STALE_AFTER_MS + 1000));
    expect(el).toHaveAttribute('data-state', 'stale');
    expect(el).toHaveTextContent(/Telemetry stale · last update 6s ago/);
  });

  it('announces state, not the ticking age, to screen readers', () => {
    render(<LiveIndicator status="open" lastMessageAt={Date.now()} />);
    const el = screen.getByRole('status');
    expect(el).toHaveAttribute('aria-atomic', 'true');
    expect(el.querySelector('.sr-only')).toHaveTextContent('Live telemetry connected');
    expect(el.querySelector('[aria-hidden="true"]:not(svg)')).toHaveTextContent(/updated/);
  });

  it('shows offline with the last update time when the socket drops', () => {
    render(<LiveIndicator status="closed" lastMessageAt={Date.now() - 30_000} />);
    expect(screen.getByRole('status')).toHaveTextContent('Telemetry offline · last update 30s ago');
  });
});
