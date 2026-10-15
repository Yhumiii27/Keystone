'use client';
// Client islands of the claim follow-up (R-143) and of the machines registered at delivery (R-144): "Edit claim", "Mark
// diagnosed", "Plan intervention" (claim drawer, or the Interventions view's header for a preventive visit), "Close claim",
// "Mark done" on a planned intervention, and "Register machines" per delivered project. Each opens the generic form
// dialog (definitions translated on the server) or runs its step; the Server Functions re-check everything.
import { CalendarPlus, Check, CheckCircle, Factory, PencilSimple, Plus, Stethoscope } from '@phosphor-icons/react/dist/ssr';
import type { Icon } from '@phosphor-icons/react';
import { useState, useTransition } from 'react';
import { FormDialog, type FormDialogResult } from '@/components/app/FormDialog';
import type { FormDef, FormValues } from '@/components/app/form-def';
import { Button, type ButtonSize, type ButtonVariant } from '@/components/ds/Button';
import { showToast } from '@/components/ds/Toast';
import { useI18n } from '@/i18n/client';
import {
  closeClaimAction, completeInterventionAction, diagnoseClaimAction, planInterventionAction, registerMachinesAction, updateClaimAction,
} from './actions';

type Kind = 'edit' | 'diagnose' | 'plan' | 'plan-preventive' | 'done' | 'register';

const ICON: Record<Kind, Icon> = { edit: PencilSimple, diagnose: Stethoscope, plan: CalendarPlus, 'plan-preventive': Plus, done: CheckCircle, register: Factory };

export interface FollowupFormButtonProps {
  kind: Kind;
  /** Claim number (edit, diagnose, plan), intervention number (done); unused for a preventive visit or a registration. */
  target: string | null;
  /** Status the viewer saw (diagnose). */
  from?: string;
  label: string;
  ariaLabel?: string;
  context?: string;
  form: FormDef;
  variant?: ButtonVariant;
  size?: ButtonSize;
}

const submit = (kind: Kind, target: string | null, from: string | undefined, v: FormValues): Promise<FormDialogResult> => {
  switch (kind) {
    case 'edit':
      return updateClaimAction(target ?? '', v);
    case 'diagnose':
      return diagnoseClaimAction(target ?? '', from ?? '', v);
    case 'plan':
      return planInterventionAction(target, v);
    case 'plan-preventive':
      return planInterventionAction(null, v);
    case 'done':
      return completeInterventionAction(target ?? '', v);
    case 'register':
      return registerMachinesAction(v);
  }
};

export function FollowupFormButton({ kind, target, from, label, ariaLabel, context, form, variant = 'secondary', size = 'sm' }: FollowupFormButtonProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant={variant} size={size} icon={ICON[kind]} nowrap aria-label={ariaLabel} onClick={() => setOpen(true)}>
        {label}
      </Button>
      <FormDialog {...form} open={open} onClose={() => setOpen(false)} context={context} onSubmit={(v) => submit(kind, target, from, v)} />
    </>
  );
}

/** "Close claim": runs the step (the claim must be diagnosed, no intervention still planned). */
export function CloseClaimButton({ number, from, label }: { number: string; from: string; label: string }) {
  const { t } = useI18n();
  const [pending, start] = useTransition();
  return (
    <Button
      variant="primary"
      size="sm"
      icon={Check}
      disabled={pending}
      aria-busy={pending || undefined}
      aria-label={`${label} · ${number}`}
      onClick={() =>
        start(async () => {
          try {
            const r = await closeClaimAction(number, from);
            showToast(r.ok ? r.toast : r.error);
          } catch {
            showToast(t('The change could not be saved'));
          }
        })
      }
    >
      {label}
    </Button>
  );
}
