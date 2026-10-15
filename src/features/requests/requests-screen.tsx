// Resource requests — the PM's outbox (docs/spec/08 §5.3–§5.6; template 2689–2730, logic 4117–4138): KPI tiles, status
// chips (`?status=`), the grid table with the 3-dot stepper, decision line and the PM's row actions. Server Component;
// the row actions are a client island shown only on the viewer's own requests when they may act — and on the what-if
// drafts the viewer may send or discard (chapter 4, S-7).
import { ArrowFatUp, Lightning } from '@phosphor-icons/react/dist/ssr';
import { FilterBar, FilterChips, FilterGroup, FilterLabel, FilterNote } from '@/components/app/Filter';
import { KpiGrid, KpiTile } from '@/components/app/Kpi';
import { cx } from '@/components/ds/cx';
import type { RequestFilter } from '@/domain/requests';
import type { T } from '@/i18n/translate';
import type { RequestsScreenModel } from './model';
import { DraftRowActions, RequestRowActions } from './request-row-actions';
import { requestsHref } from './routes';
import s from './requests.module.css';

export interface RequestsScreenProps {
  model: RequestsScreenModel;
  /** Current `?status=` chip (null = All). */
  filter: RequestFilter | null;
  /** The viewer may act on their own requests (Resource requests in their workspace). */
  canAct: boolean;
  /** Translator of the feature (reqT). */
  t: T;
}

export function RequestsScreen({ model, filter, canAct, t }: RequestsScreenProps) {
  return (
    <div className={s.screen}>
      <KpiGrid>
        {model.kpis.map((k) => (
          <KpiTile key={k.label} label={k.label} value={k.value} sub={k.sub} color={k.color} />
        ))}
      </KpiGrid>
      <FilterBar gap={6}>
        <FilterGroup>
          <FilterLabel>{t('Status')}</FilterLabel>
          <FilterChips
            label={t('Status')}
            value={filter ?? 'all'}
            options={model.chips.map((c) => ({ value: c.value ?? 'all', label: c.label, count: String(c.count), href: requestsHref(c.value) }))}
          />
        </FilterGroup>
        <FilterNote>{t('A task reaches the team member only once the department head approves')}</FilterNote>
      </FilterBar>
      <div className={cx('card', 'elev-sm', s.tableCard)}>
        <div className={s.tableInner} role="table" aria-label={t('Resource requests')}>
          <div className={s.gridHead} role="row">
            <span role="columnheader">{t('Request')}</span>
            <span role="columnheader">{t('Task')}</span>
            <span role="columnheader">{t('Resource')}</span>
            <span role="columnheader">{t('When')}</span>
            <span role="columnheader">{t('Status')}</span>
            <span role="columnheader">{t('Response')}</span>
            <span role="columnheader" />
          </div>
          {model.rows.map((r) => (
            <div key={r.id} className={s.gridRow} role="row">
              <div className={s.stack} role="cell">
                <span className={s.num}>{r.id}</span>
                <span className={s.sub11}>{r.sent}</span>
              </div>
              <div className={s.taskCell} role="cell">
                <span className={s.titleLine}>
                  <span className={s.ellipsis} title={r.title}>
                    {r.title}
                  </span>
                  {r.critical && <Lightning className={s.flag} aria-label={t('Critical path')} />}
                  {r.high && <ArrowFatUp className={s.flag} aria-label={t('High priority')} />}
                </span>
                <span className={s.actSub}>{r.actLine}</span>
              </div>
              <div className={s.resource} role="cell">
                <span className={s.avatar24} aria-hidden>
                  {r.initials}
                </span>
                <div className={s.stackMin}>
                  <span className={s.ellipsis}>{r.person}</span>
                  <span className={s.sub11}>{r.dept}</span>
                </div>
              </div>
              <div className={s.stack} role="cell">
                <span className={s.numNowrap}>{r.dates}</span>
                <span className={s.sub11}>{r.hours}</span>
              </div>
              <div className={s.statusCell} role="cell">
                <span className={cx(r.tagClass, s.statusTag)}>{r.statusLabel}</span>
                <div className={s.stepper} title={t('Sent → department review → assigned to the person')}>
                  <span className={cx(s.dot, r.steps[0] && s.dotOn)} />
                  <span className={s.link} />
                  <span className={cx(s.dot, r.steps[1] && s.dotOn)} />
                  <span className={s.link} />
                  <span className={cx(s.dot, r.steps[2] && s.dotOn)} />
                </div>
                <span className={s.sub11}>{r.stepLabel}</span>
              </div>
              <span className={s.response} role="cell">
                {r.response}
              </span>
              <div className={s.rowActions} role="cell">
                {canAct && r.mine && (r.isPending || r.isReschedule || r.canReRequest) && (
                  <RequestRowActions id={r.id} isPending={r.isPending} isReschedule={r.isReschedule} canReRequest={r.canReRequest} proposed={r.proposed} />
                )}
                {canAct && r.canSendDraft && <DraftRowActions id={r.id} title={r.title} />}
              </div>
            </div>
          ))}
          {!model.rows.length && (
            <div className={s.empty} role="row">
              <span role="cell">{t('No request in this status')}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
