// Plan toolbar (docs/spec/05 §2.3 item 1, template 1026–1035): "Display" Structure / Progress (URL `?view=`),
// the Calendar / Baseline / Data date chips and the right-aligned "Reschedule" / "Set baseline" buttons.
// Chapter 4: the chips show the project's own calendar, displayed baseline and data date; the director and the project
// manager change them and run Reschedule / Set baseline (./plan-controls.tsx); others see static chips and no buttons.
// R-N04: rendered as the page header's toolbar (the charte's FilterBar, one wrapping row, COQUE.md § 5): views, chips, then the
// screen's filters (`filters`: the activity-code filter and grouping), the buttons pushed right.
import type { ReactNode } from 'react';
import { FilterBar } from '@norma/charte/ds/FilterBar';
import { ChartBar, Clock, Eye, TreeStructure } from '@phosphor-icons/react/dist/ssr';
import { FilterGroup, FilterLabel } from '@/components/app/Filter';
import { cx } from '@/components/ds/cx';
import { Segmented } from '@/components/ds/Segmented';
import type { EstimateClass } from '@/domain/estimate-class';
import type { T } from '@/i18n/translate';
import type { PlanView } from './model';
import { DataDateChip, PickerChip, RescheduleButton, SetBaselineButton, type ChipOption } from './plan-controls';
import s from './plan.module.css';

export interface PlanToolbarProps {
  view: PlanView;
  /** Links of the two views (keep the selection params). */
  hrefs: Record<PlanView, string>;
  code: string;
  /** Translated "#026 · Harbor Line Terminal Expansion" (dialog sub-line). */
  context: string;
  calendar: { value: string; current: string; options: ChipOption[] };
  baseline: { value: string; current: string; options: ChipOption[] };
  /** Translated data date ("25 sept. 2026"). */
  dataDate: string;
  /** D9-09: preset of the « Data date » dialog (the proposed Friday, else the stored date, else today) — ISO. */
  dataDateDefault: string;
  /** D9-09: translated Friday Keystone proposes as the next data date; absent when none. */
  dataDateProposed?: string;
  /** Next baseline code ("BL3"), the default name of "Set baseline". */
  nextBaseline: string;
  /** R-188: estimate class preset in "Set baseline" (class of the project's stage). */
  defaultEstimateClass: EstimateClass;
  /** S-3: after BL1, "Set baseline" links to this Change control form (new request proposing the next baseline). */
  baselineChangeRequestHref?: string;
  /** Director / project manager: chips change, Reschedule and Set baseline shown. */
  canSchedule: boolean;
  /** Filters shown after the chips (R-204 activity codes). */
  filters?: ReactNode;
  t: T;
}

export function PlanToolbar({ view, hrefs, code, context, calendar, baseline, dataDate, dataDateDefault, dataDateProposed, nextBaseline, defaultEstimateClass, baselineChangeRequestHref, canSchedule, filters, t }: PlanToolbarProps) {
  return (
    <FilterBar className={s.toolbar}>
      <FilterGroup>
        <FilterLabel icon={Eye}>{t('Display')}</FilterLabel>
        <Segmented
          wrap
          label={t('Display')}
          value={view}
          options={[
            { value: 'structure', label: t('Structure'), icon: TreeStructure, href: hrefs.structure },
            { value: 'progress', label: t('Progress'), icon: ChartBar, href: hrefs.progress },
          ]}
        />
      </FilterGroup>
      <PickerChip kind="calendar" code={code} header={t('Project calendar')} canChange={canSchedule} {...calendar} />
      <PickerChip kind="baseline" code={code} header={t('Displayed baseline')} canChange={canSchedule} {...baseline} />
      {canSchedule ? (
        <DataDateChip code={code} context={context} value={dataDate} defaultIso={dataDateDefault} proposedText={dataDateProposed} />
      ) : (
        <div className={cx('input', s.chip, s.chipStatic)}>
          <Clock className={s.chipIcon} aria-hidden />
          <span className={s.chipLabel}>{t('Data date')}</span>
          <span className={s.chipValue}>{dataDate}</span>
        </div>
      )}
      {filters}
      {canSchedule && (
        <div className={s.toolbarRight}>
          <RescheduleButton code={code} />
          <SetBaselineButton code={code} context={context} defaultName={nextBaseline} defaultClass={defaultEstimateClass} changeRequestHref={baselineChangeRequestHref} />
        </div>
      )}
    </FilterBar>
  );
}
