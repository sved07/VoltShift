import { Suspense, lazy } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowRight, ArrowUpRight, BrainCircuit, Route } from 'lucide-react';
import { useTelemetry } from '../app/TelemetryProvider';
import { MetricsBar } from '../components/MetricsBar';
import { driverTone } from '../components/AIAuditPanel';
import { usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion';
import { DURATION, EASE_OUT, fadeIn, fadeUp, pressable, staggerChildren } from '../lib/motion';
import { carbonColor, formatHour } from '../utils/carbon';
import type { GridZone, IndustrialWorkload } from '../types';

// three.js is ~600 kB: keep it out of the initial bundle and other routes.
const GridScene = lazy(() => import('../components/three/GridScene'));

const MotionLink = motion.create(Link);

export function OverviewPage() {
  const { packet } = useTelemetry();
  const reducedMotion = usePrefersReducedMotion();
  const navigate = useNavigate();
  const zones = packet?.zones ?? [];
  const workloads = packet?.workloads ?? [];

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-4">
      <section
        aria-labelledby="overview-title"
        className="relative isolate flex flex-col overflow-hidden rounded-3xl border border-white/10 bg-card/20 lg:h-[calc(100vh-11rem)] lg:min-h-[600px]"
      >
        <motion.div
          variants={staggerChildren(0.05, 0.15)}
          initial="hidden"
          animate="show"
          className="pointer-events-none relative z-10 flex flex-1 flex-col justify-between gap-6 p-5 md:p-8"
        >
          {/* Legibility scrim behind the copy (desktop, where the scene sits under the text). */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 -z-10 hidden bg-[radial-gradient(70%_60%_at_0%_0%,rgb(var(--c-bg)/0.85),transparent_70%),linear-gradient(to_top,rgb(var(--c-bg)/0.9),transparent_45%)] lg:block"
          />
          <div className="flex flex-col justify-between gap-6 lg:flex-row lg:items-start">
            <div className="pointer-events-auto max-w-lg">
              <motion.p variants={fadeUp} className="eyebrow">
                SEC.01 // Grid Overview
              </motion.p>
              <motion.h1
                id="overview-title"
                variants={fadeUp}
                className="mt-3 text-balance text-4xl font-semibold leading-[1.05] tracking-tight text-fg md:text-5xl"
              >
                Load follows <span className="text-neon">clean power</span>.
              </motion.h1>
              <motion.div
                aria-hidden="true"
                className="mt-4 h-px w-24 origin-left bg-gradient-to-r from-neon to-electric"
                initial={{ scaleX: 0 }}
                animate={{ scaleX: 1 }}
                transition={{ duration: DURATION.max, ease: EASE_OUT, delay: 0.3 }}
              />
              <motion.p variants={fadeUp} className="mt-4 text-pretty text-[15px] leading-relaxed text-muted-fg">
                An autonomous agent shifts {workloads.length || 'AI training and EV fleet'} industrial loads across ERCOT, CAISO,
                PJM and MISO — boosting into solar and wind, throttling through fossil peaks, never missing an SLA.
              </motion.p>
              <motion.div variants={fadeUp} className="mt-6 flex flex-wrap items-center gap-2">
                <MotionLink
                  to="/sites"
                  {...pressable}
                  className="hover-instant inline-flex items-center gap-2 rounded-xl bg-neon px-4 py-2.5 text-sm font-semibold text-canvas hover:bg-neon/90"
                >
                  Inspect sites <ArrowRight size={16} aria-hidden="true" />
                </MotionLink>
                <MotionLink
                  to="/audit"
                  {...pressable}
                  className="hover-instant inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/[0.03] px-4 py-2.5 text-sm font-medium text-fg hover:bg-white/[0.08]"
                >
                  Agent audit log <ArrowUpRight size={16} aria-hidden="true" />
                </MotionLink>
              </motion.div>
            </div>

            {/* Background first: the scene fades in on its own, foreground staggers over it.
                Narrow screens: an in-flow band between copy and cards. Desktop: full-bleed behind everything. */}
            <motion.div
              variants={fadeIn}
              initial="hidden"
              animate="show"
              className="pointer-events-auto relative -mx-5 h-[340px] md:-mx-8 lg:absolute lg:inset-0 lg:-z-20 lg:mx-0 lg:h-auto"
            >
              {packet ? (
                <Suspense fallback={<SceneBackdrop />}>
                  <GridScene
                    zones={zones}
                    workloads={workloads}
                    reducedMotion={reducedMotion}
                    onSelectSite={(id) => navigate(`/sites?focus=${encodeURIComponent(id)}`)}
                  />
                </Suspense>
              ) : (
                <SceneBackdrop />
              )}
            </motion.div>

            <motion.div variants={fadeUp} className="pointer-events-auto w-full lg:max-w-xs">
              <ZoneStatusCard zones={zones} simHour={packet?.sim_hour} />
            </motion.div>
          </div>

          <div className="pointer-events-auto -mx-3">
            <MetricsBar metrics={packet?.cumulative_metrics ?? null} />
          </div>
        </motion.div>
      </section>

      <motion.section
        variants={staggerChildren(0.06, 0.25)}
        initial="hidden"
        animate="show"
        className="grid gap-4 md:grid-cols-2"
        aria-label="Agent status"
      >
        <motion.div variants={fadeUp}>
          <RoutingCard zones={zones} workloads={workloads} />
        </motion.div>
        <motion.div variants={fadeUp}>
          <LatestDecisionCard />
        </motion.div>
      </motion.section>
    </div>
  );
}

/** Static stand-in while three.js loads (and before the first packet). */
function SceneBackdrop() {
  return <div className="scene-backdrop h-full w-full" data-testid="scene-backdrop" />;
}

function ZoneStatusCard({ zones, simHour }: { zones: GridZone[]; simHour?: number }) {
  return (
    <div className="glass p-4">
      <div className="flex items-center justify-between">
        <h2 className="eyebrow">ISO Carbon Intensity</h2>
        {simHour !== undefined && <span className="font-mono text-[11px] text-muted-fg">sim {formatHour(simHour)}</span>}
      </div>
      <ul className="mt-3 space-y-2" data-testid="zone-status">
        {zones.length === 0 && <li className="text-sm text-muted-fg">Awaiting telemetry…</li>}
        {zones.map((z) => (
          <li key={z.zone_id} className="flex items-center justify-between gap-3 text-sm">
            <span className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: carbonColor(z.carbon_intensity) }} aria-hidden="true" />
              <span className="font-mono text-xs text-fg">[{z.zone_id}]</span>
              <span className="text-muted-fg">{Math.round(z.renewable_pct)}% RE</span>
            </span>
            <span className="font-mono tabular-nums" style={{ color: carbonColor(z.carbon_intensity) }}>
              {Math.round(z.carbon_intensity)} g
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function RoutingCard({ zones, workloads }: { zones: GridZone[]; workloads: IndustrialWorkload[] }) {
  const cleanest = zones.reduce<GridZone | null>((best, z) => (!best || z.carbon_intensity < best.carbon_intensity ? z : best), null);
  const count = (s: IndustrialWorkload['status']) => workloads.filter((w) => w.status === s).length;
  const rows = [
    { label: 'Boosting', value: count('BOOST'), tone: 'text-neon' },
    { label: 'Throttled', value: count('THROTTLE'), tone: 'text-orange-300' },
    { label: 'Deferred', value: count('DEFER'), tone: 'text-red-300' },
    { label: 'Holding', value: count('MAINTAIN'), tone: 'text-electric' },
  ];

  return (
    <div className="glass h-full p-5">
      <p className="eyebrow flex items-center gap-2">
        <Route size={13} aria-hidden="true" /> SEC.02 // Routing Now
      </p>
      <p className="mt-3 text-lg font-medium text-fg">
        {cleanest ? (
          <>
            Drawing from <span className="font-mono">[{cleanest.zone_id}]</span> at{' '}
            <span className="font-mono" style={{ color: carbonColor(cleanest.carbon_intensity) }}>
              {Math.round(cleanest.carbon_intensity)} gCO₂/kWh
            </span>
          </>
        ) : (
          'Waiting for grid telemetry…'
        )}
      </p>
      <dl className="mt-4 grid grid-cols-4 gap-2">
        {rows.map((r) => (
          <div key={r.label} className="glass-inset px-3 py-2">
            <dt className="text-[11px] uppercase tracking-wider text-muted-fg">{r.label}</dt>
            <dd className={`font-mono text-2xl font-semibold tabular-nums ${r.tone}`}>{r.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function LatestDecisionCard() {
  const { packet } = useTelemetry();
  const decision = packet?.ai_explanation;

  return (
    <div className="glass flex h-full flex-col p-5">
      <p className="eyebrow flex items-center gap-2">
        <BrainCircuit size={13} aria-hidden="true" /> SEC.03 // Latest Agent Decision
      </p>
      {decision ? (
        <>
          <span className={`mt-3 w-fit rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${driverTone(decision.primary_driver)}`}>
            {decision.primary_driver}
          </span>
          <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-fg/85">{decision.reasoning_summary}</p>
        </>
      ) : (
        <p className="mt-3 text-sm text-muted-fg">No decisions yet.</p>
      )}
      <Link
        to="/audit"
        className="hover-instant mt-auto inline-flex w-fit items-center gap-1 rounded-md pt-4 text-sm font-medium text-electric hover:text-fg"
      >
        Open audit log <ArrowRight size={14} aria-hidden="true" />
      </Link>
    </div>
  );
}
