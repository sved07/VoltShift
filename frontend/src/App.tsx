import { useState } from 'react';
import { Activity, Zap } from 'lucide-react';
import { AIAuditPanel } from './components/AIAuditPanel';
import { ControlBar } from './components/ControlBar';
import { MapboxView } from './components/MapboxView';
import { MetricsBar } from './components/MetricsBar';
import { WorkloadList } from './components/WorkloadList';
import { useGridSocket } from './hooks/useGridSocket';

export default function App() {
  const { packet, status, connected, sendAction } = useGridSocket();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const metrics = packet?.cumulative_metrics ?? null;

  return (
    <div className="flex min-h-screen flex-col bg-slate-950 text-zinc-100 lg:h-screen">
      <header className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-neon/15 p-2 text-neon shadow-neon">
            <Zap size={20} />
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-tight">
              Volt<span className="text-neon">Shift</span>
            </h1>
            <p className="text-[11px] uppercase tracking-widest text-zinc-500">Autonomous Grid Load-Shifting Agent</p>
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs">
          {metrics?.peaker_spike_active && (
            <span className="animate-pulse rounded-full bg-red-600/25 px-3 py-1 font-semibold text-red-300 ring-1 ring-red-500/60">
              GAS PEAKER RAMP
            </span>
          )}
          <span
            role="status"
            className={`flex items-center gap-1.5 rounded-full px-3 py-1 ring-1 ${
              connected ? 'bg-emerald-500/10 text-emerald-300 ring-emerald-500/40' : 'bg-amber-500/10 text-amber-300 ring-amber-500/40'
            }`}
          >
            <Activity size={12} />
            {connected ? 'Live telemetry' : status === 'connecting' ? 'Connecting…' : 'Reconnecting…'}
          </span>
        </div>
      </header>

      <MetricsBar metrics={metrics} />

      {/* Desktop: fixed-height 3-column dashboard. Narrow screens: stacked panels, page scrolls. */}
      <main className="grid grid-cols-1 gap-3 p-3 lg:min-h-0 lg:flex-1 lg:grid-cols-[300px_minmax(0,1fr)_380px] lg:overflow-hidden">
        <div className="flex max-h-[60vh] min-h-0 flex-col lg:max-h-none [&>aside]:flex-1">
          <WorkloadList
            workloads={packet?.workloads ?? []}
            zones={packet?.zones ?? []}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
        </div>
        <div className="h-[60vh] min-h-0 lg:h-auto">
          {packet ? (
            <MapboxView zones={packet.zones} workloads={packet.workloads} selectedId={selectedId} onSelect={setSelectedId} />
          ) : (
            <div className="flex h-full items-center justify-center rounded-2xl bg-zinc-950/80 text-sm text-zinc-500 ring-1 ring-zinc-800">
              Waiting for grid telemetry — is the backend running on port 8000?
            </div>
          )}
        </div>
        <div className="flex max-h-[70vh] min-h-0 flex-col lg:max-h-none [&>aside]:flex-1">
          <AIAuditPanel
            explanation={packet?.ai_explanation ?? null}
            simHour={packet?.sim_hour ?? 0}
            explainer={metrics?.explainer}
          />
        </div>
      </main>

      <ControlBar
        simHour={packet?.sim_hour ?? 0}
        autonomous={metrics?.mode !== 'UNMANAGED'}
        peakerActive={Boolean(metrics?.peaker_spike_active)}
        connected={connected}
        onAction={sendAction}
      />
    </div>
  );
}
