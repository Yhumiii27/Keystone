// Budget › Structure & changes — "Budget by equipment" (R-185, owner's choice 3): the project's costs broken down by equipment
// line where the planning lots give it, read-only; shown only for a project with more than one line. Attribution rule:
// src/domain/equipment-costs.ts. Server Component.
import { LO, SectionCard } from '@/components/app';
import { CardTitle } from '@/components/ds/Card';
import { Table, Td, Th } from '@/components/ds/Table';
import { dataText } from '@/i18n/data-text';
import type { Lang, T } from '@/i18n/translate';
import { money } from '@/lib/format';
import type { EquipmentCosts } from '@/server/dal/budget';
import s from './budget.module.css';

export function EquipmentCostsCard({ equipment, lang, t }: { equipment: EquipmentCosts; lang: Lang; t: T }) {
  const f = (k: number, signed?: boolean) => money(k, lang, { signed });
  const rows = [
    ...equipment.rows.map((r) => ({ ...r, name: r.lotLabel ?? t('Common to the project'), sub: r.label ? dataText(r.label, lang) : null, weight: 400 })),
    { key: 'total', name: t('Total'), sub: null, ...equipment.total, weight: 500 },
  ];
  return (
    <SectionCard scroll>
      <div className={s.headRow}>
        <div className={s.titleCol}>
          <CardTitle>{t('Budget by equipment')}</CardTitle>
          <span className={s.subtitle}>{t('From the planning lots of each equipment line · read-only')}</span>
        </div>
      </div>
      <Table size={13}>
        <thead>
          <tr>
            <Th>{t('Equipment')}</Th>
            <Th align="right">{t('Current')}</Th>
            <Th align="right">{t('Actual')}</Th>
            <Th align="right">{t('EAC')}</Th>
            <Th align="right">{t('Variance')}</Th>
            <Th align="right">{t('Earned value')}</Th>
            <Th align="right">{t('Open orders')}</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const v = r.budget - r.eac;
            return (
              <tr key={r.key} style={{ fontWeight: r.weight }}>
                <Td>
                  <span className={s.refName}>
                    <span>{r.name}</span>
                    {r.sub && <span className={s.refPattern}>{r.sub}</span>}
                  </span>
                </Td>
                <Td align="right" numeric>
                  {f(r.budget)}
                </Td>
                <Td align="right" numeric>
                  {f(r.actual)}
                </Td>
                <Td align="right" numeric>
                  {f(r.eac)}
                </Td>
                <Td align="right" numeric color={v < 0 ? LO : 'var(--color-neutral-300)'}>
                  {f(v, true)}
                </Td>
                <Td align="right" numeric>
                  {r.ev == null ? '—' : f(r.ev)}
                </Td>
                <Td align="right" numeric color="var(--color-neutral-400)">
                  {r.openOrders ? f(r.openOrders) : '—'}
                </Td>
              </tr>
            );
          })}
        </tbody>
      </Table>
      <p className={s.frozenHint}>
        {t('The budget follows the equipment line of each work package; actual cost, EAC and earned value follow each activity (else its work package); open orders follow the article’s equipment line, else the activity they are needed for. The unallocated contingency and the lots without an equipment line are common to the project.')}
      </p>
      <p className={s.frozenHint}>
        {t('Cost categories are not broken down by equipment: their actuals and commitments are booked per category (timesheets, invoices, Sage), not per activity.')}
        {equipment.total.ev == null && ` ${t('Earned value is not broken down: this project’s earned value is not computed from its activities.')}`}
      </p>
    </SectionCard>
  );
}
