// Risk register — /projects/[code]/risks (docs/spec/07 §2.1, template 1771–1832, logic 4570–4590).
// URL state (docs/spec/00 §8.3): `?filter=<category code>` (riskFilter, default All), `?risk=R-03` opens the drawer.
// Primary action "New risk" (AF `risks`); drawer edits (P, I, response, close / reopen) go through
// src/features/risks/actions.ts. Hidden / read-only when the screen is outside the viewer's workspace or the project
// is read-only for them. Projects without a register show the empty register (no Harbor Line data, 00 §7.16).
import { PageHeader } from '@/components/app/shell/page-header';
import { parseCategory } from '@/domain/risk';
import { NewRiskButton } from '@/features/risks/add-buttons';
import { riskFormDef } from '@/features/risks/forms';
import { riskRegisterView } from '@/features/risks/model';
import { RiskRegister } from '@/features/risks/risk-register';
import { projectLabel } from '@/server/dal/projects';
import { getRiskScreen } from '@/server/dal/risks-screen';
import { getProjectContext } from '@/server/project-context';
import { getI18n } from '@/server/session';

type SP = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function RisksPage({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<SP> }) {
  const [{ code }, sp] = await Promise.all([params, searchParams]);
  const ctx = await getProjectContext(code, 'risks');
  const projectCode = ctx.project.code;
  const [{ t, lang }, data] = await Promise.all([getI18n(), getRiskScreen(projectCode)]);
  const canEdit = ctx.canEdit('risks');

  const view = riskRegisterView(
    {
      code: projectCode,
      risks: data?.register.risks ?? [],
      contingency: data?.contingency ?? 0,
      filter: parseCategory(first(sp.filter)),
      selected: first(sp.risk) ?? null,
    },
    t,
    lang,
  );

  const primary =
    canEdit && data ? <NewRiskButton code={projectCode} context={t(projectLabel(ctx.project))} form={riskFormDef(data.team)} /> : undefined;

  return (
    <>
      <PageHeader screen="risks" projectCode={projectCode} primary={primary} />
      <RiskRegister code={projectCode} view={view} canEdit={canEdit} t={t} />
    </>
  );
}
