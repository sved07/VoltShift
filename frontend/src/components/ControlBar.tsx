import { useEffect, useRef, useState } from 'react';
import { Bot, Flame, Pause, Play, ShieldOff } from 'lucide-react';
import type { ClientAction } from '../types';
import { formatHour } from '../utils/carbon';

export const PLAY_INTERVAL_MS = 2500;

interface ControlBarProps {
  simHour: number;
  autonomous: boolean;
  peakerActive: boolean;
  connected: boolean;
  onAction: (action: ClientAction) => void;
}

export function ControlBar({ simHour, autonomous, peakerActive, connected, onAction }: ControlBarProps) {
  const [playing, setPlaying] = useState(false);
  const hourRef = useRef(simHour);
  hourRef.current = simHour;
  const actionRef = useRef(onAction);
  actionRef.current = onAction;

  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      actionRef.current({ action: 'SET_HOUR', hour: (hourRef.current + 1) % 24 });
    }, PLAY_INTERVAL_MS);
    return () => clearInterval(id);
  }, [playing]);

  return (
    <footer className="z-10 md:sticky md:bottom-0 flex flex-wrap items-center gap-4 border-t border-white/10 bg-canvas/80 px-4 py-3 backdrop-blur">
      <button
        type="button"
        onClick={() => setPlaying((p) => !p)}
        disabled={!connected}
        aria-label={playing ? 'Pause simulation' : 'Play simulation'}
        className="flex h-10 w-10 items-center justify-center rounded-full bg-electric/15 text-electric ring-1 ring-electric/40 transition hover:bg-electric/25 disabled:opacity-40"
      >
        {playing ? <Pause size={18} /> : <Play size={18} />}
      </button>

      <div className="flex min-w-[240px] flex-1 items-center gap-3">
        <label htmlFor="sim-hour" className="text-xs uppercase tracking-widest text-muted-fg">
          Simulated Hour
        </label>
        <input
          id="sim-hour"
          type="range"
          min={0}
          max={23}
          step={1}
          value={simHour}
          disabled={!connected}
          onChange={(e) => onAction({ action: 'SET_HOUR', hour: Number(e.target.value) })}
          className="h-1.5 flex-1 cursor-pointer accent-cyan-400"
        />
        <span className="w-16 rounded-md bg-muted/60 px-2 py-1 text-center font-mono text-lg text-electric" data-testid="sim-hour">
          {formatHour(simHour)}
        </span>
      </div>

      <button
        type="button"
        onClick={() => onAction({ action: 'TRIGGER_PEAKER_SPIKE' })}
        disabled={!connected}
        aria-pressed={peakerActive}
        className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold ring-1 transition disabled:opacity-40 ${
          peakerActive
            ? 'animate-pulse bg-red-600/30 text-red-200 ring-red-500 shadow-[0_0_20px_rgba(239,68,68,0.45)]'
            : 'bg-muted/60 text-red-300 ring-red-500/40 hover:bg-red-950'
        }`}
      >
        <Flame size={16} />
        {peakerActive ? 'Peaker Ramp Active — Click to Clear' : 'Simulate Gas Peaker Plant Ramp (Grid Spike)'}
      </button>

      <div role="group" aria-label="Dispatch mode" className="flex overflow-hidden rounded-lg ring-1 ring-white/15">
        <button
          type="button"
          aria-pressed={autonomous}
          disabled={!connected || autonomous}
          onClick={() => onAction({ action: 'TOGGLE_MODE' })}
          className={`flex items-center gap-2 px-3 py-2 text-sm font-semibold transition ${
            autonomous ? 'bg-neon/15 text-neon' : 'bg-muted/60 text-muted-fg hover:text-fg'
          }`}
        >
          <Bot size={16} /> Autonomous Agent Dispatch
        </button>
        <button
          type="button"
          aria-pressed={!autonomous}
          disabled={!connected || !autonomous}
          onClick={() => onAction({ action: 'TOGGLE_MODE' })}
          className={`flex items-center gap-2 px-3 py-2 text-sm font-semibold transition ${
            !autonomous ? 'bg-line/60 text-fg' : 'bg-muted/60 text-muted-fg hover:text-fg'
          }`}
        >
          <ShieldOff size={16} /> Unmanaged Baseline
        </button>
      </div>
    </footer>
  );
}
