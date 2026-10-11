import { useSearchParams } from 'react-router-dom';
import { useTelemetry } from '../app/TelemetryProvider';
import { MapboxView } from '../components/MapboxView';
import { WorkloadList } from '../components/WorkloadList';

/** Interim Sites page — reuses the existing list + map. Filterable grid comes in the next iteration. */
export function SitesPage() {
  const { packet } = useTelemetry();
  const [params, setParams] = useSearchParams();
  const selectedId = params.get('focus');
  const select = (id: string) => setParams({ focus: id }, { replace: true });

  return (
    <div className="mx-auto max-w-7xl">
      <p className="eyebrow">SEC.04 // Industrial Sites</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight text-fg">Sites</h1>
      <div className="mt-5 grid gap-4 lg:h-[calc(100vh-14rem)] lg:grid-cols-[340px_minmax(0,1fr)]">
        <div className="flex max-h-[60vh] min-h-0 flex-col lg:max-h-none [&>aside]:flex-1">
          <WorkloadList workloads={packet?.workloads ?? []} zones={packet?.zones ?? []} selectedId={selectedId} onSelect={select} />
        </div>
        <div className="h-[60vh] min-h-0 lg:h-auto">
          {packet ? (
            <MapboxView zones={packet.zones} workloads={packet.workloads} selectedId={selectedId} onSelect={select} />
          ) : (
            <div className="glass flex h-full items-center justify-center text-sm text-muted-fg">Waiting for grid telemetry…</div>
          )}
        </div>
      </div>
    </div>
  );
}
