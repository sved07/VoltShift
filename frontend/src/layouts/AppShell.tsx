import { Outlet, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useTelemetry } from '../app/TelemetryProvider';
import { ControlBar } from '../components/ControlBar';
import { FloatingNav } from '../components/nav/FloatingNav';
import { LiveIndicator } from '../components/LiveIndicator';
import { pageTransition } from '../lib/motion';

export function AppShell() {
  const { packet, connected, status, lastMessageAt, sendAction } = useTelemetry();
  const { pathname } = useLocation();
  const metrics = packet?.cumulative_metrics;

  return (
    <div className="relative flex min-h-screen flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-card focus:px-3 focus:py-2">
        Skip to content
      </a>
      <FloatingNav />

      {/* Live status for small screens, where the nav pill has no room for it */}
      <div className="flex justify-center pt-20 md:hidden">
        <LiveIndicator status={status} lastMessageAt={lastMessageAt} />
      </div>

      <motion.main
        id="main"
        key={pathname}
        variants={pageTransition}
        initial="hidden"
        animate="show"
        className="flex-1 px-3 pb-6 pt-4 md:pt-24"
      >
        <Outlet />
      </motion.main>

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
