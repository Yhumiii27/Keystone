// Quality — NCR & deliverables — /projects/[code]/quality (docs/spec/07 §2.3, template 1883–1971, logic 4612–4644).
// System boundaries (user decision, overrides the prototype and spec 07): Vigie owns the non-conformities — the NCR log
// is Keystone's view of Vigie's NCRs for the project (mirror through the Vigie connector, src/server/integrations/vigie),
// opened in Vigie ("Open in Vigie", "8D report", "Manage in Vigie"); Keystone records the viewer's own step decisions
// (the next step; the quality manager's verification → Closed / back to Corrective action), sent to Vigie. "New NCR"
// opens Vigie's report form (no Keystone form). The deliverables register is Keystone's: Start → To internal review →
// Submit to client, the client's acceptance (PV) or rejection, back to In progress at the next revision after a
// rejection (R-114), the issued Codex document; on that register the primary action is "New deliverable" for the
// project's manager and the director (R-115, Q-3b), "New NCR" otherwise.
// URL state (docs/spec/00 §8.3): `?tab=ncr|dlv` (default ncr; `?dlv=` alone opens the deliverables register),
// `?filter=minor|major|critical` (NCR severity), `?status=<deliverable status>`, `?ncr=NCR-029`, `?dlv=D-015` (drawers,
// case-insensitive; unknown → none). Unknown values fall back to All.
// Roles: director, PM, engineering lead, quality, client; others get the "Outside my workspace" banner (PageHeader), no
// primary action and no buttons (refused server-side too). A read-only project (pm / client on a project not theirs)
// hides the buttons. The client sees no Vigie link (Vigie is internal) and decides only the deliverables of their
// organisation's projects. P-10b (R-043): the client sees no NCR at all — the screen opens on the deliverables register, without
// the NCR tab, and no NCR row is sent to the browser. Projects without data show empty registers.
import { PageHeader } from '@/components/app/shell/page-header';
import { DELIVERABLE_CREATOR_ROLES, deliverableFilterOf, ncrFilterOf, qualityTabOf } from '@/domain/quality';
import { VigieLink } from '@/features/eco/vigie-link';
import { newDeliverableFormDef } from '@/features/quality/deliverable-form';
import { NewDeliverableButton } from '@/features/quality/quality-buttons';
import { dlvDrawerView, dlvTabView, ncrDrawerView, ncrTabView, qualitySegView, type QualityState, type QualityViewerCtx } from '@/features/quality/model';
import { QualityView } from '@/features/quality/quality-view';
import { getApproverIdentity } from '@/server/dal/myapprovals-identity';
import { deliverableWbsOptions, listDeliverableTypes } from '@/server/dal/quality';
import { getQualityScreen } from '@/server/dal/quality-screen';
import { teamOwnerOptions } from '@/server/dal/team';
import { vigieReportNcrUrl } from '@/server/integrations/vigie/links';
import { getProjectContext } from '@/server/project-context';
import { getI18n } from '@/server/session';
import { projectLabelText } from '@/i18n/data-text';

type SP = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const key = (v: string | undefined) => v?.trim().slice(0, 40).toLowerCase() || null;

export default async function QualityPage({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<SP> }) {
  const [{ code }, sp] = await Promise.all([params, searchParams]);
  const ctx = await getProjectContext(code, 'quality');
  const projectCode = ctx.project.code;
  const [{ t, lang }, data, identity] = await Promise.all([getI18n(), getQualityScreen(projectCode), getApproverIdentity(ctx.viewer)]);
  const viewer: QualityViewerCtx = {
    role: ctx.viewer.role,
    canEdit: ctx.canEdit('quality'),
    isClientContact: identity.clientProjects.includes(projectCode),
    vigie: ctx.viewer.role !== 'client',
  };

  // P-10b: the client's Quality screen is the deliverables register only (no NCR, not even the numbers linked to a deliverable).
  const ncrs = viewer.vigie ? data.ncrs : [];
  const deliverables = viewer.vigie ? data.deliverables : data.deliverables.map((d) => ({ ...d, linkedNcrs: [] }));
  const ncrKey = viewer.vigie ? key(first(sp.ncr)) : null;
  const dlvKey = key(first(sp.dlv));
  const tab = viewer.vigie ? (qualityTabOf(first(sp.tab)) ?? (dlvKey && !ncrKey ? 'dlv' : 'ncr')) : 'dlv';
  const ncr = tab === 'ncr' && ncrKey ? ncrs.find((n) => n.number.toLowerCase() === ncrKey) ?? null : null;
  const dlv = tab === 'dlv' && dlvKey ? deliverables.find((d) => d.number.toLowerCase() === dlvKey) ?? null : null;
  const state: QualityState = {
    tab,
    filter: ncrFilterOf(first(sp.filter)),
    status: deliverableFilterOf(first(sp.status)),
    ncr: ncr?.number ?? null,
    dlv: dlv?.number ?? null,
  };

  const input = { code: projectCode, state, viewer };
  const context = projectLabelText(ctx.project, lang);
  // R-115 (Q-3b): on the deliverables register, the project's manager (and the director) adds deliverables.
  const creates = tab === 'dlv' && viewer.canEdit && DELIVERABLE_CREATOR_ROLES.includes(ctx.viewer.role) && ctx.isLead;
  let primary;
  if (creates) {
    const [types, wbs, team] = await Promise.all([listDeliverableTypes(), deliverableWbsOptions(projectCode), teamOwnerOptions(projectCode)]);
    primary = <NewDeliverableButton code={projectCode} label={t('New deliverable')} context={context} form={newDeliverableFormDef({ types, wbs, team }, t)} />;
  } else if (viewer.vigie) {
    primary = (
      <VigieLink href={vigieReportNcrUrl({ projectCode })} variant="primary" size="md" plus label={`${t('New NCR')} · ${t('Report in Vigie')}`}>
        {t('New NCR')}
      </VigieLink>
    );
  }

  return (
    <>
      <PageHeader screen="quality" projectCode={projectCode} primary={primary} />
      <QualityView
        code={projectCode}
        context={context}
        tab={tab}
        seg={viewer.vigie ? qualitySegView(projectCode, state, t) : qualitySegView(projectCode, state, t).filter((x) => x.value === 'dlv')}
        ncr={tab === 'ncr' ? ncrTabView({ ...input, ncrs, dataDate: data.dataDate }, t, lang) : null}
        ncrDrawer={ncr ? ncrDrawerView({ ...input, ncr, ecoByPart: data.ecoByPart, ordersByPart: data.ordersByPart }, t, lang) : null}
        dlv={tab === 'dlv' ? dlvTabView({ ...input, deliverables }, t, lang) : null}
        dlvDrawer={dlv ? dlvDrawerView({ ...input, deliverable: dlv, documents: data.documents }, t, lang) : null}
        t={t}
      />
    </>
  );
}
