// Commissioning & handover dossier screen body (docs/spec/07 §2.6, template 910–920): KPI row, the commissioning grid —
// one row per system, a status cell per step (Mechanical completion → Handover; done / in progress / blocked / planned
// with its date or blocking reference) and the open category-A punch items of the system — and the handover dossier
// with its Codex record buttons; R-185: the grid grouped by equipment line when the project has several. Without a
// commissioning plan: the empty panel. "Plan SAT" is the header's primary action. Server Component.
import { Check, CircleDashed, CircleHalf, LockSimple } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { Fragment, type CSSProperties } from 'react';
import { EmptyState } from '@/components/app/EmptyState';
import { KpiGrid, KpiTile } from '@/components/app/Kpi';
import { SectionCard, Stack } from '@/components/app/SectionCard';
import { Table, Td, Th } from '@/components/ds/Table';
import { cx } from '@/components/ds/cx';
import type { T } from '@/i18n/translate';
import { DocButton } from './itp-view';
import type { CommissioningScreenView } from './model';
import s from './itpcom.module.css';

const ICON = { Check, LockSimple, CircleHalf, CircleDashed } as const;

export interface CommissioningBodyProps {
  /** Null when the project has no commissioning plan. */
  view: CommissioningScreenView | null;
  t: T;
}

export function CommissioningBody({ view, t }: CommissioningBodyProps) {
  if (!view)
    return (
      <Stack>
        <EmptyState variant="boxed">{t('No commissioning plan yet · systems come from the inspection template')}</EmptyState>
      </Stack>
    );
  return (
    <Stack>
      <KpiGrid>
        {view.kpis.map((k) => (
          <KpiTile key={k.label} label={k.label} value={k.value} sub={k.sub} color={k.color} />
        ))}
      </KpiGrid>

      <SectionCard title={view.title} scroll>
        <div className={s.grid} role="table" aria-label={view.title}>
          <div className={s.gridRow} role="row">
            <div role="columnheader" />
            {view.columns.map((c) => (
              <div key={c} className={s.colHead} role="columnheader">
                {c}
              </div>
            ))}
            <div className={cx(s.colHead, s.colHeadRight)} role="columnheader">
              {view.blockingLabel}
            </div>
          </div>
          {view.groups.map((g) => (
            <Fragment key={g.label ?? ''}>
              {g.label && (
                <div className={s.gridGroup} role="row">
                  <div role="rowheader" className={s.groupHead}>
                    <span>{g.label}</span>
                    <span className={s.groupRule} aria-hidden />
                  </div>
                </div>
              )}
              {g.rows.map((r) => (
                <div key={r.system} className={s.gridRow} role="row">
                  <div className={s.sys} role="rowheader">
                    {r.system}
                  </div>
                  {r.cells.map((c, i) => {
                    const I = ICON[c.icon];
                    return (
                      <div key={i} className={s.cell} style={{ background: c.bg, border: c.border, color: c.color } as CSSProperties} role="cell" title={c.title}>
                        <I className={s.cellIcon} aria-hidden />
                        <span className={s.cellText}>
                          <span>{c.status}</span>
                          {c.href ? (
                            <Link href={c.href} className={cx(s.cellSub, s.cellLink)}>
                              {c.date}
                            </Link>
                          ) : (
                            <span className={s.cellSub}>{c.date}</span>
                          )}
                        </span>
                      </div>
                    );
                  })}
                  <div className={s.punchA} role="cell">
                    {r.blockingA}
                  </div>
                </div>
              ))}
            </Fragment>
          ))}
        </div>
      </SectionCard>

      <SectionCard title={view.dossierTitle} scroll>
        <Table size={12.5}>
          <thead>
            <tr>
              <Th>{t('Item')}</Th>
              <Th>{t('Document type')}</Th>
              <Th>{t('Status')}</Th>
              <Th aria-label={t('Actions')} />
            </tr>
          </thead>
          <tbody>
            {view.dossier.map((d) => (
              <tr key={d.item}>
                <Td>{d.item}</Td>
                <Td className={s.docType}>{d.type}</Td>
                <Td>
                  <span className={cx(d.statusClass, s.nowrap)}>{d.status}</span>
                </Td>
                <Td className={s.right}>{d.doc && <DocButton doc={d.doc} />}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </SectionCard>
    </Stack>
  );
}
