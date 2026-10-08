// CH-8 Project Gantt — work packages, baseline vs forecast (docs/spec/02 CH-8, docs/spec/05 §1.4, template
// 497–538). Div grid with the prototype geometry: 230px name · 56px done · 64px slip · 13-month timeline;
// positions are percentages from `scheduleView()` (src/domain/schedule-gantt.ts, `pos(m) = pct(m/13)`).
// Server-compatible, no interaction (only native `title` tooltips on milestone diamonds). Labels arrive translated.
import { Lightning } from '@phosphor-icons/react/dist/ssr';
import { Legend, LegendItem } from '@/components/app/Legend';
import { cx } from '@/components/ds/cx';
import type { GanttTask, ScheduleMilestone } from '@/domain/schedule-gantt';
import s from './project-gantt.module.css';

export interface ProjectGanttLabels {
  workPackage: string;
  done: string;
  slip: string;
  milestones: string;
  today: string;
}

export interface ProjectGanttProps {
  /** 13 month labels (translated). */
  months: string[];
  /** Package rows; `name` translated by the caller. */
  tasks: GanttTask[];
  /** Milestone diamonds; `name` (tooltip) translated by the caller. */
  milestones: Pick<ScheduleMilestone, 'name' | 'bL' | 'fL' | 'done'>[];
  /** Today line position ("67.7%"). */
  todayL: string;
  /** Baseline bars and outline diamonds (app prop `showBaseline`, default true). */
  showBaseline?: boolean;
  labels: ProjectGanttLabels;
  className?: string;
}

export function ProjectGantt({ months, tasks, milestones, todayL, showBaseline = true, labels, className }: ProjectGanttProps) {
  const today = <div className={s.today} style={{ left: todayL }} aria-hidden />;
  return (
    <div className={cx(s.grid, className)}>
      <div className={s.row}>
        <div className={s.th}>{labels.workPackage}</div>
        <div className={cx(s.th, s.thRight)}>{labels.done}</div>
        <div className={cx(s.th, s.thSlip)}>{labels.slip}</div>
        <div className={s.months}>
          {months.map((m, i) => (
            <div key={i} className={s.month}>
              {m}
            </div>
          ))}
        </div>
      </div>
      {tasks.map((t, i) => (
        <div key={i} className={s.row}>
          <div className={s.nameCell}>
            <span className={s.name}>
              {t.name}
              {t.critical && <Lightning className={s.critIcon} aria-hidden />}
            </span>
            <span className={s.owner}>{t.owner}</span>
          </div>
          <div className={s.num}>{t.pctText}</div>
          <div className={cx(s.num, s.slip, t.slipAlert && s.slipAlert)}>{t.slipText}</div>
          <div className={cx(s.track, s.trackRow)}>
            {showBaseline && <div className={s.baseline} style={{ left: t.bL, width: t.bW }} />}
            <div className={cx(s.bar, t.critical && s.barCrit)} style={{ left: t.aL, width: t.aW }}>
              <div className={s.fill} style={{ width: t.pctText }} />
            </div>
            {today}
          </div>
        </div>
      ))}
      <div className={s.row}>
        <div className={s.msLabel}>{labels.milestones}</div>
        <div />
        <div />
        <div className={s.track}>
          {milestones.map((m, i) => (
            <MilestoneMarks key={i} m={m} showBaseline={showBaseline} />
          ))}
          {today}
          <div className={s.todayChip} style={{ left: todayL }}>
            {labels.today}
          </div>
        </div>
      </div>
    </div>
  );
}

function MilestoneMarks({ m, showBaseline }: { m: ProjectGanttProps['milestones'][number]; showBaseline: boolean }) {
  return (
    <>
      {showBaseline && <div className={s.msBase} style={{ left: m.bL }} />}
      <div title={m.name} className={cx(s.msForecast, m.done && s.msDone)} style={{ left: m.fL }} />
    </>
  );
}

export interface ProjectGanttLegendProps {
  /** Translated "Critical path", "Task", "Baseline", "Milestone". */
  labels: { critical: string; task: string; baseline: string; milestone: string };
}

/** Header legend of the Gantt card (template 499–504): swatch colours differ slightly from the bars, as in the prototype. */
export function ProjectGanttLegend({ labels }: ProjectGanttLegendProps) {
  return (
    <Legend>
      <LegendItem kind="bar" color="var(--color-accent-800)" edge="var(--color-accent)">
        {labels.critical}
      </LegendItem>
      <LegendItem kind="bar" color="var(--color-neutral-800)" edge="var(--color-neutral-600)">
        {labels.task}
      </LegendItem>
      <LegendItem kind="bar" color="var(--color-neutral-600)" height={4}>
        {labels.baseline}
      </LegendItem>
      <LegendItem kind="diamond" color="var(--color-accent)">
        {labels.milestone}
      </LegendItem>
    </Legend>
  );
}
