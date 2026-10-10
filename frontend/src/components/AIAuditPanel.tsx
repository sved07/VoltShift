import { useEffect, useState } from 'react';
import { BrainCircuit, CalendarClock, Sparkles } from 'lucide-react';
import type { GeminiAgentExplanation } from '../types';
import { formatHour } from '../utils/carbon';

export const MAX_AUDIT_CARDS = 8;

interface AuditEntry extends GeminiAgentExplanation {
  key: string;
  simHour: number;
  receivedAt: string;
}

export function driverTone(driver: string): string {
  const d = driver.toLowerCase();
  if (d.includes('peaker') || d.includes('fossil')) return 'bg-red-500/15 text-red-300 ring-red-500/40';
  if (d.includes('solar')) return 'bg-amber-500/15 text-amber-300 ring-amber-400/40';
  if (d.includes('wind')) return 'bg-cyan-500/15 text-cyan-300 ring-cyan-400/40';
  if (d.includes('unmanaged')) return 'bg-zinc-700/40 text-zinc-300 ring-zinc-600';
  return 'bg-emerald-500/15 text-emerald-300 ring-emerald-400/40';
}

interface AIAuditPanelProps {
  explanation: GeminiAgentExplanation | null;
  simHour: number;
  explainer?: 'gemini' | 'rule_based';
}

export function AIAuditPanel({ explanation, simHour, explainer = 'rule_based' }: AIAuditPanelProps) {
  const [entries, setEntries] = useState<AuditEntry[]>([]);

  useEffect(() => {
    if (!explanation) return;
    const key = `${explanation.primary_driver}|${explanation.reasoning_summary}`;
    setEntries((prev) => {
      if (prev[0]?.key === key) return prev; // same decision as the last tick — no new card
      const entry: AuditEntry = {
        ...explanation,
        key,
        simHour,
        receivedAt: new Date().toLocaleTimeString('en-US', { hour12: false }),
      };
      return [entry, ...prev].slice(0, MAX_AUDIT_CARDS);
    });
  }, [explanation, simHour]);

  const latest = explanation;

  return (
    <aside className="flex min-h-0 flex-col gap-3 rounded-2xl bg-zinc-950/80 p-4 ring-1 ring-zinc-800">
      <header className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-widest text-zinc-200">
          <BrainCircuit size={18} className="text-electric" />
          Gemini Autonomous Decision Audit
        </h2>
        <span
          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ring-1 ${
            explainer === 'gemini' ? 'bg-electric/10 text-electric ring-electric/40' : 'bg-zinc-800 text-zinc-400 ring-zinc-700'
          }`}
        >
          {explainer === 'gemini' ? 'Live · gemini-2.5-flash' : 'Rule-based fallback'}
        </span>
      </header>

      <section aria-label="24-hour forecast" className="rounded-xl bg-gradient-to-br from-emerald-500/10 to-cyan-500/10 p-4 ring-1 ring-emerald-500/30">
        <div className="mb-2 flex items-center gap-2 text-[11px] uppercase tracking-widest text-emerald-300">
          <CalendarClock size={14} /> 24h Predictive Forecast
        </div>
        {latest ? (
          <>
            <div className="flex items-baseline gap-4">
              <div>
                <div className="font-mono text-2xl font-bold text-neon" data-testid="forecast-carbon">
                  {Math.round(latest.estimated_carbon_saved_kg).toLocaleString('en-US')} kg
                </div>
                <div className="text-[11px] text-zinc-400">projected CO₂ avoided</div>
              </div>
              <div>
                <div className="font-mono text-xl font-semibold text-electric" data-testid="forecast-cost">
                  ${Math.round(latest.estimated_cost_saved_usd).toLocaleString('en-US')}
                </div>
                <div className="text-[11px] text-zinc-400">projected savings</div>
              </div>
            </div>
            <p className="mt-2 text-sm text-zinc-300">{latest.forecast_recommendation}</p>
          </>
        ) : (
          <p className="text-sm text-zinc-500">Waiting for the first agent decision…</p>
        )}
      </section>

      <ol aria-label="Decision stream" className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-1">
        {entries.length === 0 && <li className="text-sm text-zinc-500">No decisions yet.</li>}
        {entries.map((e, i) => (
          <li
            key={`${e.key}-${e.receivedAt}-${i}`}
            data-testid="audit-card"
            className={`animate-card-in rounded-xl p-3 ring-1 ${i === 0 ? 'bg-zinc-900 ring-electric/30' : 'bg-zinc-900/50 ring-zinc-800 opacity-80'}`}
          >
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${driverTone(e.primary_driver)}`}>
                {e.primary_driver}
              </span>
              <span className="flex items-center gap-1 font-mono text-[11px] text-zinc-500">
                <Sparkles size={11} /> sim {formatHour(e.simHour)} · {e.receivedAt}
              </span>
            </div>
            <p className="text-sm leading-snug text-zinc-200">{e.reasoning_summary}</p>
          </li>
        ))}
      </ol>
    </aside>
  );
}
