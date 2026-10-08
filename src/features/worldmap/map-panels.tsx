'use client';
// Projects map — map card and "Sites" list (template 218–233). Client island: hovering a project row highlights its
// marker, a site header zooms the map on the site, a row opens the project (Plan, or the Projects register
// searched by its code). Strings arrive translated from the server.
import { GlobeHemisphereEast, MapPin } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { useRef, useState } from 'react';
import { Tag } from '@/components/ds/Tag';
import { Callout } from '@/components/app/Callout';
import { Eyebrow } from '@/components/app/Eyebrow';
import { ProjectsMap, type ProjectsMapHandle } from '@/components/charts/projects-map';
import type { WorldMapModel } from './model';
import s from './worldmap.module.css';

export interface MapPanelsProps {
  model: Pick<WorldMapModel, 'points' | 'labels' | 'zone' | 'groups' | 'siteCount' | 'zoneEmpty'>;
  /** Translated "Sites". */
  sitesLabel: string;
  /** Translated "No project in this zone for this view". */
  zoneEmptyText: string;
}

export function MapPanels({ model, sitesLabel, zoneEmptyText }: MapPanelsProps) {
  const mapRef = useRef<ProjectsMapHandle>(null);
  const [hl, setHl] = useState<string | null>(null);
  return (
    <div className={s.panels}>
      <div className={`card elev-sm ${s.mapCard}`}>
        <ProjectsMap ref={mapRef} points={model.points} labels={model.labels} zone={model.zone} highlight={hl} />
      </div>
      <div className={s.list}>
        <Eyebrow flush>{`${sitesLabel} · ${model.siteCount}`}</Eyebrow>
        {model.zoneEmpty && (
          <Callout icon={GlobeHemisphereEast} role="status">
            {zoneEmptyText}
          </Callout>
        )}
        {model.groups.map((g) => (
          <div key={g.key} className={`card elev-sm ${s.site}`}>
            <button type="button" className={s.siteHead} onClick={() => mapRef.current?.focus(g.focusCode)}>
              <MapPin className={s.pin} aria-hidden />
              <span className={s.city}>{g.city}</span>
              <span className={s.where}>{`${g.country} · ${g.count}`}</span>
            </button>
            {g.items.map((p) => (
              <Link
                key={p.code}
                href={p.href}
                className={s.item}
                onMouseEnter={() => setHl(p.code)}
                onMouseLeave={() => setHl(null)}
                onFocus={() => setHl(p.code)}
                onBlur={() => setHl(null)}
              >
                <span className={s.itemText}>
                  <span className={s.itemName}>{p.name}</span>
                  <span className={s.itemSub}>{p.sub}</span>
                </span>
                <span className={s.itemTags}>
                  <Tag tone={p.status.tone} size="sm">
                    {p.status.label}
                  </Tag>
                  {p.health && (
                    <Tag tone={p.health.tone} size="sm">
                      {p.health.label}
                    </Tag>
                  )}
                </span>
              </Link>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
