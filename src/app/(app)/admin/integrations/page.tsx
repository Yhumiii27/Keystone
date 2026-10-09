// Activity, integrations & audit — /admin/integrations (docs/spec/10 §2, template 2237–2267, logic 4692–4718). Activity
// feed (all projects, source chips), connectors (the prototype's nine, Vigie, connectors added in Keystone; Codex, Vigie
// and Cursus with the mode and state of Keystone's connector layer), import / export formats (drop zones staged — the
// import handlers come later) and the audit trail with its ISO 9001 CSV export (./audit.csv). URL state: `?view=`
// display (activity default, connectors, imports, audit), `?source=` activity kind. Primary "Add connector"
// (AF.plumbing). Roles: director, PM; the others see it outside their workspace (banner, no Sync / Add / export).
import { PageHeader } from '@/components/app/shell/page-header';
import { parseActivitySource, parsePlumbView } from '@/domain/admin';
import { addConnectorForm, firstFreeSystem } from '@/features/admin/forms';
import { plumbingView } from '@/features/admin/model';
import { PlumbingBody } from '@/features/admin/plumbing-view';
import { AddConnectorButton } from '@/features/admin/primary-buttons';
import { listAdminConnectors } from '@/server/dal/admin-connectors';
import { ADDABLE_SYSTEMS, CONNECTOR_FREQUENCIES, getPlumbingCounts, listImportFormats } from '@/server/dal/integrations';
import { countUnreadNotifications, listActivity, listAudit } from '@/server/dal/notifications';
import { getProject, projectLabel } from '@/server/dal/projects';
import { importKindsOf } from '@/server/interchange/rights';
import { getScreenAccess } from '@/server/project-context';
import { getI18n, getLastProject } from '@/server/session';

type SP = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function IntegrationsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const [{ t, lang }, access, activity, connectors, imports, audit, counts, lastProject] = await Promise.all([
    getI18n(), getScreenAccess('plumbing'), listActivity(), listAdminConnectors(), listImportFormats(), listAudit(), getPlumbingCounts(), getLastProject(),
  ]);
  // The unread count and its persona title are the viewer's; the add-form sub-line names the current project.
  const [unread, project] = await Promise.all([countUnreadNotifications(access.viewer.role), access.canEdit ? getProject(lastProject) : null]);
  const view = plumbingView(
    {
      view: parsePlumbView(first(sp.view)),
      source: parseActivitySource(first(sp.source), activity.map((a) => a.kind)),
      activity, connectors, imports, audit, counts, unread, personaTitle: access.viewer.title,
    },
    t, lang,
  );
  const form = addConnectorForm(ADDABLE_SYSTEMS, CONNECTOR_FREQUENCIES);
  return (
    <>
      <PageHeader screen="plumbing" primary={<AddConnectorButton form={form} initialSystem={firstFreeSystem(ADDABLE_SYSTEMS, connectors.map((c) => c.name))} context={project ? t(projectLabel(project)) : undefined} />} />
      <PlumbingBody view={view} canEdit={access.canEdit} importKinds={importKindsOf(access.viewer.role)} t={t} />
    </>
  );
}
