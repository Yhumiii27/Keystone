'use client';
// "Plan activities" of a change request (Delivery 7, NEW-D2-2 = a, R-062): the activities the request touches, with the
// new duration it asks for. Editors of an open request (the project's PM or the director) add an activity of the plan
// with an optional new duration, or remove one; the Plan drawer of each activity lists the request. Server Functions in
// ./activity-actions.ts; the page re-renders from the database after each write.
import { Plus, X } from '@phosphor-icons/react/dist/ssr';
import { useState, useTransition } from 'react';
import { Button, IconButton } from '@/components/ds/Button';
import { Input, Select } from '@/components/ds/Field';
import { useToast } from '@/components/ds/Toast';
import { useI18n } from '@/i18n/client';
import { linkCrActivityAction, unlinkCrActivityAction } from './activity-actions';
import s from './changes.module.css';

export interface CrActivityRow {
  code: string;
  /** "A1250 · Steel erection — Bays 3–4" (translated), or the code alone when the activity left the plan. */
  label: string;
  /** "20d → 28d", "20 j → 28 j · appliquée" (translated). */
  duration: string;
}

export function CrActivitiesEditor({ code, number, rows, options, editable }: {
  code: string;
  number: string;
  rows: CrActivityRow[];
  /** Plan activities not linked yet ({ value: code, label }), translated. */
  options: { value: string; label: string }[];
  editable: boolean;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [activity, setActivity] = useState('');
  const [days, setDays] = useState('');
  const run = (fn: () => ReturnType<typeof linkCrActivityAction>, done?: () => void) =>
    start(async () => {
      const r = await fn();
      toast.show('error' in r ? r.error : r.toast);
      if (!('error' in r)) done?.();
    });
  return (
    <div className={s.crActs}>
      {rows.map((r) => (
        <div key={r.code} className={s.crAct}>
          <span className={s.crActText}>
            <span className={s.crActName}>{r.label}</span>
            <span className={s.crActMeta}>{r.duration}</span>
          </span>
          {editable && (
            <IconButton
              icon={X}
              size={24}
              label={`${t('Remove')} ${r.code}`}
              disabled={pending}
              onClick={() => run(() => unlinkCrActivityAction(code, number, r.code))}
            />
          )}
        </div>
      ))}
      {!rows.length && <span className={s.hint}>{t('No plan activity named — the request applies to its work packages')}</span>}
      {editable && (
        <form
          className={s.crActAdd}
          onSubmit={(e) => {
            e.preventDefault();
            if (!activity || pending) return;
            run(() => linkCrActivityAction(code, number, { activity, days }), () => {
              setActivity('');
              setDays('');
            });
          }}
        >
          <Select
            size="sm"
            aria-label={t('Activity')}
            value={activity}
            onChange={(e) => setActivity(e.target.value)}
            options={[{ value: '', label: t('Choose an activity') }, ...options]}
          />
          <Input
            size="sm"
            aria-label={t('New duration (working days, optional)')}
            type="number"
            min={0}
            max={3650}
            step={1}
            inputMode="numeric"
            placeholder={t('New duration (d)')}
            className={s.crActDays}
            value={days}
            onChange={(e) => setDays(e.target.value)}
          />
          <Button type="submit" variant="secondary" size="sm" icon={Plus} disabled={!activity || pending} aria-busy={pending || undefined}>
            {t('Add')}
          </Button>
        </form>
      )}
    </div>
  );
}
