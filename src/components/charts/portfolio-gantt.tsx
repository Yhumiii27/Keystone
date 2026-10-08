// CH-9 Portfolio Gantt — projects in progress & pipeline (docs/spec/02 CH-9, docs/spec/05 §3.3–3.4, template
// 979–1020). Div grid with the prototype geometry: 240px project · 172px status · 170px next decision / finish ·
// 24-month timeline (Jan 2026 – Dec 2027); positions are percentages from `pgRow()` (src/domain/pfplan.ts).
// Server-compatible: rows link to their target (Plan or Projects register), segments carry native `title` tooltips.
// Labels and titles arrive translated.
import Link from 'next/link';
import type { CSSProperties } from 'react';
import { GroupDivider } from '@/components/app/Eyebrow';
import { Tag } from '@/components/ds/Tag';
import { cx } from '@/components/ds/cx';
import type { PgSegment, PgTint, PgTone } from '@/domain/pfplan';
import s from './portfolio-gantt.module.css';

export interface PortfolioGanttRow {
  key: string;
  /** "#026 · Harbor Line Terminal Expansion" (translated). */
  name: string;
  /** "R. Aubert · Port authority" (translated). */
  sub: string;
  href: string;
  /** Lifecycle label (translated) and tag tone. */
  status: string;
  tone: PgTone;
  /** Next decision / forecast finish and its sub-line (translated). */
  gate: string;
  gateSub: string;
  gateTint: PgTint;
  /** Segments with translated `title` / `label`. */
  segments: PgSegment[];
  exec: { left: string; width: string; fill: string; ifApproved: boolean } | null;
  baseline: { left: string; width: string } | null;
  /** "→ août 2028" or ''. */
  clipText: string;
}

export interface PortfolioGanttGroup {
  key: string;
  /** Translated group label ("In progress" / "Pipeline"). */
  label: string;
  count: number;
  rows: PortfolioGanttRow[];
}

export interface PortfolioGanttLabels {
  project: string;
  status: string;
  /** "Next decision / Finish". */
  gate: string;
}

export interface PortfolioGanttProps {
  /** 24 month headers: translated label, year on January. */
  months: { label: string; year: string; yearStart: boolean }[];
  groups: PortfolioGanttGroup[];
  /** Today line position ("37.38%"). */
  todayL: string;
  labels: PortfolioGanttLabels;
  className?: string;
}

const pos = (left: string, width?: string): CSSProperties => (width === undefined ? { left } : { left, width });

function Segment({ seg }: { seg: PgSegment }) {
  if (seg.kind === 'diamond')
    return <div title={seg.title} className={cx(s.diamond, s[`d_${seg.state}`])} style={pos(seg.left)} />;
  if (seg.kind === 'board')
    return <div title={seg.title} className={cx(s.seg, s.board, seg.state === 'pending' && s.boardPending)} style={pos(seg.left, seg.width)} />;
  return (
    <div title={seg.title} className={cx(s.seg, s.stage, seg.done && s.stageDone)} style={pos(seg.left, seg.width)}>
      {seg.label}
    </div>
  );
}

export function PortfolioGantt({ months, groups, todayL, labels, className }: PortfolioGanttProps) {
  return (
    <div className={cx(s.grid, className)}>
      <div className={s.contents}>
        <div className={s.th}>{labels.project}</div>
        <div className={s.th}>{labels.status}</div>
        <div className={cx(s.th, s.thGate)}>{labels.gate}</div>
        <div className={s.months}>
          {months.map((m, i) => (
            <div key={i} className={cx(s.month, m.yearStart && s.monthYear)}>
              <span className={s.year}>{m.year}</span>
              <span className={s.monthLabel}>{m.label}</span>
            </div>
          ))}
        </div>
      </div>
      {groups.map((g) => (
        <div key={g.key} className={s.contents}>
          <GroupDivider fullRow label={g.label} count={g.count} />
          {g.rows.map((r) => (
            <div key={r.key} className={s.contents}>
              <Link href={r.href} className={s.name}>
                <span className={s.nameText}>{r.name}</span>
                <span className={s.nameSub}>{r.sub}</span>
              </Link>
              <div className={s.statusCell}>
                <Tag tone={r.tone} size="sm">
                  {r.status}
                </Tag>
              </div>
              <div className={s.gateCell}>
                <span className={s.gate}>{r.gate}</span>
                <span className={cx(s.gateSub, r.gateTint === 'lo' && s.gateLo)}>{r.gateSub}</span>
              </div>
              <div className={s.track}>
                {r.segments.map((seg, i) => (
                  <Segment key={i} seg={seg} />
                ))}
                {r.baseline && <div className={s.baseline} style={pos(r.baseline.left, r.baseline.width)} />}
                {r.exec && (
                  <div className={cx(s.exec, r.exec.ifApproved && s.execIfApproved)} style={pos(r.exec.left, r.exec.width)}>
                    <div className={s.execFill} style={{ width: r.exec.fill }} />
                  </div>
                )}
                {r.clipText && <span className={s.clip}>{r.clipText}</span>}
                <div className={s.today} style={{ left: todayL }} aria-hidden />
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

export interface PortfolioGanttLegendLabels {
  inProgress: string;
  pipeline: string;
  decisionPending: string;
  groupBoard: string;
  ifApproved: string;
  baselineFinish: string;
}

/** Legend of the card header (template 979–986): 11.5px neutral-400, gap 14, 18×8 swatches. */
export function PortfolioGanttLegend({ labels }: { labels: PortfolioGanttLegendLabels }) {
  return (
    <div className={s.legend}>
      <span className={s.legendItem}>
        <span className={cx(s.sw, s.swExec)} aria-hidden />
        {labels.inProgress}
      </span>
      <span className={s.legendItem}>
        <span className={cx(s.sw, s.swPipe)} aria-hidden />
        {labels.pipeline}
      </span>
      <span className={s.legendItem}>
        <span className={cx(s.sw, s.swBoard)} aria-hidden />
        {labels.decisionPending}
      </span>
      <span className={s.legendItem}>
        <span className={s.swDiamond} aria-hidden />
        {labels.groupBoard}
      </span>
      <span className={s.legendItem}>
        <span className={cx(s.sw, s.swIfApproved)} aria-hidden />
        {labels.ifApproved}
      </span>
      <span className={s.legendItem}>
        <span className={s.swBaseline} aria-hidden />
        {labels.baselineFinish}
      </span>
    </div>
  );
}
