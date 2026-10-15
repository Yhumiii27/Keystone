// Projects map (docs/spec/03 §3, 02 SCR-WORLDMAP-FRAME; template 215–236; logic 5072–5081): world map of the
// portfolio's sites, zone-filtered (zone bar), with KPI tiles and the "Sites" list grouped by city. A project opens
// its Plan when it has planning data, else the Projects register searched by its code. No primary action
// (docs/spec/01 §5.9) and no write: read-only for every viewer, outside-workspace viewers get the shell banner.
import { PageHeader } from '@/components/app/shell/page-header';
import { buildWorldMapModel } from '@/features/worldmap/model';
import { WorldMapBody } from '@/features/worldmap/worldmap-body';
import { getProjectsMap } from '@/server/dal/geo';
import { getI18n, getZone } from '@/server/session';
import { getScreenAccess } from '@/server/project-context';

export default async function ProjectsMapPage() {
  // R-042 (P-1): a client is sent home before anything is read.
  await getScreenAccess('worldmap');
  const [{ t, lang }, zone] = await Promise.all([getI18n(), getZone()]);
  const model = buildWorldMapModel(await getProjectsMap(zone), t, lang);
  return (
    <>
      <PageHeader screen="worldmap" crumbExtra={model.crumbExtra} />
      <WorldMapBody model={model} t={t} />
    </>
  );
}
