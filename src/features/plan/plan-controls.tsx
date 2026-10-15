'use client';
// Plan controls made real in chapter 4 (they had no behaviour in the prototype, docs/spec/05 §2.5 "placeholders"):
// the Calendar / Baseline toolbar chips, "Reschedule", "Set baseline", the drawer's calendar override, "Add relationship",
// link removal and the to-do composer / ticks. Same look as the prototype; each calls a Server Function
// (./scheduling-actions.ts) and reports in a toast. Rendered only for viewers allowed to use them (./rights.ts).
import { ArrowsClockwise, Calendar, CaretDown, Check, FlagBanner, Plus, X } from '@phosphor-icons/react/dist/ssr';
import { useState, useTransition } from 'react';
import { FormDialog } from '@/components/app/FormDialog';
import type { FormDef } from '@/components/app/form-def';
import { Button, ButtonLink, IconButton } from '@/components/ds/Button';
import { cx } from '@/components/ds/cx';
import { Input, Select } from '@/components/ds/Field';
import { MenuHeader, MenuItem } from '@/components/ds/Menu';
import { Popover } from '@/components/ds/Popover';
import { useToast } from '@/components/ds/Toast';
import { useI18n } from '@/i18n/client';
import {
  addRelationshipAction, addTodoAction, removeRelationshipAction, removeTodoAction, rescheduleAction, setActivityCalendarAction, setBaselineAction,
  setProjectCalendarAction, showBaselineAction, toggleTodoAction, type PlanToastResult,
} from './scheduling-actions';
import s from './plan.module.css';

/** Runs a Server Function in a transition and toasts its message or error. */
function useRun() {
  const [pending, start] = useTransition();
  const toast = useToast();
  const run = (fn: () => Promise<PlanToastResult>, after?: () => void) =>
    start(async () => {
      const r = await fn();
      if ('error' in r) toast.show(r.error);
      else {
        if (r.toast) toast.show(r.toast);
        after?.();
      }
    });
  return { pending, run };
}

// ── Toolbar chips ─────────────────────────────────────────────────────────────────────────────────────────────────

export interface ChipOption {
  value: string;
  /** Translated label ("BL1 · 12 mars 2026", "Chantier 6j · 10h"). */
  label: string;
  /** Translated right-aligned meta ("Actuel", "8 h/j"). */
  meta?: string;
  disabled?: boolean;
  /** Translated tooltip (why disabled). */
  title?: string;
}

export interface PickerChipProps {
  kind: 'calendar' | 'baseline';
  code: string;
  /** Translated current value. */
  value: string;
  current: string;
  options: ChipOption[];
  /** Translated menu header ("Project calendar", "Displayed baseline"). */
  header: string;
  /** Viewer may change it (director / project manager); otherwise a static chip. */
  canChange: boolean;
}

/** Toolbar picker chip (`.input` auto width, 12.5px): icon · label · value · caret, opening a menu. */
export function PickerChip({ kind, code, value, current, options, header, canChange }: PickerChipProps) {
  const { t } = useI18n();
  const { pending, run } = useRun();
  const I = kind === 'calendar' ? Calendar : FlagBanner;
  const label = t(kind === 'calendar' ? 'Calendar' : 'Baseline');
  const face = (
    <>
      <I className={s.chipIcon} aria-hidden />
      <span className={s.chipLabel}>{label}</span>
      {value}
      {canChange && <CaretDown className={s.chipIcon} aria-hidden />}
    </>
  );
  if (!canChange)
    return (
      <div className={cx('input', s.chip, s.chipStatic)} title={label}>
        {face}
      </div>
    );
  const choose = (v: string) =>
    run(() => (kind === 'calendar' ? setProjectCalendarAction(code, v) : showBaselineAction(code, v)));
  return (
    <Popover trigger={face} triggerClassName={cx('input', s.chip)} triggerLabel={`${label} · ${value}`} minWidth="240px" zIndex={30}>
      <MenuHeader>{header}</MenuHeader>
      {options.map((o) => (
        <MenuItem
          key={o.value}
          size={12.5}
          selected={o.value === current}
          meta={o.meta}
          disabled={o.disabled || pending}
          title={o.title}
          onClick={() => o.value !== current && choose(o.value)}
        >
          {o.label}
        </MenuItem>
      ))}
    </Popover>
  );
}

// ── Toolbar actions ───────────────────────────────────────────────────────────────────────────────────────────────

/** "Reschedule" (`btn btn-secondary` 13px): CPM at the data date. */
export function RescheduleButton({ code }: { code: string }) {
  const { t } = useI18n();
  const { pending, run } = useRun();
  return (
    <Button variant="secondary" icon={ArrowsClockwise} className={s.btn13} disabled={pending} aria-busy={pending || undefined} onClick={() => run(() => rescheduleAction(code))}>
      {t('Reschedule')}
    </Button>
  );
}

/**
 * "Set baseline": dialog (name = next code, comment) snapshotting every activity — up to BL1 only (S-3, L-2). From BL2 on
 * (`changeRequestHref` given) the same button opens the Change control form proposing the next baseline instead.
 */
export function SetBaselineButton({ code, context, defaultName, changeRequestHref }: { code: string; context: string; defaultName: string; changeRequestHref?: string }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  if (changeRequestHref)
    return (
      <ButtonLink variant="secondary" icon={FlagBanner} className={s.btn13} href={changeRequestHref} title={t('After BL1, a new baseline goes through a change request')}>
        {t('Set baseline')}
      </ButtonLink>
    );
  const def: FormDef = {
    title: 'Set baseline',
    submit: 'Set baseline',
    kind: 'run',
    fields: [
      { id: 'name', label: 'Baseline name', type: 'text', required: true, defaultValue: defaultName },
      { id: 'comment', label: 'Comment', type: 'textarea' },
    ],
  };
  return (
    <>
      <Button variant="secondary" icon={FlagBanner} className={s.btn13} onClick={() => setOpen(true)}>
        {t('Set baseline')}
      </Button>
      {open && <FormDialog {...def} translate open context={context} onClose={() => setOpen(false)} onSubmit={(v) => setBaselineAction(code, v)} />}
    </>
  );
}

// ── Activity drawer ───────────────────────────────────────────────────────────────────────────────────────────────

/** "Calendar" value of the drawer: the project calendar or an override (applied at the next Reschedule). */
export function ActivityCalendarSelect({ code, activity, value, options, label }: { code: string; activity: string; value: string; options: { value: string; label: string }[]; label: string }) {
  const [draft, setDraft] = useState(value);
  const [prev, setPrev] = useState(value);
  const { pending, run } = useRun();
  if (value !== prev) {
    setPrev(value);
    setDraft(value);
  }
  return (
    <Select
      size="cell"
      className={s.calSelect}
      value={draft}
      aria-label={label}
      disabled={pending}
      options={options}
      onChange={(e) => {
        const v = e.target.value;
        setDraft(v);
        run(() => setActivityCalendarAction(code, activity, v));
      }}
    />
  );
}

/** Drawer "+ Add relationship" (`btn-ghost`, 12.5px): direction, activity ("A1240 · Steel erection — Bays 1–2", EN), type, lag. */
export function AddRelationshipButton({ code, activity, activities, context }: { code: string; activity: string; activities: string[]; context: string }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const def: FormDef = {
    title: 'Add relationship',
    submit: 'Add relationship',
    kind: 'create',
    fields: [
      { id: 'dir', label: 'Relationship', type: 'select', options: [{ value: 'pred', label: 'Predecessor of this activity' }, { value: 'succ', label: 'Successor of this activity' }] },
      { id: 'activity', label: 'Activity', type: 'select', options: activities, span: 'full' },
      {
        id: 'type', label: 'Type', type: 'select',
        options: [
          { value: 'FS', label: 'Finish to start (FS)' }, { value: 'SS', label: 'Start to start (SS)' },
          { value: 'FF', label: 'Finish to finish (FF)' }, { value: 'SF', label: 'Start to finish (SF)' },
        ],
      },
      { id: 'lag', label: 'Lag (working days)', type: 'number', defaultValue: '0' },
    ],
  };
  return (
    <>
      <Button variant="ghost" icon={Plus} className={s.addRel} onClick={() => setOpen(true)} disabled={!activities.length}>
        {t('Add relationship')}
      </Button>
      {open && (
        // Above the activity drawer (z 60/61).
        <FormDialog {...def} translate open context={context} zIndex={70} onClose={() => setOpen(false)} onSubmit={(v) => addRelationshipAction(code, activity, v)} />
      )}
    </>
  );
}

/** × on a predecessor / successor line. */
export function RemoveLinkButton({ code, pred, succ }: { code: string; pred: string; succ: string }) {
  const { t } = useI18n();
  const { pending, run } = useRun();
  return (
    <IconButton icon={X} size={24} muted label={`${t('Remove relationship')} · ${pred} → ${succ}`} disabled={pending} onClick={() => run(() => removeRelationshipAction(code, pred, succ))} />
  );
}

/** Drawer to-do composer: input "Add a to-do…" + `btn-primary` "Add". */
export function TodoComposer({ code, activity }: { code: string; activity: string }) {
  const { t } = useI18n();
  const [draft, setDraft] = useState('');
  const { pending, run } = useRun();
  return (
    <form
      className={s.addTodo}
      onSubmit={(e) => {
        e.preventDefault();
        const title = draft.trim();
        if (!title || pending) return;
        run(() => addTodoAction(code, activity, title), () => setDraft(''));
      }}
    >
      <Input className={s.addTodoInput} placeholder={t('Add a to-do…')} aria-label={t('Add a to-do…')} value={draft} maxLength={200} onChange={(e) => setDraft(e.target.value)} />
      <Button type="submit" variant="primary" className={s.addTodoBtn} disabled={!draft.trim() || pending} aria-busy={pending || undefined}>
        {t('Add')}
      </Button>
    </form>
  );
}

/** Status ring of a to-do line, as a toggle (done ↔ in progress). */
export function TodoRing({ code, activity, number, done }: { code: string; activity: string; number: string; done: boolean }) {
  const { t } = useI18n();
  const { pending, run } = useRun();
  return (
    <button
      type="button"
      className={cx(s.ring, s.ringButton, done && s.ringDone)}
      aria-pressed={done}
      aria-label={`${number} · ${t(done ? 'Mark not done' : 'Mark done')}`}
      title={t(done ? 'Mark not done' : 'Mark done')}
      disabled={pending}
      onClick={() => run(() => toggleTodoAction(code, activity, number, !done))}
    >
      {done && <Check className={s.ringCheck} aria-hidden />}
    </button>
  );
}

/** × on a to-do created from the drawer without logged time. */
export function RemoveTodoButton({ code, activity, number }: { code: string; activity: string; number: string }) {
  const { t } = useI18n();
  const { pending, run } = useRun();
  return <IconButton icon={X} size={24} muted label={`${t('Remove')} · ${number}`} disabled={pending} onClick={() => run(() => removeTodoAction(code, activity, number))} />;
}
