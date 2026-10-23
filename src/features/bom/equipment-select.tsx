'use client';
// R-185 part 2: the equipment line of a BOM line on the flat list (projects with more than one equipment line, BOM editors
// only): "Common to the project" or a line ("EQ-02 · 3 × MEMU"). Changing it saves at once (setBomLineEquipmentAction, which
// re-checks the rights); a refused or failed change shows its message as a toast and the select returns to the saved value.
// Inside a clickable row: the select is interactive, so a click on it does not open the part drawer.
import { useState, useTransition } from 'react';
import { cx } from '@/components/ds/cx';
import { showToast } from '@/components/ds/Toast';
import { useI18n } from '@/i18n/client';
import { setBomLineEquipmentAction } from './actions';
import s from './bom.module.css';

export function EquipmentSelect({ code, partRef, value, choices, label }: {
  code: string;
  partRef: string;
  /** Saved value: a line's reference or 'common'. */
  value: string;
  choices: { value: string; label: string }[];
  /** Accessible name ("Equipment · ASM-RMG-250"). */
  label: string;
}) {
  const { t } = useI18n();
  const [current, setCurrent] = useState(value);
  const [pending, start] = useTransition();
  const change = (next: string) => {
    setCurrent(next);
    start(async () => {
      try {
        const r = await setBomLineEquipmentAction(code, partRef, next);
        showToast('error' in r ? r.error : r.toast);
        if ('error' in r) setCurrent(value);
      } catch {
        setCurrent(value);
        showToast(t('The change could not be saved'));
      }
    });
  };
  return (
    <select className={cx('input', s.eqSelect)} value={current} onChange={(e) => change(e.target.value)} aria-label={label} disabled={pending} aria-busy={pending || undefined}>
      {choices.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
