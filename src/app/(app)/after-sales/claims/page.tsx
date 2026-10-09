// Warranty claims & interventions — /after-sales/claims (docs/spec/07 §2.9, template 956–971, logic 4979–4995). After-
// sales on the installed base, filtered by the zone bar (claims and interventions of the zone's machines).
// URL state: `?view=claims|interventions|costs` (unknown → Claims). Claims linked to a design ECO carry its tag: it
// opens the ECO on the Change orders screen when Vigie reports it to Keystone, else in Vigie (Vigie owns the ECOs;
// Vigie is internal: no Vigie link for the client).
// Primary action "New claim" (AF `sav`). Roles: director, pm, quality, procurement; others get the "Outside my
// workspace" banner (PageHeader) and no primary action (refused server-side too). Sidebar badge: open Major / Critical
// claims (`savNavBadge`).
import { PageHeader } from '@/components/app/shell/page-header';
import { savViewOf } from '@/domain/aftersales';
import { NewClaimButton } from '@/features/aftersales/add-buttons';
import { claimFormDef, localizeForm } from '@/features/aftersales/forms';
import { savView } from '@/features/aftersales/model';
import { SavBody } from '@/features/aftersales/sav-view';
import { claimFormOptions, getSavScreen } from '@/server/dal/aftersales';
import { getProject, projectLabel } from '@/server/dal/projects';
import { getScreenAccess } from '@/server/project-context';
import { getI18n, getLastProject, getZone } from '@/server/session';

type SP = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function WarrantyClaimsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const view = savViewOf(first(sp.view));
  const [{ t, lang }, access, zone] = await Promise.all([getI18n(), getScreenAccess('sav'), getZone()]);
  const data = await getSavScreen(zone);

  let primary;
  if (access.canEdit) {
    const [opts, project] = await Promise.all([claimFormOptions(), getLastProject().then(getProject)]);
    primary = <NewClaimButton label={t('New claim')} form={localizeForm(claimFormDef(opts.machines, opts.owners), t, lang)} context={project ? t(projectLabel(project)) : undefined} />;
  }

  return (
    <>
      <PageHeader screen="sav" primary={primary} />
      <SavBody view={savView(data, view, zone, t, lang, { vigie: access.viewer.role !== 'client' })} t={t} />
    </>
  );
}
