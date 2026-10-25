'use client';
// R-189 (Arche K-04): the CAPEX milestone a schedule milestone is — a small select on the Schedule screen's milestone list, for the
// project's leads. The Server Function checks the rights and the code; a code held by another milestone moves to this one.
import { useState, useTransition } from 'react';
import { Select } from '@/components/ds/Field';
import { showToast } from '@/components/ds/Toast';
import { setCapexMilestoneAction } from './actions';

export interface CapexMilestoneSelectProps {
  code: string;
  milestoneId: string;
  value: string;
  /** Accessible name: "CAPEX milestone · <milestone name>". */
  label: string;
  options: { value: string; label: string }[];
  saved: string;
}

export function CapexMilestoneSelect({ code, milestoneId, value, label, options, saved }: CapexMilestoneSelectProps) {
  const [current, setCurrent] = useState(value);
  const [pending, startTransition] = useTransition();
  return (
    <Select
      size="inline"
      aria-label={label}
      title={label}
      value={current}
      options={options}
      disabled={pending}
      aria-busy={pending || undefined}
      onChange={(e) => {
        const next = e.target.value;
        const before = current;
        setCurrent(next);
        startTransition(async () => {
          try {
            const r = await setCapexMilestoneAction(code, milestoneId, next);
            if ('error' in r) {
              setCurrent(before);
              showToast(r.error);
            } else showToast(saved);
          } catch (err) {
            setCurrent(before);
            showToast(err instanceof Error ? err.message : String(err));
          }
        });
      }}
    />
  );
}
