// Portfolio overview (docs/spec/03 §4): EVM snapshot of the planned projects, zone-filtered, plus portfolio alerts.
import { PageHeader } from '@/components/app/shell/page-header';
import { OverviewBody } from '@/features/portfolio/overview';
import { NewProjectButton } from '@/features/projects/new-project-button';
import { getPortfolioOverview } from '@/server/dal/portfolio';
import { getI18n, getZone } from '@/server/session';
import { getScreenAccess } from '@/server/project-context';

export default async function PortfolioOverviewPage() {
  // R-042 (P-1): a client is sent home before anything is read.
  await getScreenAccess('overview');
  const [{ t, lang }, zone] = await Promise.all([getI18n(), getZone()]);
  const data = await getPortfolioOverview(zone, lang);
  return (
    <>
      <PageHeader screen="overview" primary={<NewProjectButton />} />
      <OverviewBody data={data} zoneSelected={!!zone} t={t} lang={lang} />
    </>
  );
}
