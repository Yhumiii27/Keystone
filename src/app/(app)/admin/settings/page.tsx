// Settings — personalisable lists — /admin/settings (docs/spec/10 §1, template 1573–1597, logic 4437–4445). Company
// reference lists (stock locations, skills, cost categories, project statuses, risk categories, deliverable types,
// public holidays) and the project health thresholds, persisted (src/server/dal/settings.ts). Primary "Reset to
// defaults" (with a confirmation). Roles: director, PM, department head, engineering lead, quality, procurement; member
// and client see the lists outside their workspace (banner, read-only, no controls). Writes: src/features/admin/actions.ts.
// Chapter 4 (A-14): only the portfolio director edits — the other roles of the workspace read the lists (no controls,
// no Reset, a read-only note); the lists drive the modules and the thresholds the one health rule (A-13).
// R-158 lot A (decision 9): the Incoterms card (Incoterms 2020 and their split of responsibilities), same editors.
// R-199 / R-036: the Reminders & reports card (company default of the reminders and the weekly reports), same editors.
import { PageHeader } from '@/components/app/shell/page-header';
import { canEditSettings } from '@/domain/settings-rules';
import { settingsView } from '@/features/admin/model';
import { ResetSettingsButton } from '@/features/admin/primary-buttons';
import { SettingsBody } from '@/features/admin/settings-view';
import { IncotermsCard } from '@/features/admin/incoterms-card';
import { incotermFormDef, incotermsView } from '@/features/admin/incoterms-model';
import { ReminderDefaultsCard } from '@/features/reminders/defaults-card';
import { formOfPrefs } from '@/domain/reminders';
import { getConfig } from '@/server/config';
import { listIncoterms } from '@/server/dal/incoterms';
import { readReminderDefaults } from '@/server/dal/reminder-preferences';
import { getSettings } from '@/server/dal/settings';
import { getScreenAccess } from '@/server/project-context';
import { getI18n } from '@/server/session';

export default async function SettingsPage() {
  const [{ t, lang }, access, data, incoterms, reminders] = await Promise.all([getI18n(), getScreenAccess('settings'), getSettings(), listIncoterms(), readReminderDefaults()]);
  const canEdit = access.canEdit && canEditSettings(access.viewer.role);
  return (
    <>
      <PageHeader screen="settings" primary={canEdit ? <ResetSettingsButton /> : undefined} />
      <SettingsBody view={settingsView(data, t, lang)} canEdit={canEdit} directorOnlyNote={access.canEdit && !canEdit} />
      {/* R-158 (owner's decision 9): the Incoterms, edited by the Settings editors. */}
      <IncotermsCard rows={incotermsView(incoterms, t, lang)} canEdit={canEdit} createForm={incotermFormDef(t, true)} editForm={incotermFormDef(t, false)} />
      {/* R-199 / R-036: the company default of the reminders and weekly reports, same editors. */}
      <ReminderDefaultsCard values={formOfPrefs(reminders)} canEdit={canEdit} transport={getConfig().mail.transport} />
    </>
  );
}
