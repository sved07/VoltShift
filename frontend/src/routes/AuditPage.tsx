import { useTelemetry } from '../app/TelemetryProvider';
import { AIAuditPanel } from '../components/AIAuditPanel';

/** Interim Audit page — reuses the existing panel. Dedicated feed comes in the next iteration. */
export function AuditPage() {
  const { packet } = useTelemetry();
  const metrics = packet?.cumulative_metrics;

  return (
    <div className="mx-auto max-w-3xl">
      <p className="eyebrow">SEC.05 // Agent Audit Log</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight text-fg">Audit Log</h1>
      <div className="mt-5 flex h-[calc(100vh-14rem)] min-h-[480px] flex-col [&>aside]:flex-1">
        <AIAuditPanel
          explanation={packet?.ai_explanation ?? null}
          simHour={packet?.sim_hour ?? 0}
          explainer={metrics?.explainer}
          model={metrics?.explainer_model}
        />
      </div>
    </div>
  );
}
