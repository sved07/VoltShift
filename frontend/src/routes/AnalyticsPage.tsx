import { motion } from 'framer-motion';
import { Activity, CalendarRange, Clock, Gauge, Pause, Play, RotateCcw, Target } from 'lucide-react';
import { useTelemetry } from '../app/TelemetryProvider';
import { ForecastChart } from '../components/analytics/ForecastChart';
import { fadeUp, pressable, staggerChildren } from '../lib/motion';
import { STATUS_META, carbonColor, formatHour, formatPower } from '../utils/carbon';
import type { GridZone, IndustrialWorkload } from '../types';

const TIER_LABEL = { green: 'Green', amber: 'Amber', red: 'Red' } as const;

/** Grid Analytics: the v2 backend data the other pages don't show. */
export function AnalyticsPage() {
  const { packet, connected, sendAction } = useTelemetry();
  const metrics = packet?.cumulative_metrics;
  const paused = Boolean(metrics?.simulation_paused);

  return (
    <div className="mx-auto max-w-7xl">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">SEC.06 // Grid Analytics</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-fg">Analytics</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {paused && (
            <span className="rounded-full bg-amber-500/10 px-2.5 py-1 font-mono text-[11px] text-amber-300 ring-1 ring-amber-400/40" role="status">
              Simulation paused
            </span>
          )}
          <motion.button
            type="button"
            {...pressable}
            disabled={!connected}
            onClick={() => sendAction({ action: 'TOGGLE_TICKER' })}
            aria-pressed={paused}
            className="hover-instant inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/[0.03] px-3.5 py-2 text-sm font-medium text-fg hover:bg-white/[0.08] disabled:opacity-40"
          >
            {paused ? <Play size={15} aria-hidden="true" /> : <Pause size={15} aria-hidden="true" />}
            {paused ? 'Resume simulation' : 'Pause simulation'}
          </motion.button>
          <motion.button
            type="button"
            {...pressable}
            disabled={!connected}
            onClick={() => sendAction({ action: 'RESET_METRICS' })}
            className="hover-instant inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/[0.03] px-3.5 py-2 text-sm font-medium text-fg hover:bg-white/[0.08] disabled:opacity-40"
          >
            <RotateCcw size={15} aria-hidden="true" /> Reset metrics
          </motion.button>
        </div>
      </div>

      <motion.div
        variants={staggerChildren(0.05, 0.08)}
        initial="hidden"
        animate="show"
        className="mt-5 grid gap-4 lg:grid-cols-3"
      >
        <motion.section variants={fadeUp} className="glass p-5 lg:col-span-2" aria-labelledby="forecast-title">
          <h2 id="forecast-title" className="eyebrow flex items-center gap-2">
            <CalendarRange size={13} aria-hidden="true" /> 24h Carbon Forecast & Agent Plan
          </h2>
          <div className="mt-3">
            <ForecastChart points={packet?.ai_explanation.hourly_forecast ?? []} currentHour={packet?.sim_hour ?? 0} />
          </div>
        </motion.section>

        <motion.section variants={fadeUp} className="glass p-5" aria-labelledby="dispatch-title">
          <h2 id="dispatch-title" className="eyebrow flex items-center gap-2">
            <Gauge size={13} aria-hidden="true" /> Dispatch Snapshot
          </h2>
          <dl className="mt-3 grid grid-cols-2 gap-2" data-testid="dispatch-snapshot">
            <Stat label="Managed carbon" value={metrics?.avg_carbon_managed} unit="g/kWh" colored />
            <Stat label="Baseline carbon" value={metrics?.avg_carbon_baseline} unit="g/kWh" colored />
            <Stat label="Active load" value={metrics?.total_active_kw} format={formatPower} />
            <Stat label="Carbon cut" value={metrics?.improvement_pct} unit="%" accent />
          </dl>
          <p className="mt-3 text-xs leading-relaxed text-muted-fg">
            Load-weighted carbon intensity of what the sites draw right now, versus the same sites on their unmanaged
            schedule.
          </p>
        </motion.section>

        <motion.section variants={fadeUp} className="glass p-5 lg:col-span-2" aria-labelledby="iso-title">
          <h2 id="iso-title" className="eyebrow flex items-center gap-2">
            <Activity size={13} aria-hidden="true" /> ISO Generation Mix
          </h2>
          <IsoTable zones={packet?.zones ?? []} />
        </motion.section>

        <motion.section variants={fadeUp} className="glass p-5" aria-labelledby="sla-title">
          <h2 id="sla-title" className="eyebrow flex items-center gap-2">
            <Target size={13} aria-hidden="true" /> SLA Quota Progress
          </h2>
          <SlaList workloads={packet?.workloads ?? []} simHour={packet?.sim_hour ?? 0} />
        </motion.section>
      </motion.div>
    </div>
  );
}

function Stat({
  label,
  value,
  unit,
  format,
  colored,
  accent,
}: {
  label: string;
  value?: number;
  unit?: string;
  format?: (n: number) => string;
  colored?: boolean;
  accent?: boolean;
}) {
  const has = typeof value === 'number' && Number.isFinite(value);
  const text = !has ? '—' : format ? format(value) : `${value.toLocaleString('en-US', { maximumFractionDigits: 1 })}${unit ? ` ${unit}` : ''}`;
  return (
    <div className="glass-inset px-3 py-2.5">
      <dt className="text-[11px] uppercase tracking-wider text-muted-fg">{label}</dt>
      <dd
        className={`mt-0.5 font-mono text-lg font-semibold tabular-nums ${accent ? 'text-neon' : 'text-fg'}`}
        style={colored && has ? { color: carbonColor(value) } : undefined}
      >
        {text}
      </dd>
    </div>
  );
}

function IsoTable({ zones }: { zones: GridZone[] }) {
  if (zones.length === 0) return <p className="mt-3 text-sm text-muted-fg">Awaiting telemetry…</p>;
  return (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full min-w-[560px] text-left text-sm" data-testid="iso-table">
        <thead>
          <tr className="text-[11px] uppercase tracking-wider text-muted-fg">
            <th scope="col" className="pb-2 font-medium">ISO</th>
            <th scope="col" className="pb-2 font-medium">Carbon</th>
            <th scope="col" className="pb-2 font-medium">Renewable</th>
            <th scope="col" className="pb-2 font-medium">Solar / Wind</th>
            <th scope="col" className="pb-2 font-medium">Marginal fuel</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/[0.06]">
          {zones.map((z) => (
            <tr key={z.zone_id}>
              <th scope="row" className="py-2 pr-3 font-mono text-xs font-medium text-fg">
                [{z.zone_id}]
              </th>
              <td className="py-2 pr-3 font-mono tabular-nums" style={{ color: carbonColor(z.carbon_intensity) }}>
                {Math.round(z.carbon_intensity)} g
                {z.color_tier && <span className="ml-1.5 text-[10px] uppercase opacity-80">{TIER_LABEL[z.color_tier]}</span>}
              </td>
              <td className="py-2 pr-3 font-mono tabular-nums text-fg/85">{Math.round(z.renewable_pct)}%</td>
              <td className="py-2 pr-3 font-mono text-xs tabular-nums text-muted-fg">
                {formatPower(z.solar_mw * 1000)} / {formatPower(z.wind_mw * 1000)}
              </td>
              <td className="py-2 text-xs text-fg/85">{z.marginal_fuel ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SlaList({ workloads, simHour }: { workloads: IndustrialWorkload[]; simHour: number }) {
  if (workloads.length === 0) return <p className="mt-3 text-sm text-muted-fg">Awaiting telemetry…</p>;
  const sorted = [...workloads].sort((a, b) => hoursLeft(a.deadline_hour, simHour) - hoursLeft(b.deadline_hour, simHour));

  return (
    <motion.ul variants={staggerChildren(0.04, 0.1)} initial="hidden" animate="show" className="mt-3 space-y-3" data-testid="sla-list">
      {sorted.map((w) => {
        const pct = Math.max(0, Math.min(100, w.sla_progress_pct ?? 0));
        const meta = STATUS_META[w.status];
        const left = hoursLeft(w.deadline_hour, simHour);
        return (
          <motion.li key={w.id} variants={fadeUp}>
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span className="truncate text-fg">{w.site_name}</span>
              <span className="shrink-0 font-mono text-xs tabular-nums text-fg">{pct.toFixed(0)}%</span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                role="progressbar"
                aria-label={`${w.site_name} SLA quota`}
                aria-valuenow={Math.round(pct)}
                aria-valuemin={0}
                aria-valuemax={100}
                className="h-full w-full origin-left rounded-full transition-transform duration-300 ease-out"
                style={{ transform: `scaleX(${pct / 100})`, backgroundColor: meta.color }}
              />
            </div>
            <div className="mt-1 flex justify-between font-mono text-[11px] text-muted-fg">
              <span className="flex items-center gap-1">
                <Clock size={10} aria-hidden="true" /> due {formatHour(w.deadline_hour)} · {left}h
              </span>
              <span style={{ color: meta.color }}>{meta.label}</span>
            </div>
          </motion.li>
        );
      })}
    </motion.ul>
  );
}

function hoursLeft(deadline: number, now: number): number {
  return (deadline - now + 24) % 24;
}
