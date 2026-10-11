// Change control & baselines body (docs/spec/07 §2.2, template 1833–1882): KPI row, type chips with the workflow
// hint, change-request register, baselines register and the CR drawer (`?cr=CR-008`). Server Component; the
// interactive parts (row selection, Submit for review, Approve / Reject) are client islands.
import { ChartLineUp, TreeStructure } from '@phosphor-icons/react/dist/ssr';
import type { CSSProperties } from 'react';
import { ClickableRow } from '@/components/app/ClickableRow';
import { EmptyState } from '@/components/app/EmptyState';
import { Eyebrow } from '@/components/app/Eyebrow';
import { FilterBar, FilterChips, FilterGroup, FilterLabel, FilterNote } from '@/components/app/Filter';
import { KeyValueList } from '@/components/app/KeyValueList';
import { KpiGrid, KpiTile } from '@/components/app/Kpi';
import { SectionCard } from '@/components/app/SectionCard';
import { LO, OK } from '@/components/app/tones';
import { ButtonLink } from '@/components/ds/Button';
import { cx } from '@/components/ds/cx';
import { Drawer } from '@/components/ds/Drawer';
import { Table, Td, Th } from '@/components/ds/Table';
import { Tag } from '@/components/ds/Tag';
import type { RoleKey } from '@/config/screens';
import {
  BASELINE_STATE_LABEL, BASELINE_TONE, CR_STATUS_LABEL, CR_STATUS_TONE, CR_STEP_LABEL, amountCell, canDecideStep, chainDots, crChips, crHint,
  crImpact, crKpis, daysCell, filterCrs, stepState, typesText, type BaselineLike, type ChangeRequestLike, type CrFilter,
} from '@/domain/change-control';
import { crActivitiesEditable } from '@/domain/change-activities';
import type { Lang, T } from '@/i18n/translate';
import { money } from '@/lib/format';
import { StepDecisionButtons, SubmitForReviewButton } from './change-buttons';
import { CrActivitiesEditor, type CrActivityRow } from './cr-activities';
import s from './changes.module.css';

export interface ChangesViewData {
  /** Register order, effective status. */
  crs: ChangeRequestLike[];
  baselines: BaselineLike[];
  originalBudget: number | null;
  bac: number;
  contingency: number | null;
}

export interface ChangesViewProps {
  code: string;
  data: ChangesViewData;
  filter: CrFilter;
  /** Open drawer (`?cr=`), null when closed or unknown. */
  selected: string | null;
  role: RoleKey;
  /** Edit controls (submit, decisions): not outside the workspace, not a read-only project. */
  canEdit: boolean;
  /** `?filter=` / `?cr=` URL builder of this screen. */
  href: (q: { filter?: CrFilter; cr?: string | null }) => string;
  planHref: string;
  budgetHref: string;
  lang: Lang;
  t: T;
  /**
   * Delivery 7 (NEW-D2-2, R-062): plan activities each request touches (by request number), the plan's activities offered
   * to link, and whether the viewer edits the links (the project team; never the client, who does not see the section).
   */
  crActivities?: { byCr: Record<string, CrActivityRow[]>; options: { value: string; label: string }[]; canEdit: boolean; visible: boolean };
}

const DAYS_COLOR = { delay: LO, gain: 'var(--color-accent-300)', none: 'var(--color-neutral-400)' } as const;

export function ChangesView({ code, data, filter, selected, role, canEdit, href, planHref, budgetHref, lang, t, crActivities }: ChangesViewProps) {
  const { crs } = data;
  const kpis = crKpis(crs, { originalBudget: data.originalBudget, bac: data.bac, baselines: data.baselines }, lang);
  const rows = filterCrs(crs, filter);
  const open = selected ? crs.find((c) => c.id === selected) : undefined;
  const proposed = data.baselines.find((b) => b.state === 'proposed' && b.changeRequest);
  const blHint = proposed
    ? `A re-baseline is itself a change request — ${proposed.code} becomes current when ${proposed.changeRequest} is approved`
    : 'A re-baseline is itself a change request';

  return (
    <div className={s.stack}>
      <KpiGrid min={150}>
        {kpis.map((k) => (
          <KpiTile key={k.label} label={t(k.label)} value={t(k.value)} sub={t(k.sub)} color={k.alert ? LO : OK} />
        ))}
      </KpiGrid>

      <FilterBar gap={6}>
        <FilterGroup>
          <FilterLabel>{t('Type')}</FilterLabel>
          <FilterChips
            label={t('Type')}
            value={filter}
            options={crChips(crs).map((c) => ({ value: c.value, label: t(c.label), count: c.count, href: href({ filter: c.value, cr: selected }) }))}
          />
        </FilterGroup>
        <FilterNote>{t('Draft → in review (PM → director → client → change control board) → approved · approved changes revise budget, schedule and WBS')}</FilterNote>
      </FilterBar>

      <SectionCard title={t('Change requests')} hint={t('Click a request for its impact and approval chain')} scroll>
        <Table size={13}>
          <thead>
            <tr>
              <Th>{t('Request')}</Th>
              <Th>{t('Type')}</Th>
              <Th align="right">{t('Budget')}</Th>
              <Th align="right">{t('Schedule')}</Th>
              <Th>{t('WBS')}</Th>
              <Th>{t('Baseline')}</Th>
              <Th>{t('Approval chain')}</Th>
              <Th>{t('Status')}</Th>
              <Th aria-label={t('Actions')} />
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => {
              const isOpen = c.id === open?.id;
              const amt = amountCell(c.amount, lang);
              const days = daysCell(c.days);
              return (
                <ClickableRow key={c.id} href={href({ filter, cr: isOpen ? null : c.id })}>
                  <td>
                    <div className={s.reqCell}>
                      <span className={cx(s.reqId, isOpen && s.reqIdOn)}>{c.id}</span>
                      <span className={s.pretty}>{t(c.title)}</span>
                      <span className={s.reqBy}>{t(`${c.by} · ${c.date}`)}</span>
                    </div>
                  </td>
                  <Td tone="secondary" nowrap>
                    {t(typesText(c.types))}
                  </Td>
                  <Td align="right" numeric nowrap color={amt.lo ? LO : 'var(--color-neutral-300)'}>
                    {t(amt.text)}
                  </Td>
                  <Td align="right" numeric nowrap color={DAYS_COLOR[days.tone]}>
                    {t(days.text)}
                  </Td>
                  <Td tone="secondary" numeric>
                    {c.wbs.length ? c.wbs.map((w) => w.code).join(', ') : '—'}
                  </Td>
                  <td className={s.blCell}>{c.baseline ?? '—'}</td>
                  <td>
                    <div className={s.chain}>
                      {chainDots(c.chain).map((d) => {
                        const name = t(CR_STEP_LABEL[d.step]) + (d.state ? ` · ${t(d.state)}` : '');
                        return (
                          <span key={d.step} className={s.chainItem} title={name}>
                            <span className={s.dot} style={{ '--dot': d.dot, '--ring': d.ring } as CSSProperties} role="img" aria-label={name} />
                            {t(d.label)}
                          </span>
                        );
                      })}
                    </div>
                  </td>
                  <td>
                    <Tag tone={CR_STATUS_TONE[c.status]}>{t(CR_STATUS_LABEL[c.status])}</Tag>
                  </td>
                  <td>
                    <div className={s.rowActions}>{canEdit && c.status === 'draft' && <SubmitForReviewButton code={code} number={c.id} variant="row" />}</div>
                  </td>
                </ClickableRow>
              );
            })}
          </tbody>
        </Table>
        {!rows.length && <EmptyState>{t('No change request of this type')}</EmptyState>}
      </SectionCard>

      <SectionCard title={t('Baselines')} hint={t(blHint)} scroll>
        <Table size={13}>
          <thead>
            <tr>
              <Th>{t('Baseline')}</Th>
              <Th>{t('Name')}</Th>
              <Th>{t('Set on')}</Th>
              <Th align="right">{t('BAC')}</Th>
              <Th>{t('Finish')}</Th>
              <Th>{t('State')}</Th>
            </tr>
          </thead>
          <tbody>
            {data.baselines.map((b) => (
              <tr key={b.code}>
                <td className={s.blId}>{b.code}</td>
                <td>{t(b.name)}</td>
                <Td color="var(--color-neutral-300)">{t(b.setOn)}</Td>
                <Td align="right" numeric>
                  {money(b.bac, lang)}
                </Td>
                <Td numeric>{t(b.finish)}</Td>
                <td>
                  <Tag tone={BASELINE_TONE[b.state]} nowrap={false}>
                    {t(BASELINE_STATE_LABEL[b.state])}
                  </Tag>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
        {!data.baselines.length && <EmptyState>{t('No baseline recorded for this project yet')}</EmptyState>}
      </SectionCard>

      {open && (
        <ChangeRequestDrawer
          cr={open}
          code={code}
          ctx={{ bac: data.bac, contingency: data.contingency, proposedBaseline: data.baselines.find((b) => b.changeRequest === open.id)?.code ?? null }}
          role={role}
          canEdit={canEdit}
          closeHref={href({ filter, cr: null })}
          planHref={planHref}
          budgetHref={budgetHref}
          lang={lang}
          t={t}
          crActivities={crActivities}
        />
      )}
    </div>
  );
}

export interface CrDrawerProps {
  cr: ChangeRequestLike;
  code: string;
  ctx: { bac: number; contingency: number | null; proposedBaseline?: string | null };
  role: RoleKey;
  canEdit: boolean;
  closeHref: string;
  planHref: string;
  budgetHref: string;
  lang: Lang;
  t: T;
  crActivities?: ChangesViewProps['crActivities'];
}

/** CR drawer (crVals 4607–4610) over the DS Drawer (client; closes to the register URL without `?cr=`). */
function ChangeRequestDrawer(props: CrDrawerProps) {
  const { cr, closeHref, t } = props;
  return (
    <Drawer
      open
      closeHref={closeHref}
      id={cr.id}
      title={t(cr.title)}
      meta={
        <>
          <Tag tone="neutral" nowrap={false}>
            {t(typesText(cr.types))}
          </Tag>
          <Tag tone={CR_STATUS_TONE[cr.status]} nowrap={false}>
            {t(CR_STATUS_LABEL[cr.status])}
          </Tag>
        </>
      }
    >
      <CrDrawerBody {...props} />
    </Drawer>
  );
}

/** Impact value in the viewer's language: "Requires re-baseline → BL3" keeps its code (any BLn, S-3). */
const impactText = (v: string, t: (s: string) => string) => {
  const m = /^Requires re-baseline → (BL\d+)$/.exec(v);
  return m ? `${t('Requires re-baseline →')} ${m[1]}` : t(v);
};

/** Drawer content: raised by, impact, approval chain with the viewer's decisions, hint, actions. */
export function CrDrawerBody({ cr, code, ctx, role, canEdit, planHref, budgetHref, lang, t, crActivities }: Omit<CrDrawerProps, 'closeHref'>) {
  const impact = crImpact(cr, ctx, lang);
  // A read-only / outside viewer gets no "Submit the request…" instruction: the Submit button is hidden for them.
  const hint = cr.status === 'draft' && !canEdit ? '' : crHint(cr, role);
  return (
    <>
      <span className={s.raised}>
        {t('Raised by')} {t(`${cr.by} · ${cr.date}`)}
      </span>
      <KeyValueList title={t('Impact')} items={impact.map((r) => ({ k: t(r.k), v: impactText(r.v, t), color: r.lo ? LO : OK }))} />
      <section className={s.chainSection} aria-label={t('Approval chain')}>
        <Eyebrow>{t('Approval chain')}</Eyebrow>
        {cr.chain.map((st) => {
          const state = stepState(st.decision);
          const act = canEdit && canDecideStep(role, cr, st.step);
          return (
            <div key={st.step} className={s.step}>
              <span className={s.stepText}>
                <span className={s.stepLabel}>{t(CR_STEP_LABEL[st.step])}</span>
                <span className={s.stepWho}>{st.approver ? t(st.approver) : '—'}</span>
              </span>
              <div className={s.stepActions}>
                {act && <StepDecisionButtons code={code} number={cr.id} step={st.step} stepLabel={t(CR_STEP_LABEL[st.step])} />}
                {state ? (
                  <Tag tone={state.tone} nowrap={false}>
                    {t(state.label)}
                  </Tag>
                ) : (
                  <span className={s.unrecorded}>—</span>
                )}
              </div>
            </div>
          );
        })}
        <span className={s.hint}>{hint ? t(hint) : ''}</span>
      </section>
      {crActivities?.visible && (
        <section className={s.chainSection} aria-label={t('Plan activities')}>
          <Eyebrow>{t('Plan activities')}</Eyebrow>
          <CrActivitiesEditor
            code={code}
            number={cr.id}
            rows={crActivities.byCr[cr.id] ?? []}
            options={crActivities.options.filter((o) => !(crActivities.byCr[cr.id] ?? []).some((r) => r.code === o.value))}
            editable={crActivities.canEdit && crActivitiesEditable(cr.status)}
          />
        </section>
      )}
      <div className={s.actions}>
        {canEdit && cr.status === 'draft' && <SubmitForReviewButton code={code} number={cr.id} variant="drawer" />}
        <ButtonLink variant="secondary" size="sm" icon={TreeStructure} href={planHref}>
          {t('Open plan')}
        </ButtonLink>
        <ButtonLink variant="secondary" size="sm" icon={ChartLineUp} href={budgetHref}>
          {t('Open budget')}
        </ButtonLink>
      </div>
    </>
  );
}
