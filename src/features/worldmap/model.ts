// Projects map view model (docs/spec/03 §3; template 215–236; logic 5072–5081). Builds, from the DAL map
// (getProjectsMap), everything the screen renders — translated: KPI tiles, the "Sites" list grouped by city and
// the map points (marker style, tooltip tags, open link) and labels. Pure; server-compatible.
import type { TagTone } from '@/components/ds/Tag';
import type { MapTagView, ProjectsMapLabels, ProjectsMapPoint } from '@/components/charts/projects-map';
import { HEALTH_TONE, lifecycleTone, type Tone } from '@/components/app/tones';
import { screenHref } from '@/config/screens';
import { HEALTH_LABEL } from '@/domain/health';
import {
  mapCrumbExtra, mapKpis, markerStyleOf, tooltipStatusTone, type GeoBounds, type MapCategory, type MapKpiView,
} from '@/domain/worldmap';
import type { T } from '@/i18n/translate';
import type { MapPoint, ProjectsMap } from '@/server/dal/geo';

/** One project on the map (tooltip row): `mapPts` with codes kept and labels translated. */
export type MapPointView = ProjectsMapPoint & { category: MapCategory };

/** One project row of the "Sites" list. */
export interface SiteItemView {
  code: string;
  name: string;
  sub: string;
  /** Stage tag with the app's stage tone (`statusTag`). */
  status: MapTagView;
  health: MapTagView | null;
  href: string;
}

/** One site card: a distinct city|country with its projects (`mapGroups`, count desc then city). */
export interface SiteGroupView {
  key: string;
  city: string;
  country: string;
  count: number;
  /** First project of the site: the map zooms on it (`focus`). */
  focusCode: string;
  items: SiteItemView[];
}

export interface WorldMapModel {
  /** Translated KPI tiles. */
  kpis: MapKpiView[];
  siteCount: number;
  /** A zone is selected and has no located project (`zoneEmptyMap`). */
  zoneEmpty: boolean;
  groups: SiteGroupView[];
  points: MapPointView[];
  /** Map labels (`mapUi`, translated; `europe` is the zone name when one is selected) and accessibility names. */
  labels: ProjectsMapLabels;
  /** Selected zone frame, null for the whole portfolio. */
  zone: { code: string; label: string; bounds: GeoBounds } | null;
  /** Breadcrumb extra, EN source ("17 projects located · Africa"). */
  crumbExtra: string;
}

const name = (p: MapPoint, t: T) => `${p.project.displayId} · ${t(p.project.name)}`;
const sub = (p: MapPoint, t: T) => [p.project.code, p.project.pm, t(p.project.client)].filter(Boolean).join(' · ');
/** DS tag tone of a status tone ("muted" never applies to a stage or a health). */
const tagTone = (tone: Tone): TagTone => (tone === 'muted' ? 'neutral' : tone);
const healthTag = (p: MapPoint, t: T): MapTagView | null => (p.health ? { label: t(HEALTH_LABEL[p.health]), tone: tagTone(HEALTH_TONE[p.health]) } : null);

/** Where a map or list row leads (`p.open`, logic 5081 / map message `open`, logic 3765). */
export function openHref(p: { code: string; hasData: boolean }): string {
  return p.hasData ? screenHref('plan', { code: p.code }) : `${screenHref('projects')}?q=${encodeURIComponent(p.code)}`;
}

export function buildWorldMapModel(map: ProjectsMap, t: T): WorldMapModel {
  const zoneLabel = map.zone?.label ?? null;
  const kpis = mapKpis(
    map.points.map((p) => ({ category: p.category, health: p.health, site: `${p.city}|${p.country}`, country: p.country })),
    map.unlocated,
    zoneLabel,
  ).map((k) => ({ ...k, label: t(k.label), value: k.value, sub: t(k.sub) }));

  const points: MapPointView[] = map.points.map((p) => ({
    code: p.project.code,
    name: name(p, t),
    sub: sub(p, t),
    city: p.city,
    country: t(p.country),
    lat: p.lat,
    lng: p.lng,
    category: p.category,
    style: markerStyleOf(p.category, p.health),
    status: { label: t(p.project.status), tone: tooltipStatusTone(p.category, p.health) },
    health: healthTag(p, t),
    href: openHref(p.project),
  }));

  const groups: SiteGroupView[] = map.groups.map((g) => ({
    key: `${g.city}|${g.country}`,
    city: g.city,
    country: t(g.country),
    count: g.points.length,
    focusCode: g.points[0].project.code,
    items: g.points.map((p) => ({
      code: p.project.code,
      name: name(p, t),
      sub: `${p.project.code} · ${p.project.pm} · ${t(p.project.client)}`,
      status: { label: t(p.project.status), tone: tagTone(lifecycleTone(p.project.status)) },
      health: healthTag(p, t),
      href: openHref(p.project),
    })),
  }));

  return {
    kpis,
    siteCount: map.groups.length,
    zoneEmpty: !!map.zone && map.points.length === 0,
    groups,
    points,
    labels: {
      world: t('World'),
      europe: zoneLabel ? t(zoneLabel) : t('Europe'),
      fit: t('Projects'),
      ontrack: t('On track'),
      risk: t('At risk / off track'),
      pipeline: t('Pipeline'),
      closed: t('Closed / on hold'),
      open: t('Open project'),
      loading: t('Loading map geometry…'),
      failed: t('Map geometry could not be loaded.'),
      close: t('Close'),
      map: t('Projects map'),
      legend: t('Map legend'),
      views: t('Map view'),
    },
    zone: map.zone ? { code: map.zone.code, label: t(map.zone.label), bounds: map.zone.bounds } : null,
    crumbExtra: mapCrumbExtra(map.points.length, zoneLabel),
  };
}
