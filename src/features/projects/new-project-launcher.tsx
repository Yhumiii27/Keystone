'use client';
// "New project" primary button + the 4-step wizard (docs/spec/01 §10, 03 §5.8; openNp / npClose / npCreate 3968–3969).
// Opening goes back to step 1 and keeps the draft (npClose keeps the values too). Create inserts the project
// through createProjectAction, resets the draft and (chapter 4, L-3) opens the created project on its plan — the
// register's status filter is cleared for when the viewer comes back to it.
import { Plus } from '@phosphor-icons/react/dist/ssr';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { screenHref } from '@/config/screens';
import { Button } from '@/components/ds/Button';
import { useToast } from '@/components/ds/Toast';
import { useI18n } from '@/i18n/client';
import type { NewProjectSetup } from '@/server/dal/projects-register';
import { createProjectAction } from './actions';
import { PROJECTS_RESET_EVENT } from './events';
import { DEFAULT_DRAFT, NewProjectWizard, draftCalendar, draftCategories, draftManager, type WizardDraft } from './new-project-wizard';

export function NewProjectLauncher({ setup }: { setup: NewProjectSetup }) {
  const { t } = useI18n();
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(1);
  const [draft, setDraft] = useState<WizardDraft>(DEFAULT_DRAFT);
  const [pending, startTransition] = useTransition();

  const create = () =>
    startTransition(async () => {
      const r = await createProjectAction({
        ...draft, cats: draftCategories(setup, draft), cal: draftCalendar(setup, draft), pm: draftManager(setup, draft),
      });
      if (!r.ok) {
        toast.showEn(r.error);
        return;
      }
      setOpen(false);
      setStep(1);
      setDraft(DEFAULT_DRAFT);
      // npCreate cleared the register's status filter; the created project now opens on its plan (L-3).
      window.dispatchEvent(new Event(PROJECTS_RESET_EVENT));
      toast.showEn(`${r.number} · ${r.name} · Project created`);
      router.push(screenHref('plan', { code: r.code }));
    });

  return (
    <>
      <Button
        variant="primary"
        icon={Plus}
        onClick={() => {
          setStep(1);
          setOpen(true);
        }}
      >
        {t('New project')}
      </Button>
      <NewProjectWizard
        open={open}
        onClose={() => setOpen(false)}
        step={step}
        onStepChange={setStep}
        setup={setup}
        draft={draft}
        onDraft={(patch) => setDraft((d) => ({ ...d, ...patch }))}
        onCreate={create}
        pending={pending}
      />
    </>
  );
}
