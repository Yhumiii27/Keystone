'use client';
// "New project" primary button + the 4-step wizard (docs/spec/01 §10, 03 §5.8; openNp / npClose / npCreate 3968–3969).
// Opening goes back to step 1 and keeps the draft (npClose keeps the values too). Create inserts the project
// through createProjectAction, then lands on the Projects register with its status filter cleared.
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
import { DEFAULT_DRAFT, NewProjectWizard, draftCategories, type WizardDraft } from './new-project-wizard';

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
      const r = await createProjectAction({ ...draft, cats: draftCategories(setup, draft) });
      if (!r.ok) {
        toast.showEn(r.error);
        return;
      }
      setOpen(false);
      setStep(1);
      setDraft(DEFAULT_DRAFT);
      // npCreate: statusFilter:null, screen:'projects' (the search query is kept, as in the prototype).
      const target = screenHref('projects');
      const here = new URL(window.location.href);
      here.searchParams.delete('status');
      window.dispatchEvent(new Event(PROJECTS_RESET_EVENT));
      router.push(here.pathname === target ? here.pathname + here.search : target);
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
