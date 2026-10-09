// Settings — personalisable lists — /admin/settings (docs/spec/10 §1, template 1573–1597, logic 4437–4445). Company
// reference lists (stock locations, skills, cost categories, project statuses, risk categories, deliverable types,
// public holidays) and the project health thresholds, persisted (src/server/dal/settings.ts). Primary "Reset to
// defaults" (with a confirmation). Roles: director, PM, department head, engineering lead, quality, procurement; member
// and client see the lists outside their workspace (banner, read-only, no controls). Writes: src/features/admin/actions.ts.
// Chapter 4 (A-14): only the portfolio director edits — the other roles of the workspace read the lists (no controls,
// no Reset, a read-only note); the lists drive the modules and the thresholds the one health rule (A-13).
import { PageHeader } from '@/components/app/shell/page-header';
import { canEditSettings } from '@/domain/settings-rules';
import { settingsView } from '@/features/admin/model';
import { ResetSettingsButton } from '@/features/admin/primary-buttons';
import { SettingsBody } from '@/features/admin/settings-view';
import { getSettings } from '@/server/dal/settings';
import { getScreenAccess } from '@/server/project-context';
import { getI18n } from '@/server/session';

export default async function SettingsPage() {
  const [{ t }, access, data] = await Promise.all([getI18n(), getScreenAccess('settings'), getSettings()]);
  const canEdit = access.canEdit && canEditSettings(access.viewer.role);
  return (
    <>
      <PageHeader screen="settings" primary={canEdit ? <ResetSettingsButton /> : undefined} />
      <SettingsBody view={settingsView(data, t)} canEdit={canEdit} directorOnlyNote={access.canEdit && !canEdit} />
    </>
  );
}
