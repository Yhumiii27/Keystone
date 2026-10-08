// Projects map body (docs/spec/03 §3; template 215–236): KPI tiles, map + "Sites" list, footer hint.
// Server Component; the map and the list are one client island (MapPanels).
import { KpiGrid, KpiTile } from '@/components/app/Kpi';
import { LO, OK } from '@/components/app/tones';
import type { T } from '@/i18n/translate';
import { MapPanels } from './map-panels';
import type { WorldMapModel } from './model';
import s from './worldmap.module.css';

export function WorldMapBody({ model, t }: { model: WorldMapModel; t: T }) {
  return (
    <div className={s.body}>
      <KpiGrid min={160}>
        {model.kpis.map((k) => (
          <KpiTile key={k.key} label={k.label} value={k.value} sub={k.sub} color={k.alert ? LO : OK} />
        ))}
      </KpiGrid>
      <MapPanels
        model={{ points: model.points, labels: model.labels, zone: model.zone, groups: model.groups, siteCount: model.siteCount, zoneEmpty: model.zoneEmpty }}
        sitesLabel={t('Sites')}
        zoneEmptyText={t('No project in this zone for this view')}
      />
      <span className={s.hint}>{t('Pan and zoom · click a marker to open the project · hover a project to highlight it on the map')}</span>
    </div>
  );
}
