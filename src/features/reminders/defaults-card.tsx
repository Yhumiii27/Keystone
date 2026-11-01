'use client';
// R-199 / R-036 — Settings › "Reminders & reports — company default": what applies to every user who has not made their own
// choice (bell › Reminders & reports), edited by the Settings editors (the portfolio director, A-14); the others read. Shows the
// e-mail transport IT configured (none until the SMTP relay or Microsoft 365 is available).
import { BellRinging, PencilSimple } from '@phosphor-icons/react/dist/ssr';
import { useState } from 'react';
import { FormDialog } from '@/components/app/FormDialog';
import type { FormValues } from '@/components/app/form-def';
import { Button } from '@/components/ds/Button';
import { cx } from '@/components/ds/cx';
import { NOTIFICATION_FAMILIES, NOTIFICATION_FAMILY_LABEL, NOTIFICATION_MODE_LABEL, modeField, type NotificationMode } from '@/domain/notification-mail';
import { offsetsLabel, parseOffsets } from '@/domain/reminders';
import { useI18n } from '@/i18n/client';
import { saveReminderDefaultsAction } from '@/server/actions/reminders';
import { reminderFormDef } from './form-def';
import s from './reminders.module.css';

export function ReminderDefaultsCard({ values, canEdit, transport }: { values: FormValues; canEdit: boolean; transport: 'none' | 'file' }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const yes = (v: string) => t(v === 'on' ? 'Yes' : 'No');
  const rows: [string, string][] = [
    [t('Reminder offsets'), offsetsLabel(parseOffsets(values.offsets) ?? [])],
    [t('Overdue reminder'), yes(values.overdue)],
    [t('E-mail reminders'), yes(values.emailReminders)],
    [t('E-mail reports'), yes(values.emailReports)],
    // R-036: the e-mail of the other notifications, per family.
    ...NOTIFICATION_FAMILIES.map((f): [string, string] => [t(NOTIFICATION_FAMILY_LABEL[f]), t(NOTIFICATION_MODE_LABEL[values[modeField(f)] as NotificationMode] ?? '—')]),
    [t('E-mail transport'), t(transport === 'file' ? 'Written to a folder (file)' : 'Not connected (awaits IT)')],
  ];
  return (
    <div className={cx('card', 'elev-sm', s.card)}>
      <div className={s.head}>
        <BellRinging className={s.accent} aria-hidden />
        <div className={s.title}>
          <div className="card-title">{t('Notifications, reminders & reports — company default')}</div>
          <span className={s.muted}>
            {t('Deadline reminders every morning (tasks, activities, milestones, deliverables, meeting actions, client prerequisites) and weekly reports on Monday (status report to the project leads, portfolio to the directors) · each person changes their own choice from the notifications bell')}
            {' · '}
            {t('Notifications by e-mail: at once, or in the daily digest sent at the reminders hour; clients receive theirs at once')}
          </span>
        </div>
        {canEdit && (
          <Button variant="secondary" size="sm" icon={PencilSimple} nowrap push onClick={() => setOpen(true)}>
            {t('Edit the default')}
          </Button>
        )}
      </div>
      <dl className={s.grid}>
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      {open && (
        <FormDialog
          {...reminderFormDef(t, 'default', values.offsets)}
          open
          initialValues={values}
          onClose={() => setOpen(false)}
          onSubmit={async (v) => {
            const r = await saveReminderDefaultsAction(v);
            return 'error' in r ? { error: r.error } : { toast: r.toast };
          }}
        />
      )}
    </div>
  );
}
