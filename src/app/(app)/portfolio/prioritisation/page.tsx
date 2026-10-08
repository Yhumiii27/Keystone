// Portfolio — prioritisation & capacity (docs/spec/03 §6; template 2079–2141, logic 4494–4512). Zone screen
// (zone bar, cookie). "Display" switches the Prioritisation tab (KPI tiles, ranking, weights — recomputed live in the
// browser) and the Capacity what-if tab (`?tab=capacity`, candidate `?project=`); `?sel=` keeps the selected ranking
// row. Primary action "Score a proposal" (AF `portfolio`). Viewers outside the workspace get the read-only render.
import { GlobeHemisphereEast } from '@phosphor-icons/react/dist/ssr';
import { Callout } from '@/components/app/Callout';
import { Stack } from '@/components/app/SectionCard';
import { PageHeader } from '@/components/app/shell/page-header';
import { CapacityView } from '@/features/pfinance/capacity-view';
import { DisplaySeg } from '@/features/pfinance/display-seg';
import { pfT } from '@/features/pfinance/i18n';
import { capacityView, parsePfTab } from '@/features/pfinance/model';
import { PrioritisationBoard } from '@/features/pfinance/prioritisation-board';
import { ScoreProposalButton } from '@/features/pfinance/score-proposal-button';
import { getCapacityScreen, getPrioritisationScreen, listProposalOptions } from '@/server/dal/pfinance';
import { getScreenAccess } from '@/server/project-context';
import { getI18n, getZone } from '@/server/session';

type SearchParams = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || null;

export default async function PrioritisationPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const tab = parsePfTab(first(sp.tab));
  const sel = first(sp.sel);
  const asked = first(sp.project);
  const [{ t: t0, lang }, zone, { viewer, outside }] = await Promise.all([getI18n(), getZone(), getScreenAccess('portfolio')]);
  const t = pfT(t0, lang);
  const [{ candidates, ...data }, options] = await Promise.all([getPrioritisationScreen(viewer.role, zone), outside ? Promise.resolve([]) : listProposalOptions()]);

  // Candidate of the what-if: `?project=` when it is a pipeline project of the zone, else the first one (`pfWhatif`).
  const candidate = candidates.find((c) => c.code === asked) ?? candidates[0] ?? null;
  const capacityInput = tab === 'capacity' && candidate ? await getCapacityScreen(candidate.code) : null;
  const zoneEmpty = data.zoneSelected && data.projects.length === 0;

  return (
    <>
      <PageHeader screen="portfolio" primary={<ScoreProposalButton options={options} />} />
      <Stack gap={14}>
        <DisplaySeg tab={tab} zone={zone} />
        {zoneEmpty && (
          <Callout icon={GlobeHemisphereEast} role="status">
            {t('No project in this zone for this view')}
          </Callout>
        )}
        {tab === 'score' ? (
          <PrioritisationBoard data={data} canEdit={!outside} initialSel={sel} zone={zone} />
        ) : candidate && capacityInput ? (
          <CapacityView candidates={candidates.map((c) => c.code)} current={candidate.code} view={capacityView(capacityInput, t, lang)} sel={sel} t={t} />
        ) : (
          !zoneEmpty && (
            <Callout icon={GlobeHemisphereEast} role="status">
              {t('No pipeline project to absorb')}
            </Callout>
          )
        )}
      </Stack>
    </>
  );
}
