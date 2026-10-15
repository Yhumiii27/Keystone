'use client';
// Header primary actions of the HR screens (docs/spec/01 §5.9): `btn btn-primary` + plus icon opening the AF dialog.
// Rate cards "Add role", Skills matrix "Add skill", Hours "Import Lucca" (Leave's "Sync Lucca" is retired: absences come
// from Cursus, NEW-CURSUS-7). PageHeader hides them
// outside the workspace and on read-only projects; the Server Functions check the same rules.
import { Plus } from '@phosphor-icons/react/dist/ssr';
import { useState } from 'react';
import { FormDialog } from '@/components/app/FormDialog';
import type { FormDef, FormValues } from '@/components/app/form-def';
import { Button } from '@/components/ds/Button';
import { useI18n } from '@/i18n/client';
import { addRateRoleAction, addSkillAction, importHoursAction } from './actions';
import { ADD_SKILL_FORM, addRoleForm, importHoursForm } from './forms';

function AfButton({ label, form, onSubmit, context }: { label: string; form: FormDef; onSubmit: (v: FormValues) => ReturnType<typeof addSkillAction>; context?: string }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="primary" icon={Plus} onClick={() => setOpen(true)}>
        {t(label)}
      </Button>
      <FormDialog {...form} translate open={open} onClose={() => setOpen(false)} context={context} onSubmit={onSubmit} />
    </>
  );
}

/** Rate cards — "Add role" (AF.rates + R-083 "Effective from", defaulting to the date the card shows — translated text). */
export function AddRoleButton({ effectiveFrom }: { effectiveFrom: string }) {
  return <AfButton label="Add role" form={addRoleForm(effectiveFrom)} onSubmit={addRateRoleAction} />;
}

/** Skills matrix — "Add skill" (AF.skills). */
export function AddSkillButton() {
  return <AfButton label="Add skill" form={ADD_SKILL_FORM} onSubmit={addSkillAction} />;
}

/** Hours — "Import Lucca" (AF.hours); `context` = the translated project label of the dialog sub-line. */
export function ImportHoursButton({ code, analytic, context }: { code: string; analytic: string | null; context: string }) {
  return <AfButton label="Import Lucca" form={importHoursForm(analytic)} onSubmit={(v) => importHoursAction(code, v)} context={context} />;
}
