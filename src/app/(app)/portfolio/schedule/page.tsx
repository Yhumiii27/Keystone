// Portfolio schedule — projects in progress & pipeline (docs/spec/05 §3; template 972–1023, logic 4523–4555).
// 24-month portfolio Gantt of the live projects of the selected zone (zone cookie): pipeline stage gates and group
// boards, execution bars with progress, baseline finish and forecast slip. Stage filter `?filter=exec|pipe`.
// Read-only for every persona (no primary action, spec 01 §5.9); outside the workspace the shell adds the banner.
import { PageHeader } from '@/components/app/shell/page-header';
import { isPgFilter, portfolioScheduleModel } from '@/domain/pfplan';
import { PfPlanBody } from '@/features/pfplan/view';
import { getPortfolioSchedule } from '@/server/dal/pipeline';
import { getI18n, getZone } from '@/server/session';

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function PortfolioSchedulePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [sp, { t, lang }, zone] = await Promise.all([searchParams, getI18n(), getZone()]);
  const f = one(sp.filter);
  const filter = isPgFilter(f) ? f : 'all';
  const model = portfolioScheduleModel(await getPortfolioSchedule(zone), { filter, lang });
  return (
    <>
      <PageHeader screen="pfplan" />
      <PfPlanBody model={model} filter={filter} zoneSelected={!!zone} t={t} lang={lang} />
    </>
  );
}
