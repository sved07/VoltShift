import { useEffect, useState } from 'react';
import { Activity, CircleAlert, Loader2 } from 'lucide-react';
import type { SocketStatus } from '../hooks/useGridSocket';

/** Telemetry ticks every 1.5s; after this long without a packet the feed is shown as stale. */
export const STALE_AFTER_MS = 5000;

type Freshness = 'live' | 'stale' | 'connecting' | 'offline';

export function freshness(status: SocketStatus, lastMessageAt: number | null, now: number): Freshness {
  if (status === 'connecting' && lastMessageAt === null) return 'connecting';
  if (status !== 'open') return 'offline';
  if (lastMessageAt === null) return 'connecting';
  return now - lastMessageAt > STALE_AFTER_MS ? 'stale' : 'live';
}

export function ageLabel(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s}s ago` : `${Math.floor(s / 60)}m ago`;
}

const STYLES: Record<Freshness, string> = {
  live: 'bg-neon/10 text-neon ring-neon/40',
  stale: 'bg-amber-500/10 text-amber-300 ring-amber-400/40',
  connecting: 'bg-muted text-muted-fg ring-white/15',
  offline: 'bg-danger/10 text-red-300 ring-danger/40',
};

interface LiveIndicatorProps {
  status: SocketStatus;
  lastMessageAt: number | null;
}

/**
 * "Live" only when backed by a current packet — shows update age and a stale state,
 * per the real-time pattern. A single atomic status message keeps screen readers informed
 * without announcing every tick.
 */
export function LiveIndicator({ status, lastMessageAt }: LiveIndicatorProps) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const state = freshness(status, lastMessageAt, now);
  const age = lastMessageAt === null ? '' : ageLabel(now - lastMessageAt);
  const text = {
    live: `Live telemetry · updated ${age}`,
    stale: `Telemetry stale · last update ${age}`,
    connecting: 'Connecting to grid telemetry…',
    offline: lastMessageAt === null ? 'Telemetry offline · reconnecting…' : `Telemetry offline · last update ${age}`,
  }[state];
  const Icon = state === 'connecting' ? Loader2 : state === 'live' ? Activity : CircleAlert;

  return (
    <span
      role="status"
      aria-atomic="true"
      data-state={state}
      className={`inline-flex min-w-[15.5rem] items-center justify-center gap-1.5 rounded-full px-3 py-1 font-mono text-[11px] ring-1 ${STYLES[state]}`}
    >
      <Icon size={12} aria-hidden="true" className={state === 'connecting' ? 'animate-spin' : undefined} />
      {/* Announce state changes, not the ticking age. */}
      <span aria-hidden="true">{text}</span>
      <span className="sr-only">
        {state === 'live' ? 'Live telemetry connected' : state === 'stale' ? 'Telemetry is stale' : text}
      </span>
    </span>
  );
}
