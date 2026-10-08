import 'server-only';
// Projects map DAL (docs/spec/03 §3, 02 SCR-WORLDMAP-FRAME; 11 §3.1 Zone / Country, §3.2 ProjectSite). Sites
// (city, country, lat/lng, zone) are modelled since Delivery 1; this module derives the map points and their category
// (`mapPts`, logic 5074; `mapCategoryOf` in src/domain/worldmap.ts) — health kept for active points only — the site
// groups (`mapGroups`: by city|country, count desc then city) and the zone frame (label + bounds) the map fits.
import { listZones, type ZoneRow } from './people';
import { listProjects, type ProjectRow } from './projects';
import type { Health } from '@/domain/health';
import { mapCategoryOf, type MapCategory } from '@/domain/worldmap';
import type { ZoneCode } from '@/server/db/codes';

export type { MapCategory };

export interface MapPoint {
  project: ProjectRow;
  city: string;
  country: string;
  lat: number;
  lng: number;
  category: MapCategory;
  /** Health of active points only. */
  health: Health | null;
}

export interface MapSiteGroup {
  city: string;
  country: string;
  points: MapPoint[];
}

export interface ProjectsMap {
  points: MapPoint[];
  groups: MapSiteGroup[];
  /** Zone projects without a located site ("{n} without location"). */
  unlocated: number;
  countries: string[];
  /** Selected zone with its frame, null for the whole portfolio. */
  zone: ZoneRow | null;
}

/** Points, site groups and zone frame of the Projects map for a zone (null = whole portfolio). */
export async function getProjectsMap(zone: ZoneCode | null): Promise<ProjectsMap> {
  const [all, zones] = await Promise.all([listProjects(), listZones()]);
  const zp = all.filter((p) => !zone || p.zone === zone);
  const points = zp
    .filter((p) => p.city && p.country && p.lat != null && p.lng != null)
    .map((p) => {
      const category = mapCategoryOf(p.stage, p.health);
      return { project: p, city: p.city!, country: p.country!, lat: p.lat!, lng: p.lng!, category, health: category === 'active' ? p.health : null };
    });
  const keys = [...new Set(points.map((x) => `${x.city}|${x.country}`))];
  const groups = keys
    .map((k) => {
      const [city, country] = k.split('|');
      return { city, country, points: points.filter((x) => x.city === city && x.country === country) };
    })
    .sort((a, b) => b.points.length - a.points.length || a.city.localeCompare(b.city));
  return {
    points, groups, unlocated: zp.length - points.length, countries: [...new Set(points.map((x) => x.country))],
    zone: zone ? (zones.find((z) => z.code === zone) ?? null) : null,
  };
}
