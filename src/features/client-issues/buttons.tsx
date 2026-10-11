'use client';
// Row actions of the client issues the project manager handles (R-137): "Take in charge" (secondary), "Answer" and "Close"
// (form dialogs with the answer the client sees). Shown to the project's manager and the director on a project they may
// edit; the Server Functions re-check everything and refuse a row that changed meanwhile. Forms arrive translated.
import { ChatText, Check, HandGrabbing } from '@phosphor-icons/react/dist/ssr';
import { useState, useTransition } from 'react';
import { FormDialog } from '@/components/app/FormDialog';
import type { FormDef } from '@/components/app/form-def';
import { Button } from '@/components/ds/Button';
import { showToast } from '@/components/ds/Toast';
import { useI18n } from '@/i18n/client';
import { answerClientIssueAction, closeClientIssueAction, takeClientIssueAction } from './actions';

export interface IssueActionsProps {
  code: string;
  /** "CI-08". */
  number: string;
  /** Status the viewer saw (stale rows are refused). */
  from: string;
  /** Dialog sub-line: "CI-08 · Request for weekly photo report". */
  context: string;
  take: string | null;
  answer: { label: string; form: FormDef } | null;
  close: { label: string; form: FormDef } | null;
}

export function IssueActions({ code, number, from, context, take, answer, close }: IssueActionsProps) {
  const { t } = useI18n();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState<'answer' | 'close' | null>(null);
  const onTake = () =>
    start(async () => {
      try {
        const r = await takeClientIssueAction(code, number, from);
        showToast(r.ok ? r.toast : r.error);
      } catch {
        showToast(t('The change could not be saved'));
      }
    });
  return (
    <>
      {take && (
        <Button variant="secondary" size="row" icon={HandGrabbing} disabled={pending} aria-label={`${take} · ${number}`} onClick={onTake}>
          {take}
        </Button>
      )}
      {answer && (
        <>
          <Button variant="primary" size="row" icon={ChatText} aria-label={`${answer.label} · ${number}`} onClick={() => setOpen('answer')}>
            {answer.label}
          </Button>
          <FormDialog {...answer.form} open={open === 'answer'} onClose={() => setOpen(null)} context={context} onSubmit={(v) => answerClientIssueAction(code, number, from, v)} />
        </>
      )}
      {close && (
        <>
          <Button variant="ghost" size="compact" icon={Check} aria-label={`${close.label} · ${number}`} onClick={() => setOpen('close')}>
            {close.label}
          </Button>
          <FormDialog {...close.form} open={open === 'close'} onClose={() => setOpen(null)} context={context} onSubmit={(v) => closeClientIssueAction(code, number, from, v)} />
        </>
      )}
    </>
  );
}
