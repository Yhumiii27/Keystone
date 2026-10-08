'use client';
// My work body (docs/spec/10 §6.4 c–f): KPI tiles and the List / Board / Calendar views of the person's tasks.
// Client island so the list's done toggle updates the groups, the KPIs and the other views optimistically
// (useOptimistic), then reconciles with the server after the Server Function revalidates the page.
import { ArrowFatUp, CaretLeft, CaretRight, CheckSquare, Clock } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useOptimistic, useTransition, type CSSProperties, type MouseEvent } from 'react';
import { CheckCircle } from '@/components/app/Check';
import { EmptyState } from '@/components/app/EmptyState';
import { KpiGrid, KpiTile } from '@/components/app/Kpi';
import { LO, OK } from '@/components/app/tones';
import { CardTitle } from '@/components/ds/Card';
import { cx } from '@/components/ds/cx';
import { useToast } from '@/components/ds/Toast';
import {
  TASK_STATUS_LABEL, WORK_GROUP_LABEL, boardColumns, calendarBars, calendarDays, calendarStart, dueText, dueTone, hoursCellText, hoursText,
  nextWeekEnd, plannedHours, spanText, toggleDone, todayColumn, workGroups, workKpis, type TaskStatus, type WorkGroupKey,
} from '@/domain/tasks';
import { useI18n } from '@/i18n/client';
import { TODAY, dayLabel, pct } from '@/lib/format';
import { toggleTaskDoneAction } from './actions';
import { loggedSubText, taskCountText } from './i18n';
import type { WorkItemData } from './model';
import s from './mywork.module.css';

export type WorkView = 'list' | 'board' | 'calendar';

export interface MyWorkBodyProps {
  items: WorkItemData[];
  /** Weekly loads of the person (resource pool); null outside the pool. */
  loads: number[] | null;
  view: WorkView;
  /** Calendar window offset in weeks (0 = 21 Sep – 2 Oct). */
  week: number;
  calendarHrefs: { prev: string; next: string };
  /** Done toggles allowed (assignee or director, inside the workspace). */
  canEdit: boolean;
}

const GROUP_COLOR: Record<WorkGroupKey, string> = {
  overdue: LO, today: 'var(--color-accent-300)', next: 'var(--color-neutral-400)', later: 'var(--color-neutral-400)', done: 'var(--color-neutral-400)',
};
const DOT_COLOR: Record<TaskStatus, string> = {
  todo: 'var(--color-neutral-400)', doing: 'var(--color-accent)', review: 'var(--color-accent)', done: 'var(--color-neutral-500)',
};
const INTERACTIVE = 'a, button, input, select, textarea, label';

export function MyWorkBody({ items, loads, view, week, calendarHrefs, canEdit }: MyWorkBodyProps) {
  const { t, lang } = useI18n();
  const toast = useToast();
  const [, startTransition] = useTransition();
  const [tasks, flip] = useOptimistic(items, (cur: WorkItemData[], id: string) => cur.map((x) => (x.id === id ? { ...x, ...toggleDone(x) } : x)));

  const toggle = (id: string) =>
    startTransition(async () => {
      flip(id);
      const r = await toggleTaskDoneAction({ taskId: id });
      if (!r.ok) toast.showEn(r.error);
    });

  const k = workKpis(tasks, loads);
  const nextStart = nextWeekEnd() - 4;
  return (
    <>
      <KpiGrid>
        <KpiTile label={t('Due today')} value={k.dueToday} sub={t(dayLabel(TODAY))} color={OK} />
        <KpiTile label={t('Overdue')} value={k.overdue} sub={t('Needs a new date or a push')} color={k.overdue ? LO : OK} />
        <KpiTile label={t('Next week')} value={k.nextWeek} sub={t(spanText(nextStart, nextStart + 4))} color={OK} />
        <KpiTile label={t('Logged this week')} value={k.loggedH.toFixed(1) + ' h'} sub={loggedSubText(k.loggedPct, lang)} color={OK} />
        <KpiTile
          label={t('Load next 2 wks')}
          value={k.load == null ? '—' : k.load + '%'}
          sub={t(k.load == null ? 'Not in the resource pool' : k.overCapacity ? 'Over capacity — rebalance' : 'Within capacity')}
          color={k.overCapacity ? LO : OK}
        />
      </KpiGrid>
      {view === 'list' && <WorkList items={tasks} onToggle={canEdit ? toggle : undefined} />}
      {view === 'board' && <WorkBoard items={tasks} />}
      {view === 'calendar' && <WorkCalendar items={tasks} week={week} hrefs={calendarHrefs} />}
    </>
  );
}

// ── List ─────────────────────────────────────────────────────────────────────────────────────────────

function WorkList({ items, onToggle }: { items: WorkItemData[]; onToggle?: (id: string) => void }) {
  const { t, lang } = useI18n();
  const groups = workGroups(items);
  if (!groups.length) return <EmptyState variant="boxed">{t('No tasks yet')}</EmptyState>;
  return (
    <div className={s.groups}>
      {groups.map((g) => (
        <section key={g.key} className={cx('card', 'elev-sm', s.group)} aria-label={t(WORK_GROUP_LABEL[g.key])}>
          <div className={s.groupHead}>
            <span className={s.groupLabel} style={{ '--group-color': GROUP_COLOR[g.key] } as CSSProperties}>
              {t(WORK_GROUP_LABEL[g.key])}
            </span>
            <span className={s.groupCount}>{taskCountText(g.items.length, lang)}</span>
          </div>
          {g.items.map((x) => (
            <TaskRowItem key={x.id} item={x} onToggle={onToggle} />
          ))}
        </section>
      ))}
    </div>
  );
}

function TaskRowItem({ item: x, onToggle }: { item: WorkItemData; onToggle?: (id: string) => void }) {
  const { t } = useI18n();
  const router = useRouter();
  const done = x.status === 'done';
  const open = (e: MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest(INTERACTIVE)) return;
    router.push(x.href);
  };
  return (
    <div className={s.row} onClick={open}>
      <span className={s.toggleSlot}>
        {onToggle ? <CheckCircle done={done} onToggle={() => onToggle(x.id)} label={t('Mark done')} /> : <CheckCircle done={done} />}
      </span>
      <div className={s.rowMain}>
        <span className={s.titleLine}>
          <Link href={x.href} className={cx(s.rowTitle, done && s.done)}>
            {x.title}
          </Link>
          {x.fresh && <span className={cx('tag', 'tag-accent', s.mini)}>{x.fresh}</span>}
        </span>
        <div className={s.meta}>
          <span className={cx('tag', 'tag-neutral', s.mini)}>{x.project}</span>
          {x.activity && <span>{x.activity}</span>}
          {x.labels.map((l) => (
            <span key={l} className={s.label}>
              #{l}
            </span>
          ))}
        </div>
      </div>
      <div className={s.right}>
        {x.priority === 'high' && (
          <span title={t('High priority')} className={s.iconText}>
            <ArrowFatUp className={s.high} aria-label={t('High priority')} />
          </span>
        )}
        <span className={s.iconText}>
          <CheckSquare aria-hidden />
          {x.checklist.done}/{x.checklist.total}
        </span>
        <span className={cx(s.iconText, s.num)}>
          <Clock aria-hidden />
          {hoursText(x.loggedH, x.estimateH)}
        </span>
        <span className={cx(s.due, s[`due_${dueTone(x)}`])}>{t(dueText(x))}</span>
      </div>
    </div>
  );
}

// ── Board ────────────────────────────────────────────────────────────────────────────────────────────

function WorkBoard({ items }: { items: WorkItemData[] }) {
  const { t } = useI18n();
  return (
    <div className={s.board}>
      {boardColumns(items).map((c) => (
        <section key={c.status} className={s.column} aria-label={t(TASK_STATUS_LABEL[c.status])}>
          <div className={s.columnHead}>
            <span className={s.dot} style={{ '--dot-color': DOT_COLOR[c.status] } as CSSProperties} />
            <span className={s.columnLabel}>{t(TASK_STATUS_LABEL[c.status])}</span>
            <span className={s.columnCount}>{c.items.length}</span>
          </div>
          {c.items.map((x) => (
            <Link key={x.id} href={x.href} className={cx('card', s.boardCard)}>
              <span className={cx(s.cardTitle, x.status === 'done' && s.strike)}>{x.title}</span>
              <div className={s.cardMeta}>
                <span className={cx('tag', 'tag-neutral', s.mini)}>{x.project}</span>
                {x.activity && <span>{x.activity}</span>}
              </div>
              <div className={s.cardFoot}>
                <span className={s[`due_${dueTone(x)}`]}>{t(dueText(x))}</span>
                <span className={s.iconText}>
                  <CheckSquare aria-hidden />
                  {x.checklist.done}/{x.checklist.total}
                </span>
                <span className={cx(s.iconText, s.push)}>
                  <Clock aria-hidden />
                  {hoursText(x.loggedH, x.estimateH)}
                </span>
              </div>
              <div className={s.thinTrack}>
                <div className={s.thinFill} style={{ '--w': `${x.pct}%` } as CSSProperties} />
              </div>
            </Link>
          ))}
          {!c.items.length && <EmptyState variant="column">{t('Nothing here')}</EmptyState>}
        </section>
      ))}
    </div>
  );
}

// ── Calendar ─────────────────────────────────────────────────────────────────────────────────────────

function WorkCalendar({ items, week, hrefs }: { items: WorkItemData[]; week: number; hrefs: { prev: string; next: string } }) {
  const { t } = useI18n();
  const start = calendarStart(week);
  const days = calendarDays(start);
  const bars = calendarBars(items, start);
  const hours = plannedHours(items, start);
  const todayCol = todayColumn(start);
  const band = todayCol == null ? null : ({ '--l': `${todayCol * 10}%` } as CSSProperties);
  return (
    <div className={cx('card', 'elev-sm', s.calCard)}>
      <div className={s.calHead}>
        <CardTitle push>{t(spanText(start, start + 9))}</CardTitle>
        <div className={s.calNav}>
          <Link href={hrefs.prev} className={cx('btn', 'btn-icon', 'btn-secondary', s.calBtn)} aria-label={t('Previous week')} title={t('Previous week')} scroll={false}>
            <CaretLeft aria-hidden />
          </Link>
          <Link href={hrefs.next} className={cx('btn', 'btn-icon', 'btn-secondary', s.calBtn)} aria-label={t('Following week')} title={t('Following week')} scroll={false}>
            <CaretRight aria-hidden />
          </Link>
        </div>
      </div>
      <div className={s.calGrid}>
        <div className={s.corner} />
        {days.map((d) => (
          <div key={d.offset} className={cx(s.dayHead, d.isToday && s.dayHeadToday)}>
            <span className={s.weekday}>{t(d.weekday)}</span>
            <span className={s.dayNum}>{d.day}</span>
          </div>
        ))}
        {bars.map((b) => (
          <div key={b.task.id} className={s.calRow}>
            <Link href={b.task.href} className={s.calLabel}>
              <span className={s.calLabelTitle}>{b.task.title}</span>
              <span className={s.calLabelSub}>
                {b.task.project} · {hoursText(b.task.loggedH, b.task.estimateH)}
              </span>
            </Link>
            <div className={s.track}>
              {band && <div className={s.todayBand} style={band} />}
              <Link
                href={b.task.href}
                className={cx(s.calBar, s[`bar_${b.tone}`])}
                style={{ '--l': pct(b.left), '--w': pct(b.width) } as CSSProperties}
                tabIndex={-1}
                aria-hidden
              >
                {b.task.title}
              </Link>
            </div>
          </div>
        ))}
        <div className={s.calRow}>
          <div className={s.hoursLabel}>{t('Planned hours')}</div>
          {hours.map((h, i) => (
            <div key={i} className={cx(s.hoursCell, h.over && s.hoursOver, i === todayCol && s.hoursToday)}>
              {hoursCellText(h.hours)}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
