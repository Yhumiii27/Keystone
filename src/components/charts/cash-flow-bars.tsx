// CH-7 CashFlowBars — cash in vs cash out per month (docs/spec/02 CH-7; Cash flow template 2169–2174, logic 4519).
// Six `flex:1` columns in a 150px row: net label (10px, coloured), a 100px bar area with the two bars side by side
// (in = accent, out = neutral-600, heights in % of the scale from src/domain/portfolio-finance.ts `cashBars`), month
// label 10.5px neutral-400. Server-compatible; labels and tooltips are translated by the caller.
import type { CSSProperties } from 'react';
import { cx } from '@/components/ds/cx';
import s from './cash-flow-bars.module.css';

export interface CashFlowBar {
  /** Month label ("Oct", FR "oct."). */
  label: string;
  /** Bar heights in % of the bar area. */
  inPct: number;
  outPct: number;
  /** Net label above the bars ("+530k"). */
  net: string;
  /** Net label colour (CSS value). */
  netColor: string;
  /** Tooltips ("Cash in · €1.35M"). */
  inTitle?: string;
  outTitle?: string;
}

export interface CashFlowBarsProps {
  bars: CashFlowBar[];
  /** Accessible name of the chart (translated). */
  label?: string;
  className?: string;
}

export function CashFlowBars({ bars, label, className }: CashFlowBarsProps) {
  return (
    <div className={cx(s.chart, className)} role="group" aria-label={label}>
      {bars.map((b, i) => (
        <div key={i} className={s.col}>
          <span className={s.net} style={{ '--net-color': b.netColor } as CSSProperties}>
            {b.net}
          </span>
          <div className={s.bars}>
            <div className={cx(s.bar, s.in)} style={{ height: `${b.inPct}%` }} title={b.inTitle} />
            <div className={cx(s.bar, s.out)} style={{ height: `${b.outPct}%` }} title={b.outTitle} />
          </div>
          <span className={s.label}>{b.label}</span>
        </div>
      ))}
    </div>
  );
}
