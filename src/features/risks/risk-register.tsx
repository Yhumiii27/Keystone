// Risk register screen body (docs/spec/07 §2.1, template 1771–1832): KPI row, category chips with the scoring
// hint, the register table (rows open the drawer through `?risk=`) and the 5×5 heat map of open risks, then the
// risk drawer. Server Component; the drawer's edit controls are client islands.
import { Minus, TrendDown, TrendUp } from '@phosphor-icons/react/dist/ssr';
import { FilterBar, FilterChips, FilterGroup, FilterLabel, FilterNote } from '@/components/app/Filter';
import { KpiGrid, KpiTile } from '@/components/app/Kpi';
import { ClickableRow } from '@/components/app/ClickableRow';
import { SectionCard, Stack } from '@/components/app/SectionCard';
import { RiskMatrix } from '@/components/charts/risk-matrix';
import { cx } from '@/components/ds/cx';
import { Ellipsis, Table, Td, Th } from '@/components/ds/Table';
import type { T } from '@/i18n/translate';
import type { RiskRegisterView, RiskRowView } from './model';
import { RiskDrawer } from './risk-drawer';
import s from './risks.module.css';

export interface RiskRegisterProps {
  code: string;
  view: RiskRegisterView;
  /** Drawer edits allowed (not outside, not read-only). */
  canEdit: boolean;
  t: T;
}

/** Trend icon 15px: up `ph-trend-up` in LO, down `ph-trend-down`, flat `ph-minus` (neutral-400). */
function TrendIcon({ trend, t }: { trend: RiskRowView['trend']; t: T }) {
  if (trend === 'up') return <TrendUp className={cx(s.trend, s.trendUp)} role="img" aria-label={t('Trending up')} />;
  if (trend === 'down') return <TrendDown className={s.trend} role="img" aria-label={t('Trending down')} />;
  return <Minus className={s.trend} role="img" aria-label={t('Stable')} />;
}

export function RiskRegister({ code, view, canEdit, t }: RiskRegisterProps) {
  return (
    <Stack>
      <KpiGrid>
        {view.kpis.map((k) => (
          <KpiTile key={k.label} label={k.label} value={k.value} sub={k.sub} color={k.color} />
        ))}
      </KpiGrid>

      <FilterBar gap={6}>
        <FilterGroup>
          <FilterLabel>{t('Category')}</FilterLabel>
          <FilterChips label={t('Category')} options={view.chips} value={view.filter ?? 'all'} />
        </FilterGroup>
        <FilterNote>{t('Score = probability × impact (1–5) · EMV = probability × cost impact · reviewed weekly with the snapshot')}</FilterNote>
      </FilterBar>

      <div className={s.split}>
        <SectionCard title={t('Register')} hint={t('Click a risk to score it and edit its response')} flex="2.4 1 1015px" scroll>
          <Table size={13}>
            <thead>
              <tr>
                <Th>{t('Risk')}</Th>
                <Th>{t('Category')}</Th>
                <Th align="right">P</Th>
                <Th align="right">I</Th>
                <Th align="right">{t('Score')}</Th>
                <Th>{t('Level')}</Th>
                <Th>{t('Response')}</Th>
                <Th>{t('Owner')}</Th>
                <Th align="right">{t('EMV')}</Th>
                <Th>{t('Linked activity')}</Th>
                <Th>{t('Trend')}</Th>
                <Th>{t('Status')}</Th>
              </tr>
            </thead>
            <tbody>
              {view.rows.map((r) => (
                <ClickableRow key={r.id} href={r.href}>
                  <td>
                    <div className={s.riskCell}>
                      <span className={cx(s.riskId, r.selected && s.riskIdOn)}>{r.id}</span>
                      <span className={s.riskTitle}>{r.title}</span>
                    </div>
                  </td>
                  <Td tone="secondary" nowrap>
                    {r.category}
                  </Td>
                  <Td align="right" numeric>
                    {r.p}
                  </Td>
                  <Td align="right" numeric>
                    {r.i}
                  </Td>
                  <Td align="right" numeric className={s.score}>
                    {r.score}
                  </Td>
                  <td>
                    <span className={cx(r.levelClass, s.nowrap)}>{r.level}</span>
                  </td>
                  <Td tone="secondary">{r.response}</Td>
                  <td className={s.ownerCell}>{r.owner}</td>
                  <Td align="right" numeric nowrap>
                    {r.emvText}
                  </Td>
                  <Td tone="muted" maxWidth={180}>
                    <Ellipsis title={r.actText}>{r.actText}</Ellipsis>
                  </Td>
                  <td>
                    <TrendIcon trend={r.trend} t={t} />
                  </td>
                  <td>
                    <span className={r.statusClass}>{r.status}</span>
                  </td>
                </ClickableRow>
              ))}
            </tbody>
          </Table>
          {view.empty && <span className={s.empty}>{view.empty}</span>}
        </SectionCard>

        <SectionCard title={t('Heat map — open risks')} subtitle={t('Impact ↑ · probability →')} gap={10} flex="1 1 260px">
          <RiskMatrix
            rows={view.matrix}
            label={t('Heat map — open risks')}
            legend={{ critical: t('Critical ≥ 15'), high: t('High ≥ 8'), medium: t('Medium ≥ 4') }}
          />
        </SectionCard>
      </div>

      {view.drawer && <RiskDrawer code={code} view={view.drawer} canEdit={canEdit} t={t} />}
    </Stack>
  );
}
