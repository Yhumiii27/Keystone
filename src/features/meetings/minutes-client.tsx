'use client';
// Interactive parts of the Meetings screen (docs/spec/05 §5.4–5.5, template 766–810): action ticks (agenda, carried
// over, previous meeting, Actions register — optimistic, reconciled when the Server Function revalidates), the
// agenda with its selectable point and the minutes composer, and "Send minutes" (the transcript box is in
// transcript-client.tsx). Edit controls are rendered only when `canEdit` (not outside the workspace, not a read-only project).
import { ArrowBendDownRight, CheckCircle, CheckSquare, Circle, FileText, Gavel, Info, PaperPlaneTilt, Plus, Square } from '@phosphor-icons/react/dist/ssr';
import type { Icon } from '@phosphor-icons/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useOptimistic, useRef, useState, useTransition, type CSSProperties, type KeyboardEvent } from 'react';
import { Button, ButtonLink } from '@/components/ds/Button';
import { Segmented } from '@/components/ds/Segmented';
import { useToast } from '@/components/ds/Toast';
import { cx } from '@/components/ds/cx';
import { LINE_TYPES, lineKey, type LineRef } from '@/domain/meetings';
import { useI18n } from '@/i18n/client';
import type { MeetingLineType } from '@/server/db/codes';
import { addMinutesLineAction, recordMinutesReadAction, sendMinutesAction, toggleMeetingActionAction } from './actions';
import { LINE_COLOR, type ActionRowView, type AgendaPointView, type LineView, type PrepActionView } from './model';
import s from './meetings.module.css';

const TYPE_ICON: Record<MeetingLineType, Icon> = { action: ArrowBendDownRight, decision: Gavel, info: Info };
const TYPE_LABEL: Record<MeetingLineType, string> = { info: 'Info', decision: 'Decision', action: 'Action' };
const colorVar = (c: string) => ({ '--toggle-color': c }) as CSSProperties;

// ── Action ticks ───────────────────────────────────────────────────────────────────────────────────────

/** Optimistic done flags of action lines, shared by the rows of one list. */
function useLineToggles(code: string) {
  const toast = useToast();
  const [, startTransition] = useTransition();
  const [flags, flip] = useOptimistic<Record<string, boolean>, { key: string; done: boolean }>({}, (cur, op) => ({ ...cur, [op.key]: op.done }));
  return {
    doneOf: (key: string, base: boolean) => flags[key] ?? base,
    toggle: (ref: LineRef, current: boolean) =>
      startTransition(async () => {
        flip({ key: lineKey(ref), done: !current });
        // R-010: the state asked for, not a flip (two people ticking at once leave it ticked).
        const r = await toggleMeetingActionAction({ code, ...ref, done: !current });
        if (!r.ok) toast.show(r.error);
      }),
  };
}

interface ToggleProps {
  done: boolean;
  canEdit: boolean;
  onToggle: () => void;
  /** `square` = ph-square / ph-check-square (agenda, carry-over, register); `circle` = ph-circle / ph-fill check-circle. */
  shape?: 'square' | 'circle';
  color?: string;
  large?: boolean;
}

function Toggle({ done, canEdit, onToggle, shape = 'square', color, large }: ToggleProps) {
  const { t } = useI18n();
  const I = shape === 'circle' ? (done ? CheckCircle : Circle) : done ? CheckSquare : Square;
  const c = color ?? (shape === 'circle' ? (done ? 'var(--color-accent-300)' : 'var(--color-neutral-500)') : 'var(--color-accent-300)');
  const icon = <I weight={shape === 'circle' && done ? 'fill' : 'regular'} aria-hidden />;
  if (!canEdit)
    return (
      <span className={cx(s.toggleStatic, large && s.toggleLg)} style={colorVar(c)} role="img" aria-label={t(done ? 'Done' : 'Open')}>
        {icon}
      </span>
    );
  return (
    <button
      type="button"
      className={cx(s.toggle, large && s.toggleLg)}
      style={colorVar(c)}
      aria-pressed={done}
      aria-label={t(done ? 'Reopen action' : 'Close action')}
      title={t(done ? 'Reopen action' : 'Close action')}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
    >
      {icon}
    </button>
  );
}

/** "Carried over from …" rows: always open (ph-square); ticking closes the action, which then leaves the list. */
export function CarriedRows({ code, items, canEdit }: { code: string; items: { ref: LineRef; key: string; text: string; meta: string }[]; canEdit: boolean }) {
  const { doneOf, toggle } = useLineToggles(code);
  return items.map((c) => {
    const done = doneOf(c.key, false);
    return (
      <div key={c.key} className={cx(s.row3, s.row3Center)}>
        <Toggle done={done} canEdit={canEdit} onToggle={() => toggle(c.ref, done)} />
        <span className={s.pretty}>{c.text}</span>
        <span className={s.smallNowrap}>{c.meta}</span>
      </div>
    );
  });
}

/** "Actions since the previous meeting" rows: circle toggle, "{who} · {due}", Closed since / Still open tag. */
export function PrevActionRows({ code, items, canEdit }: { code: string; items: PrepActionView[]; canEdit: boolean }) {
  const { t } = useI18n();
  const { doneOf, toggle } = useLineToggles(code);
  return items.map((a) => {
    const done = doneOf(a.key, a.done);
    return (
      <div key={a.key} className={s.row3}>
        <Toggle shape="circle" done={done} canEdit={canEdit} onToggle={() => toggle(a.ref, done)} />
        <span className={s.textCol}>
          <span className={s.pretty}>{a.text}</span>
          <span className={s.small}>{a.meta}</span>
        </span>
        <span className={cx(done ? 'tag tag-neutral' : 'tag tag-accent', s.nowrap, s.tag10)}>
          {t(done ? 'Closed since' : 'Still open')}
        </span>
      </div>
    );
  });
}

/** Actions register rows (mtgActionRows): tick, action, owner, due, meeting link, status. */
export function ActionRows({ code, rows, canEdit }: { code: string; rows: ActionRowView[]; canEdit: boolean }) {
  const { t } = useI18n();
  const { doneOf, toggle } = useLineToggles(code);
  return rows.map((a) => {
    const done = doneOf(a.key, a.done);
    const changed = done !== a.done;
    const dueColor = changed ? (done ? 'var(--color-neutral-500)' : 'var(--color-neutral-400)') : a.dueColor;
    return (
      <tr key={a.key}>
        <td className={s.checkCell}>
          <Toggle large done={done} canEdit={canEdit} onToggle={() => toggle(a.ref, done)} />
        </td>
        <td className={cx(s.cellText, done && s.lineDone)}>{a.text}</td>
        <td className={cx(s.cell12, s.nowrap)}>
          {a.taskHref ? (
            <Link href={a.taskHref} className={s.meetingLink} title={t('Open task')}>
              {a.owner}
            </Link>
          ) : (
            a.owner
          )}
        </td>
        <td className={cx(s.cell12, s.nowrap)} style={{ color: dueColor }}>
          {a.due}
        </td>
        <td className={s.meetingCell}>
          <Link href={a.href} className={s.meetingLink} scroll={false}>
            {a.meetingTitle}
          </Link>
          <span className={s.meetingRef}>{a.meetingRef}</span>
        </td>
        <td className={s.cell12} style={{ color: dueColor }}>
          {changed ? t(done ? 'Done' : 'Open') : a.stateText}
        </td>
      </tr>
    );
  });
}

/**
 * "Open minutes" of "Distribution & read receipts" (S-11 a, R-037): the link opens the MIN record as before and, on the way,
 * records the viewer's read receipt in Keystone when they are a recipient (the server decides; a failure never blocks the link).
 */
export function OpenMinutesLink({ code, meeting, href, label }: { code: string; meeting: string; href: string; label: string }) {
  return (
    <ButtonLink
      variant="ghost"
      size="xs"
      icon={FileText}
      href={href}
      onClick={() => {
        recordMinutesReadAction({ code, meeting }).catch(() => undefined);
      }}
    >
      {label}
    </ButtonLink>
  );
}

// ── Agenda & composer ──────────────────────────────────────────────────────────────────────────────────

export interface MinutesEditorProps {
  code: string;
  meeting: string;
  organizer: string;
  agenda: AgendaPointView[];
  /** Minutes not sent yet. */
  editable: boolean;
  canEdit: boolean;
  /** "Send minutes to all invitees" (P-9b: the meeting's organiser and the project's PM); others add notes only. */
  canSend?: boolean;
  /** This meeting's URL; the page switches to it after a write when the selection came from the default. */
  selfHref: string;
  pinned: boolean;
  /**
   * S-12 a (R-067): plan activities an action may serve (value = code, label = "A1250 · name" as typed) — the minutes' writers
   * only; empty → no Activity select. The task "Send minutes" creates carries the activity.
   */
  activities?: { value: string; label: string }[];
}

interface PendingLine {
  point: number;
  line: LineView;
}

/** Agenda & notes (one block per point, selectable when editable) + composer + "Send minutes to all invitees". */
export function MinutesEditor({ code, meeting, organizer, agenda, editable, canEdit, canSend = canEdit, selfHref, pinned, activities = [] }: MinutesEditorProps) {
  const { t } = useI18n();
  const toast = useToast();
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  const { doneOf, toggle } = useLineToggles(code);
  const [pending, addPending] = useOptimistic<PendingLine[], PendingLine>([], (cur, p) => [...cur, p]);
  const [point, setPoint] = useState(0);
  const [type, setType] = useState<MeetingLineType>('action');
  const [text, setText] = useState('');
  const [owner, setOwner] = useState('');
  const [due, setDue] = useState('');
  const [activity, setActivity] = useState('');
  const seq = useRef(0);
  const composing = editable && canEdit;
  const target = agenda.some((a) => a.position === point) ? point : (agenda[0]?.position ?? 0);

  const pin = () => {
    if (!pinned) router.replace(selfHref, { scroll: false });
  };

  const add = () => {
    const body = text.trim();
    if (!body || busy) return;
    const isAction = type === 'action';
    const draft = { type, text: body, owner: isAction ? owner : '', due: isAction ? due : '', activity: isAction ? activity : '' };
    const n = ++seq.current;
    const ref = { meeting, point: target, position: 10_000 + n };
    setText('');
    setOwner('');
    setDue('');
    setActivity('');
    startTransition(async () => {
      addPending({
        point: target,
        line: {
          ref, key: `pending-${n}`, type, typeLabel: t(TYPE_LABEL[type]), text: body, isAction, done: false,
          meta: isAction ? `${owner.trim() || organizer} · ${due.trim() ? t(due.trim()) : '—'}${activity ? ` · ${activity}` : ''}` : '', taskNumber: null, taskHref: null,
        },
      });
      const r = await addMinutesLineAction({ code, meeting, point: target, ...draft });
      if (!r.ok) {
        toast.show(r.error);
        setText(body);
        setOwner(draft.owner);
        setDue(draft.due);
        setActivity(draft.activity);
      } else pin();
    });
  };

  const send = () =>
    startTransition(async () => {
      const r = await sendMinutesAction({ code, meeting });
      if (!r.ok) return toast.show(r.error);
      if (r.toast) toast.show(r.toast);
      pin();
    });

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      e.preventDefault();
      add();
    }
  };

  const lineRow = (l: LineView, optimistic = false) => {
    const done = optimistic ? false : doneOf(l.key, l.done);
    const I = TYPE_ICON[l.type];
    return (
      <div key={l.key} className={cx(s.row3, s.line, optimistic && s.pending)}>
        <span className={s.lineCheck}>{l.isAction && !optimistic && <Toggle done={done} canEdit={canEdit} onToggle={() => toggle(l.ref, done)} color={LINE_COLOR.action} />}</span>
        <span className={s.lineCol}>
          <span className={cx(s.lineText, done && s.lineDone)}>
            <I className={s.lineIcon} style={{ color: LINE_COLOR[l.type] }} aria-hidden />
            <span>{l.text}</span>
          </span>
          {l.isAction && (
            <span className={s.lineMeta}>
              {l.meta}
              {l.taskHref && l.taskNumber && (
                <>
                  {' · '}
                  <Link href={l.taskHref} className={s.taskLink} title={t('Open task')}>
                    {l.taskNumber}
                  </Link>
                </>
              )}
            </span>
          )}
        </span>
        <span className={s.lineType} style={{ color: LINE_COLOR[l.type] }}>
          {l.typeLabel}
        </span>
      </div>
    );
  };

  return (
    <>
      <div className={s.blockLg}>
        <span className={s.kicker}>{t('Agenda & notes')}</span>
        {agenda.map((a, i) => {
          const extra = pending.filter((p) => p.point === a.position);
          const on = composing && a.position === target;
          return (
            <div key={a.position} className={cx(s.point, composing && s.pointPick, on && s.pointOn)} onClick={composing ? () => setPoint(a.position) : undefined}>
              {composing ? (
                <button type="button" className={s.pointHeadBtn} aria-pressed={on} title={t('Select agenda point')} onClick={() => setPoint(a.position)}>
                  <span className={s.pointNo}>{i + 1}</span>
                  <span className={s.pretty}>{a.title}</span>
                </button>
              ) : (
                <div className={s.pointHead}>
                  <span className={s.pointNo}>{i + 1}</span>
                  <span className={s.pretty}>{a.title}</span>
                </div>
              )}
              {a.lines.map((l) => lineRow(l))}
              {extra.map((p) => lineRow(p.line, true))}
              {!a.lines.length && !extra.length && <span className={s.empty}>{t('No note yet')}</span>}
            </div>
          );
        })}
        {!agenda.length && (
          <>
            {pending.map((p) => lineRow(p.line, true))}
            {composing && !pending.length && <span className={s.emptyAgenda}>{t('No agenda point yet · the first note opens one')}</span>}
          </>
        )}
      </div>
      {composing && (
        <>
          <div className={s.composer}>
            <span className={s.composerHint}>{t('Add a note to the selected agenda point')}</span>
            <div className={s.composerRow}>
              <Segmented label={t('New note')} options={LINE_TYPES.map((v) => ({ value: v, label: t(TYPE_LABEL[v]) }))} value={type} onChange={setType} />
              <input className={cx('input', s.draftText)} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKey} placeholder="…" aria-label={t('New note')} maxLength={1000} />
              {type === 'action' && (
                <>
                  <input className={cx('input', s.draftOwner)} value={owner} onChange={(e) => setOwner(e.target.value)} onKeyDown={onKey} placeholder={t('Owner')} aria-label={t('Owner')} maxLength={80} />
                  <input className={cx('input', s.draftDue)} value={due} onChange={(e) => setDue(e.target.value)} onKeyDown={onKey} placeholder={t('Due')} aria-label={t('Due')} maxLength={40} />
                  {activities.length > 0 && (
                    <select className={cx('input', s.draftActivity)} value={activity} onChange={(e) => setActivity(e.target.value)} aria-label={t('Activity')}>
                      <option value="">{t('No activity')}</option>
                      {activities.map((a) => (
                        <option key={a.value} value={a.value}>
                          {a.label}
                        </option>
                      ))}
                    </select>
                  )}
                </>
              )}
              <Button size="sm" icon={Plus} onClick={add} disabled={!text.trim() || busy}>
                {t('Add')}
              </Button>
            </div>
          </div>
          <div className={s.footer}>
            <span className={s.footerText}>
              {/* S-11 a (R-037): a read receipt = a recipient opening the minutes from Keystone; nothing is e-mailed. */}
              {t(canSend ? 'Minutes become a numbered document (MIN) · actions go to the owners’ tasks · read receipts are tracked in Keystone' : 'The organiser or the project manager sends the minutes')}
            </span>
            {canSend && (
              <Button variant="primary" size="sm" icon={PaperPlaneTilt} onClick={send} disabled={busy}>
                {t('Send minutes to all invitees')}
              </Button>
            )}
          </div>
        </>
      )}
    </>
  );
}
