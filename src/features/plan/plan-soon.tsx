'use client';
// Plan controls that have no behaviour in the prototype (docs/spec/05 §2.5 "No behaviour (placeholders)"):
// the Calendar / Baseline toolbar chips, "Reschedule", "Set baseline", the drawer's "Add relationship" and the
// to-do composer. They keep the prototype's look and announce "<action> — coming soon" in a toast, like the
// header's Export button (no scheduling engine, baselines or task store yet — docs/spec/05 §7, OQ 2/4/5).
import { ArrowsClockwise, Calendar, CaretDown, FlagBanner, Plus } from '@phosphor-icons/react/dist/ssr';
import { useState } from 'react';
import { Button } from '@/components/ds/Button';
import { cx } from '@/components/ds/cx';
import { Input } from '@/components/ds/Field';
import { useToast } from '@/components/ds/Toast';
import { useI18n } from '@/i18n/client';
import s from './plan.module.css';

const soon = (english: string) => `${english} — coming soon`;

/** Toolbar picker chip (`.input` auto width, 12.5px): icon · label · value · caret. */
export function SoonChip({ kind, value }: { kind: 'calendar' | 'baseline'; /** Translated value. */ value: string }) {
  const { t } = useI18n();
  const toast = useToast();
  const I = kind === 'calendar' ? Calendar : FlagBanner;
  const label = kind === 'calendar' ? 'Calendar' : 'Baseline';
  return (
    <button type="button" className={cx('input', s.chip)} onClick={() => toast.show(t(soon(label)))}>
      <I className={s.chipIcon} aria-hidden />
      <span className={s.chipLabel}>{t(label)}</span>
      {value}
      <CaretDown className={s.chipIcon} aria-hidden />
    </button>
  );
}

const ACTIONS = {
  reschedule: { label: 'Reschedule', icon: ArrowsClockwise },
  baseline: { label: 'Set baseline', icon: FlagBanner },
} as const;

/** Toolbar `btn btn-secondary` 13px: "Reschedule" / "Set baseline". */
export function SoonAction({ kind }: { kind: keyof typeof ACTIONS }) {
  const { t } = useI18n();
  const toast = useToast();
  const a = ACTIONS[kind];
  return (
    <Button variant="secondary" icon={a.icon} className={s.btn13} onClick={() => toast.show(t(soon(a.label)))}>
      {t(a.label)}
    </Button>
  );
}

/** Drawer "+ Add relationship" (`btn-ghost`, 12.5px, align-self flex-start). */
export function AddRelationshipButton() {
  const { t } = useI18n();
  const toast = useToast();
  return (
    <Button variant="ghost" icon={Plus} className={s.addRel} onClick={() => toast.show(t(soon('Add relationship')))}>
      {t('Add relationship')}
    </Button>
  );
}

/** Drawer to-do composer: input "Add a to-do…" + `btn-primary` "Add". */
export function TodoComposer() {
  const { t } = useI18n();
  const toast = useToast();
  const [draft, setDraft] = useState('');
  return (
    <form
      className={s.addTodo}
      onSubmit={(e) => {
        e.preventDefault();
        toast.show(t(soon('Add a to-do')));
      }}
    >
      <Input className={s.addTodoInput} placeholder={t('Add a to-do…')} aria-label={t('Add a to-do…')} value={draft} onChange={(e) => setDraft(e.target.value)} />
      <Button type="submit" variant="primary" className={s.addTodoBtn}>
        {t('Add')}
      </Button>
    </form>
  );
}
