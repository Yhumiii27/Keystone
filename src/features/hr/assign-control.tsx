'use client';
// "Assign" control of a line of hours declared without a planned task (docs/spec/06 §5.4d): level-1 work package
// select + "Assign" button. The prototype has no handler (06 OQ9); here it routes the hours to the work package.
// Renders two grid cells of the row.
import { useState, useTransition } from 'react';
import { Button } from '@/components/ds/Button';
import { cx } from '@/components/ds/cx';
import { showToast } from '@/components/ds/Toast';
import { useI18n } from '@/i18n/client';
import { assignHoursAction } from './actions';
import s from './hr.module.css';

export function AssignControl({ code, index, options }: { code: string; index: number; options: { value: string; label: string }[] }) {
  const { t } = useI18n();
  const [wbs, setWbs] = useState(options[0]?.value ?? '');
  const [pending, startTransition] = useTransition();
  const assign = () =>
    startTransition(async () => {
      try {
        const r = await assignHoursAction(code, index, wbs);
        const msg = typeof r === 'string' ? r : r && typeof r === 'object' ? (r.error ?? r.toast) : undefined;
        if (msg) showToast(msg);
      } catch (e) {
        showToast(e instanceof Error ? e.message : String(e));
      }
    });
  return (
    <>
      <select className={cx('input', s.unSelect)} value={wbs} onChange={(e) => setWbs(e.target.value)} aria-label={t('Work package')} disabled={pending}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <Button size="xs" onClick={assign} disabled={pending || !wbs} aria-busy={pending || undefined}>
        {t('Assign')}
      </Button>
    </>
  );
}
