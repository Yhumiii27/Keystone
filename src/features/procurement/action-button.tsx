'use client';
// Action buttons of Sourcing (docs/spec/08 §1.4.1–§1.4.3): "Send to suppliers", "Compare quotes", "Award", "Approve
// payment", "Approve received part" / "Approve €… · request credit note", "Reject invoice". The server page renders
// them only for viewers allowed to act (the Server Functions check again). A refused or failed decision shows its
// message as a toast; a confirmation toast (e.g. the drafted purchase order) too. Row buttons stop the row's click.
import { Check, PaperPlaneTilt } from '@phosphor-icons/react/dist/ssr';
import { useTransition } from 'react';
import { Button, type ButtonSize, type ButtonVariant } from '@/components/ds/Button';
import { showToast } from '@/components/ds/Toast';
import { useI18n } from '@/i18n/client';
import {
  approveInvoiceAction, approveInvoicePartAction, awardRfqAction, compareRfqAction, rejectInvoiceAction, sendRfqAction, type SourcingActionResult,
} from './actions';

export type SourcingOp = 'send' | 'compare' | 'award' | 'approve' | 'approve_part' | 'reject';

const RUN: Record<SourcingOp, (number: string, supplier?: string) => Promise<SourcingActionResult>> = {
  send: (n) => sendRfqAction(n),
  compare: (n) => compareRfqAction(n),
  award: (n, s) => awardRfqAction(n, s ?? ''),
  approve: (n) => approveInvoiceAction(n),
  approve_part: (n) => approveInvoicePartAction(n),
  reject: (n) => rejectInvoiceAction(n),
};

export interface SourcingActionButtonProps {
  op: SourcingOp;
  /** RFQ or invoice number. */
  number: string;
  /** Quote to award. */
  supplier?: string;
  /** Translated label. */
  label: string;
  /** Accessible name when the label alone is ambiguous in a list ("Award · Dillinger"). */
  ariaLabel?: string;
  variant: ButtonVariant;
  size: ButtonSize;
  icon?: 'check' | 'send';
}

export function SourcingActionButton({ op, number, supplier, label, ariaLabel, variant, size, icon }: SourcingActionButtonProps) {
  const { t } = useI18n();
  const [pending, start] = useTransition();
  const run = () =>
    start(async () => {
      try {
        const r = await RUN[op](number, supplier);
        if ('error' in r) showToast(r.error);
        else if (r.toast) showToast(r.toast);
      } catch {
        showToast(t('The change could not be saved'));
      }
    });
  return (
    <Button
      variant={variant}
      size={size}
      icon={icon === 'check' ? Check : icon === 'send' ? PaperPlaneTilt : undefined}
      disabled={pending}
      aria-label={ariaLabel}
      onClick={(e) => {
        e.stopPropagation();
        run();
      }}
    >
      {label}
    </Button>
  );
}
