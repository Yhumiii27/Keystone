// Activity, integrations & audit — /admin/integrations (docs/spec/10 §2, template 2237–2267, logic 4692–4718). Activity
// feed (all projects, source chips), connectors (the prototype's nine, Vigie, connectors added in Keystone; Codex, Vigie
// and Cursus with the mode and state of Keystone's connector layer), import / export cards (D-7b: the import cards only
// while IMPORTS_ENABLED is on in src/domain/ch4-defaults.ts; the "Export — …" cards always) and the audit trail with its
// ISO 9001 CSV export (./audit.csv). URL state: `?view=` display (activity default, connectors, imports, audit), `?source=`
// activity kind. No primary action: IT configures the connectors outside Keystone (D-7a, R-020 — the connectors file and
// the server environment; "Configure" shows them read-only). Roles: director, PM; the others see it outside their
// workspace (banner, no Sync / export).
import { PageHeader } from '@/components/app/shell/page-header';
import { parseActivitySource, parsePlumbView } from '@/domain/admin';
import { plumbingView, visibleImportFormats } from '@/features/admin/model';
import { PlumbingBody } from '@/features/admin/plumbing-view';
import { listAdminConnectors } from '@/server/dal/admin-connectors';
import { getPlumbingCounts, listImportFormats } from '@/server/dal/integrations';
import { countUnreadNotifications, listActivity, listAudit } from '@/server/dal/notifications';
import { importKindsOf } from '@/server/interchange/rights';
import { getScreenAccess } from '@/server/project-context';
import { getI18n } from '@/server/session';

type SP = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function IntegrationsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const [{ t, lang }, access, activity, connectors, imports, audit, counts] = await Promise.all([
    getI18n(), getScreenAccess('plumbing'), listActivity(), listAdminConnectors(), listImportFormats(), listAudit(), getPlumbingCounts(),
  ]);
  // The unread count and its persona title are the viewer's.
  const unread = await countUnreadNotifications(access.viewer);
  const view = plumbingView(
    {
      view: parsePlumbView(first(sp.view)),
      source: parseActivitySource(first(sp.source), activity.map((a) => a.kind)),
      activity, connectors, imports: visibleImportFormats(imports), audit, counts, unread, personaTitle: access.viewer.title,
    },
    t, lang,
  );
  return (
    <>
      <PageHeader screen="plumbing" />
      <PlumbingBody view={view} canEdit={access.canEdit} importKinds={importKindsOf(access.viewer.role)} t={t} />
    </>
  );
}
