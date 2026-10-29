'use client';
// R-199 / R-036 — "Reminders & reports" in the notifications bell's footer: the viewer's own choices (e-mail copy of the
// reminders and of the weekly reports, the reminder offsets, the overdue reminder), or the company default. There is no profile
// screen in Keystone: the bell, on every page and for every role, is where the notifications are, so the choices sit with it.
// The dialog lives outside the bell's panel (the panel closes on an outside click, the dialog must stay).
import { useState, useTransition, type ReactNode } from 'react';
import { FormDialog } from '@/components/app/FormDialog';
import type { FormValues } from '@/components/app/form-def';
import { showToast } from '@/components/ds/Toast';
import { useI18n } from '@/i18n/client';
import { getMyReminderPreferencesAction, saveMyReminderPreferencesAction } from '@/server/actions/reminders';
import { reminderFormDef } from './form-def';

/** `open()` loads the viewer's preferences and shows the dialog; render `dialog` where it may outlive the caller's popover. */
export function useReminderPreferences(): { open: () => void; pending: boolean; dialog: ReactNode } {
  const { t } = useI18n();
  const [values, setValues] = useState<FormValues | null>(null);
  const [pending, startTransition] = useTransition();
  const open = () =>
    startTransition(async () => {
      const r = await getMyReminderPreferencesAction();
      if (!r) showToast(t('Invalid request'));
      else setValues(r.values);
    });
  const dialog = values ? (
    <FormDialog
      {...reminderFormDef(t, 'mine', values.offsets)}
      open
      context={t('The bell always receives the reminders and the reports')}
      initialValues={values}
      onClose={() => setValues(null)}
      onSubmit={async (v) => {
        const r = await saveMyReminderPreferencesAction(v);
        return 'error' in r ? { error: r.error } : { toast: r.toast };
      }}
    />
  ) : null;
  return { open, pending, dialog };
}
