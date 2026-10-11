// Warranty claims & interventions — /after-sales/claims (docs/spec/07 §2.9, template 956–971, logic 4979–4995). After-
// sales on the installed base, filtered by the zone bar (claims and interventions of the zone's machines).
// URL state: `?view=claims|interventions|costs` (unknown → Claims), `?claim=WC-014` (R-143: the claim's drawer on the
// Claims view; unknown → none). Claims linked to a design ECO carry its tag: it opens the ECO on the Change orders screen
// when Vigie reports it to Keystone, else in Vigie (Vigie owns the ECOs; Vigie is internal: no Vigie link for the client).
// Primary action "New claim" (AF `sav`) on the Claims and Costs views, "Plan intervention" (a preventive visit) on the
// Interventions view. R-143 (Q-8): the drawer drives the claim — Edit claim (coverage, owner, cost, next step, diagnosis,
// design ECO), Mark diagnosed, Plan intervention, Close claim — and a planned intervention is marked done (with the part
// fitted, which updates the machine's configuration, R-144). Roles: director, pm, quality, procurement; others get the
// "Outside my workspace" banner (PageHeader), no primary action and no step (refused server-side too). Sidebar badge:
// open Major / Critical claims (`savNavBadge`).
import { PageHeader } from '@/components/app/shell/page-header';
import { savViewOf } from '@/domain/aftersales';
import { NewClaimButton } from '@/features/aftersales/add-buttons';
import { ClaimDrawer } from '@/features/aftersales/claim-drawer';
import { claimDrawerView } from '@/features/aftersales/claim-drawer-model';
import { FollowupFormButton } from '@/features/aftersales/followup-buttons';
import { claimFormDef, interventionDoneFormDef, localizeForm, planInterventionFormDef } from '@/features/aftersales/forms';
import { savView } from '@/features/aftersales/model';
import { SavBody } from '@/features/aftersales/sav-view';
import { claimFormOptions, getSavScreen } from '@/server/dal/aftersales';
import { CLAIM_OWNERS, getClaim, interventionPartOptions } from '@/server/dal/claims';
import { machineConfigurations } from '@/server/dal/fleet';
import { getProject } from '@/server/dal/projects';
import { NOW_ISO, displayOfIso } from '@/server/db/codes';
import { getScreenAccess } from '@/server/project-context';
import { getI18n, getLastProject, getZone } from '@/server/session';
import { projectLabelText } from '@/i18n/data-text';

type SP = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function WarrantyClaimsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const view = savViewOf(first(sp.view));
  const [{ t, lang }, access, zone] = await Promise.all([getI18n(), getScreenAccess('sav'), getZone()]);
  const data = await getSavScreen(zone);
  const vigie = access.viewer.role !== 'client';

  let primary;
  if (access.canEdit) {
    const [opts, project] = await Promise.all([claimFormOptions(), getLastProject().then(getProject)]);
    const context = project ? projectLabelText(project, lang) : undefined;
    primary =
      view === 'interventions' ? (
        <FollowupFormButton kind="plan-preventive" target={null} label={t('Plan intervention')} context={context} form={localizeForm(planInterventionFormDef(opts.machines, { technicians: '' }), t, lang)} variant="primary" size="md" />
      ) : (
        <NewClaimButton label={t('New claim')} form={localizeForm(claimFormDef(opts.machines, opts.owners), t, lang)} context={context} />
      );
  }

  // R-143: "Mark done" forms of the planned interventions shown (parts: the machine's configuration, then the catalogue).
  const today = displayOfIso(NOW_ISO);
  const doneForms =
    access.canEdit && view === 'interventions'
      ? Object.fromEntries(
          await Promise.all(
            data.interventions.filter((i) => i.status === 'planned').map(async (i) => [i.number, localizeForm(interventionDoneFormDef(await interventionPartOptions(i.machineNumber), today), t, lang)] as const),
          ),
        )
      : undefined;

  // R-143: the claim drawer (Claims view), for a claim of the zone shown.
  const claimKey = view === 'claims' ? first(sp.claim)?.trim().toUpperCase().slice(0, 12) : undefined;
  const claim = claimKey && data.claims.some((c) => c.number === claimKey) ? await getClaim(claimKey) : null;
  let drawer;
  if (claim) {
    const [configs, parts] = await Promise.all([machineConfigurations([claim.machineNumber]), interventionPartOptions(claim.machineNumber)]);
    drawer = (
      <ClaimDrawer
        view={claimDrawerView({ claim, ecos: data.ecos, config: configs.get(claim.machineNumber) ?? [], parts, owners: CLAIM_OWNERS, viewer: { vigie, canEdit: access.canEdit } }, t, lang)}
        t={t}
      />
    );
  }

  return (
    <>
      <PageHeader screen="sav" primary={primary} />
      <SavBody view={savView(data, view, zone, t, lang, { vigie, canEdit: access.canEdit, selectedClaim: claim?.number ?? null, doneForms })} t={t} drawer={drawer} />
    </>
  );
}
