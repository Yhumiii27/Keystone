// Warranty claims & interventions screen body (docs/spec/07 §2.9, template 956–971): the Display switch (`?view=`
// claims | interventions | costs), the KPI row (the same in every view), the zone notice, then one register — claims
// (open first; the design ECO tag opens the ECO), field interventions (the type under a "Type" header, 07 OQ7) or the
// warranty vs chargeable cost per machine with its bar (25 k€ = full). "New claim" is the header's primary action.
// R-143: a claim row opens its drawer (`?claim=`); a planned intervention offers "Mark done" to editors and a done one shows
// its report and the part fitted. Server Component.
import { ArrowSquareOut, CurrencyEur, Eye, GlobeHemisphereEast, WarningCircle, Wrench } from '@phosphor-icons/react/dist/ssr';
import type { Icon } from '@phosphor-icons/react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Callout } from '@/components/app/Callout';
import { ClickableRow } from '@/components/app/ClickableRow';
import { FilterBar, FilterLabel } from '@/components/app/Filter';
import { KpiGrid, KpiTile } from '@/components/app/Kpi';
import { SectionCard, Stack } from '@/components/app/SectionCard';
import { Segmented } from '@/components/ds/Segmented';
import { Table, Th } from '@/components/ds/Table';
import { cx } from '@/components/ds/cx';
import type { SavView } from '@/domain/aftersales';
import type { T } from '@/i18n/translate';
import { VIGIE_LINK_ATTRS } from '@/server/integrations/vigie/links';
import { FollowupFormButton } from './followup-buttons';
import type { ClaimEcoView, ClaimRowView, CostRowView, InterventionRowView, SavScreenView } from './model';
import s from './aftersales.module.css';

const VIEW_ICON: Record<SavView, Icon> = { claims: WarningCircle, interventions: Wrench, costs: CurrencyEur };

export function SavBody({ view, t, drawer }: { view: SavScreenView; t: T; /** R-143: the open claim's drawer. */ drawer?: ReactNode }) {
  return (
    <Stack>
      <FilterBar>
        <FilterLabel icon={Eye}>{t('Display')}</FilterLabel>
        <Segmented wrap label={t('Display')} value={view.view} options={view.seg.map((o) => ({ value: o.value, label: o.label, href: o.href, icon: VIEW_ICON[o.value] }))} />
      </FilterBar>
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
      {view.claims && <Claims rows={view.claims} t={t} />}
      {view.interventions && <Interventions rows={view.interventions} t={t} />}
      {view.costs && <Costs rows={view.costs} t={t} />}
      {drawer}
    </Stack>
  );
}

function EcoTag({ eco }: { eco: ClaimEcoView }) {
  if (!eco.href) return <span className={cx('tag tag-outline', s.ecoTag)}>{eco.text}</span>;
  return eco.external ? (
    <a href={eco.href} {...VIGIE_LINK_ATTRS} className={cx('tag tag-outline', s.ecoTag)} aria-label={eco.label} title={eco.label}>
      {eco.text}
      <ArrowSquareOut aria-hidden />
    </a>
  ) : (
    <Link href={eco.href} className={cx('tag tag-outline', s.ecoTag)} title={eco.label}>
      {eco.text}
    </Link>
  );
}

function Claims({ rows, t }: { rows: ClaimRowView[]; t: T }) {
  return (
    <SectionCard title={t('Claims')} scroll>
      <Table size={12.5}>
        <thead>
          <tr>
            <Th />
            <Th>{t('Machine')}</Th>
            <Th>{t('Reported issue')}</Th>
            <Th>{t('Severity')}</Th>
            <Th>{t('Date')}</Th>
            <Th>{t('Status')}</Th>
            <Th>{t('Coverage')}</Th>
            <Th align="right">{t('Cost')}</Th>
            <Th>{t('Owner')}</Th>
            <Th>{t('Next step')}</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <ClickableRow key={c.number} href={c.href} selected={c.selected}>
              <td className={s.id}>{c.number}</td>
              <td>
                <div className={s.stack}>
                  <span style={{ color: c.color }}>{c.machineName}</span>
                  <span className={s.sub}>{c.machineSub}</span>
                </div>
              </td>
              <td className={s.issue} style={{ color: c.color }}>
                {c.issue}
                {c.eco && <EcoTag eco={c.eco} />}
              </td>
              <td>
                <span className={cx(c.severityClass, s.tag105)}>{c.severity}</span>
              </td>
              <td className={cx(s.c12, s.nowrap)}>{c.date}</td>
              <td>
                <span className={cx(c.statusClass, s.nowrap)}>{c.status}</span>
              </td>
              <td>
                <span className={cx(c.coverageClass, s.tag105)}>{c.coverage}</span>
              </td>
              <td className={s.right}>{c.cost}</td>
              <td className={cx(s.c12, s.nowrap)}>{c.owner}</td>
              <td className={s.next}>
                <span className={s.pretty}>{c.next}</span>
              </td>
            </ClickableRow>
          ))}
        </tbody>
      </Table>
    </SectionCard>
  );
}

function Interventions({ rows, t }: { rows: InterventionRowView[]; t: T }) {
  return (
    <SectionCard title={t('Interventions')} scroll>
      <Table size={12.5}>
        <thead>
          <tr>
            <Th />
            <Th>{t('Machine')}</Th>
            <Th>{t('Date')}</Th>
            <Th>{t('Technician')}</Th>
            <Th>{t('Type')}</Th>
            <Th>{t('Duration')}</Th>
            <Th>{t('Status')}</Th>
            <Th aria-label={t('Actions')} />
          </tr>
        </thead>
        <tbody>
          {rows.map((i) => (
            <tr key={i.number}>
              <td className={s.id}>{i.number}</td>
              <td>
                <div className={s.stack}>
                  <span>{i.machineName}</span>
                  <span className={s.sub}>{i.machineSub}</span>
                </div>
              </td>
              <td className={cx(s.c12, s.nowrap)}>{i.date}</td>
              <td className={s.c12}>{i.technicians}</td>
              <td className={s.c12Muted}>
                {i.type}
                {i.doneLine && <span className={s.sub}>{i.doneLine}</span>}
              </td>
              <td className={s.c12}>{i.duration}</td>
              <td>
                <span className={i.statusClass}>{i.status}</span>
              </td>
              <td>
                {i.done && <FollowupFormButton kind="done" target={i.number} label={i.done.label} ariaLabel={i.done.ariaLabel} context={`${i.number} · ${i.machineName}`} form={i.done.form} size="row" />}
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
    </SectionCard>
  );
}

function Costs({ rows, t }: { rows: CostRowView[]; t: T }) {
  return (
    <SectionCard title={t('Costs per machine')} scroll>
      <Table size={12.5}>
        <thead>
          <tr>
            <Th />
            <Th>{t('Machine')}</Th>
            <Th>{t('Claims')}</Th>
            <Th align="right">{t('Warranty cost')}</Th>
            <Th align="right">{t('Chargeable')}</Th>
            <Th aria-label={t('Warranty cost')} />
          </tr>
        </thead>
        <tbody>
          {rows.map((m) => (
            <tr key={m.number}>
              <td className={s.id}>{m.number}</td>
              <td>
                <div className={s.stack}>
                  <span className={s.strong}>{m.name}</span>
                  <span className={s.sub}>{m.sub}</span>
                </div>
              </td>
              <td className={s.num}>{m.claims}</td>
              <td className={s.right}>{m.warrantyCost}</td>
              <td className={s.chargeable}>{m.chargeable}</td>
              <td className={s.barCell}>
                <div className={s.bar}>
                  <div className={s.barFill} style={{ width: `${m.barPct}%` }} />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
    </SectionCard>
  );
}
