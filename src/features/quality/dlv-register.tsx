// Quality — Deliverables register (docs/spec/07 §2.3.b, template 1926–1954): KPI tiles, the status chips with the
// flow / RACI-B note, and the "Deliverables register" card with the RACI-B avatars. Each row opens the deliverable drawer
// (`?dlv=`) and carries the viewer's action: Start / To internal review / Submit to client (project team), Accept /
// Reject (the project's client contact). Server Component; the buttons are client islands.
import { Funnel } from '@phosphor-icons/react/dist/ssr';
import { Avatar } from '@/components/app/Badges';
import { ClickableRow } from '@/components/app/ClickableRow';
import { FilterBar, FilterChips, FilterGroup, FilterLabel, FilterNote } from '@/components/app/Filter';
import { KpiGrid, KpiTile } from '@/components/app/Kpi';
import { SectionCard } from '@/components/app/SectionCard';
import { cx } from '@/components/ds/cx';
import { Table, Th } from '@/components/ds/Table';
import type { T } from '@/i18n/translate';
import type { DlvTabView } from './model';
import { DeliverableDecideRow, DeliverableMoveButton } from './quality-buttons';
import s from './quality.module.css';

export function DeliverablesRegister({ code, view, t }: { code: string; view: DlvTabView; t: T }) {
  return (
    <>
      <KpiGrid>
        {view.kpis.map((k) => (
          <KpiTile key={k.label} label={k.label} value={k.value} sub={k.sub} color={k.color} />
        ))}
      </KpiGrid>

      <FilterBar gap={6}>
        <FilterGroup>
          <FilterLabel icon={Funnel}>{t('Status')}</FilterLabel>
          <FilterChips label={t('Status')} value={view.filter} options={view.chips.map((c) => ({ value: c.value, label: c.label, count: c.count, href: c.href }))} />
        </FilterGroup>
        <FilterNote>{t('Planned → in progress → internal review → submitted → accepted by the client · RACI-B: R produces, A signs off, C consulted, I informed, B backup')}</FilterNote>
      </FilterBar>

      <SectionCard title={t('Deliverables register')} hint={t('Types come from Settings · each line is tied to a WBS element')} scroll>
        <Table size={13}>
          <thead>
            <tr>
              <Th>{t('Deliverable')}</Th>
              <Th>{t('Type')}</Th>
              <Th>{t('WBS')}</Th>
              <Th>{t('Due')}</Th>
              <Th>{t('Rev')}</Th>
              <Th>R</Th>
              <Th>A</Th>
              <Th>C</Th>
              <Th>I</Th>
              <Th>B</Th>
              <Th>{t('Acceptance')}</Th>
              <Th>{t('Status')}</Th>
              <Th aria-label={t('Actions')} />
            </tr>
          </thead>
          <tbody>
            {view.rows.map((r) => (
              <ClickableRow key={r.number} href={r.href}>
                <td>
                  <div className={cx(s.idStack, s.dlvCell)}>
                    <span className={cx(s.id, r.selected && s.idOn)} aria-current={r.selected ? 'true' : undefined}>
                      {r.number}
                    </span>
                    <span className={s.pretty}>{r.title}</span>
                  </div>
                </td>
                <td className={s.type}>
                  <span className={s.clip} title={r.type}>
                    {r.type}
                  </span>
                </td>
                <td className={s.wbs}>{r.wbs}</td>
                <td className={s.cell12}>{r.due}</td>
                <td className={s.num}>{r.rev}</td>
                {r.raci.map((c) => (
                  <td key={c.role}>{c.name ? <Avatar size={26} initials={c.initials} name={c.name} /> : null}</td>
                ))}
                <td className={s.acc}>{r.acceptance}</td>
                <td>
                  <span className={cx(r.statusClass, s.nowrap)}>{r.status}</span>
                </td>
                <td>
                  <div className={s.actions}>
                    {r.action?.kind === 'move' && (
                      <DeliverableMoveButton code={code} number={r.number} to={r.action.to} label={r.action.label} variant={r.action.variant} place="row" />
                    )}
                    {r.action?.kind === 'decide' && <DeliverableDecideRow code={code} number={r.number} />}
                  </div>
                </td>
              </ClickableRow>
            ))}
          </tbody>
        </Table>
        {view.empty && <span className={s.empty}>{view.empty}</span>}
      </SectionCard>
    </>
  );
}
