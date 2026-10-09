// Installed base screen body (docs/spec/07 §2.8, template 948–955): KPI row, zone notice, and the register of the
// machines in service — warranty state, delivering project, site, dates with the "ends in n d" line, open claims, the
// as-maintained configuration against Vigie's ECOs (pending / retrofit / pinned tags opening the first ECO on the
// Change orders screen, and "Open in Vigie"), warranty cost. "Add machine" is the header's primary action.
// Server Component.
import { ArrowSquareOut, GlobeHemisphereEast } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { Callout } from '@/components/app/Callout';
import { KpiGrid, KpiTile } from '@/components/app/Kpi';
import { SectionCard, Stack } from '@/components/app/SectionCard';
import { Table, Th } from '@/components/ds/Table';
import { cx } from '@/components/ds/cx';
import type { T } from '@/i18n/translate';
import { VIGIE_LINK_ATTRS } from '@/server/integrations/vigie/links';
import type { FleetView } from './model';
import s from './aftersales.module.css';

export function FleetBody({ view, t }: { view: FleetView; t: T }) {
  return (
    <Stack>
      <KpiGrid>
        {view.kpis.map((k) => (
          <KpiTile key={k.label} label={k.label} value={k.value} sub={k.sub} color={k.color} />
        ))}
      </KpiGrid>
      {view.zoneEmpty && (
        <Callout icon={GlobeHemisphereEast} role="status">
          {view.zoneEmpty}
        </Callout>
      )}
      <SectionCard title={t('Installed base')} scroll>
        <Table size={12.5}>
          <thead>
            <tr>
              <Th />
              <Th>{t('Machine')}</Th>
              <Th>{t('Status')}</Th>
              <Th>{t('Project')}</Th>
              <Th>{t('Site')}</Th>
              <Th>{t('Delivered')}</Th>
              <Th>{t('Warranty end')}</Th>
              <Th>{t('Open claims')}</Th>
              <Th>{t('Configuration')}</Th>
              <Th align="right">{t('Warranty cost')}</Th>
            </tr>
          </thead>
          <tbody>
            {view.rows.map((m) => (
              <tr key={m.number}>
                <td className={s.id}>{m.number}</td>
                <td>
                  <div className={s.stack}>
                    <span className={s.strong}>{m.name}</span>
                    <span className={s.sub}>{m.sub}</span>
                  </div>
                </td>
                <td>
                  <span className={cx(m.statusClass, s.nowrap)}>{m.status}</span>
                </td>
                <td className={s.c12MutedNum}>{m.project}</td>
                <td className={s.c12Muted}>{m.site}</td>
                <td className={cx(s.c12, s.nowrap)}>{m.delivered}</td>
                <td className={s.nowrap}>
                  <div className={s.stack}>
                    <span className={s.num} style={{ color: m.warrantyEndColor }}>
                      {m.warrantyEnd}
                    </span>
                    {m.warrantyEndSub && (
                      <span className={s.sub} style={{ color: m.warrantyEndColor }}>
                        {m.warrantyEndSub}
                      </span>
                    )}
                  </div>
                </td>
                <td className={s.c12} style={{ color: m.openColor }}>
                  {m.openText}
                </td>
                <td>
                  {m.config && (
                    <div className={s.cfg}>
                      <Link href={m.config.href} className={s.cfgLink} title={m.config.title} aria-label={`${m.config.items.map((c) => c.text).join(', ')} · ${m.config.title}`}>
                        {m.config.items.map((c) => (
                          <span key={c.text} className={cx(c.cls, s.tag105)}>
                            {c.text}
                          </span>
                        ))}
                      </Link>
                      {m.config.vigieHref && (
                        <a href={m.config.vigieHref} {...VIGIE_LINK_ATTRS} className={s.vigie} aria-label={m.config.vigieLabel} title={m.config.vigieLabel}>
                          <ArrowSquareOut size={13} aria-hidden />
                        </a>
                      )}
                    </div>
                  )}
                </td>
                <td className={s.right}>{m.cost}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      </SectionCard>
    </Stack>
  );
}
