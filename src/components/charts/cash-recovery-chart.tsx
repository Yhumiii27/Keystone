// CH-2 CashRecoveryChart — Budget › Cash & recovery (docs/spec/02 CH-2, docs/spec/04 §1.6; template 461–471,
// logic 4914–4921). Fixed 760×290 geometry with a 560px min-width (the card scrolls horizontally).
// Server-compatible (no hooks). Colours are Nocturne tokens (prototype hex in comments).
import type { Lang, T } from '@/i18n/translate';
import { money } from '@/lib/format';
import { RECOVERY_MONTHS, type CashRecovery } from '@/domain/evm';
import { gridLabel } from './evm-s-curve';

const W = 760;
const H = 290;
const L = 52;
const R = 16;
const T_ = 14;
const B = 30;
const fx = (n: number) => n.toFixed(1);

export interface CashChartGeometry {
  rcMax: number;
  step: number;
  grid: { v: number; y: string; ty: string }[];
  monthX: string[];
  /** Receipts step path (vertical jump at the start of the month of receipt). */
  rec: string;
  /** Committed to date (solid) and forecast (dotted). */
  com: string;
  comF: string;
  todayX: string;
  todayLabelX: string;
  gapY1: string;
  gapY2: string;
  gapLabelY: string;
  lowX: string;
  lowY: string;
}

/**
 * `rcMax = max(contract value, …cumCom) × 1.08`; grid step = first of [200, 250, 500, 1000, 2000] with
 * rcMax/step ≤ 6.5; `rcX(m) = 52 + m/15 × 692`, `rcY(v) = 14 + (1 − v/rcMax) × 246`.
 */
export function cashChartGeometry(rc: CashRecovery, contractTotal: number): CashChartGeometry {
  const RCN = rc.months;
  const evn = rc.todayM + 1;
  const rcMax = Math.max(contractTotal, ...rc.cumCom) * 1.08;
  const y = (v: number) => T_ + (1 - v / rcMax) * (H - T_ - B);
  const x = (m: number) => L + (m / RCN) * (W - L - R);
  const step = [200, 250, 500, 1000, 2000].find((s) => rcMax / s <= 6.5) ?? 2000;
  const gridVals: number[] = [];
  for (let gv = 0; gv <= rcMax; gv += step) gridVals.push(gv);
  let rec = 'M' + fx(x(0)) + ' ' + fx(y(0));
  rc.cumRec.forEach((v, i) => {
    rec += ' L' + fx(x(i)) + ' ' + fx(y(i ? rc.cumRec[i - 1] : 0)) + ' L' + fx(x(i)) + ' ' + fx(y(v)) + ' L' + fx(x(i + 1)) + ' ' + fx(y(v));
  });
  const line = (a: number[]) => 'M' + [[0, 0], ...a.map((v, i) => [i + 1, v])].map(([m, v]) => fx(x(m)) + ' ' + fx(y(v))).join(' L');
  const comNow = rc.cumCom[rc.todayM];
  const recNow = rc.cumRec[rc.todayM];
  return {
    rcMax,
    step,
    grid: gridVals.map((v) => ({ v, y: fx(y(v)), ty: fx(y(v) + 4) })),
    monthX: Array.from({ length: RCN }, (_, i) => fx(x(i + 0.5))),
    rec,
    com: line(rc.cumCom.slice(0, evn)),
    comF: 'M' + fx(x(evn)) + ' ' + fx(y(comNow)) + rc.cumCom.slice(evn).map((v, i) => ' L' + fx(x(evn + i + 1)) + ' ' + fx(y(v))).join(''),
    todayX: fx(x(evn)),
    todayLabelX: fx(x(evn) + 6),
    gapY1: fx(y(comNow)),
    gapY2: fx(y(recNow)),
    gapLabelY: fx((y(comNow) + y(recNow)) / 2 + 4),
    lowX: fx(x(rc.lowI + 1)),
    lowY: fx(y(rc.cumRec[rc.lowI])),
  };
}

export interface CashRecoveryChartProps {
  recovery: CashRecovery;
  contractTotal: number;
  lang: Lang;
  t: T;
}

const C = {
  grid: 'var(--color-neutral-900)', // #292b31
  axis: 'var(--color-neutral-500)', // #9397ab
  today: 'var(--color-accent-700)', // #5d5294
  todayText: 'var(--color-accent-400)', // #b5abfc
  com: 'var(--color-neutral-200)', // #e4e7f5
  rec: 'var(--color-accent)', // #9184d9
  bg: 'var(--color-bg)', // #161826
};

export function CashRecoveryChart({ recovery, contractTotal, lang, t }: CashRecoveryChartProps) {
  const g = cashChartGeometry(recovery, contractTotal);
  const text = (size: number, fill: string, anchor?: 'end' | 'middle') => ({ fill, fontSize: size, textAnchor: anchor });
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', minWidth: 560, height: 'auto', display: 'block' }} role="img" aria-label={t('Cash recovery')}>
      {g.grid.map((r) => (
        <g key={r.v}>
          <line x1="52" x2="744" y1={r.y} y2={r.y} style={{ stroke: C.grid }} />
          <text x="44" y={r.ty} style={text(11, C.axis, 'end')}>
            {gridLabel(r.v, lang)}
          </text>
        </g>
      ))}
      {g.monthX.map((x, i) => (
        <text key={i} x={x} y="282" style={text(10.5, C.axis, 'middle')}>
          {t(RECOVERY_MONTHS[i].replace(' ’27', '’27'))}
        </text>
      ))}
      <line x1={g.todayX} x2={g.todayX} y1="10" y2="262" style={{ stroke: C.today }} />
      <text x={g.todayLabelX} y="22" style={text(11, C.todayText)}>
        {t('Today')}
      </text>
      <path d={g.com} fill="none" style={{ stroke: C.com, strokeWidth: 2 }} />
      <path d={g.comF} fill="none" style={{ stroke: C.com, strokeWidth: 2, strokeDasharray: '1 4', strokeLinecap: 'round' }} />
      <path d={g.rec} fill="none" style={{ stroke: C.rec, strokeWidth: 2.5 }} />
      <line x1={g.todayX} x2={g.todayX} y1={g.gapY1} y2={g.gapY2} style={{ stroke: C.todayText, strokeWidth: 3, strokeLinecap: 'round', opacity: 0.6 }} />
      <text x={g.todayLabelX} y={g.gapLabelY} style={text(11, C.todayText)}>
        {money(recovery.recNow, lang, { signed: true })}
      </text>
      <circle cx={g.lowX} cy={g.lowY} r="4" style={{ fill: C.bg, stroke: C.rec, strokeWidth: 2 }}>
        <title>{t('Lowest point')}</title>
      </circle>
    </svg>
  );
}
