// Budget & cost — /projects/[code]/budget?tab=perf|setup|cash (docs/spec/04 §1; template 286–484).
// Header primary "Change request" only switches to the Structure & changes tab, as in the prototype (§1.7).
import { Plus } from '@phosphor-icons/react/dist/ssr';
import { EmptyState } from '@/components/app';
import { PageHeader } from '@/components/app/shell/page-header';
import { ButtonLink } from '@/components/ds/Button';
import { screenHref } from '@/config/screens';
import { cashRecovery, contractValue, evmCore, offerSummary, openCommitment, termsDays } from '@/domain/evm';
import { budgetT } from '@/features/budget/i18n';
import { CashTab } from '@/features/budget/cash-tab';
import { PerformanceTab } from '@/features/budget/performance-tab';
import { SetupTab } from '@/features/budget/setup-tab';
import { BudgetViewBar, budgetTabHref, parseBudgetTab } from '@/features/budget/view-bar';
import s from '@/features/budget/budget.module.css';
import { money } from '@/lib/format';
import { categoryAmountFrozen } from '@/domain/baseline-policy';
import { getBudgetData } from '@/server/dal/budget';
import { getBudgetEstimate } from '@/server/dal/estimate-class';
import { estimateKpi } from '@/features/budget/estimate-class-field';
import { KpiGrid, KpiTile, LO, OK } from '@/components/app';
import { listProjectBaselines } from '@/server/dal/baselines';
import { healthThresholds } from '@/server/dal/health-thresholds';
import { costCategoryOptions } from '@/server/dal/settings-lists';
import { getProjectContext } from '@/server/project-context';
import { getI18n } from '@/server/session';
import { projectLabelText } from '@/i18n/data-text';

export default async function BudgetPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ code }, sp] = await Promise.all([params, searchParams]);
  // Delivery 8: the Settings health thresholds colour the Performance tiles (R-080, C-1); the category amounts are frozen after
  // BL1 (R-081, C-3a — the same "after BL1" test as Set baseline).
  const [ctx, i18n, data, th] = await Promise.all([getProjectContext(code, 'budget'), getI18n(), getBudgetData(code), healthThresholds()]);
  // R-188: the budget's estimate class and range (current baseline, else the class of the stage).
  const est = await getBudgetEstimate(ctx.project.code);
  const { lang } = i18n;
  const t = budgetT(i18n.t, lang);
  const projectCode = ctx.project.code;
  const base = screenHref('budget', { code: projectCode });
  const estimate = est ? estimateKpi(est, (k) => money(k, lang), t) : undefined;

  if (!data)
    return (
      <>
        <PageHeader screen="budget" projectCode={projectCode} />
        <div className={s.stack}>
          {/* R-188: a project without cost data (pipeline) still shows its budget, class and range. */}
          {est && estimate && (
            <KpiGrid min={140}>
              <KpiTile label={t('Budget (BAC)')} value={money(est.bac, lang)} sub={t('Current budget')} color={OK} />
              <KpiTile label={estimate.label} value={estimate.value} sub={estimate.sub} color={estimate.alert ? LO : OK} />
            </KpiGrid>
          )}
          <EmptyState variant="boxed">{t('No cost data for this project yet')}</EmptyState>
        </div>
      </>
    );

  const tab = parseBudgetTab(sp.tab);
  const { cost, rex, contract } = data;
  const core = evmCore({ pv: cost.pv, ev: cost.ev, ac: cost.ac, bac: cost.bac });
  const offer = cost.offer;

  // costProfile.sourceText · costProfile.rexText (logic 3831)
  const sum = offerSummary(offer, cost.bac);
  const sourceText = `${sum.count} quotes from the commercial offer · ${money(sum.amount, lang)} · ${sum.pctOfBac} % of BAC`;
  const rexText = rex
    ? `REX ${rex.mt} · ${rex.refs.length}${rex.refs.length > 1 ? ' reference projects' : ' reference project'} · pattern ${rex.dep} / ${rex.deliv}${rex.acc ? ' / ' + rex.acc : ''}`
    : '';
  const profileText = t(sourceText) + (rexText ? ' · ' + t(rexText) : '');

  let body;
  if (tab === 'setup') {
    const [options, bls] = ctx.canEdit('budget') ? await Promise.all([costCategoryOptions(), listProjectBaselines(projectCode)]) : [[], []];
    body = (
      <SetupTab
        cost={cost}
        offer={offer}
        rex={rex}
        profileText={profileText}
        planHref={screenHref('plan', { code: projectCode })}
        canEdit={ctx.canEdit('budget')}
        code={projectCode}
        context={projectLabelText(ctx.project, lang)}
        categoryOptions={options}
        amountsFrozen={categoryAmountFrozen(bls.map((b) => b.code))}
        equipment={data.equipment}
        lang={lang}
        t={t}
      />
    );
  } else if (tab === 'cash') {
    const total = contract ? contractValue(contract.amount, contract.amendments) : 0;
    const recovery = contract
      ? cashRecovery({
          pv: cost.pv,
          ac: cost.ac,
          bac: cost.bac,
          evn: core.evn,
          cpi: core.cpi,
          contractTotal: total,
          milestones: contract.milestones,
          termsDays: termsDays(contract.terms),
          openCommit: openCommitment(cost.pv, core.evn, contract.openCommit),
          year: contract.year,
        })
      : null;
    body = <CashTab recovery={recovery} contractTotal={total} terms={contract?.terms ?? ''} ac={core.ac} lang={lang} t={t} />;
  } else {
    body = <PerformanceTab cost={cost} core={core} offer={offer} profileText={profileText} setupHref={budgetTabHref(base, 'setup')} th={th} estimate={estimate} lang={lang} t={t} />;
  }

  return (
    <>
      <PageHeader
        screen="budget"
        projectCode={projectCode}
        primary={
          <ButtonLink href={budgetTabHref(base, 'setup')} variant="primary" icon={Plus} scroll={false}>
            {t('Change request')}
          </ButtonLink>
        }
      />
      <div className={s.stack}>
        <BudgetViewBar tab={tab} base={base} t={t} />
        {body}
      </div>
    </>
  );
}
