'use client';
// R-187: actions of the "Subsidiaries' machine needs" card (Portfolio › Projects). "Refresh" reads Arche's views again (the director
// and the project managers); "Answer" / "Edit" open the generic form dialog, the status buttons move the latest answer, "Create the
// project" opens the New project wizard prefilled from the ordered need, "Add to a project" adds its equipment line to an existing
// project — the portfolio director only. The Server Functions re-check the rights and parse the values again; their errors come
// back in the viewer's language.
import { ArrowsClockwise, FolderPlus, PencilSimple, Plus, Stack } from '@phosphor-icons/react/dist/ssr';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { FormDialog } from '@/components/app/FormDialog';
import type { FormDef, FormValues } from '@/components/app/form-def';
import { useToday } from '@/components/app/clock';
import { Button } from '@/components/ds/Button';
import { showToast } from '@/components/ds/Toast';
import { screenHref } from '@/config/screens';
import { useI18n } from '@/i18n/client';
import type { NewProjectSetup } from '@/server/dal/projects-register';
import { NewProjectWizard, defaultDraft, draftCalendar, draftCategories, draftLines, draftManager, type WizardDraft } from '@/features/projects/new-project-wizard';
import {
  addNeedToProjectAction, createProjectFromNeedAction, editNeedAnswerAction, recordNeedAnswerAction, refreshCapexNeedsAction, setNeedAnswerStatusAction,
} from './actions';

export function RefreshNeedsButton({ label }: { label: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="ghost" size="xs" icon={ArrowsClockwise} nowrap disabled={pending} aria-busy={pending || undefined}
      onClick={() => startTransition(async () => {
        const r = await refreshCapexNeedsAction();
        showToast('error' in r ? r.error : r.message ?? label);
      })}
    >
      {label}
    </Button>
  );
}

/** "Answer" (a new answer) or "Edit" (the latest answer, in preparation). */
export function AnswerNeedButton(
  { needRef, number, context, form, values, label, ariaLabel, saved }: {
    needRef: string; number?: string; context: string; form: FormDef; values: FormValues; label: string; ariaLabel: string; saved: string;
  },
) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="ghost" size="mini" icon={number ? PencilSimple : Plus} nowrap onClick={() => setOpen(true)} aria-label={ariaLabel} title={ariaLabel}>
        {label}
      </Button>
      <FormDialog
        {...form}
        open={open}
        onClose={() => setOpen(false)}
        context={context}
        initialValues={values}
        onSubmit={async (v) => {
          const r = number ? await editNeedAnswerAction(number, v) : await recordNeedAnswerAction(needRef, v);
          return 'error' in r ? { error: r.error } : { toast: number ? saved : `${saved} · ${r.code ?? ''}` };
        }}
      />
    </>
  );
}

/** One status move of the latest answer (Send, Accept, Lapse). */
export function AnswerStatusButton({ number, to, label, ariaLabel, done }: { number: string; to: string; label: string; ariaLabel: string; done: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="ghost" size="mini" nowrap disabled={pending} aria-busy={pending || undefined} aria-label={ariaLabel} title={ariaLabel}
      onClick={() => startTransition(async () => {
        const r = await setNeedAnswerStatusAction(number, to);
        showToast('error' in r ? r.error : done);
      })}
    >
      {label}
    </Button>
  );
}

/** K-10 (b): "Add to a project" — the project (and the machine type of a free need). */
export function AddNeedToProjectButton({ needRef, context, form, label, added }: { needRef: string; context: string; form: FormDef; label: string; added: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="ghost" size="mini" icon={Stack} nowrap onClick={() => setOpen(true)} title={label}>
        {label}
      </Button>
      <FormDialog
        {...form}
        open={open}
        onClose={() => setOpen(false)}
        context={context}
        onSubmit={async (v) => {
          const r = await addNeedToProjectAction(needRef, v);
          return 'error' in r ? { error: r.error } : { toast: `${added} · ${v.project ?? ''} · ${r.code ?? ''}` };
        }}
      />
    </>
  );
}

/** What the wizard starts from for a need: name, client, type and the need's line (the other fields are the wizard's defaults). */
export interface NeedDraftSeed {
  name: string;
  client: string;
  /** Machine type label of the need's catalogue version ("EMP"), or the wizard's default for a free need. */
  mt: string;
  qty: number;
  city: string;
  country: string;
}

/**
 * K-10 (a): "Create the project" — the New project wizard (the register's creation path) prefilled from the ordered need; the first
 * equipment line is the need's (the server writes its options, capacity, catalogue version and need reference). Then opens the
 * project's plan, as the wizard does.
 */
export function CreateProjectFromNeedButton({ needRef, setup, seed, label }: { needRef: string; setup: NewProjectSetup; seed: NeedDraftSeed; label: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const today = useToday();
  const initial = (): WizardDraft => ({
    ...defaultDraft(today), name: seed.name, client: seed.client, mt: seed.mt, template: seed.mt, city: seed.city, country: seed.country,
    lines: [{ mt: seed.mt, qty: seed.qty }],
  });
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(1);
  const [draft, setDraft] = useState<WizardDraft>(initial);
  const [pending, startTransition] = useTransition();
  const create = () =>
    startTransition(async () => {
      const r = await createProjectFromNeedAction(needRef, {
        ...draft, cats: draftCategories(setup, draft), cal: draftCalendar(setup, draft), pm: draftManager(setup, draft), lines: draftLines(draft),
      });
      if ('error' in r) {
        showToast(r.error);
        return;
      }
      setOpen(false);
      showToast(`${t('Project created')} · ${r.code ?? ''}`);
      if (r.code) router.push(screenHref('plan', { code: r.code }));
    });
  return (
    <>
      <Button variant="ghost" size="mini" icon={FolderPlus} nowrap onClick={() => { setStep(1); setDraft(initial()); setOpen(true); }} title={label}>
        {label}
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
