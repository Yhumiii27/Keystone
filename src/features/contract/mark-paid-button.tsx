'use client';
// "Mark paid" on an invoice awaiting payment (docs/spec/04 §4.6, template 862: `btn btn-primary`, 12px). No
// confirmation and no toast, as in the prototype; an error (rights, state changed meanwhile) shows a toast.
import { useTransition } from 'react';
import { Button } from '@/components/ds/Button';
import { showToast } from '@/components/ds/Toast';
import { markInvoicePaidAction } from './actions';

export function MarkPaidButton({ code, milestone, label, ariaLabel }: { code: string; milestone: string; label: string; ariaLabel: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="primary"
      size="xs"
      disabled={pending}
      aria-busy={pending || undefined}
      aria-label={ariaLabel}
      onClick={() =>
        startTransition(async () => {
          try {
            const r = await markInvoicePaidAction(code, milestone);
            if ('error' in r) showToast(r.error);
          } catch (e) {
            showToast(e instanceof Error ? e.message : String(e));
          }
        })
      }
    >
      {label}
    </Button>
  );
}
