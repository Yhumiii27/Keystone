// R-199 / R-036 — the form of the reminder, report and notification e-mail preferences: the viewer's own (notifications bell ›
// "Notifications & reminders")
// and the company default (Settings). Pure: the caller passes its translator; the offsets read the same in French ("J-7 · J-1").
import type { FormDef } from '@/components/app/form-def';
import { NOTIFICATION_FAMILIES, NOTIFICATION_FAMILY_LABEL, NOTIFICATION_MODES, NOTIFICATION_MODE_LABEL, modeField } from '@/domain/notification-mail';
import { OFFSET_PRESETS, offsetsLabel, parseOffsets } from '@/domain/reminders';

/** The offsets presets as select options, plus the stored choice when it is not one of them. */
export function offsetOptions(current?: string): { value: string; label: string }[] {
  const values = [...OFFSET_PRESETS, ...(current && !OFFSET_PRESETS.includes(current) && parseOffsets(current) ? [current] : [])];
  return values.map((v) => ({ value: v, label: offsetsLabel(parseOffsets(v)!) }));
}

/** `mine`: the viewer's form (with "Apply: my choices / the company default"); `default`: the Settings form of the director. */
export function reminderFormDef(t: (s: string) => string, mode: 'mine' | 'default', currentOffsets?: string): FormDef {
  const yesNo = [{ value: 'on', label: t('Yes') }, { value: 'off', label: t('No') }];
  const modes = NOTIFICATION_MODES.map((m) => ({ value: m, label: t(NOTIFICATION_MODE_LABEL[m]) }));
  return {
    title: mode === 'mine' ? t('Notifications & reminders') : t('Notifications, reminders & reports — company default'),
    submit: mode === 'mine' ? t('Save my preferences') : t('Save the default'),
    fields: [
      ...(mode === 'mine'
        ? [{ id: 'apply', label: t('Apply'), type: 'select' as const, span: 'full' as const, options: [{ value: 'own', label: t('My choices below') }, { value: 'default', label: t('The company default') }] }]
        : []),
      { id: 'offsets', label: t('Remind me before the due date'), type: 'select', options: offsetOptions(currentOffsets) },
      { id: 'overdue', label: t('Remind me once overdue'), type: 'select', options: yesNo },
      { id: 'emailReminders', label: t('E-mail copy of the deadline reminders'), type: 'select', options: yesNo },
      { id: 'emailReports', label: t('E-mail copy of the weekly reports'), type: 'select', options: yesNo },
      // R-036: the e-mail of the other notifications, per family (immediate, daily digest, none).
      ...NOTIFICATION_FAMILIES.map((f) => ({ id: modeField(f), label: `${t('E-mail')} · ${t(NOTIFICATION_FAMILY_LABEL[f])}`, type: 'select' as const, options: modes })),
    ],
  };
}
