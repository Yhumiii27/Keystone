// Budget view bar (docs/spec/04 §1.3; template 288, `budgetSeg` logic 5186): eye + "Display" + segmented
// Performance / Structure & changes / Cash & recovery (URL state `?tab=`) + helper text. Server Component.
import { Eye } from '@phosphor-icons/react/dist/ssr';
import { Segmented } from '@/components/ds/Segmented';
import type { T } from '@/i18n/translate';
import s from './budget.module.css';

export type BudgetTab = 'perf' | 'setup' | 'cash';

export const BUDGET_TABS: { value: BudgetTab; label: string }[] = [
  { value: 'perf', label: 'Performance' },
  { value: 'setup', label: 'Structure & changes' },
  { value: 'cash', label: 'Cash & recovery' },
];

/** `?tab=` value → tab ('perf' by default). */
export const parseBudgetTab = (v: string | string[] | undefined): BudgetTab => (v === 'setup' || v === 'cash' ? v : 'perf');

/** URL of a tab: the screen URL for Performance, `?tab=setup|cash` otherwise. */
export const budgetTabHref = (base: string, tab: BudgetTab) => (tab === 'perf' ? base : `${base}?tab=${tab}`);

export function BudgetViewBar({ tab, base, t }: { tab: BudgetTab; base: string; t: T }) {
  return (
    <div className={s.viewBar}>
      <div className={s.viewGroup}>
        <span className={s.viewLabel}>
          <Eye className={s.viewIcon} aria-hidden />
          {t('Display')}
        </span>
        <Segmented
          wrap
          label={t('Display')}
          value={tab}
          options={BUDGET_TABS.map((o) => ({ value: o.value, label: t(o.label), href: budgetTabHref(base, o.value) }))}
        />
      </div>
      <span className={s.viewHint}>{t('Budget structure, cost categories and change requests are defined per project')}</span>
    </div>
  );
}
