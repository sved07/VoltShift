import { useEffect, useRef, useState, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { DollarSign, Leaf, Sun, TrendingUp, Zap } from 'lucide-react';
import { usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion';
import { fadeUp, staggerChildren } from '../lib/motion';
import type { CumulativeMetrics } from '../types';

const ANIMATION_MS = 900;

function useAnimatedNumber(target: number): number {
  const [value, setValue] = useState(target);
  const fromRef = useRef(target);
  const reducedMotion = usePrefersReducedMotion();

  useEffect(() => {
    const from = fromRef.current;
    if (from === target || reducedMotion || typeof requestAnimationFrame === 'undefined') {
      fromRef.current = target;
      setValue(target);
      return;
    }
    const start = performance.now();
    let frame = 0;
    // rAF timestamps can predate `start`, so sample the clock directly and clamp.
    const step = () => {
      const t = Math.min(1, Math.max(0, (performance.now() - start) / ANIMATION_MS));
      const eased = 1 - (1 - t) ** 3;
      const next = from + (target - from) * eased;
      fromRef.current = next;
      setValue(next);
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target, reducedMotion]);

  return value;
}

function safe(n: number | undefined): number {
  return typeof n === 'number' && Number.isFinite(n) ? n : 0;
}

interface CounterProps {
  id: string;
  label: string;
  value: number;
  format: (n: number) => string;
  icon: ReactNode;
  accent: string;
}

function Counter({ id, label, value, format, icon, accent }: CounterProps) {
  const animated = useAnimatedNumber(value);
  return (
    <motion.div variants={fadeUp} className="flex items-center gap-3 glass px-4 py-3" data-testid={`metric-${id}`} data-target={format(value)}>
      <div className={`rounded-lg p-2 ${accent}`} aria-hidden="true">{icon}</div>
      <div>
        <div className="text-[11px] uppercase tracking-widest text-muted-fg">{label}</div>
        <div className="font-mono text-xl font-semibold tabular-nums text-fg">{format(animated)}</div>
      </div>
    </motion.div>
  );
}

const fmt = (digits: number) => (n: number) =>
  n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });

export function MetricsBar({ metrics }: { metrics: CumulativeMetrics | null }) {
  const improvement = safe(metrics?.improvement_pct);
  const unmanaged = metrics?.mode === 'UNMANAGED';

  return (
    <motion.section
      aria-label="Live KPIs"
      variants={staggerChildren(0.04, 0.2)}
      initial="hidden"
      animate="show"
      className="grid grid-cols-2 gap-3 px-3 pt-3 md:grid-cols-3 xl:grid-cols-5"
    >
      <Counter
        id="co2"
        label="CO₂ Avoided (kg)"
        value={safe(metrics?.co2_avoided_kg)}
        format={fmt(0)}
        icon={<Leaf size={18} />}
        accent="bg-emerald-500/15 text-neon"
      />
      <Counter
        id="energy"
        label="Energy Shifted (MWh)"
        value={safe(metrics?.energy_shifted_mwh)}
        format={fmt(2)}
        icon={<Zap size={18} />}
        accent="bg-cyan-500/15 text-electric"
      />
      <Counter
        id="clean-share"
        label="Clean Energy Share"
        value={safe(metrics?.clean_energy_share_pct)}
        format={(n) => `${fmt(1)(n)}%`}
        icon={<Sun size={18} />}
        accent="bg-amber-500/15 text-amber-300"
      />
      <Counter
        id="cost"
        label="Cost Savings (USD)"
        value={safe(metrics?.cost_savings_usd)}
        format={(n) => `$${fmt(0)(n)}`}
        icon={<DollarSign size={18} />}
        accent="bg-violet-500/15 text-violet-300"
      />
      <motion.div
        variants={fadeUp}
        data-testid="baseline-badge"
        className={`col-span-2 flex items-center gap-3 rounded-2xl px-4 py-3 md:col-span-1 ${
          unmanaged ? 'glass text-muted-fg' : 'border border-neon/40 bg-neon/10 text-neon shadow-neon backdrop-blur-md'
        }`}
      >
        <TrendingUp size={22} />
        <div>
          <div className="font-mono text-2xl font-bold">{fmt(1)(improvement)}%</div>
          <div className="text-[11px] uppercase tracking-widest">
            {unmanaged ? 'Agent paused — unmanaged baseline' : 'Improvement over unmanaged baseline'}
          </div>
        </div>
      </motion.div>
    </motion.section>
  );
}
