// Contingency register screen body (docs/spec/04 §5, template 900–909): 4 KPI tiles, then "Contingency use vs
// project progress" (drawn bar over the hatched exposure layer, progress bar, legend) and "Draw-downs" (most recent
// first). Server Component.
import type { CSSProperties } from 'react';
import { KpiGrid, KpiTile } from '@/components/app/Kpi';
import { SectionCard, Stack } from '@/components/app/SectionCard';
import { Table, Td, Th } from '@/components/ds/Table';
import type { T } from '@/i18n/translate';
import type { ContingencyView as View } from './model';
import s from './risks.module.css';

const w = (v: string) => ({ '--bar-w': v }) as CSSProperties;

export function ContingencyView({ view, t }: { view: View; t: T }) {
  return (
    <Stack>
      <KpiGrid>
        {view.kpis.map((k) => (
          <KpiTile key={k.label} label={k.label} value={k.value} sub={k.sub} color={k.color} />
        ))}
      </KpiGrid>
      <div className={s.cgGrid}>
        <SectionCard title={t('Contingency use vs project progress')} scroll>
          <div className={s.bars}>
            <div className={s.barBlock}>
              <div className={s.barHead}>
                <span>{t('Drawn')}</span>
                <span className={s.num}>{view.usedPct}</span>
              </div>
              <div className={s.track} role="img" aria-label={`${t('Drawn')} ${view.usedPct}`}>
                <div className={s.hatch} style={w(view.barExposure)} />
                <div className={s.used} style={w(view.barUsed)} />
              </div>
            </div>
            <div className={s.barBlock}>
              <div className={s.barHead}>
                <span>{t('Project progress')}</span>
                <span className={s.num}>{view.progPct}</span>
              </div>
              <div className={s.progTrack} role="img" aria-label={`${t('Project progress')} ${view.progPct}`}>
                <div className={s.progFill} style={w(view.barProgress)} />
              </div>
            </div>
            <span className={s.cgLegend}>
              <span className={s.cgSwatch} aria-hidden />
              {t('Exposure (drawn + open risks EMV)')}
            </span>
          </div>
        </SectionCard>
        <SectionCard title={t('Draw-downs')} scroll>
          <Table size={12.5}>
            <thead>
              <tr>
                <Th>{t('Date')}</Th>
                <Th align="right">{t('Amount')}</Th>
                <Th>{t('Reason')}</Th>
                <Th>{t('Linked to')}</Th>
                <Th>{t('Approved by')}</Th>
              </tr>
            </thead>
            <tbody>
              {view.rows.map((d, i) => (
                <tr key={i}>
                  <Td nowrap numeric>
                    {d.date}
                  </Td>
                  <Td align="right" numeric>
                    {d.amount}
                  </Td>
                  <td className={s.reason}>{d.reason}</td>
                  <Td tone="secondary" nowrap>
                    {d.link}
                  </Td>
                  <td className={s.ownerCell}>{d.by}</td>
                </tr>
              ))}
            </tbody>
          </Table>
          {!view.rows.length && <span className={s.empty}>{t('No draw-down recorded yet')}</span>}
        </SectionCard>
      </div>
    </Stack>
  );
}
