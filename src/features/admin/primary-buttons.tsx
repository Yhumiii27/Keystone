'use client';
// Header primary actions of the administration screens (docs/spec/01 §5.9; `btn btn-primary` + plus icon). PageHeader
// hides them outside the workspace; the Server Functions check the same rule.
// - Settings "Reset to defaults": restores SETTINGS0 after a confirmation (the reset is now persisted and company-wide;
//   the prototype reset its in-memory copy without asking, 10 OQ2).
// - Machine types "New machine type" (AF.mtype): creates the type and selects it (`?type=`).
// - Activity & integrations "Add connector" (AF.plumbing): the connector is listed at once, waiting for its first sync.
// The add-forms name the current project in their sub-line, as every add-form of the prototype (`projectName`, template 142).
import { Plus } from '@phosphor-icons/react/dist/ssr';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { FormDialog, type FormDialogResult } from '@/components/app/FormDialog';
import type { FormDef, FormValues } from '@/components/app/form-def';
import { Button } from '@/components/ds/Button';
import { Dialog } from '@/components/ds/Dialog';
import { DialogActions } from '@/components/ds/DialogParts';
import { showToast } from '@/components/ds/Toast';
import { useI18n } from '@/i18n/client';
import { createMachineTypeAction, resetSettingsAction, type AdminActionResult } from './actions';
import { machineTypesHref } from './links';
import s from './admin.module.css';

const asResult = (r: AdminActionResult): FormDialogResult => ('error' in r ? { error: r.error } : { toast: r.toast });

export function ResetSettingsButton() {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const confirm = () =>
    start(async () => {
      try {
        const r = await resetSettingsAction();
        showToast('error' in r ? r.error : (r.toast ?? ''));
        if (!('error' in r)) setOpen(false);
      } catch (e) {
        showToast(e instanceof Error ? e.message : String(e));
      }
    });
  return (
    <>
      <Button variant="primary" icon={Plus} onClick={() => setOpen(true)}>
        {t('Reset to defaults')}
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title={t('Reset to defaults')} width={440}>
        <p className={s.confirmText}>
          {t('The lists, the stock locations and the project health rules return to their defaults. Entries added since are removed from the lists; records that use them keep them.')}
        </p>
        <DialogActions>
          <Button variant="secondary" onClick={() => setOpen(false)}>
            {t('Cancel')}
          </Button>
          <Button variant="primary" disabled={pending} aria-busy={pending || undefined} onClick={confirm}>
            {t('Reset to defaults')}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

export function NewMachineTypeButton({ form, context }: { form: FormDef; context?: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const submit = async (values: FormValues): Promise<FormDialogResult> => {
    const r = await createMachineTypeAction(values);
    if (!('error' in r) && r.code) router.push(machineTypesHref(r.code), { scroll: false });
    return asResult(r);
  };
  return (
    <>
      <Button variant="primary" icon={Plus} onClick={() => setOpen(true)}>
        {t('New machine type')}
      </Button>
      <FormDialog {...form} translate open={open} onClose={() => setOpen(false)} context={context} onSubmit={submit} />
    </>
  );
}
