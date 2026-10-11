import { render, screen, within } from '@testing-library/react';
import { AIAuditPanel, MAX_AUDIT_CARDS, driverTone } from '../../src/components/AIAuditPanel';
import { makeExplanation } from '../fixtures';

describe('AIAuditPanel', () => {
  it('shows the Gemini audit heading and placeholder before data', () => {
    render(<AIAuditPanel explanation={null} simHour={0} />);
    expect(screen.getByRole('heading', { name: /gemini autonomous decision audit/i })).toBeInTheDocument();
    expect(screen.getByText(/waiting for the first agent decision/i)).toBeInTheDocument();
    expect(screen.queryAllByTestId('audit-card')).toHaveLength(0);
  });

  it('renders a reasoning card with the primary driver tag', () => {
    render(<AIAuditPanel explanation={makeExplanation()} simHour={12} />);
    const [card] = screen.getAllByTestId('audit-card');
    expect(within(card).getByText('Solar Curtailment Window')).toBeInTheDocument();
    expect(within(card).getByText(/boosting santa clara/i)).toBeInTheDocument();
    expect(within(card).getByText(/sim 12:00/)).toBeInTheDocument();
  });

  it('shows the 24h forecast box', () => {
    render(<AIAuditPanel explanation={makeExplanation()} simHour={12} />);
    expect(screen.getByTestId('forecast-carbon')).toHaveTextContent('18,450 kg');
    expect(screen.getByTestId('forecast-cost')).toHaveTextContent('$2,311');
    expect(screen.getByText(/route deferred work to caiso/i)).toBeInTheDocument();
  });

  it('streams new decisions on top and dedupes repeats', () => {
    const { rerender } = render(<AIAuditPanel explanation={makeExplanation()} simHour={12} />);
    rerender(<AIAuditPanel explanation={makeExplanation()} simHour={12} />); // same decision on next tick
    expect(screen.getAllByTestId('audit-card')).toHaveLength(1);

    rerender(
      <AIAuditPanel
        explanation={makeExplanation({ primary_driver: 'Grid Fossil Peaker Spike', reasoning_summary: 'Peaker ramp in MISO.' })}
        simHour={18}
      />,
    );
    const cards = screen.getAllByTestId('audit-card');
    expect(cards).toHaveLength(2);
    expect(cards[0]).toHaveTextContent('Grid Fossil Peaker Spike');
    expect(cards[1]).toHaveTextContent('Solar Curtailment Window');
  });

  it(`keeps at most ${MAX_AUDIT_CARDS} cards`, () => {
    const { rerender } = render(<AIAuditPanel explanation={null} simHour={0} />);
    for (let i = 0; i < MAX_AUDIT_CARDS + 4; i++) {
      rerender(<AIAuditPanel explanation={makeExplanation({ reasoning_summary: `decision ${i}` })} simHour={i % 24} />);
    }
    expect(screen.getAllByTestId('audit-card')).toHaveLength(MAX_AUDIT_CARDS);
  });

  it('labels the explainer source', () => {
    const { rerender } = render(<AIAuditPanel explanation={null} simHour={0} explainer="gemini" model="gemini-3.8-flash" />);
    expect(screen.getByText('Live · gemini-3.8-flash')).toBeInTheDocument();
    rerender(<AIAuditPanel explanation={null} simHour={0} explainer="gemini" />);
    expect(screen.getByText('Live · Gemini')).toBeInTheDocument();
    rerender(<AIAuditPanel explanation={null} simHour={0} explainer="rule_based" />);
    expect(screen.getByText(/rule-based fallback/i)).toBeInTheDocument();
  });

  it('announces each new decision once, with context, in a single atomic status', () => {
    const { rerender } = render(<AIAuditPanel explanation={makeExplanation()} simHour={12} />);
    const announcer = screen.getByTestId('decision-announcer');
    expect(announcer).toHaveAttribute('role', 'status');
    expect(announcer).toHaveAttribute('aria-atomic', 'true');
    expect(announcer).toHaveTextContent('New agent decision at 12:00: Solar Curtailment Window');
    rerender(<AIAuditPanel explanation={makeExplanation({ primary_driver: 'Grid Fossil Peaker Spike', reasoning_summary: 'x' })} simHour={18} />);
    expect(announcer).toHaveTextContent('New agent decision at 18:00: Grid Fossil Peaker Spike');
    expect(screen.getAllByTestId('audit-card')[0]).not.toHaveAttribute('aria-live');
  });

  it('colours driver tags by cause', () => {
    expect(driverTone('Grid Fossil Peaker Spike')).toContain('red');
    expect(driverTone('Solar Curtailment Window')).toContain('amber');
    expect(driverTone('Overnight Wind Surplus')).toContain('cyan');
    expect(driverTone('Unmanaged Baseline')).toContain('bg-muted');
  });
});
