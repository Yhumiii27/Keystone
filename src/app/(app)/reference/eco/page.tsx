// Engineering change orders — /reference/eco (docs/spec/09 §4, template 1312–1376, logic 4339–4370).
// Vigie owns the ECOs (user decision, overrides 09 §4): this is Keystone's view of the ECOs Vigie reports for its parts
// and projects, through the Vigie connector (src/server/integrations/vigie). Keystone shows them, opens them in Vigie
// and records the viewer's progress — the decision on their own approval key and the step advancements of the
// prototype — sent to Vigie. Creation, editing, interchangeability, dispositions, effectivity and release happen in
// Vigie ("New ECO" and "Manage in Vigie" open Vigie in a new window).
// URL state: `?status=draft|impact_analysis|in_approval|released|rejected` (unknown → All), `?eco=<number>` (drawer;
// case-insensitive, unknown → none).
// Roles: director, pm, englead, quality, procurement; others get the "Outside my workspace" banner (PageHeader), no
// primary action and no progress buttons (refused server-side too).
import { PageHeader } from '@/components/app/shell/page-header';
import { ecoFilterOf } from '@/domain/eco';
import { EcoDrawer } from '@/features/eco/eco-drawer';
import { EcoRegister } from '@/features/eco/eco-view';
import { ecoDrawerView, ecoScreenView, type EcoState } from '@/features/eco/model';
import { VigieLink } from '@/features/eco/vigie-link';
import { getEcoScreen } from '@/server/dal/eco-screen';
import { getApproverIdentity } from '@/server/dal/myapprovals-identity';
import { vigieNewEcoUrl } from '@/server/integrations/vigie/links';
import { getScreenAccess } from '@/server/project-context';
import { getI18n } from '@/server/session';

type SP = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function EcoPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const [{ t, lang }, access] = await Promise.all([getI18n(), getScreenAccess('eco')]);
  const [identity, data] = await Promise.all([getApproverIdentity(access.viewer), getEcoScreen(access.viewer, first(sp.eco)?.trim().slice(0, 60) || null)]);
  // `?eco=` as Vigie writes the number (case-insensitive deep link); an unknown ECO opens nothing and is dropped from the links.
  const state: EcoState = { status: ecoFilterOf(first(sp.status)), eco: data.selected };
  const view = ecoScreenView({ ecos: data.ecos, awaitingMine: data.awaitingMine, state, viewer: access.viewer }, t, lang);
  const drawer = data.detail ? ecoDrawerView({ data: data.detail, state, viewer: { role: access.viewer.role, managedProjects: identity.managedProjects } }, t, lang) : null;

  return (
    <>
      <PageHeader
        screen="eco"
        primary={
          <VigieLink href={vigieNewEcoUrl()} variant="primary" size="md" plus>
            {t('New ECO')}
          </VigieLink>
        }
      />
      <EcoRegister view={view} canEdit={access.canEdit} t={t} />
      {drawer && <EcoDrawer view={drawer} canEdit={access.canEdit} t={t} />}
    </>
  );
}
