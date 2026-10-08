'use client';
// Task detail (docs/spec/10 §7.4, template 2902–2969): header row (back, id, project, activity link, status
// segment), meta + description, checklist, files, comments, Progress & Time, plan position. One optimistic task
// state (useOptimistic) is shared through context by the body and the header's "Mark done" primary, so the status
// ⇄ % coupling, ticks, comments and time entries show at once and reconcile when the Server Function revalidates.
import {
  ArrowLeft, ArrowSquareOut, File, FileDoc, FilePdf, FileXls, Image as ImageIcon, Lightning, Paperclip, Plus, TreeStructure,
} from '@phosphor-icons/react/dist/ssr';
import type { Icon } from '@phosphor-icons/react';
import { createContext, useContext, useOptimistic, useState, useTransition, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import { Callout } from '@/components/app/Callout';
import { CheckRow, CheckSquare } from '@/components/app/Check';
import { KeyValueList } from '@/components/app/KeyValueList';
import { AttachmentRow, CommentRow, TimeEntryRow } from '@/components/app/Rows';
import { LO } from '@/components/app/tones';
import { Button, ButtonLink } from '@/components/ds/Button';
import { CardTitle } from '@/components/ds/Card';
import { Segmented } from '@/components/ds/Segmented';
import { useToast } from '@/components/ds/Toast';
import { cx } from '@/components/ds/cx';
import {
  PCT_STEPS, TASK_PRIORITY_LABEL, TASK_STATUSES, TASK_STATUS_LABEL, applyProgress, applyStatus, checklistCounts, checklistPct, floatText,
  hoursBar, isCritical, laborCost, parseHours, type TaskStatus,
} from '@/domain/tasks';
import { useI18n } from '@/i18n/client';
import { TODAY, dayLabel } from '@/lib/format';
import type { AttachmentKind } from '@/server/db/codes';
import {
  addChecklistItemAction, addTaskCommentAction, logTaskTimeAction, markTaskDoneAction, setTaskProgressAction, setTaskStatusAction,
  toggleChecklistItemAction, type TaskActionResult,
} from './actions';
import { checkCountText, costNoteText, daysText } from './i18n';
import type { TaskSheetData } from './model';
import s from './mywork.module.css';

// ── Optimistic task state ──────────────────────────────────────────────────────────────────────────────

interface LiveState {
  status: TaskStatus;
  pct: number;
  loggedH: number;
  checklist: TaskSheetData['checklist'];
  comments: TaskSheetData['comments'];
  entries: TaskSheetData['entries'];
}

type Op =
  | { kind: 'status'; status: TaskStatus }
  | { kind: 'pct'; pct: number }
  | { kind: 'check'; position: number }
  | { kind: 'addCheck'; text: string }
  | { kind: 'comment'; comment: TaskSheetData['comments'][number] }
  | { kind: 'log'; entry: TaskSheetData['entries'][number] };

function reduce(cur: LiveState, op: Op): LiveState {
  switch (op.kind) {
    case 'status':
      return { ...cur, ...applyStatus(cur, op.status) };
    case 'pct':
      return { ...cur, ...applyProgress(cur, op.pct) };
    case 'check':
      return { ...cur, checklist: cur.checklist.map((c) => (c.position === op.position ? { ...c, done: !c.done } : c)) };
    case 'addCheck': {
      const position = cur.checklist.reduce((m, c) => Math.max(m, c.position), -1) + 1;
      return { ...cur, checklist: [...cur.checklist, { position, text: op.text, done: false }] };
    }
    case 'comment':
      return { ...cur, comments: [...cur.comments, op.comment] };
    case 'log':
      return { ...cur, entries: [...cur.entries, op.entry], loggedH: cur.loggedH + op.entry.hours };
  }
}

interface TaskCtx {
  data: TaskSheetData;
  live: LiveState;
  canEdit: boolean;
  canComment: boolean;
  viewer: { name: string; initials: string };
  run: (op: Op, call: () => Promise<TaskActionResult>) => void;
}

const Ctx = createContext<TaskCtx | null>(null);

const useTask = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error('TaskProvider missing');
  return c;
};

export interface TaskProviderProps {
  data: TaskSheetData;
  /** Status, %, checklist and time (assignee or director, inside the workspace). */
  canEdit: boolean;
  /** Comments (inside the workspace). */
  canComment: boolean;
  viewer: { name: string; initials: string };
  children: ReactNode;
}

/** Wraps the page header and the body: one optimistic state for both. */
export function TaskProvider({ data, canEdit, canComment, viewer, children }: TaskProviderProps) {
  const toast = useToast();
  const [, startTransition] = useTransition();
  const base: LiveState = { status: data.status, pct: data.pct, loggedH: data.loggedH, checklist: data.checklist, comments: data.comments, entries: data.entries };
  const [live, apply] = useOptimistic(base, reduce);
  const run = (op: Op, call: () => Promise<TaskActionResult>) =>
    startTransition(async () => {
      apply(op);
      const r = await call();
      if (!r.ok) toast.showEn(r.error);
    });
  return <Ctx.Provider value={{ data, live, canEdit, canComment, viewer, run }}>{children}</Ctx.Provider>;
}

/** Header primary "Mark done" (hidden by the page when the viewer cannot edit; inert once done). */
export function MarkDoneButton() {
  const { t } = useI18n();
  const { data, live, run } = useTask();
  return (
    <Button
      variant="primary"
      icon={Plus}
      disabled={live.status === 'done'}
      onClick={() => run({ kind: 'status', status: 'done' }, () => markTaskDoneAction({ taskId: data.id }))}
    >
      {t('Mark done')}
    </Button>
  );
}

// ── Body ─────────────────────────────────────────────────────────────────────────────────────────────

const FILE_ICON: Record<AttachmentKind, Icon> = { xls: FileXls, image: ImageIcon, pdf: FilePdf, doc: FileDoc, other: File };

export function TaskBody() {
  const { t } = useI18n();
  const { data, live, canEdit, run } = useTask();
  return (
    <div className={s.page}>
      <div className={s.taskHead}>
        <ButtonLink variant="ghost" icon={ArrowLeft} href={data.backHref} className={s.back}>
          {t('My work')}
        </ButtonLink>
        <span className={s.taskId}>{data.id}</span>
        <span className="tag tag-neutral">{data.project}</span>
        {data.activity && (
          <ButtonLink variant="ghost" iconRight={ArrowSquareOut} href={data.activity.href} className={s.actLink}>
            {data.activity.label}
          </ButtonLink>
        )}
        {canEdit ? (
          <Segmented
            className={s.statusSeg}
            label={t('Status')}
            value={live.status}
            options={TASK_STATUSES.map((v) => ({ value: v, label: t(TASK_STATUS_LABEL[v]) }))}
            onChange={(v) => v !== live.status && run({ kind: 'status', status: v }, () => setTaskStatusAction({ taskId: data.id, status: v }))}
          />
        ) : (
          <span className={cx('tag', live.status === 'done' ? 'tag-neutral' : 'tag-outline', s.statusRead)}>{t(TASK_STATUS_LABEL[live.status])}</span>
        )}
      </div>
      <div className={s.taskGrid}>
        <div className={s.col}>
          <MetaCard />
          <ChecklistCard />
          <FilesCard />
          <CommentsCard />
        </div>
        <div className={s.col}>
          <ProgressCard />
          <PlanCard />
        </div>
      </div>
    </div>
  );
}

function MetaCard() {
  const { t } = useI18n();
  const { data, live } = useTask();
  const overdue = data.due < TODAY && live.status !== 'done';
  return (
    <div className={cx('card', 'elev-sm', s.sheet, s.gap10)}>
      <KeyValueList
        layout="inline"
        items={[
          { k: t('Assignee'), v: data.assignee },
          { k: t('Due'), v: t(dayLabel(data.due)), color: overdue ? LO : undefined },
          { k: t('Priority'), v: t(TASK_PRIORITY_LABEL[data.priority]), color: data.priority === 'high' ? 'var(--color-accent-300)' : undefined },
          { k: t('Estimate'), v: `${data.estimateH} h` },
          { k: t('Labels'), v: data.labels.map((l) => '#' + l).join('  ') },
        ]}
      />
      <p className={s.description}>{data.description}</p>
    </div>
  );
}

function ChecklistCard() {
  const { t, lang } = useI18n();
  const toast = useToast();
  const { data, live, canEdit, run } = useTask();
  const [text, setText] = useState('');
  const counts = checklistCounts(
    live.checklist.map((c) => c.done),
    data.storedChecklist,
  );
  const add = (e: FormEvent) => {
    e.preventDefault();
    const item = text.trim();
    if (!item) return;
    if (item.length > 200) return toast.showEn('Item is too long');
    setText('');
    run({ kind: 'addCheck', text: item }, () => addChecklistItemAction({ taskId: data.id, text: item }));
  };
  return (
    <div className={cx('card', 'elev-sm', s.sheet, s.gap6)}>
      <div className={s.cardHead}>
        <CardTitle compact push>
          {t('Checklist')}
        </CardTitle>
        <span className={s.headHint}>{checkCountText(counts.done, counts.total, lang)}</span>
      </div>
      <div className={s.track3}>
        <div className={s.fill3} style={{ '--w': `${checklistPct(counts)}%` } as CSSProperties} />
      </div>
      {live.checklist.map((c) =>
        canEdit ? (
          <CheckRow key={c.position} done={c.done} onToggle={() => run({ kind: 'check', position: c.position }, () => toggleChecklistItemAction({ taskId: data.id, position: c.position }))}>
            {c.text}
          </CheckRow>
        ) : (
          <div key={c.position} className={s.staticCheck}>
            <CheckSquare done={c.done} />
            <span className={cx(s.checkText, c.done && s.checkDone)}>{c.text}</span>
          </div>
        ),
      )}
      {!live.checklist.length && <span className={s.empty}>{t('No checklist yet')}</span>}
      {canEdit && (
        <form className={s.addRow} onSubmit={add}>
          <input className={cx('input', s.addInput)} value={text} onChange={(e) => setText(e.target.value)} placeholder={t('Add an item…')} aria-label={t('Add an item…')} maxLength={200} />
          <button type="submit" className={cx('btn', 'btn-secondary', s.addBtn)}>
            {t('Add')}
          </button>
        </form>
      )}
    </div>
  );
}

function FilesCard() {
  const { t } = useI18n();
  const toast = useToast();
  const { data, canEdit } = useTask();
  return (
    <div className={cx('card', 'elev-sm', s.sheet, s.gap6)}>
      <div className={s.cardHead}>
        <CardTitle compact push>
          {t('Files')}
        </CardTitle>
        {canEdit && (
          <Button variant="ghost" icon={Paperclip} className={s.attach} onClick={() => toast.show(t('Attach — coming soon'))}>
            {t('Attach')}
          </Button>
        )}
      </div>
      {data.files.map((f, i) => (
        <AttachmentRow key={i} icon={FILE_ICON[f.kind]} name={f.name} meta={f.meta} />
      ))}
      {!data.files.length && <span className={s.empty}>{t('No files attached')}</span>}
    </div>
  );
}

function CommentsCard() {
  const { t } = useI18n();
  const { data, live, canComment, viewer, run } = useTask();
  const [text, setText] = useState('');
  const post = (e: FormEvent) => {
    e.preventDefault();
    const body = text.trim();
    if (!body) return;
    setText('');
    run({ kind: 'comment', comment: { author: viewer.name, initials: viewer.initials, when: t('Just now'), text: body } }, () =>
      addTaskCommentAction({ taskId: data.id, text: body }),
    );
  };
  return (
    <div className={cx('card', 'elev-sm', s.sheet, s.gap8)}>
      <CardTitle compact>{t('Comments')}</CardTitle>
      {live.comments.map((c, i) => (
        <CommentRow key={i} author={c.author} initials={c.initials} when={c.when}>
          {c.text}
        </CommentRow>
      ))}
      {!live.comments.length && <span className={s.empty}>{t('No comments yet')}</span>}
      {canComment && (
        <form className={s.addRow} onSubmit={post}>
          <input
            className={cx('input', s.commentInput)}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t('Write a comment… @mention to notify')}
            aria-label={t('Comments')}
            maxLength={2000}
          />
          <button type="submit" className={cx('btn', 'btn-primary', s.postBtn)}>
            {t('Post')}
          </button>
        </form>
      )}
    </div>
  );
}

function ProgressCard() {
  const { t, lang } = useI18n();
  const toast = useToast();
  const { data, live, canEdit, run } = useTask();
  const [hours, setHours] = useState('');
  const [note, setNote] = useState('');
  const bar = hoursBar(live.loggedH, data.estimateH);
  const log = (e: FormEvent) => {
    e.preventDefault();
    if (!hours.trim()) return;
    const h = parseHours(hours);
    if (h == null) return toast.showEn('Enter hours between 0 and 24');
    const n = note.trim();
    setHours('');
    setNote('');
    run({ kind: 'log', entry: { date: t(dayLabel(TODAY)), hours: h, note: n || data.defaultLogNote } }, () =>
      logTaskTimeAction({ taskId: data.id, hours: h, note: n }),
    );
  };
  return (
    <div className={cx('card', 'elev-sm', s.sheet, s.gap10)}>
      <div className={s.cardHead}>
        <CardTitle compact push>
          {t('Progress')}
        </CardTitle>
        <span className={s.pctValue}>{live.pct}%</span>
      </div>
      <div className={s.track6}>
        <div className={s.fill6} style={{ '--w': `${live.pct}%` } as CSSProperties} />
      </div>
      {canEdit && (
        <Segmented
          fullWidth
          label={t('Progress')}
          value={String(live.pct)}
          options={PCT_STEPS.map((v) => ({ value: String(v), label: `${v}%` }))}
          onChange={(v) => {
            const p = Number(v);
            if (p !== live.pct) run({ kind: 'pct', pct: p }, () => setTaskProgressAction({ taskId: data.id, pct: p }));
          }}
        />
      )}
      <div className={cx(s.cardHead, s.cardHeadSpaced)}>
        <CardTitle compact push>
          {t('Time')}
        </CardTitle>
        <span className={s.timeValue}>
          <span className={s.timeLogged}>{live.loggedH.toFixed(1)}</span>
          <span className={s.timeEst}> / {data.estimateH} h</span>
        </span>
      </div>
      <div className={s.track6}>
        <div className={s.fill6} style={{ '--w': `${Math.round(bar.share * 1000) / 10}%`, '--fill': bar.over ? LO : 'var(--color-neutral-300)' } as CSSProperties} />
      </div>
      {live.entries.map((e, i) => (
        <TimeEntryRow key={i} date={e.date} note={e.note} hours={`${e.hours} h`} />
      ))}
      {canEdit && (
        <form className={s.logForm} onSubmit={log}>
          <input
            className={cx('input', s.logInput, s.logHours)}
            value={hours}
            onChange={(e) => setHours(e.target.value)}
            placeholder="h"
            aria-label={t('Hours')}
            inputMode="decimal"
          />
          <input
            className={cx('input', s.logInput)}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t('What did you work on?')}
            aria-label={t('What did you work on?')}
            maxLength={200}
          />
          <Button type="submit" variant="primary" icon={Plus} className={s.addBtn}>
            {t('Log')}
          </Button>
        </form>
      )}
      <span className={s.costNote}>
        {costNoteText(live.loggedH, data.costRate, laborCost(live.loggedH, data.costRate), data.costTarget, data.projectName, t, lang)}
      </span>
    </div>
  );
}

function PlanCard() {
  const { t, lang } = useI18n();
  const { data, live } = useTask();
  const p = data.plan;
  const rows: { k: string; v: string; color?: string }[] = p
    ? [
        { k: 'Activity', v: p.activity },
        { k: 'Work package', v: p.workPackage },
        { k: 'Activity finish', v: p.finish },
        { k: 'Total float', v: daysText(t(floatText(p.float)), lang), color: p.float != null && p.float < 0 ? LO : undefined },
        { k: 'Activity progress', v: `${p.progress}%` },
      ]
    : [
        { k: 'Activity', v: '—' },
        { k: 'Work package', v: '—' },
        { k: 'Activity finish', v: '—' },
        { k: 'Total float', v: '—' },
        { k: 'Activity progress', v: '—' },
      ];
  return (
    <div className={cx('card', 'elev-sm', s.sheet, s.gap8)}>
      <CardTitle compact>{t('Where this sits in the plan')}</CardTitle>
      {rows.map((r) => (
        <div key={r.k} className={s.planRow}>
          <span className={s.planKey}>{t(r.k)}</span>
          <span className={s.planValue} style={r.color ? ({ '--v-color': r.color } as CSSProperties) : undefined}>
            {r.v}
          </span>
        </div>
      ))}
      {p && isCritical(p.float, live.status) && (
        <Callout variant="emphasis" icon={Lightning}>
          {t('On the critical path — every day this activity finishes late moves the handover date.')}
        </Callout>
      )}
      {data.activity && (
        <ButtonLink variant="secondary" icon={TreeStructure} href={data.activity.href} className={s.openPlan}>
          {t('Open activity in plan')}
        </ButtonLink>
      )}
    </div>
  );
}
