import { NavLink } from 'react-router-dom';
import { motion } from 'framer-motion';
import { BarChart3, Factory, Flame, LayoutDashboard, ScrollText, Zap } from 'lucide-react';
import { spring } from '../../lib/motion';
import { LiveIndicator } from '../LiveIndicator';
import { useTelemetry } from '../../app/TelemetryProvider';

export const NAV_ITEMS = [
  { to: '/', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/sites', label: 'Sites', icon: Factory, end: false },
  { to: '/audit', label: 'Audit Log', icon: ScrollText, end: false },
  { to: '/analytics', label: 'Analytics', icon: BarChart3, end: false },
] as const;

/** Floating glass pill. The active indicator glides between links on a spring (transform only). */
export function FloatingNav() {
  const { packet, status, lastMessageAt } = useTelemetry();

  return (
    <header className="pointer-events-none fixed inset-x-0 top-3 z-40 flex justify-center px-3">
      <nav
        aria-label="Primary"
        className="pointer-events-auto flex w-full max-w-5xl items-center justify-between gap-2 rounded-2xl border border-white/10 bg-card/60 py-1.5 pl-3 pr-1.5 shadow-xl shadow-black/30 backdrop-blur-xl"
      >
        <NavLink to="/" className="flex items-center gap-2 rounded-lg px-1 py-1" aria-label="VoltShift home">
          <span className="rounded-lg bg-neon/15 p-1.5 text-neon shadow-neon" aria-hidden="true">
            <Zap size={16} />
          </span>
          <span className="hidden font-mono text-sm font-bold tracking-tight sm:inline">
            Volt<span className="text-neon">Shift</span>
          </span>
        </NavLink>

        <ul className="flex items-center gap-1">
          {NAV_ITEMS.map(({ to, label, icon: Icon, end }) => (
            <li key={to}>
              <NavLink
                to={to}
                end={end}
                className={({ isActive }) =>
                  `hover-instant relative flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium ${
                    isActive ? 'text-fg' : 'text-muted-fg hover:bg-white/[0.04] hover:text-fg'
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    {isActive && (
                      <motion.span
                        layoutId="nav-active-pill"
                        transition={spring}
                        className="absolute inset-0 rounded-xl border border-white/10 bg-white/[0.07]"
                        aria-hidden="true"
                      />
                    )}
                    <Icon size={15} className="relative" aria-hidden="true" />
                    <span className="relative hidden sm:inline">{label}</span>
                    <span className="sr-only sm:hidden">{label}</span>
                  </>
                )}
              </NavLink>
            </li>
          ))}
        </ul>

        <div className="hidden items-center gap-2 md:flex">
          {packet?.cumulative_metrics.peaker_spike_active && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-danger/20 px-2.5 py-1 font-mono text-[11px] font-semibold text-red-200 ring-1 ring-danger/60">
              <Flame size={12} aria-hidden="true" /> PEAKER RAMP
            </span>
          )}
          <LiveIndicator status={status} lastMessageAt={lastMessageAt} />
        </div>
      </nav>
    </header>
  );
}
