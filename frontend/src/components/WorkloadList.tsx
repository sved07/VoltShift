import { Clock, Cpu, Truck } from 'lucide-react';
import type { GridZone, IndustrialWorkload } from '../types';
import { STATUS_META, carbonColor, formatHour, formatPower, formatPowerDelta } from '../utils/carbon';

interface WorkloadListProps {
  workloads: IndustrialWorkload[];
  zones: GridZone[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function WorkloadList({ workloads, zones, selectedId, onSelect }: WorkloadListProps) {
  const zoneMap = new Map(zones.map((z) => [z.zone_id, z]));

  return (
    <aside className="flex min-h-0 flex-col glass p-4">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-widest text-fg">Industrial Sites</h2>
      {workloads.length === 0 ? (
        <p className="text-sm text-muted-fg">No workloads reported.</p>
      ) : (
        <ul className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-1">
          {workloads.map((w) => {
            const zone = zoneMap.get(w.zone_id);
            const meta = STATUS_META[w.status];
            const pct = w.max_kw > 0 ? Math.min(100, (w.current_kw / w.max_kw) * 100) : 0;
            const Icon = w.type === 'AI_TRAINING' ? Cpu : Truck;
            return (
              <li key={w.id}>
                <button
                  type="button"
                  onClick={() => onSelect(w.id)}
                  aria-current={selectedId === w.id ? 'true' : undefined}
                  className={`w-full rounded-xl p-3 text-left ring-1 transition-colors duration-200 hover:bg-muted/60 ${
                    selectedId === w.id ? 'bg-muted/60 ring-electric/50' : 'bg-muted/30 ring-white/10'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Icon size={16} aria-hidden="true" className={w.type === 'AI_TRAINING' ? 'text-violet-300' : 'text-electric'} />
                      <div>
                        <div className="text-sm font-medium text-fg">{w.site_name}</div>
                        <div className="flex items-center gap-1.5 text-[11px] text-muted-fg">
                          <span>{w.type === 'AI_TRAINING' ? 'AI Training' : 'EV Fleet'}</span>·
                          <span>{w.zone_id}</span>
                          {zone && (
                            <span style={{ color: carbonColor(zone.carbon_intensity) }}>
                              {Math.round(zone.carbon_intensity)} g
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <span className={`min-w-[4.75rem] whitespace-nowrap rounded-md px-1.5 py-0.5 text-center font-mono text-[10px] font-bold ring-1 ${meta.badge}`}>
                      {meta.label}
                    </span>
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                    <div
                      role="progressbar"
                      aria-label={`${w.site_name} utilisation`}
                      aria-valuenow={Math.round(pct)}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      className="h-full w-full origin-left rounded-full transition-transform duration-300 ease-out"
                      style={{ transform: `scaleX(${pct / 100})`, backgroundColor: meta.color }}
                    />
                  </div>
                  <div className="mt-1.5 flex justify-between font-mono text-[11px] text-muted-fg">
                    <span>
                      {formatPower(w.current_kw)} / {formatPower(w.max_kw)}
                    </span>
                    <span style={{ color: meta.color }}>{formatPowerDelta(w)}</span>
                    <span className="flex items-center gap-1">
                      <Clock size={10} /> SLA {formatHour(w.deadline_hour)}
                    </span>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}
