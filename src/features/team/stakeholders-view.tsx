// Stakeholders & RACI screen body (docs/spec/05 §6, template 870–879): KPI row, the stakeholder register (avatar,
// kind tag, relationship owner, last contact flagged after 30 days, contact, notes) and the project RACI matrix — one
// column per role of the matrix (the prototype fixed 6). Read-only screen body; "Add stakeholder" is the header's
// primary action. Server Component.
import type { CSSProperties } from 'react';
import { Avatar } from '@/components/app/Badges';
import { EmptyState } from '@/components/app/EmptyState';
import { KpiGrid, KpiTile } from '@/components/app/Kpi';
import { SectionCard, Stack } from '@/components/app/SectionCard';
import { Table, Td, Th } from '@/components/ds/Table';
import type { T } from '@/i18n/translate';
import type { RaciView, StakeholdersView } from './model';
import s from './team.module.css';

export function StakeholdersBody({ view, t }: { view: StakeholdersView; t: T }) {
  return (
    <Stack>
      <KpiGrid>
        {view.kpis.map((k) => (
          <KpiTile key={k.label} label={k.label} value={k.value} sub={k.sub} color={k.color} />
        ))}
      </KpiGrid>

      <SectionCard title={t('Stakeholder register')} scroll>
        <Table size={12.5}>
          <thead>
            <tr>
              <Th>{t('Stakeholder')}</Th>
              <Th>{t('Kind')}</Th>
              <Th>{t('Relationship owner')}</Th>
              <Th>{t('Last contact')}</Th>
              <Th>{t('Contact')}</Th>
              <Th aria-label={t('Notes')} />
            </tr>
          </thead>
          <tbody>
            {view.rows.map((x) => (
              <tr key={x.key}>
                <Td>
                  <div className={s.who}>
                    <Avatar initials={x.initials} size={28} fontSize={10.5} />
                    <div className={s.whoText}>
                      <span className={s.whoName}>{x.name}</span>
                      <span className={s.whoSub}>{x.sub}</span>
                    </div>
                  </div>
                </Td>
                <Td>
                  <span className={`${x.typeClass} ${s.kind}`}>{x.type}</span>
                </Td>
                <Td className={s.cell12}>{x.owner}</Td>
                <Td className={s.cell12} color={x.lastColor} nowrap>
                  {x.lastText}
                </Td>
                <Td tone="secondary" nowrap>
                  {x.contactText}
                </Td>
                <Td className={s.notes}>
                  <span className={s.pretty}>{x.notes}</span>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
        {view.empty && <EmptyState variant="boxed">{view.empty}</EmptyState>}
      </SectionCard>

      {view.raci && <RaciCard raci={view.raci} t={t} />}
    </Stack>
  );
}

/** "RACI matrix" card: header row of roles, then one row per responsibility with its R / A / C / I cells. */
function RaciCard({ raci, t }: { raci: RaciView; t: T }) {
  return (
    <SectionCard title={t('RACI matrix')} subtitle={t('R responsible · A accountable · C consulted · I informed')} scroll>
      <div className={s.raci} style={{ gridTemplateColumns: raci.template, minWidth: raci.minWidth } as CSSProperties} role="table" aria-label={t('RACI matrix')}>
        <div className={s.raciRow} role="row">
          <div role="columnheader" />
          {raci.columns.map((c, i) => (
            <div key={`${i}:${c}`} className={s.raciHead} role="columnheader">
              {c}
            </div>
          ))}
        </div>
        {raci.rows.map((r, ri) => (
          <div key={`${ri}:${r.label}`} className={s.raciRow} role="row">
            <div className={s.raciLabel} role="rowheader">
              {r.label}
            </div>
            {r.cells.map((c, ci) => (
              <div key={ci} className={s.raciCell} style={{ background: c.bg, border: c.border, color: c.color }} role="cell">
                {c.v}
              </div>
            ))}
          </div>
        ))}
      </div>
    </SectionCard>
  );
}
