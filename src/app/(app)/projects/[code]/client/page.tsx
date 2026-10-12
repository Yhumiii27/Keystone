// My project — client view — /projects/[code]/client (docs/spec/03 §8, template 2180–2236, logic 4679–4690, 5061).
// URL state (docs/spec/00 §8.3): `?tab=progress|planning|decisions|invoices|issues|docs` (cpTab, default Progress & milestones;
// `planning` = the read-only summary Gantt and milestones with the Gantt PDF, S-9a).
// Workspace: client and director (others see it outside their workspace, read-only, without the primary action). The
// portal ignores the project read-only mode (01 §5.9), but only the client contact of the project's client organisation
// decides (change-request client step, deliverable acceptance), acknowledges documents and — with the director —
// raises issues; the Server Functions re-check. Primary action "Download status report" (AF `client`).
// R-139 (P-11 a): the director and the project's leads open it from the "View as client" entry of the project screens; PageHeader
// then shows the "Client view · preview · read-only" banner (with "Back to project") instead of the outside banner. The PM stays
// outside here (no primary, no edits); the director keeps "Raise issue" (open question: P-11 "lecture seule" vs I-2b).
import { PageHeader } from '@/components/app/shell/page-header';
import { parseClientTab } from '@/domain/rexclient';
import { StatusReportButton } from '@/features/rexclient/buttons';
import { ClientView } from '@/features/rexclient/client-view';
import { getClientScreen } from '@/features/rexclient/screen';
import { getProjectContext } from '@/server/project-context';
import { getI18n } from '@/server/session';
import { projectLabelText } from '@/i18n/data-text';

type SP = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function ClientPortalPage({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<SP> }) {
  const [{ code }, sp] = await Promise.all([params, searchParams]);
  const ctx = await getProjectContext(code, 'client');
  const projectCode = ctx.project.code;
  const { t, lang } = await getI18n();
  const view = await getClientScreen(projectCode, parseClientTab(first(sp.tab)), t, lang);
  const projectClient = !ctx.outside && ctx.viewer.role === 'client' && ctx.isMine;
  const can = { decide: projectClient, raise: projectClient || (!ctx.outside && ctx.viewer.role === 'director') };
  const primary = ctx.outside ? undefined : <StatusReportButton code={projectCode} context={projectLabelText(ctx.project, lang)} />;
  return (
    <>
      <PageHeader screen="client" projectCode={projectCode} primary={primary} />
      <ClientView code={projectCode} view={view} can={can} t={t} />
    </>
  );
}
