'use client';
// R-158 lot A — the Shipments screen's buttons: dialogs (the generic FormDialog with the page's translated definitions) and
// direct actions (validate, reopen, advance, remove — the removals after a confirmation). Shown to the shipment editors only;
// the Server Functions re-check everything and answer a toast or an error.
import {
  ArrowRight, ArrowCounterClockwise, CheckCircle, NotePencil, PencilSimple, Plus, SealCheck, Trash,
} from '@phosphor-icons/react/dist/ssr';
import type { Icon } from '@phosphor-icons/react';
import { useState, useTransition } from 'react';
import { FormDialog } from '@/components/app/FormDialog';
import type { FormDef, FormValues } from '@/components/app/form-def';
import { Button, type ButtonSize, type ButtonVariant } from '@/components/ds/Button';
import { Dialog } from '@/components/ds/Dialog';
import { DialogActions } from '@/components/ds/DialogParts';
import { showToast } from '@/components/ds/Toast';
import {
  addItemAction, addLoadAction, advanceShipmentAction, createShipmentAction, justifyGapAction, removeItemAction, removeLoadAction, removeShipmentAction,
  reopenPackingAction, setShipmentStepAction, updateItemAction, updateLoadAction, updateShipmentAction, validatePackingAction, type ShipmentActionResult,
} from './actions';

/** What a dialog / action applies to (serialisable). */
export interface ShipmentTarget {
  ref?: string;
  number?: number;
  id?: string;
  key?: string;
  step?: string;
  from?: string;
}

const FORMS = {
  create: (code: string, _x: ShipmentTarget, v: FormValues) => createShipmentAction(code, v),
  edit: (code: string, x: ShipmentTarget, v: FormValues) => updateShipmentAction(code, x.ref, v),
  addLoad: (code: string, x: ShipmentTarget, v: FormValues) => addLoadAction(code, x.ref, v),
  editLoad: (code: string, x: ShipmentTarget, v: FormValues) => updateLoadAction(code, x.ref, x.number, v),
  addItem: (code: string, x: ShipmentTarget, v: FormValues) => addItemAction(code, x.ref, v),
  editItem: (code: string, x: ShipmentTarget, v: FormValues) => updateItemAction(code, x.ref, x.id, v),
  justify: (code: string, x: ShipmentTarget, v: FormValues) => justifyGapAction(code, x.ref, x.key, v),
  step: (code: string, x: ShipmentTarget, v: FormValues) => setShipmentStepAction(code, x.ref, x.step, v),
} as const;

const FORM_ICONS: Record<keyof typeof FORMS, Icon> = {
  create: Plus, edit: PencilSimple, addLoad: Plus, editLoad: PencilSimple, addItem: Plus, editItem: PencilSimple, justify: NotePencil, step: PencilSimple,
};

const asDialog = (r: ShipmentActionResult) => ('error' in r ? { error: r.error } : { toast: r.toast });

export function ShipmentFormButton({ kind, code, target = {}, context, form, label, values, variant = 'ghost', size = 'mini', ariaLabel }: {
  kind: keyof typeof FORMS; code: string; target?: ShipmentTarget; context: string; form: FormDef; label: string; values?: FormValues;
  variant?: ButtonVariant; size?: ButtonSize; ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant={variant} size={size} icon={FORM_ICONS[kind]} nowrap onClick={() => setOpen(true)} aria-label={ariaLabel} title={ariaLabel ?? label}>
        {label}
      </Button>
      <FormDialog
        {...form} open={open} onClose={() => setOpen(false)} context={context} initialValues={values}
        onSubmit={async (v) => asDialog(await FORMS[kind](code, target, v))}
      />
    </>
  );
}

const RUNS = {
  validate: (code: string, x: ShipmentTarget) => validatePackingAction(code, x.ref),
  reopen: (code: string, x: ShipmentTarget) => reopenPackingAction(code, x.ref),
  advance: (code: string, x: ShipmentTarget) => advanceShipmentAction(code, x.ref, x.from),
  remove: (code: string, x: ShipmentTarget) => removeShipmentAction(code, x.ref),
  removeLoad: (code: string, x: ShipmentTarget) => removeLoadAction(code, x.ref, x.number),
  removeItem: (code: string, x: ShipmentTarget) => removeItemAction(code, x.ref, x.id),
} as const;

const RUN_ICONS: Record<keyof typeof RUNS, Icon> = {
  validate: SealCheck, reopen: ArrowCounterClockwise, advance: ArrowRight, remove: Trash, removeLoad: Trash, removeItem: Trash,
};

/** A direct action; with `confirm`, after a confirmation dialog. `disabledReason` disables it (shown as its title). */
export function ShipmentRunButton({ kind, code, target, label, ariaLabel, confirm, disabledReason, variant = 'secondary' }: {
  kind: keyof typeof RUNS; code: string; target: ShipmentTarget; label: string; ariaLabel?: string; variant?: ButtonVariant;
  confirm?: { title: string; text: string; cancel: string }; disabledReason?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const go = () =>
    startTransition(async () => {
      try {
        const r = await RUNS[kind](code, target);
        if ('error' in r) showToast(r.error);
        else {
          if (r.toast) showToast(r.toast);
          setOpen(false);
        }
      } catch (e) {
        showToast(e instanceof Error ? e.message : String(e));
      }
    });
  const I = kind === 'validate' && !disabledReason ? CheckCircle : RUN_ICONS[kind];
  return (
    <>
      <Button
        variant={variant} size="mini" icon={I} nowrap disabled={pending || !!disabledReason} aria-busy={pending || undefined} aria-label={ariaLabel}
        title={disabledReason ?? ariaLabel ?? label} onClick={() => (confirm ? setOpen(true) : go())}
      >
        {label}
      </Button>
      {confirm && (
        <Dialog open={open} onClose={() => setOpen(false)} title={confirm.title} width={440}>
          <p>{confirm.text}</p>
          <DialogActions>
            <Button variant="secondary" onClick={() => setOpen(false)}>{confirm.cancel}</Button>
            <Button variant="primary" disabled={pending} aria-busy={pending || undefined} onClick={go}>{label}</Button>
          </DialogActions>
        </Dialog>
      )}
    </>
  );
}
