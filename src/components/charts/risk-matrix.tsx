// CH-11 RiskMatrix — 5×5 probability × impact heat map (docs/spec/02 CH-11, 07 §2.1; template 1801–1812).
// CSS grid (not SVG): `18px repeat(5,1fr)`, gap 4; rows impact 5 → 1, columns probability 1 → 5; each cell lists
// the ids of the open risks at that (P, I). Cell colour by band of p × i (rCell 4576): ≥ 15 accent-500, ≥ 8
// accent-700, ≥ 4 accent-900, else neutral-900; text accent-100 from 8 up. Legend: Critical ≥ 15, High ≥ 8,
// Medium ≥ 4 (Low has none). Server-compatible; labels are passed translated.
import { cx } from '@/components/ds/cx';
import s from './risk-matrix.module.css';

export type RiskBand = 'critical' | 'high' | 'medium' | 'low';

export interface RiskMatrixProps {
  /** Impact rows top → bottom (5 … 1). */
  rows: { i: number; cells: { p: number; level: RiskBand; ids: string }[] }[];
  /** Translated legend labels: "Critical ≥ 15", "High ≥ 8", "Medium ≥ 4". */
  legend: { critical: string; high: string; medium: string };
  /** Accessible name of the grid (translated), e.g. "Heat map — open risks". */
  label?: string;
  className?: string;
}

export function RiskMatrix({ rows, legend, label, className }: RiskMatrixProps) {
  const cols = rows[0]?.cells.map((c) => c.p) ?? [1, 2, 3, 4, 5];
  return (
    <>
      <div className={cx(s.grid, className)} role="table" aria-label={label}>
        {rows.map((row) => (
          <div key={row.i} className={s.row} role="row">
            <div className={s.axis} role="rowheader">
              {row.i}
            </div>
            {row.cells.map((c) => (
              <div key={c.p} role="cell" className={cx(s.cell, s[c.level])} title={`P${c.p} × I${row.i} = ${c.p * row.i}`}>
                {c.ids}
              </div>
            ))}
          </div>
        ))}
        <div className={s.row} role="row">
          <div role="presentation" />
          {cols.map((p) => (
            <div key={p} className={s.axisX} role="columnheader">
              {p}
            </div>
          ))}
        </div>
      </div>
      <div className={s.legend}>
        <span className={s.item}>
          <span className={cx(s.swatch, s.critical)} aria-hidden />
          {legend.critical}
        </span>
        <span className={s.item}>
          <span className={cx(s.swatch, s.high)} aria-hidden />
          {legend.high}
        </span>
        <span className={s.item}>
          <span className={cx(s.swatch, s.medium)} aria-hidden />
          {legend.medium}
        </span>
      </div>
    </>
  );
}
