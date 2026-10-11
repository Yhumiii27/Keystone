'use client';
// Project team editing islands (R-041, P-2): the role select and "Remove" of a member row, and the "Add to team" dialog. Rendered
// only for the viewers who manage the team (the director and the project's PMs — the Server Functions check it again).
import { Plus, X } from '@phosphor-icons/react/dist/ssr';
import { useState, useTransition } from 'react';
import { FormDialog } from '@/components/app/FormDialog';
import type { FormDef } from '@/components/app/form-def';
import { Button, IconButton } from '@/components/ds/Button';
import { Select } from '@/components/ds/Field';
import { useToast } from '@/components/ds/Toast';
import { useI18n } from '@/i18n/client';
import { addTeamMemberAction, removeTeamMemberAction, setTeamMemberRoleAction, type TeamActionResult } from './team-actions';
import s from './project-team.module.css';

function useRun() {
  const [pending, start] = useTransition();
  const toast = useToast();
  const run = (fn: () => Promise<TeamActionResult>) =>
    start(async () => {
      const r = await fn();
      toast.show('error' in r ? r.error : (r.toast ?? ''));
    });
  return { pending, run };
}

/** Team role select + remove button of one member (not the PM of record). */
export function MemberControls({ code, personId, name, role, roles }: { code: string; personId: string; name: string; role: string; roles: { value: string; label: string }[] }) {
  const { t } = useI18n();
  const { pending, run } = useRun();
  return (
    <>
      <Select
        size="sm"
        className={s.role}
        value={role}
        options={roles}
        disabled={pending}
        aria-label={`${t('Team role')} · ${name}`}
        onChange={(e) => {
          const next = e.target.value;
          run(() => setTeamMemberRoleAction(code, personId, next));
        }}
      />
      <IconButton icon={X} size={24} muted label={`${t('Remove from the project team')} · ${name}`} disabled={pending} onClick={() => run(() => removeTeamMemberAction(code, personId))} />
    </>
  );
}

/** "Add to team" → dialog (person, team role). */
export function AddTeamMemberButton({ code, context, form }: { code: string; context: string; form: FormDef }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" icon={Plus} onClick={() => setOpen(true)}>
        {t('Add to team')}
      </Button>
      <FormDialog {...form} open={open} onClose={() => setOpen(false)} context={context} onSubmit={(values) => addTeamMemberAction(code, values)} />
    </>
  );
}
