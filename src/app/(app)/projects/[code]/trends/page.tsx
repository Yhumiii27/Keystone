// Trends & status report — /projects/[code]/trends (docs/spec/04 §2, template 1737–1770, logic 4556–4568).
// URL state: `?kpi=cpi|spi|eac|float|risk|slip` selects the charted indicator (prototype `trendKpi`, default CPI).
// Primary action "Generate status report" (AF `trends`) for viewers who may edit the project. Projects without
// weekly snapshots show an empty state (never Harbor Line's series, 00 §7.16).
import { EmptyState } from '@/components/app/EmptyState';
import { SectionCard } from '@/components/app/SectionCard';
import { PageHeader } from '@/components/app/shell/page-header';
import { CardTitle } from '@/components/ds/Card';
import { screenHref } from '@/config/screens';
import { parseTrendKey, type TrendKey } from '@/domain/trends';
import { StatusReportButton } from '@/features/changes/change-buttons';
import { changesT } from '@/features/changes/i18n';
import { TrendsView } from '@/features/changes/trends-view';
import { getTrends } from '@/server/dal/trends';
import { getProjectContext } from '@/server/project-context';
import { getI18n } from '@/server/session';
import { projectLabelText } from '@/i18n/data-text';

type SP = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function TrendsPage({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<SP> }) {
  const [{ code }, sp] = await Promise.all([params, searchParams]);
  const ctx = await getProjectContext(code, 'trends');
  const projectCode = ctx.project.code;
  const [i18n, data] = await Promise.all([getI18n(), getTrends(projectCode)]);
  const { lang } = i18n;
  const t = changesT(i18n.t, lang);

  if (!data)
    return (
      <>
        <PageHeader screen="trends" projectCode={projectCode} />
        <SectionCard gap={10}>
          <CardTitle>{t('Snapshot history')}</CardTitle>
          <EmptyState variant="boxed">{t('No snapshot recorded for this project yet')}</EmptyState>
        </SectionCard>
      </>
    );

  const base = screenHref('trends', { code: projectCode });
  const href = (key: TrendKey) => (key === 'cpi' ? base : `${base}?kpi=${key}`);
  const primary = ctx.canEdit('trends') ? <StatusReportButton code={projectCode} context={projectLabelText(ctx.project, i18n.lang)} /> : undefined;

  return (
    <>
      <PageHeader screen="trends" projectCode={projectCode} primary={primary} />
      <TrendsView
        data={{ snapshots: data.snapshots, series: data.series, bac: data.bac, contingency: data.contingency, nextReport: data.nextReport?.text ?? null }}
        selected={parseTrendKey(first(sp.kpi))}
        href={href}
        lang={lang}
        t={t}
      />
    </>
  );
}
