// Engineering change orders — register body (docs/spec/09 §4.5–4.7, template 1312–1345): KPI tiles, the Status chips
// with the flow note, and the register card. Each row opens the ECO drawer (`?eco=`), carries the viewer's step
// button (sent to Vigie, editors only) and an "Open in Vigie" link; progress waiting for Vigie shows under the status.
// Server Component; the step buttons are client islands.
import { ArrowsClockwise, Funnel, Hourglass, LockSimple } from '@phosphor-icons/react/dist/ssr';
import type { CSSProperties } from 'react';
import { ClickableRow } from '@/components/app/ClickableRow';
import { FilterBar, FilterChips, FilterGroup, FilterLabel, FilterNote } from '@/components/app/Filter';
import { KpiGrid, KpiTile } from '@/components/app/Kpi';
import { SectionCard, Stack } from '@/components/app/SectionCard';
import { cx } from '@/components/ds/cx';
import { Table, Th } from '@/components/ds/Table';
import type { T } from '@/i18n/translate';
import type { EcoScreenView } from './model';
import { StepButton } from './progress-buttons';
import { VigieIconLink } from './vigie-link';
import s from './eco.module.css';

export interface EcoRegisterProps {
  view: EcoScreenView;
  /** Step buttons allowed (Change orders inside the viewer's workspace). */
  canEdit: boolean;
  t: T;
}

export function EcoRegister({ view, canEdit, t }: EcoRegisterProps) {
  return (
    <Stack>
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
        <FilterNote>{t('Draft → impact analysis → approval (engineering lead · quality · PMs impacted) → released')}</FilterNote>
      </FilterBar>

      <SectionCard
        title={t('Engineering change orders')}
        hint={t('Click an ECO for its impact analysis')}
        actions={
          <span className={s.mirror}>
            <ArrowsClockwise aria-hidden />
            {t('Mirrored from Vigie — ECOs are managed in Vigie')}
          </span>
        }
        scroll
      >
        <Table>
          <thead>
            <tr>
              <Th>{t('ECO')}</Th>
              <Th>{t('Change')}</Th>
              <Th>{t('Type')}</Th>
              <Th>{t('Parts')}</Th>
              <Th>{t('Projects')}</Th>
              <Th align="right">{t('Cost')}</Th>
              <Th align="right">{t('Schedule')}</Th>
              <Th>{t('Approvals')}</Th>
              <Th>{t('Status')}</Th>
              <Th aria-label={t('Actions')} />
            </tr>
          </thead>
          <tbody>
            {view.rows.map((r) => (
              <ClickableRow key={r.number} href={r.href}>
                <td className={cx(s.idCell, r.selected && s.idOn)} aria-current={r.selected ? 'true' : undefined}>
                  {r.number}
                </td>
                <td>
                  <div className={s.change}>
                    <span className={s.pretty}>{r.title}</span>
                    <span className={s.by}>{r.byLine}</span>
                  </div>
                </td>
                <td className={s.cell12}>{r.type}</td>
                <td className={cx(s.cell12, s.num)}>{r.parts}</td>
                <td className={s.cell12}>{r.projects}</td>
                <td className={s.money}>{r.cost}</td>
                <td className={s.money}>{r.sched}</td>
                <td>
                  <div className={s.dots}>
                    {r.approvals.map((a) => (
                      <span key={a.key} className={s.dotItem} title={a.title}>
                        {/* The state is carried by the colour only: the dot is named for assistive technologies. */}
                        <span className={s.dot} style={{ '--dot': a.dot } as CSSProperties} role="img" aria-label={a.title} />
                        {a.label}
                      </span>
                    ))}
                  </div>
                </td>
                <td>
                  <div className={s.statusCol}>
                    <span className={cx(r.statusClass, s.nowrap)}>{r.status}</span>
                    {r.pending && (
                      <span className={s.pendLine}>
                        {r.pending.lock ? <LockSimple aria-hidden /> : <Hourglass aria-hidden />}
                        {r.pending.text}
                      </span>
                    )}
                    {r.sync && (
                      <span className={s.syncLine}>
                        <ArrowsClockwise className={s.syncIcon} aria-hidden />
                        <span>{r.sync}</span>
                      </span>
                    )}
                  </div>
                </td>
                <td>
                  <div className={s.actions}>
                    {canEdit && r.action?.kind === 'step' && <StepButton number={r.number} target={r.action.target} label={r.action.label} variant={r.action.variant} />}
                    {r.action?.kind === 'tag' && <span className={cx('tag tag-accent', s.nowrap)}>{r.action.label}</span>}
                    <VigieIconLink href={r.vigieUrl} label={`${t('Open in Vigie')} ${r.number}`} />
                  </div>
                </td>
              </ClickableRow>
            ))}
          </tbody>
        </Table>
        {view.empty && <span className={s.empty}>{view.empty}</span>}
      </SectionCard>
    </Stack>
  );
}
