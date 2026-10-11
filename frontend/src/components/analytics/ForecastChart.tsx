import { useId, useState } from 'react';
import { motion } from 'framer-motion';
import type { HourlyForecastPoint } from '../../types';
import { CARBON_GREEN_BELOW, CARBON_RED_ABOVE, STATUS_META, carbonColor, formatHour } from '../../utils/carbon';
import { DURATION, EASE_OUT } from '../../lib/motion';

const W = 720;
const H = 230;
const PAD = { left: 40, right: 12, top: 14, bottom: 58 };
const PLOT_W = W - PAD.left - PAD.right;
const PLOT_H = H - PAD.top - PAD.bottom;
const STRIP_Y = H - 30;
const STRIP_H = 10;

interface ForecastChartProps {
  points: HourlyForecastPoint[];
  currentHour: number;
}

/** 24h load-weighted carbon curve with thresholds and the agent's recommended action per hour. */
export function ForecastChart({ points, currentHour }: ForecastChartProps) {
  const gradientId = useId();
  const [hovered, setHovered] = useState<number | null>(null);

  if (points.length === 0) {
    return <p className="text-sm text-muted-fg">Forecast will appear with the next telemetry packet.</p>;
  }

  const yMax = Math.max(400, ...points.map((p) => p.carbon_intensity)) * 1.1;
  const colW = PLOT_W / points.length;
  const x = (hour: number) => PAD.left + colW * (hour + 0.5);
  const y = (ci: number) => PAD.top + PLOT_H * (1 - ci / yMax);

  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.hour).toFixed(1)},${y(p.carbon_intensity).toFixed(1)}`).join(' ');
  const area = `${line} L${x(points[points.length - 1].hour).toFixed(1)},${PAD.top + PLOT_H} L${x(points[0].hour).toFixed(1)},${PAD.top + PLOT_H} Z`;

  const focusHour = hovered ?? currentHour;
  const focus = points.find((p) => p.hour === focusHour) ?? points[0];

  return (
    <figure className="m-0">
      <figcaption className="mb-2 flex flex-wrap items-baseline justify-between gap-2 font-mono text-xs" data-testid="forecast-readout">
        <span className="text-muted-fg">
          {formatHour(focus.hour)} {focus.hour === currentHour && <span className="text-neon">· now</span>}
        </span>
        <span className="flex flex-wrap items-baseline gap-3">
          <span style={{ color: carbonColor(focus.carbon_intensity) }}>{Math.round(focus.carbon_intensity)} gCO₂/kWh</span>
          <span className="text-fg/85">{Math.round(focus.renewable_pct)}% renewable</span>
          <span style={{ color: STATUS_META[focus.recommended_action].color }}>{STATUS_META[focus.recommended_action].label}</span>
        </span>
      </figcaption>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full select-none"
        role="img"
        aria-label={`24-hour carbon forecast. Cleanest hour ${formatHour(
          points.reduce((a, b) => (b.carbon_intensity < a.carbon_intensity ? b : a)).hour,
        )}.`}
        onPointerLeave={() => setHovered(null)}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="rgb(var(--c-electric))" stopOpacity="0.35" />
            <stop offset="100%" stopColor="rgb(var(--c-electric))" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Thresholds: green < 150, red > 320 */}
        {[CARBON_GREEN_BELOW, CARBON_RED_ABOVE].map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} stroke={carbonColor(t + (t === CARBON_RED_ABOVE ? 1 : 0))} strokeOpacity="0.35" strokeDasharray="4 4" />
            <text x={PAD.left - 6} y={y(t) + 3} textAnchor="end" className="fill-muted-fg font-mono text-[10px]">
              {t}
            </text>
          </g>
        ))}
        <text x={PAD.left - 6} y={PAD.top + 8} textAnchor="end" className="fill-muted-fg font-mono text-[10px]">
          g
        </text>

        <motion.path
          d={area}
          fill={`url(#${gradientId})`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: DURATION.standard, ease: EASE_OUT }}
        />
        <path d={line} fill="none" stroke="rgb(var(--c-electric))" strokeWidth="2" strokeLinejoin="round" />

        {/* Current hour marker */}
        <line x1={x(currentHour)} x2={x(currentHour)} y1={PAD.top} y2={PAD.top + PLOT_H} stroke="rgb(var(--c-accent))" strokeOpacity="0.8" />

        {points.map((p) => (
          <g key={p.hour}>
            {/* Hover target (whole column) — instant, no animation on high-frequency pointer moves */}
            <rect
              x={PAD.left + colW * p.hour}
              y={PAD.top}
              width={colW}
              height={PLOT_H + 46}
              fill={p.hour === hovered ? 'rgb(255 255 255 / 0.04)' : 'transparent'}
              onPointerEnter={() => setHovered(p.hour)}
              onPointerDown={() => setHovered(p.hour)}
            />
            <circle
              cx={x(p.hour)}
              cy={y(p.carbon_intensity)}
              r={p.hour === focusHour ? 4 : 2}
              fill={carbonColor(p.carbon_intensity)}
              pointerEvents="none"
            />
            <rect
              x={PAD.left + colW * p.hour + 1}
              y={STRIP_Y}
              width={colW - 2}
              height={STRIP_H}
              rx="2"
              fill={STATUS_META[p.recommended_action].color}
              fillOpacity={p.hour === focusHour ? 0.95 : 0.55}
              pointerEvents="none"
              data-action={p.recommended_action}
            />
            {p.hour % 3 === 0 && (
              <text x={x(p.hour)} y={H - 6} textAnchor="middle" className="fill-muted-fg font-mono text-[10px]" pointerEvents="none">
                {String(p.hour).padStart(2, '0')}
              </text>
            )}
          </g>
        ))}
        <text x={PAD.left - 6} y={STRIP_Y + 9} textAnchor="end" className="fill-muted-fg font-mono text-[9px]">
          act
        </text>
      </svg>

      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-fg" aria-label="Action legend">
        {(Object.keys(STATUS_META) as (keyof typeof STATUS_META)[]).map((s) => (
          <li key={s} className="flex items-center gap-1.5">
            <span className="h-2 w-3 rounded-sm" style={{ backgroundColor: STATUS_META[s].color }} aria-hidden="true" />
            {STATUS_META[s].label}
          </li>
        ))}
      </ul>

      <table className="sr-only">
        <caption>Hourly forecast</caption>
        <thead>
          <tr>
            <th scope="col">Hour</th>
            <th scope="col">Carbon (g/kWh)</th>
            <th scope="col">Renewable %</th>
            <th scope="col">Recommended action</th>
          </tr>
        </thead>
        <tbody>
          {points.map((p) => (
            <tr key={p.hour}>
              <td>{formatHour(p.hour)}</td>
              <td>{Math.round(p.carbon_intensity)}</td>
              <td>{Math.round(p.renewable_pct)}</td>
              <td>{STATUS_META[p.recommended_action].label}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
