// CH-5 ColumnPairChart — planned vs actual cumulative columns per month (docs/spec/02 CH-5).
// `schedule` variant: 12-column grid, 170px, SPI label on top (Schedule progression, template 546–556).
// `client` variant: flex row, 150px, no SPI label (Client portal "Progress to date", template ~2188).
// Heights are percentages from `scheduleProgression()` (src/domain/schedule-gantt.ts). Server-compatible; labels translated.
import type { CSSProperties } from 'react';
import { cx } from '@/components/ds/cx';
import s from './column-pair-chart.module.css';

export interface ColumnPair {
  /** Month label (translated). */
  label: string;
  /** Planned / actual bar heights ("71.3%"). */
  planH: string;
  actH: string;
  /** "0.90", '' for future months (schedule variant only). */
  spiText?: string;
  /** SPI label in the attention colour. */
  spiAlert?: boolean;
}

export interface ColumnPairChartProps {
  columns: ColumnPair[];
  variant?: 'schedule' | 'client';
  className?: string;
}

export function ColumnPairChart({ columns, variant = 'schedule', className }: ColumnPairChartProps) {
  const schedule = variant === 'schedule';
  return (
    <div
      className={cx(schedule ? s.grid : s.flex, className)}
      style={schedule && columns.length !== 12 ? ({ '--cp-cols': columns.length } as CSSProperties) : undefined}
    >
      {columns.map((p, i) => (
        <div key={i} className={s.col}>
          {schedule && <span className={cx(s.spi, p.spiAlert && s.spiAlert)}>{p.spiText}</span>}
          <div className={s.bars}>
            <div className={cx(s.bar, s.planned)} style={{ height: p.planH }} />
            <div className={cx(s.bar, s.actual)} style={{ height: p.actH }} />
          </div>
          <span className={s.label}>{p.label}</span>
        </div>
      ))}
    </div>
  );
}
