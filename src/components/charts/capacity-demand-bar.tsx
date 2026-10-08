// Capacity what-if department bar (Portfolio › Capacity what-if, template 2124–2127, logic 4508): 8px neutral-900
// track, committed hours (neutral-600, radius 4 0 0 4) then the candidate project (accent, radius 0 4 4 0), capacity
// tick 2×14 neutral-200 at top −3px. Widths and tick position are whole % of max(capacity, total) × 1.1
// (`capacityBar` in src/domain/portfolio-finance.ts). Server-compatible.
import type { CSSProperties } from 'react';
import { cx } from '@/components/ds/cx';
import s from './capacity-demand-bar.module.css';

export interface CapacityDemandBarProps {
  committedPct: number;
  candidatePct: number;
  capacityPct: number;
  /** Accessible description (translated), e.g. "Engineering · 1586 / 960 h". */
  label?: string;
  className?: string;
}

export function CapacityDemandBar({ committedPct, candidatePct, capacityPct, label, className }: CapacityDemandBarProps) {
  return (
    <div className={cx(s.track, className)} role={label ? 'img' : undefined} aria-label={label}>
      <div className={s.committed} style={{ width: `${committedPct}%` }} />
      <div className={s.candidate} style={{ width: `${candidatePct}%` }} />
      <div className={s.tick} style={{ '--cap-left': `${capacityPct}%` } as CSSProperties} />
    </div>
  );
}
