import { fireEvent, render, screen } from '@testing-library/react';
import { WorkloadList } from '../../src/components/WorkloadList';
import { makePacket } from '../fixtures';

describe('WorkloadList', () => {
  const packet = makePacket();

  it('lists every site with type, zone, status and delta', () => {
    render(<WorkloadList workloads={packet.workloads} zones={packet.zones} selectedId={null} onSelect={vi.fn()} />);
    expect(screen.getByText('Santa Clara GPU Cluster')).toBeInTheDocument();
    expect(screen.getByText('Chicago Transit Bus Barn')).toBeInTheDocument();
    expect(screen.getByText('AI Training')).toBeInTheDocument();
    expect(screen.getByText('EV Fleet')).toBeInTheDocument();
    expect(screen.getByText('BOOST')).toBeInTheDocument();
    expect(screen.getByText('THROTTLED')).toBeInTheDocument();
    expect(screen.getByText('+15 MW')).toBeInTheDocument();
    expect(screen.getByText('-2.9 MW')).toBeInTheDocument();
    expect(screen.getByText('490 g')).toBeInTheDocument();
  });

  it('shows utilisation bars', () => {
    render(<WorkloadList workloads={packet.workloads} zones={packet.zones} selectedId={null} onSelect={vi.fn()} />);
    expect(screen.getByRole('progressbar', { name: /santa clara/i })).toHaveAttribute('aria-valuenow', '100');
    expect(screen.getByRole('progressbar', { name: /chicago/i })).toHaveAttribute('aria-valuenow', '22');
  });

  it('selects a site on click and marks the current one', () => {
    const onSelect = vi.fn();
    render(<WorkloadList workloads={packet.workloads} zones={packet.zones} selectedId="ev-chicago" onSelect={onSelect} />);
    fireEvent.click(screen.getByText('Santa Clara GPU Cluster'));
    expect(onSelect).toHaveBeenCalledWith('dc-santaclara');
    expect(screen.getByText('Chicago Transit Bus Barn').closest('button')).toHaveAttribute('aria-current', 'true');
  });

  it('handles an empty list', () => {
    render(<WorkloadList workloads={[]} zones={[]} selectedId={null} onSelect={vi.fn()} />);
    expect(screen.getByText(/no workloads/i)).toBeInTheDocument();
  });
});
