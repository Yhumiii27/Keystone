// Risk register — /projects/[code]/risks (docs/spec/07 §2.1, template 1771–1832, logic 4570–4590).
// URL state (docs/spec/00 §8.3): `?filter=<category code>` (riskFilter, default All), `?risk=R-03` opens the drawer.
// Primary action "New risk" (AF `risks`); drawer edits (P, I, response, close / reopen) go through
// src/features/risks/actions.ts. Hidden / read-only when the screen is outside the viewer's workspace or the project
// is read-only for them. Projects without a register show the empty register (no Harbor Line data, 00 §7.16).
// R-205 (K-205): the « Analyse de risques » section (Monte-Carlo on schedule and cost) follows the register; `?analysis=ranges`
// shows the three-point estimates. Its edit controls are for the project's leads (canEditRiskAnalysis).
import { PageHeader } from '@/components/app/shell/page-header';
import { FORM_CATEGORIES, parseCategory } from '@/domain/risk';
import { orderedOptions } from '@/domain/settings-rules';
import { NewRiskButton } from '@/features/risks/add-buttons';
import { riskFormDef } from '@/features/risks/forms';
import { riskRegisterView } from '@/features/risks/model';
import { RiskRegister } from '@/features/risks/risk-register';
import { RiskAnalysisSection } from '@/features/risk-analysis/risk-analysis-section';
import { canEditRiskAnalysis } from '@/domain/monte-carlo';
import { screenHref } from '@/config/screens';
import { Stack } from '@/components/app/SectionCard';
import { getRiskAnalysis } from '@/server/dal/risk-analysis';
import { getRiskScreen } from '@/server/dal/risks-screen';
import { riskCategoryOptions } from '@/server/dal/settings-lists';
import { getProjectContext } from '@/server/project-context';
import { getI18n } from '@/server/session';
import { projectLabelText } from '@/i18n/data-text';

type SP = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** The register's URL keeping its filter and drawer, with or without `?analysis=ranges`. */
function analysisHref(code: string, sp: SP, analysis: 'ranges' | null) {
  const q = new URLSearchParams();
  for (const key of ['filter', 'risk']) {
    const v = first(sp[key]);
    if (v) q.set(key, v);
  }
  if (analysis) q.set('analysis', analysis);
  const qs = q.toString();
  return `${screenHref('risks', { code })}${qs ? `?${qs}` : ''}`;
}

export default async function RisksPage({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<SP> }) {
  const [{ code }, sp] = await Promise.all([params, searchParams]);
  const ctx = await getProjectContext(code, 'risks');
  const projectCode = ctx.project.code;
  const [{ t, lang }, data, cats, analysis] = await Promise.all([getI18n(), getRiskScreen(projectCode), riskCategoryOptions(), getRiskAnalysis(projectCode)]);
  const canEdit = ctx.canEdit('risks');

  const view = riskRegisterView(
    {
      code: projectCode,
      risks: data?.register.risks ?? [],
      contingency: data?.contingency ?? 0,
      filter: parseCategory(first(sp.filter), cats.all.map((c) => c.code)),
      selected: first(sp.risk) ?? null,
    },
    t,
    lang,
  );

  const primary =
    canEdit && data ? (
      // A-14: the form offers the active Settings › Risk categories (the prototype's order first).
      <NewRiskButton code={projectCode} context={projectLabelText(ctx.project, lang)} form={riskFormDef(data.team, orderedOptions(cats.active, FORM_CATEGORIES))} />
    ) : undefined;

  return (
    <>
      <PageHeader screen="risks" projectCode={projectCode} primary={primary} />
      <Stack>
        <RiskRegister code={projectCode} view={view} canEdit={canEdit} t={t} />
        {analysis && (
          <RiskAnalysisSection
            code={projectCode}
            context={projectLabelText(ctx.project, lang)}
            data={analysis}
            canEdit={canEditRiskAnalysis({ lead: ctx.isLead, canEdit })}
            showRanges={first(sp.analysis) === 'ranges'}
            rangesHref={analysisHref(projectCode, sp, 'ranges')}
            summaryHref={analysisHref(projectCode, sp, null)}
            t={t}
            lang={lang}
          />
        )}
      </Stack>
    </>
  );
}
