// KPI tiles and grid (docs/spec/02 C-04) + variants TrendKpiCard and ReconStep. Server-compatible.
import Link from 'next/link';
import { ArrowRight } from '@phosphor-icons/react/dist/ssr';
import type { Icon } from '@phosphor-icons/react';
import type { CSSProperties, ReactNode } from 'react';
import { cx } from '@/components/ds/cx';
import { Sparkline } from '@/components/charts/primitives/Sparkline';
import { LO } from './tones';
import s from './Kpi.module.css';

export interface KpiGridProps {
  /** Column min width: 140 (Budget), 150 (default), 160 (Overview, My projects…), 170 (Home), 190 (trend cards). */
  min?: number;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}

/** `display:grid; grid-template-columns:repeat(auto-fit,minmax({min}px,1fr)); gap:10px`. */
export function KpiGrid({ min = 150, className, style, children }: KpiGridProps) {
  return (
    <div className={cx(s.grid, className)} style={{ '--kpi-min': `${min}px`, ...style } as CSSProperties}>
      {children}
    </div>
  );
}

export interface KpiTileProps {
  /** Uppercase label (translated). */
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  /** `alert` = value in LO (accent-300). Ignored when `color` is given. */
  tone?: 'default' | 'alert';
  /** Data-driven value colour (`LO` / `OK` from tones), as the prototype's `k.color`. */
  color?: string;
  /** Icon before the sub-line (Overview tiles). */
  icon?: Icon;
  /** `lg` = 24px value + 12px sub (Home, Overview); `md` = 22px + 11.5px. */
  size?: 'md' | 'lg';
  className?: string;
}

/** `.card.elev-sm` gap 3px · padding 12px 14px: label / value / sub. */
export function KpiTile({ label, value, sub, tone = 'default', color, icon: I, size = 'md', className }: KpiTileProps) {
  const c = color ?? (tone === 'alert' ? LO : undefined);
  return (
    <div className={cx('card', 'elev-sm', s.tile, size === 'lg' && s.lg, className)} style={c ? ({ '--kpi-color': c } as CSSProperties) : undefined}>
      <div className={s.label}>{label}</div>
      <div className={s.value}>{value}</div>
      {(sub != null || I) && (
        <div className={cx(s.sub, I && s.subIcon)}>
          {I && <I aria-hidden />}
          {sub}
        </div>
      )}
    </div>
  );
}

export interface TrendKpiCardProps {
  label: ReactNode;
  /** Target text on the right of the label (not uppercased). */
  target?: ReactNode;
  value: ReactNode;
  /** Weekly snapshot values for the 120×32 sparkline. */
  series: number[];
  /** Delta line, e.g. "+0.03 · 4 wk". */
  delta?: ReactNode;
  /** Delta is a deterioration → LO colour (else neutral-300). */
  worse?: boolean;
  selected?: boolean;
  /** Selection via URL (`?kpi=`). */
  href?: string;
  /** Selection handler (Client Components only). */
  onClick?: () => void;
  className?: string;
}

/** Selectable trend card (Trends): selected = accent-900 ground + inset accent-700 ring; idle = surface, no ring. */
export function TrendKpiCard({ label, target, value, series, delta, worse, selected, href, onClick, className }: TrendKpiCardProps) {
  const cls = cx('card', 'elev-sm', s.trend, selected && s.trendOn, className);
  const inner = (
    <>
      <div className={s.trendHead}>
        <span>{label}</span>
        {target != null && <span className={s.trendTarget}>{target}</span>}
      </div>
      <div className={s.trendRow}>
        <span className={s.trendValue}>{value}</span>
        <Sparkline values={series} className={s.trendSpark} />
      </div>
      {delta != null && <div className={cx(s.trendDelta, worse && s.worse)}>{delta}</div>}
    </>
  );
  return href ? (
    <Link href={href} className={cls} aria-current={selected ? 'true' : undefined} scroll={false}>
      {inner}
    </Link>
  ) : (
    <button type="button" className={cls} onClick={onClick} aria-pressed={selected}>
      {inner}
    </button>
  );
}

export interface ReconStepProps {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  /** Value colour (LO/OK). */
  color?: string;
  /** Highlighted step: accent-900 ground + inset accent-700 ring (else neutral-900). */
  highlight?: boolean;
  /** Trailing `ArrowRight` (neutral-600) towards the next step. */
  arrow?: boolean;
}

/** Budget reconciliation step tile (Budget › Setup): eyebrow, 20px value, sub. */
export function ReconStep({ label, value, sub, color, highlight, arrow }: ReconStepProps) {
  return (
    <div className={s.reconWrap}>
      <div className={cx(s.recon, highlight && s.reconOn)} style={color ? ({ '--kpi-color': color } as CSSProperties) : undefined}>
        <span className={s.label}>{label}</span>
        <span className={s.reconValue}>{value}</span>
        {sub != null && <span className={s.sub}>{sub}</span>}
      </div>
      {arrow && <ArrowRight className={s.reconArrow} aria-hidden />}
    </div>
  );
}
