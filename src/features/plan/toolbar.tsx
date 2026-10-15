// Plan toolbar (docs/spec/05 §2.3 item 1, template 1026–1035): "Display" Structure / Progress (URL `?view=`),
// the Calendar / Baseline / Data date chips and the right-aligned "Reschedule" / "Set baseline" buttons.
// Chapter 4: the chips show the project's own calendar, displayed baseline and data date; the director and the project
// manager change them and run Reschedule / Set baseline (./plan-controls.tsx); others see static chips and no buttons.
import { ChartBar, Clock, Eye, TreeStructure } from '@phosphor-icons/react/dist/ssr';
import { FilterGroup, FilterLabel } from '@/components/app/Filter';
import { cx } from '@/components/ds/cx';
import { Segmented } from '@/components/ds/Segmented';
import type { T } from '@/i18n/translate';
import type { PlanView } from './model';
import { PickerChip, RescheduleButton, SetBaselineButton, type ChipOption } from './plan-controls';
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
  /** Next baseline code ("BL3"), the default name of "Set baseline". */
  nextBaseline: string;
  /** S-3: after BL1, "Set baseline" links to this Change control form (new request proposing the next baseline). */
  baselineChangeRequestHref?: string;
  /** Director / project manager: chips change, Reschedule and Set baseline shown. */
  canSchedule: boolean;
  t: T;
}

export function PlanToolbar({ view, hrefs, code, context, calendar, baseline, dataDate, nextBaseline, baselineChangeRequestHref, canSchedule, t }: PlanToolbarProps) {
  return (
    <div className={s.toolbar}>
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
      <div className={cx('input', s.chip, s.chipStatic)}>
        <Clock className={s.chipIcon} aria-hidden />
        <span className={s.chipLabel}>{t('Data date')}</span>
        {dataDate}
      </div>
      {canSchedule && (
        <div className={s.toolbarRight}>
          <RescheduleButton code={code} />
          <SetBaselineButton code={code} context={context} defaultName={nextBaseline} changeRequestHref={baselineChangeRequestHref} />
        </div>
      )}
    </div>
  );
}
