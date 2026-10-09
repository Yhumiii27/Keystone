// Quality — NCR log (docs/spec/07 §2.3.a, template 1887–1911): KPI tiles, the severity chips with the flow note, and the
// "Non-conformance log" card. Each row opens the NCR drawer (`?ncr=`), shows the progress waiting for Vigie under its
// status and carries the viewer's step button (sent to Vigie) and "Open in Vigie". Server Component; the step buttons
// are client islands.
import { ArrowsClockwise, Warning } from '@phosphor-icons/react/dist/ssr';
import type { CSSProperties } from 'react';
import { ClickableRow } from '@/components/app/ClickableRow';
import { FilterBar, FilterChips, FilterGroup, FilterLabel, FilterNote } from '@/components/app/Filter';
import { KpiGrid, KpiTile } from '@/components/app/Kpi';
import { SectionCard } from '@/components/app/SectionCard';
import { cx } from '@/components/ds/cx';
import { Table, Th } from '@/components/ds/Table';
import { VigieIconLink } from '@/features/eco/vigie-link';
import type { T } from '@/i18n/translate';
import type { NcrTabView } from './model';
import { NcrStepButton, NcrVerifyButtons } from './quality-buttons';
import s from './quality.module.css';

export function NcrLog({ code, view, t }: { code: string; view: NcrTabView; t: T }) {
  return (
    <>
      <KpiGrid>
        {view.kpis.map((k) => (
          <KpiTile key={k.label} label={k.label} value={k.value} sub={k.sub} color={k.color} />
        ))}
      </KpiGrid>

      <FilterBar gap={6}>
        <FilterGroup>
          <FilterLabel icon={Warning}>{t('Severity')}</FilterLabel>
          <FilterChips label={t('Severity')} value={view.filter} options={view.chips.map((c) => ({ value: c.value, label: c.label, count: c.count, href: c.href }))} />
        </FilterGroup>
        <FilterNote>{t('Open → containment → root cause → corrective action → verification → closed · ISO 9001 §8.7')}</FilterNote>
      </FilterBar>

      <SectionCard
        title={t('Non-conformance log')}
        hint={t('Raised from site inspections, goods receipts, surveys and audits')}
        actions={
          view.mirrorNote ? (
            <span className={s.mirror}>
              <ArrowsClockwise aria-hidden />
              {t('Mirrored from Vigie — NCRs are managed in Vigie')}
            </span>
          ) : undefined
        }
        scroll
      >
        <Table size={13}>
          <thead>
            <tr>
              <Th>{t('NCR')}</Th>
              <Th>{t('Severity')}</Th>
              <Th>{t('Source')}</Th>
              <Th>{t('Linked activity')}</Th>
              <Th>{t('Owner')}</Th>
              <Th>{t('Action due')}</Th>
              <Th align="right">{t('Cost')}</Th>
              <Th>{t('Progress')}</Th>
              <Th>{t('Status')}</Th>
              <Th aria-label={t('Actions')} />
            </tr>
          </thead>
          <tbody>
            {view.rows.map((r) => (
              <ClickableRow key={r.number} href={r.href}>
                <td>
                  <div className={cx(s.idStack, s.ncrCell)}>
                    <span className={cx(s.id, r.selected && s.idOn)} aria-current={r.selected ? 'true' : undefined}>
                      {r.number}
                    </span>
                    <span className={s.pretty}>{r.title}</span>
                    <span className={s.raised}>{r.raisedLine}</span>
                  </div>
                </td>
                <td>
                  <span className={r.severityClass}>{r.severity}</span>
                </td>
                <td className={s.src}>{r.source}</td>
                <td className={s.act}>
                  <span className={s.clip} title={r.activity}>
                    {r.activity}
                  </span>
                </td>
                <td className={s.cell12}>{r.owner}</td>
                <td className={s.cell12}>{r.due}</td>
                <td className={s.money}>{r.cost}</td>
                <td>
                  <div className={s.segments} role="img" aria-label={r.status}>
                    {r.segments.map((bg, i) => (
                      <span key={i} className={s.segment} style={{ '--seg': bg } as CSSProperties} />
                    ))}
                  </div>
                </td>
                <td>
                  <div className={s.statusCol}>
                    <span className={cx(r.statusClass, s.nowrap)}>{r.status}</span>
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
                    {r.action?.kind === 'step' && <NcrStepButton code={code} number={r.number} step={r.action.target} label={r.action.label} place="row" />}
                    {r.action?.kind === 'verify' && <NcrVerifyButtons code={code} number={r.number} closeLabel={r.action.label} place="row" />}
                    {r.vigieUrl && <VigieIconLink href={r.vigieUrl} label={`${t('Open in Vigie')} ${r.number}`} />}
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
