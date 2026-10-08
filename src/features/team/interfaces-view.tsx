// Interface register screen body (docs/spec/07 §2.5, template 893–899): KPI row and the register of data owed by the
// client or third parties — need date with its "in n d" / "n d late" line, provided date, status tag (Late derived),
// owner and the row actions "Mark received" / "Freeze" (client island, editors only). "New interface" is the
// header's primary action. Server Component.
import { EmptyState } from '@/components/app/EmptyState';
import { KpiGrid, KpiTile } from '@/components/app/Kpi';
import { SectionCard, Stack } from '@/components/app/SectionCard';
import { Table, Td, Th } from '@/components/ds/Table';
import type { T } from '@/i18n/translate';
import { InterfaceActions } from './interface-actions';
import type { InterfacesView } from './model';
import s from './team.module.css';

export interface InterfacesBodyProps {
  code: string;
  view: InterfacesView;
  /** Row actions allowed (not outside the workspace, not a read-only project). */
  canEdit: boolean;
  t: T;
}

export function InterfacesBody({ code, view, canEdit, t }: InterfacesBodyProps) {
  return (
    <Stack>
      <KpiGrid>
        {view.kpis.map((k) => (
          <KpiTile key={k.label} label={k.label} value={k.value} sub={k.sub} color={k.color} />
        ))}
      </KpiGrid>

      <SectionCard title={t('Interface register')} subtitle={t('Late data from the client or third parties costs schedule days · keep the trace here')} scroll>
        <Table size={12.5}>
          <thead>
            <tr>
              <Th />
              <Th>{t('Interface')}</Th>
              <Th>{t('Keystone side')}</Th>
              <Th>{t('Other party')}</Th>
              <Th>{t('Data expected')}</Th>
              <Th>{t('Needed by')}</Th>
              <Th>{t('Provided')}</Th>
              <Th>{t('Status')}</Th>
              <Th>{t('Owner')}</Th>
              <Th aria-label={t('Actions')} />
            </tr>
          </thead>
          <tbody>
            {view.rows.map((r) => (
              <tr key={r.number}>
                <Td className={s.id}>{r.number}</Td>
                <Td className={s.title}>{r.title}</Td>
                <Td tone="secondary">{r.side}</Td>
                <Td tone="secondary">{r.otherParty}</Td>
                <Td tone="muted" className={s.data}>
                  <span className={s.pretty}>{r.data}</span>
                </Td>
                <Td nowrap color={r.neededColor}>
                  <div className={s.needed}>
                    <span className={s.num}>{r.needed}</span>
                    <span className={s.neededSub}>{r.neededSub}</span>
                  </div>
                </Td>
                <Td className={`${s.cell12} ${s.num}`}>{r.provided}</Td>
                <Td>
                  <span className={`${r.statusClass} ${s.nowrap}`}>{r.status}</span>
                </Td>
                <Td className={s.cell12} nowrap>
                  {r.owner}
                </Td>
                <Td className={s.actions}>
                  {canEdit && (r.canReceive || r.canFreeze) && <InterfaceActions code={code} number={r.number} canReceive={r.canReceive} canFreeze={r.canFreeze} />}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
        {view.empty && <EmptyState variant="boxed">{view.empty}</EmptyState>}
      </SectionCard>
    </Stack>
  );
}
