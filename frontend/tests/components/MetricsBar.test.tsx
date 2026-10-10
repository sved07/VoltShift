import { render, screen, waitFor } from '@testing-library/react';
import { MetricsBar } from '../../src/components/MetricsBar';
import { makeMetrics } from '../fixtures';

describe('MetricsBar', () => {
  it('renders the KPI counters', () => {
    render(<MetricsBar metrics={makeMetrics()} />);
    expect(screen.getByText(/co₂ avoided \(kg\)/i)).toBeInTheDocument();
    expect(screen.getByText(/energy shifted \(mwh\)/i)).toBeInTheDocument();
    expect(screen.getByText(/clean energy share/i)).toBeInTheDocument();
    expect(screen.getByText(/cost savings \(usd\)/i)).toBeInTheDocument();
  });

  it('targets the formatted backend values', () => {
    render(<MetricsBar metrics={makeMetrics()} />);
    expect(screen.getByTestId('metric-co2')).toHaveAttribute('data-target', '1,235');
    expect(screen.getByTestId('metric-energy')).toHaveAttribute('data-target', '12.35');
    expect(screen.getByTestId('metric-clean-share')).toHaveAttribute('data-target', '58.4%');
    expect(screen.getByTestId('metric-cost')).toHaveAttribute('data-target', '$988');
  });

  it('animates counters toward new values', async () => {
    const { rerender } = render(<MetricsBar metrics={makeMetrics({ co2_avoided_kg: 0 })} />);
    rerender(<MetricsBar metrics={makeMetrics({ co2_avoided_kg: 5000 })} />);
    await waitFor(() => expect(screen.getByTestId('metric-co2')).toHaveTextContent('5,000'), { timeout: 3000 });
  });

  it('shows the improvement-over-baseline badge', () => {
    render(<MetricsBar metrics={makeMetrics({ improvement_pct: 12.34 })} />);
    const badge = screen.getByTestId('baseline-badge');
    expect(badge).toHaveTextContent('12.3%');
    expect(badge).toHaveTextContent(/improvement over unmanaged baseline/i);
  });

  it('flags unmanaged mode in the badge', () => {
    render(<MetricsBar metrics={makeMetrics({ mode: 'UNMANAGED' })} />);
    expect(screen.getByTestId('baseline-badge')).toHaveTextContent(/unmanaged baseline/i);
  });

  it('renders zeros (never NaN) before the first packet', () => {
    const { container } = render(<MetricsBar metrics={null} />);
    expect(container).not.toHaveTextContent('NaN');
    expect(screen.getByTestId('metric-co2')).toHaveTextContent('0');
  });
});
