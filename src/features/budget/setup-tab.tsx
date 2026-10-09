// Budget › Structure & changes tab (docs/spec/04 §1.5; template 379–447, logic 3829–3833, 4048–4056). Server Component.
// Chapter 4 (A-14): "Add category" offers Settings › Cost categories and the row pencil edits name, type and budget.
import { ArrowRight, HourglassHigh } from '@phosphor-icons/react/dist/ssr';
import type { CSSProperties, ReactNode } from 'react';
import { CardGrid, EmptyState, LO, OK, ReconStep, SectionCard, statusTagClass } from '@/components/app';
import { ButtonLink } from '@/components/ds/Button';
import { CardTitle } from '@/components/ds/Card';
import { Table, Td, Th } from '@/components/ds/Table';
import { contingencyDrawn, isLongLead, workPackageBar, workPackageTotals, type OfferQuote } from '@/domain/evm';
import type { Lang, T } from '@/i18n/translate';
import { money, pct } from '@/lib/format';
import type { CostControl } from '@/server/dal/cost';
import type { RexPattern } from '@/server/dal/budget';
import type { ListOption } from '@/domain/settings-rules';
import { AddCategoryButton, EditCategoryButton } from './category-buttons';
import { addCategoryFormDef, editCategoryFormDef, editCategoryValues } from './category-forms';
import { costTypeLabel } from './i18n';
import { NewChangeRequestLink } from './change-request-link';
import s from './budget.module.css';

export interface SetupTabProps {
  cost: CostControl;
  offer: OfferQuote[];
  rex: RexPattern | null;
  /** `costProfile.sourceText · costProfile.rexText`, already translated. */
  profileText: string;
  /** Plan — WBS screen of the project ("Open plan"). */
  planHref: string;
  /** Edit controls visible (not outside the workspace, project not read-only). */
  canEdit: boolean;
  /** Project code (the category dialogs; the URL's when omitted). */
  code?: string;
  /** Translated project label, the dialogs' sub-line. */
  context?: string;
  /** Settings › Cost categories offered by "Add category" (active values, A-14). */
  categoryOptions?: readonly ListOption[];
  lang: Lang;
  t: T;
}

/**
 * Header of the Cost categories / Change requests / Budget by work package cards (template 403, 414, 427):
 * title + 12px subtitle column (margin-right:auto) then the action, `gap:10px; flex-wrap:wrap`.
 */
function CardHead({ title, subtitle, actions }: { title: string; subtitle: string; actions?: ReactNode }) {
  return (
    <div className={s.headRow}>
      <div className={s.titleCol}>
        <CardTitle>{title}</CardTitle>
        <span className={s.subtitle}>{subtitle}</span>
      </div>
      {actions}
    </div>
  );
}

export function SetupTab({ cost, offer, rex, profileText, planHref, canEdit, code, context, categoryOptions = [], lang, t }: SetupTabProps) {
  const f = (k: number, signed?: boolean) => money(k, lang, { signed });
  const m = (i: number | null) => (i == null ? '' : (cost.chartMonths[i] ?? ''));
  const rc = cost.recon;
  const cont = contingencyDrawn(rc.cont, rc.contUsed);
  const recon = [
    { label: 'Original budget', value: f(rc.orig), sub: t(`BL1 · ${cost.baselineSet}`) },
    {
      label: 'Approved changes',
      value: rc.chg ? f(rc.chg, true) : '—',
      sub: t(`${rc.crCount} change request${rc.crCount === 1 ? '' : 's'}`),
      color: rc.chg ? 'var(--color-accent-300)' : 'var(--color-neutral-400)',
    },
    { label: 'Current budget (BAC)', value: f(cost.bac), sub: t('Basis for CPI / EAC'), highlight: true },
    { label: 'Pending', value: rc.pending ? f(rc.pending, true) : '—', sub: t(rc.pendingSub), color: 'var(--color-neutral-300)' },
    {
      label: 'Contingency',
      value: f(rc.cont),
      sub: t(`${cont.pct}% drawn`) + (cont.over ? ' · ' + t(`${f(cont.over, true)} over`) : ''),
      color: cont.over ? LO : OK,
    },
  ];
  const wpRows = cost.workPackages.map((w) => ({ ...w, weight: 400 }));
  const tot = workPackageTotals(cost.workPackages);

  return (
    <div className={s.stack}>
      {/* Card 1 — Cost profile (381–389) */}
      <SectionCard gap={12} scroll title={t('Cost profile — basis of the planned value')} subtitle={profileText}>
        <div className={s.section}>
          <span className={s.kicker}>{t('Commercial offer · long-lead systems with deposits')}</span>
          <Table size={12.5}>
            <thead>
              <tr>
                <Th>{t('System')}</Th>
                <Th>{t('Supplier')}</Th>
                <Th align="right">{t('Amount')}</Th>
                <Th>{t('Payment terms')}</Th>
                <Th>{t('Order → delivery → acceptance')}</Th>
                <Th align="right">{t('Lead time')}</Th>
              </tr>
            </thead>
            <tbody>
              {offer.map((q, i) => (
                <tr key={i}>
                  <Td className={s.strong}>{t(q.system)}</Td>
                  <Td color="var(--color-neutral-300)">{t(q.supplier)}</Td>
                  <Td align="right" numeric>
                    {f(q.amount)}
                  </Td>
                  <Td numeric nowrap>
                    {t(`${q.terms} %`)}
                  </Td>
                  <Td nowrap>{t(`${m(q.orderMonth)} → ${m(q.deliveryMonth)}${q.acceptanceMonth != null ? ' → ' + m(q.acceptanceMonth) : ''}`)}</Td>
                  <Td align="right" numeric nowrap>
                    {isLongLead(q) && <HourglassHigh className={s.leadIcon} aria-hidden />}
                    {t(`${q.leadWeeks} wk`)}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
        <div className={s.refGrid}>
          <div className={s.section}>
            <span className={s.kicker}>{`${t('Financial REX · same product category')} · ${t(rex?.mt ?? 'AUTRE')}`}</span>
            {rex?.refs.map((r) => (
              <div key={r.id} className={s.refRow}>
                <span className={s.refId}>{r.id}</span>
                <span className={s.refName}>
                  <span>{t(r.name)}</span>
                  <span className={s.refPattern}>{t(r.pattern)}</span>
                </span>
                <span className={s.refYear}>{r.year}</span>
              </div>
            ))}
          </div>
          <div className={s.section}>
            <span className={s.kicker}>{t('Other cost streams')}</span>
            {cost.streams.map((st, i) => (
              <div key={i} className={s.streamRow}>
                <span>{t(st.name)}</span>
                <span className={s.streamBasis}>{t(st.basis)}</span>
              </div>
            ))}
          </div>
        </div>
      </SectionCard>

      {/* Card 2 — Budget reconciliation (390–399) */}
      <SectionCard gap={10} title={t('Budget reconciliation')} hint={t('Original baseline → approved changes → current budget')}>
        <div className={s.reconRow}>
          {recon.map((r, i) => (
            <ReconStep key={r.label} label={t(r.label)} value={r.value} sub={r.sub} color={r.color ?? OK} highlight={r.highlight} arrow={i < 2} />
          ))}
        </div>
      </SectionCard>

      <CardGrid min={420} align="stretch">
        {/* Card 3 — Cost categories (402–411) */}
        <SectionCard>
          <CardHead
            title={t('Cost categories')}
            subtitle={t('Defined per project · actuals map in by rule')}
            actions={canEdit ? <AddCategoryButton code={code} context={context} form={addCategoryFormDef(categoryOptions)} /> : undefined}
          />
          <Table size={13}>
            <thead>
              <tr>
                <Th>{t('Code')}</Th>
                <Th>{t('Category')}</Th>
                <Th>{t('Type')}</Th>
                <Th>{t('Actuals from')}</Th>
                <Th align="right">{t('Budget')}</Th>
                {canEdit && <Th />}
              </tr>
            </thead>
            <tbody>
              {cost.categories.map((c) => (
                <tr key={c.code}>
                  <Td tone="muted" numeric>
                    {c.code}
                  </Td>
                  <Td className={s.strong}>{t(c.name)}</Td>
                  <Td>
                    <span className="tag tag-neutral">{costTypeLabel(c.costTypeLabel, t, lang)}</span>
                  </Td>
                  <Td tone="secondary">{t(c.source)}</Td>
                  <Td align="right" numeric>
                    {f(c.budget)}
                  </Td>
                  {canEdit && (
                    <Td align="right">
                      <EditCategoryButton code={code} context={context} form={editCategoryFormDef()} category={c.code} values={editCategoryValues(c)} />
                    </Td>
                  )}
                </tr>
              ))}
            </tbody>
          </Table>
        </SectionCard>

        {/* Card 4 — Change requests (413–424) */}
        <SectionCard>
          <CardHead
            title={t('Change requests')}
            subtitle={t('Approved changes revise the budget baseline')}
            actions={canEdit ? <NewChangeRequestLink /> : undefined}
          />
          {cost.changes.map((cr) => (
            <div key={cr.id} className={s.crRow}>
              <span className={s.crId}>{cr.id}</span>
              <div className={s.crMain}>
                <span className={s.crTitle}>{t(cr.title)}</span>
                <span className={s.crMeta}>{t(cr.meta)}</span>
              </div>
              <div className={s.crAmounts}>
                <span className={s.crAmount} style={{ '--cr-color': cr.amount > 0 ? LO : 'var(--color-neutral-300)' } as CSSProperties}>
                  {f(cr.amount, true)}
                </span>
                <span className={s.crDays}>{t(cr.days ? `${cr.days > 0 ? '+' : ''}${cr.days} days` : 'No schedule impact')}</span>
              </div>
              <span className={statusTagClass('budgetChange', cr.status)}>{t(cr.statusLabel)}</span>
            </div>
          ))}
          {!cost.changes.length && <EmptyState variant="boxed">{t('No change requests raised — the current budget equals the original baseline')}</EmptyState>}
        </SectionCard>
      </CardGrid>

      {/* Card 5 — Budget by work package (426–445) */}
      <SectionCard scroll>
        <CardHead
          title={t('Budget by work package')}
          subtitle={t('Mapped to the WBS — every activity carries its share')}
          actions={
            <ButtonLink href={planHref} variant="ghost" size="sm" iconRight={ArrowRight}>
              {t('Open plan')}
            </ButtonLink>
          }
        />
        <Table size={13}>
          <thead>
            <tr>
              <Th>{t('WBS')}</Th>
              <Th>{t('Work package')}</Th>
              <Th align="right">{t('Original')}</Th>
              <Th align="right">{t('Changes')}</Th>
              <Th align="right">{t('Current')}</Th>
              <Th align="right">{t('Actual')}</Th>
              <Th align="right">{t('EAC')}</Th>
              <Th width="22%">{t('Actual · tick = current · ◆ EAC')}</Th>
              <Th align="right">{t('Variance')}</Th>
            </tr>
          </thead>
          <tbody>
            {[...wpRows, { wbs: '', name: 'Total', ...tot, weight: 500 }].map((w, i) => {
              const cur = w.original + w.changes;
              const bar = workPackageBar(cur, w.actual, w.eac);
              const v = cur - w.eac;
              return (
                <tr key={i} style={{ fontWeight: w.weight }}>
                  <Td tone="muted" numeric>
                    {w.wbs}
                  </Td>
                  <Td>{t(w.name)}</Td>
                  <Td align="right" numeric>
                    {f(w.original)}
                  </Td>
                  <Td align="right" numeric color={w.changes ? 'var(--color-accent-300)' : 'var(--color-neutral-500)'}>
                    {w.changes ? f(w.changes, true) : '—'}
                  </Td>
                  <Td align="right" numeric>
                    {f(cur)}
                  </Td>
                  <Td align="right" numeric>
                    {f(w.actual)}
                  </Td>
                  <Td align="right" numeric>
                    {f(w.eac)}
                  </Td>
                  <Td>
                    <div
                      className={s.wpTrack}
                      style={{ '--wp-a': pct(bar.actual), '--wp-t': pct(bar.tick), '--wp-e': pct(bar.eac) } as CSSProperties}
                    >
                      <div className={s.wpFill} />
                      <div className={s.wpTick} />
                      <div className={s.wpDiamond} />
                    </div>
                  </Td>
                  <Td align="right" numeric color={v < 0 ? LO : 'var(--color-neutral-300)'}>
                    {f(v, true)}
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      </SectionCard>
    </div>
  );
}
