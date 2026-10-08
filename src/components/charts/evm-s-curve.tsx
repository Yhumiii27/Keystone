// CH-1 EvmSCurve — Budget › Performance "Budget vs cost" chart (docs/spec/02 CH-1, docs/spec/04 §1.4 B1;
// template 311–330, logic 3816–3828). Fixed 760×290 geometry, scaled to the card width. Server-compatible
// (no hooks): the page passes the language and translator. Colours are Nocturne tokens (hex of the prototype
// in comments).
import type { Lang, T } from '@/i18n/translate';
import { money } from '@/lib/format';
import { DISBURSEMENT_WORD, type DisbursementPoint, type EvmSeries } from '@/domain/evm';

const W = 760;
const H = 290;
const L = 52;
const R = 16;
const T_ = 14;
const B = 30;
const fx = (n: number) => n.toFixed(1);

export interface EvmChartGeometry {
  ymax: number;
  gstep: number;
  /** Grid rows: value, line y, label y (y + 4). */
  grid: { v: number; y: string; ty: string }[];
  /** Month label x positions (centre of each month). */
  monthX: string[];
  pv: string;
  ev: string;
  ac: string;
  evArea: string;
  fc: string;
  bacY: string;
  bacLabelY: string;
  todayX: string;
  todayLabelX: string;
  eacX: string;
  eacY: string;
  eacLabelX: string;
  eacLabelY: string;
  steps: { x: string; y: string; point: DisbursementPoint }[];
}

/**
 * Geometry of the S-curve (prototype logic 3816–3828): `ymax = BAC × 1.17`, grid step = first of
 * [100, 200, 250, 500, 1000, 2000] with ymax/step ≤ 6.5; `x(m) = 52 + m/12 × 692`, `y(v) = 14 + (1 − v/ymax) × 246`;
 * value i plotted at the end of month i (series start at 0). Coordinates are `toFixed(1)` strings as in the prototype.
 */
export function evmChartGeometry({ pv, ev, ac, bac }: EvmSeries, eac: number, points: DisbursementPoint[]): EvmChartGeometry {
  const ymax = bac * 1.17;
  const gstep = [100, 200, 250, 500, 1000, 2000].find((s) => ymax / s <= 6.5) ?? 2000;
  const gridVals: number[] = [];
  for (let gv = 0; gv <= ymax; gv += gstep) gridVals.push(gv);
  const x = (m: number) => L + (m / 12) * (W - L - R);
  const y = (v: number) => T_ + (1 - v / ymax) * (H - T_ - B);
  const path = (a: number[]) =>
    'M' + [[0, 0], ...a.map((v, i) => [i + 1, v])].map(([m, v]) => fx(x(m)) + ' ' + fx(y(v))).join(' L');
  const evn = ev.length;
  const lastAc = ac[evn - 1] ?? 0;
  const evP = path(ev);
  return {
    ymax,
    gstep,
    grid: gridVals.map((v) => ({ v, y: fx(y(v)), ty: fx(y(v) + 4) })),
    monthX: Array.from({ length: 12 }, (_, i) => fx(x(i + 0.5))),
    pv: path(pv),
    ev: evP,
    ac: path(ac),
    evArea: `${evP} L${fx(x(evn))} ${fx(y(0))} Z`,
    fc: `M${fx(x(evn))} ${fx(y(lastAc))} L${fx(x(12))} ${fx(y(eac))}`,
    bacY: fx(y(bac)),
    bacLabelY: fx(y(bac) - 6),
    todayX: fx(x(evn)),
    todayLabelX: fx(x(evn) + 6),
    eacX: fx(x(12)),
    eacY: fx(y(eac)),
    eacLabelX: fx(x(12) - 10),
    eacLabelY: fx(y(eac) - 10),
    steps: points.map((p) => ({ x: fx(x(p.m + 1)), y: fx(y(pv[p.m])), point: p })),
  };
}

/** Grid label: `f(v)` with ".00" stripped (EN "€1M"; FR keeps "1,00 M€"), "0" for zero. */
export const gridLabel = (v: number, lang: Lang) => (v ? money(v, lang).replace('.00', '') : '0');

export interface EvmSCurveProps {
  series: EvmSeries;
  /** Estimate at completion (BAC / CPI). */
  eac: number;
  /** Disbursement steps of the commercial offer (`offerPoints`). */
  points: DisbursementPoint[];
  /** English month labels of the project (`chartMonths`, 12). */
  chartMonths: string[];
  lang: Lang;
  t: T;
}

const C = {
  grid: 'var(--color-neutral-900)', // #292b31
  axis: 'var(--color-neutral-500)', // #9397ab
  bac: 'var(--color-neutral-700)', // #595d6c
  bacText: 'var(--color-neutral-400)', // #b2b6ca
  today: 'var(--color-accent-700)', // #5d5294
  todayText: 'var(--color-accent-400)', // #b5abfc
  pv: 'var(--color-neutral-600)', // #75798c
  ev: 'var(--color-accent)', // #9184d9
  ac: 'var(--color-neutral-200)', // #e4e7f5
  bg: 'var(--color-bg)', // #161826
};

export function EvmSCurve({ series, eac, points, chartMonths, lang, t }: EvmSCurveProps) {
  const g = evmChartGeometry(series, eac, points);
  const f = (k: number) => money(k, lang);
  const text = (size: number, fill: string, anchor?: 'end' | 'middle') => ({ fill, fontSize: size, textAnchor: anchor });
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }} role="img" aria-label={t('Budget vs cost')}>
      <defs>
        <linearGradient id="evfill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" style={{ stopColor: C.ev, stopOpacity: 0.28 }} />
          <stop offset="1" style={{ stopColor: C.ev, stopOpacity: 0 }} />
        </linearGradient>
      </defs>
      {g.grid.map((r) => (
        <g key={r.v}>
          <line x1="52" x2="744" y1={r.y} y2={r.y} style={{ stroke: C.grid }} />
          <text x="44" y={r.ty} style={text(11, C.axis, 'end')}>
            {gridLabel(r.v, lang)}
          </text>
        </g>
      ))}
      {g.monthX.map((x, i) => (
        <text key={i} x={x} y="282" style={text(11, C.axis, 'middle')}>
          {t(chartMonths[i] ?? '')}
        </text>
      ))}
      <line x1="52" x2="744" y1={g.bacY} y2={g.bacY} style={{ stroke: C.bac, strokeDasharray: '2 4' }} />
      <text x="56" y={g.bacLabelY} style={text(11, C.bacText)}>
        {t('Budget at completion ·')} {f(series.bac)}
      </text>
      <line x1={g.todayX} x2={g.todayX} y1="10" y2="262" style={{ stroke: C.today }} />
      <text x={g.todayLabelX} y="22" style={text(11, C.todayText)}>
        {t('Today')}
      </text>
      <path d={g.evArea} fill="url(#evfill)" />
      <path d={g.pv} fill="none" style={{ stroke: C.pv, strokeWidth: 2, strokeDasharray: '5 4' }} />
      {g.steps.map((s, i) => (
        <circle key={i} cx={s.x} cy={s.y} r="3.5" style={{ fill: C.bg, stroke: C.axis, strokeWidth: 1.5 }}>
          {/* "{system} · deposit|delivery|acceptance {pct} % · {amount} · {month}", translated per segment */}
          <title>{`${t(s.point.sys)} · ${t(DISBURSEMENT_WORD[s.point.k])} ${s.point.pct} % · ${f(s.point.amt)} · ${t(chartMonths[s.point.m] ?? '')}`}</title>
        </circle>
      ))}
      <path d={g.ac} fill="none" style={{ stroke: C.ac, strokeWidth: 2 }} />
      <path d={g.fc} fill="none" style={{ stroke: C.ac, strokeWidth: 2, strokeDasharray: '1 4', strokeLinecap: 'round' }} />
      <path d={g.ev} fill="none" style={{ stroke: C.ev, strokeWidth: 2.5 }} />
      <circle cx={g.eacX} cy={g.eacY} r="4" style={{ fill: C.bg, stroke: C.ac, strokeWidth: 2 }} />
      <text x={g.eacLabelX} y={g.eacLabelY} style={text(11, C.ac, 'end')}>
        {t('EAC')} {f(eac)}
      </text>
    </svg>
  );
}
