// Plan toolbar (docs/spec/05 §2.3 item 1, template 1026–1035): "Display" Structure / Progress (URL `?view=`),
// the Calendar / Baseline / Data date chips and the right-aligned "Reschedule" / "Set baseline" buttons.
import { ChartBar, Clock, Eye, TreeStructure } from '@phosphor-icons/react/dist/ssr';
import { FilterGroup, FilterLabel } from '@/components/app/Filter';
import { cx } from '@/components/ds/cx';
import { Segmented } from '@/components/ds/Segmented';
import type { T } from '@/i18n/translate';
import { STATUS_DATE } from '@/lib/format';
import type { PlanView } from './model';
import { SoonAction, SoonChip } from './plan-soon';
import s from './plan.module.css';

export interface PlanToolbarProps {
  view: PlanView;
  /** Links of the two views (keep the selection params). */
  hrefs: Record<PlanView, string>;
  /** Date BL1 was set ("12 Mar 2026", `PD.baselineSet`). */
  baselineSet: string;
  t: T;
}

export function PlanToolbar({ view, hrefs, baselineSet, t }: PlanToolbarProps) {
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
      {/* Calendar is per project in the prototype text only (OQ 4): the site calendar is shown for every project. */}
      <SoonChip kind="calendar" value={t('Site 6d · 10h')} />
      <SoonChip kind="baseline" value={t(`BL1 · ${baselineSet}`)} />
      <div className={cx('input', s.chip, s.chipStatic)}>
        <Clock className={s.chipIcon} aria-hidden />
        <span className={s.chipLabel}>{t('Data date')}</span>
        {t(STATUS_DATE)}
      </div>
      <div className={s.toolbarRight}>
        <SoonAction kind="reschedule" />
        <SoonAction kind="baseline" />
      </div>
    </div>
  );
}
