'use client';
// Interactive islands of the Change control and Trends screens: header primary actions with their action-form
// dialogs (AF `changes`, AF `trends`), "Submit for review" (row and drawer) and the approval-step decisions.
// They call the Server Functions of ./actions; the page re-renders from the database after each write.
import { Check, PaperPlaneTilt, Plus } from '@phosphor-icons/react/dist/ssr';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { FormDialog } from '@/components/app/FormDialog';
import { Button } from '@/components/ds/Button';
import { useToast } from '@/components/ds/Toast';
import { downloadExport } from '@/features/exports/download';
import { useI18n } from '@/i18n/client';
import { exportHref } from '@/lib/export-href';
import { createChangeRequestAction, decideChangeStepAction, generateStatusReportAction, submitChangeRequestAction, type ChangeActionResult } from './actions';
import { STATUS_REPORT_FORM, newChangeRequestForm } from './forms';

export interface NewChangeRequestButtonProps {
  code: string;
  /** Translated "#026 · Harbor Line Terminal Expansion" (dialog sub-line). */
  context: string;
  /** WBS field default ("1.3", or "1" when the project has no such work package). */
  defaultWbs: string;
  /** Open on arrival (`?new=1`, e.g. from Budget › "New change request"); closing drops the param via `closeHref`. */
  autoOpen?: boolean;
  closeHref?: string;
}

/** Header primary "New change request" (`btn btn-primary` + plus) opening AF `changes`. */
export function NewChangeRequestButton({ code, context, defaultWbs, autoOpen, closeHref }: NewChangeRequestButtonProps) {
  const { t } = useI18n();
  const router = useRouter();
  const [open, setOpen] = useState(!!autoOpen);
  const close = () => {
    setOpen(false);
    if (autoOpen && closeHref) router.replace(closeHref, { scroll: false });
  };
  return (
    <>
      <Button variant="primary" icon={Plus} onClick={() => setOpen(true)}>
        {t('New change request')}
      </Button>
      <FormDialog
        {...newChangeRequestForm(defaultWbs)}
        translate
        open={open}
        onClose={close}
        context={context}
        onSubmit={(values) => createChangeRequestAction(code, values)}
      />
    </>
  );
}

/** Header primary "Generate status report" (`btn btn-primary` + plus) opening AF `trends` (run form). */
export function StatusReportButton({ code, context }: { code: string; context: string }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="primary" icon={Plus} onClick={() => setOpen(true)}>
        {t('Generate status report')}
      </Button>
      <FormDialog
        {...STATUS_REPORT_FORM}
        translate
        open={open}
        onClose={() => setOpen(false)}
        context={context}
        onSubmit={async (values) => {
          // Records the report, then downloads its PDF (chapter 4 exports: the Trends status report, `?report=latest`).
          const r = await generateStatusReportAction(code, values);
          if (!r.error) await downloadExport(exportHref('trends', { format: 'pdf', code, variant: 'status', params: { report: 'latest' } }), t('Export failed'));
          return r;
        }}
      />
    </>
  );
}

/** Runs a write and toasts its error, if any (a successful write revalidates the page from the action). */
function useWrite() {
  const toast = useToast();
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<ChangeActionResult>) =>
    start(async () => {
      const r = await fn();
      if ('error' in r) toast.show(r.error);
    });
  return { pending, run };
}

/** "Submit for review": `row` = register cell (12px, padding 3px 10px), `drawer` = 12.5px with the paper-plane icon. */
export function SubmitForReviewButton({ code, number, variant }: { code: string; number: string; variant: 'row' | 'drawer' }) {
  const { t } = useI18n();
  const { pending, run } = useWrite();
  return (
    <Button
      variant="primary"
      size={variant === 'row' ? 'row' : 'sm'}
      icon={variant === 'drawer' ? PaperPlaneTilt : undefined}
      disabled={pending}
      aria-busy={pending || undefined}
      onClick={(e) => {
        e.stopPropagation();
        run(() => submitChangeRequestAction(code, number));
      }}
    >
      {t('Submit for review')}
    </Button>
  );
}

/**
 * Drawer step actions: ghost "Reject" (12px, 3px 8px) + primary "Approve" with a check (12px, 3px 10px).
 * `stepLabel` (translated, e.g. "Portfolio director") completes the accessible names ("Approve · Portfolio director").
 */
export function StepDecisionButtons({ code, number, step, stepLabel }: { code: string; number: string; step: string; stepLabel?: string }) {
  const { t } = useI18n();
  const { pending, run } = useWrite();
  const name = (verb: string) => (stepLabel ? `${t(verb)} · ${stepLabel}` : undefined);
  return (
    <>
      <Button variant="ghost" size="compact" disabled={pending} aria-label={name('Reject')} onClick={() => run(() => decideChangeStepAction(code, number, step, 'rejected'))}>
        {t('Reject')}
      </Button>
      <Button variant="primary" size="row" icon={Check} disabled={pending} aria-label={name('Approve')} onClick={() => run(() => decideChangeStepAction(code, number, step, 'ok'))}>
        {t('Approve')}
      </Button>
    </>
  );
}
