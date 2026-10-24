'use client';
// "Equipment" card actions of the Contract screen (R-185): "Add equipment" and a line's "Edit" open the generic form dialog
// (type, quantity, label, target capacity, options, machine need), "Remove" asks for a confirmation. Rendered for the director
// and the project's leads only; the Server Functions re-check the rights and parse the values again.
import { PencilSimple, Plus, Trash } from '@phosphor-icons/react/dist/ssr';
import { useState, useTransition } from 'react';
import { FormDialog } from '@/components/app/FormDialog';
import type { FormDef, FormValues } from '@/components/app/form-def';
import { Button } from '@/components/ds/Button';
import { Dialog } from '@/components/ds/Dialog';
import { DialogActions } from '@/components/ds/DialogParts';
import { showToast } from '@/components/ds/Toast';
import { addEquipmentAction, removeEquipmentAction, updateEquipmentAction, type EquipmentLineDraft } from './actions';
import s from './contract.module.css';

const draftOf = (v: FormValues): EquipmentLineDraft => ({
  machineTypeCode: v.machineTypeCode ?? '', quantity: v.quantity ?? '', label: v.label ?? '', capacityValue: v.capacityValue ?? '',
  capacityUnit: v.capacityUnit ?? '', options: v.options ?? '', besoinRef: v.besoinRef ?? '', catalogue: v.catalogue ?? '',
});

export function AddEquipmentButton({ code, context, form, label, saved }: { code: string; context: string; form: FormDef; label: string; saved: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="ghost" size="xs" icon={Plus} push nowrap onClick={() => setOpen(true)}>
        {label}
      </Button>
      <FormDialog
        {...form}
        open={open}
        onClose={() => setOpen(false)}
        context={context}
        onSubmit={async (values) => {
          const r = await addEquipmentAction(code, draftOf(values));
          return 'error' in r ? { error: r.error } : { toast: saved };
        }}
      />
    </>
  );
}

export function EditEquipmentButton(
  { code, refCode, context, form, values, label, ariaLabel, saved }: { code: string; refCode: string; context: string; form: FormDef; values: FormValues; label: string; ariaLabel: string; saved: string },
) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="ghost" size="mini" icon={PencilSimple} nowrap onClick={() => setOpen(true)} aria-label={ariaLabel} title={label}>
        {label}
      </Button>
      <FormDialog
        {...form}
        open={open}
        onClose={() => setOpen(false)}
        context={context}
        initialValues={values}
        onSubmit={async (v) => {
          const r = await updateEquipmentAction(code, refCode, draftOf(v));
          return 'error' in r ? { error: r.error } : { toast: saved };
        }}
      />
    </>
  );
}

export function RemoveEquipmentButton(
  { code, refCode, label, ariaLabel, title, text, cancel, removed }: { code: string; refCode: string; label: string; ariaLabel: string; title: string; text: string; cancel: string; removed: string },
) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const confirm = () =>
    startTransition(async () => {
      try {
        const r = await removeEquipmentAction(code, refCode);
        showToast('error' in r ? r.error : removed);
        if (!('error' in r)) setOpen(false);
      } catch (e) {
        showToast(e instanceof Error ? e.message : String(e));
      }
    });
  return (
    <>
      <Button variant="ghost" size="mini" icon={Trash} nowrap onClick={() => setOpen(true)} aria-label={ariaLabel} title={label}>
        {label}
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title={title} width={440}>
        <p className={s.confirmText}>{text}</p>
        <DialogActions>
          <Button variant="secondary" onClick={() => setOpen(false)}>
            {cancel}
          </Button>
          <Button variant="primary" disabled={pending} aria-busy={pending || undefined} onClick={confirm}>
            {label}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
