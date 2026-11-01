'use client';
// My work body (docs/spec/10 §6.4 c–f): KPI tiles and the List / Board / Calendar views of the person's tasks.
// Client island so the list's done toggle and the board's status moves update the groups, the KPIs and the other views
// optimistically (useOptimistic), then reconcile with the server after the Server Function revalidates the page.
// R-150 (R-8c a — a deliberate departure from spec 10 §6.4 "No drag-and-drop"): on the Board, whoever may edit the tasks (the
// assignee, or the portfolio director viewing someone's work, R-9 b) drags a card to another column, or uses its "Move to…"
// menu (keyboard and touch path, tablet-sized rows); the status changes with the same coupling as the task sheet (done ⇒
// 100 %), a toast confirms, the focus comes back to the moved card. Read-only boards keep plain link cards.
import { ArrowFatUp, ArrowsClockwise, ArrowsLeftRight, CaretLeft, CaretRight, CheckSquare, Clock } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useOptimistic, useRef, useState, useTransition, type CSSProperties, type DragEvent, type MouseEvent } from 'react';
import { CheckCircle } from '@/components/app/Check';
import { EmptyState } from '@/components/app/EmptyState';
import { KpiGrid, KpiTile } from '@/components/app/Kpi';
import { LO, OK } from '@/components/app/tones';
import { CardTitle } from '@/components/ds/Card';
import { MenuHeader, MenuItem } from '@/components/ds/Menu';
import { Popover } from '@/components/ds/Popover';
import { cx } from '@/components/ds/cx';
import { useToast } from '@/components/ds/Toast';
import {
  TASK_STATUS_LABEL, WORK_GROUP_LABEL, boardColumns, calendarBars, calendarDays, calendarStart, dueText, dueTone, hoursCellText, hoursText, nextWeekEnd,
  plannedHours, spanText, todayColumn, workGroups, workKpis, type TaskStatus, type WorkGroupKey,
} from '@/domain/tasks';
import { weekHoursOf } from '@/domain/kpis';
import { loggedOfText } from '@/features/kpis/i18n';
import { useI18n } from '@/i18n/client';
import { dayLabel, pct } from '@/lib/format';
import { useTodayOffset } from '@/components/app/clock';
import { setTaskStatusAction, toggleTaskDoneAction } from './actions';
import { TASK_DRAG_TYPE, acceptsDrag, applyWorkOp, isMove, moveTargets, type WorkOp } from './board-move';
import { taskCountText } from './i18n';
import type { WorkItemData } from './model';
import s from './mywork.module.css';

export type WorkView = 'list' | 'board' | 'calendar';

export interface MyWorkBodyProps {
  items: WorkItemData[];
  /** Weekly loads of the person (resource pool); null outside the pool. */
  loads: number[] | null;
  /**
   * A-12 (10 OQ18): hours of this week's time entries and the mean pool load of the two weeks after the data date
   * (src/server/dal/kpis.ts); absent → the prototype's formulas (`workKpis`).
   */
  measured?: { loggedH: number; load: number | null };
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

export function MyWorkBody({ items, loads, measured, view, week, calendarHrefs, canEdit }: MyWorkBodyProps) {
  const { t, lang } = useI18n();
  const toast = useToast();
  const [, startTransition] = useTransition();
  const [tasks, apply] = useOptimistic(items, (cur: WorkItemData[], op: WorkOp) => applyWorkOp(cur, op));
  /** R-150: the card to focus once it re-rendered in its new column (keyed by task id, not by DOM node). */
  const focusId = useRef<string | null>(null);
  useEffect(() => {
    if (!focusId.current) return;
    const el = document.querySelector<HTMLElement>(`[data-task-card="${CSS.escape(focusId.current)}"] a`);
    if (!el) return;
    el.focus();
    focusId.current = null;
  }, [tasks]);

  const toggle = (id: string) =>
    startTransition(async () => {
      apply({ kind: 'toggle', id });
      const r = await toggleTaskDoneAction({ taskId: id });
      if (!r.ok) toast.showEn(r.error);
    });

  /** R-150: board move (drop or "Move to…"); an unchanged status does nothing; errors roll back with the revalidation. */
  const move = (id: string, status: TaskStatus) => {
    if (!isMove(tasks, id, status)) return;
    focusId.current = id;
    startTransition(async () => {
      apply({ kind: 'status', id, status });
      const r = await setTaskStatusAction({ taskId: id, status });
      if (!r.ok) toast.showEn(r.error);
      else toast.show(`${t('Moved to')} ${t(TASK_STATUS_LABEL[status])}`);
    });
  };

  const today = useTodayOffset();
  const base = workKpis(tasks, loads, today);
  const k = measured
    ? { ...base, loggedH: measured.loggedH, loggedPct: Math.round((measured.loggedH / weekHoursOf()) * 100), load: measured.load, overCapacity: measured.load != null && measured.load > 100 }
    : base;
  const nextStart = nextWeekEnd(today) - 4;
  return (
    <>
      <KpiGrid>
        <KpiTile label={t('Due today')} value={k.dueToday} sub={t(dayLabel(today))} color={OK} />
        <KpiTile label={t('Overdue')} value={k.overdue} sub={t('Needs a new date or a push')} color={k.overdue ? LO : OK} />
        <KpiTile label={t('Next week')} value={k.nextWeek} sub={t(spanText(nextStart, nextStart + 4))} color={OK} />
        <KpiTile label={t('Logged this week')} value={k.loggedH.toFixed(1) + ' h'} sub={loggedOfText(weekHoursOf(), k.loggedPct, lang)} color={OK} />
        <KpiTile
          label={t('Load next 2 wks')}
          value={k.load == null ? '—' : k.load + '%'}
          sub={t(k.load == null ? 'Not in the resource pool' : k.overCapacity ? 'Over capacity — rebalance' : 'Within capacity')}
          color={k.overCapacity ? LO : OK}
        />
      </KpiGrid>
      {view === 'list' && <WorkList items={tasks} onToggle={canEdit ? toggle : undefined} />}
      {view === 'board' && <WorkBoard items={tasks} onMove={canEdit ? move : undefined} />}
      {view === 'calendar' && <WorkCalendar items={tasks} week={week} hrefs={calendarHrefs} />}
    </>
  );
}

// ── List ─────────────────────────────────────────────────────────────────────────────────────────────

function WorkList({ items, onToggle }: { items: WorkItemData[]; onToggle?: (id: string) => void }) {
  const { t, lang } = useI18n();
  const groups = workGroups(items, useTodayOffset());
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
  const today = useTodayOffset();
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
          <RepeatMark item={x} />
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
        <span className={cx(s.due, s[`due_${dueTone(x, today)}`])}>{t(dueText(x, today))}</span>
      </div>
    </div>
  );
}

// ── Board ────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Board columns by status, cards by due date. `onMove` (the viewer may edit the tasks, R-150): cards drag between columns and
 * carry a "Move to…" menu; without it the board is read-only (plain link cards).
 */
function WorkBoard({ items, onMove }: { items: WorkItemData[]; onMove?: (id: string, status: TaskStatus) => void }) {
  const { t } = useI18n();
  const [over, setOver] = useState<TaskStatus | null>(null);
  const dropProps = (status: TaskStatus) =>
    onMove
      ? {
          onDragOver: (e: DragEvent<HTMLElement>) => {
            if (!acceptsDrag(e.dataTransfer.types)) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            if (over !== status) setOver(status);
          },
          onDragLeave: (e: DragEvent<HTMLElement>) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(null);
          },
          onDrop: (e: DragEvent<HTMLElement>) => {
            setOver(null);
            const id = e.dataTransfer.getData(TASK_DRAG_TYPE);
            if (!id) return;
            e.preventDefault();
            onMove(id, status);
          },
        }
      : {};
  return (
    <div className={s.board}>
      {boardColumns(items).map((c) => (
        <section key={c.status} className={cx(s.column, over === c.status && s.columnOver)} aria-label={t(TASK_STATUS_LABEL[c.status])} {...dropProps(c.status)}>
          <div className={s.columnHead}>
            <span className={s.dot} style={{ '--dot-color': DOT_COLOR[c.status] } as CSSProperties} />
            <span className={s.columnLabel}>{t(TASK_STATUS_LABEL[c.status])}</span>
            <span className={s.columnCount}>{c.items.length}</span>
          </div>
          {c.items.map((x) =>
            onMove ? (
              <MovableCard key={x.id} item={x} onMove={onMove} />
            ) : (
              <Link key={x.id} href={x.href} className={cx('card', s.boardCard)}>
                <span className={cx(s.cardTitle, x.status === 'done' && s.strike)}>
                  {x.title} <RepeatMark item={x} />
                </span>
                <BoardCardBody item={x} />
              </Link>
            ),
          )}
          {!c.items.length && <EmptyState variant="column">{t('Nothing here')}</EmptyState>}
        </section>
      ))}
    </div>
  );
}

/** Meta, foot and progress line of a board card. */
function BoardCardBody({ item: x }: { item: WorkItemData }) {
  const today = useTodayOffset();
  const { t } = useI18n();
  return (
    <>
      <div className={s.cardMeta}>
        <span className={cx('tag', 'tag-neutral', s.mini)}>{x.project}</span>
        {x.activity && <span>{x.activity}</span>}
      </div>
      <div className={s.cardFoot}>
        <span className={s[`due_${dueTone(x, today)}`]}>{t(dueText(x, today))}</span>
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
    </>
  );
}

/**
 * R-150: an editable board card — a draggable block (click opens the task, like the list rows) with its title link (not
 * draggable itself: no URL drag) and the "Move to…" menu listing the three other statuses.
 */
function MovableCard({ item: x, onMove }: { item: WorkItemData; onMove: (id: string, status: TaskStatus) => void }) {
  const { t } = useI18n();
  const router = useRouter();
  const open = (e: MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest(INTERACTIVE)) return;
    router.push(x.href);
  };
  return (
    <div
      className={cx('card', s.boardCard, s.movable)}
      data-task-card={x.id}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(TASK_DRAG_TYPE, x.id);
        e.dataTransfer.effectAllowed = 'move';
      }}
      onClick={open}
    >
      <div className={s.cardTop}>
        <Link href={x.href} draggable={false} className={cx(s.cardTitle, s.cardLink, x.status === 'done' && s.strike)}>
          {x.title}
        </Link>
        <RepeatMark item={x} />
        <Popover
          trigger={<ArrowsLeftRight aria-hidden />}
          triggerLabel={`${t('Move to…')} · ${x.id}`}
          triggerClassName={cx('btn', 'btn-icon', 'btn-ghost', s.moveBtn)}
          align="end"
          minWidth="200px"
        >
          <MenuHeader>{t('Move to')}</MenuHeader>
          {moveTargets(x.status).map((st) => (
            <MenuItem key={st} className={s.moveItem} onClick={() => onMove(x.id, st)}>
              {`${t('Move to')} ${t(TASK_STATUS_LABEL[st])}`}
            </MenuItem>
          ))}
        </Popover>
      </div>
      <BoardCardBody item={x} />
    </div>
  );
}

// ── Calendar ─────────────────────────────────────────────────────────────────────────────────────────

function WorkCalendar({ items, week, hrefs }: { items: WorkItemData[]; week: number; hrefs: { prev: string; next: string } }) {
  const { t } = useI18n();
  const today = useTodayOffset();
  const start = calendarStart(week, today);
  const days = calendarDays(start, today);
  const bars = calendarBars(items, start, today);
  const hours = plannedHours(items, start);
  const todayCol = todayColumn(start, today);
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
              <span className={s.calLabelTitle}>
                {b.task.title} <RepeatMark item={b.task} />
              </span>
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

/** R-201: the mark of a recurring task (list, board, calendar) — its rule in words on hover and for screen readers. */
function RepeatMark({ item }: { item: Pick<WorkItemData, 'repeat'> }) {
  const { t } = useI18n();
  if (!item.repeat) return null;
  const label = `${t('Recurring task')} · ${item.repeat}`;
  return (
    <span className={s.repeat} role="img" aria-label={label} title={label}>
      <ArrowsClockwise aria-hidden />
    </span>
  );
}
