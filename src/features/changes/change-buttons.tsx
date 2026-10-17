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
import { useToday } from '@/components/app/clock';
import { newChangeRequestForm, statusReportForm, translatedChangeRequestForm } from './forms';

export interface NewChangeRequestButtonProps {
  code: string;
  /** Translated "#026 · Harbor Line Terminal Expansion" (dialog sub-line). */
  context: string;
  /** WBS field default ("1.3", or "1" when the project has no such work package). */
  defaultWbs: string;
  /** Open on arrival (`?new=1`, e.g. from Budget › "New change request"); closing drops the param via `closeHref`. */
  autoOpen?: boolean;
  closeHref?: string;
  /**
   * S-3: opened from Plan "Set baseline" after BL1 (`?new=1&baseline=1`): the request proposes the next baseline, the form is
   * pre-filled (`initialValues`, translated: title "New baseline BL3", type Schedule).
   */
  proposeBaseline?: boolean;
  initialValues?: Record<string, string>;
  /** Delivery 7 (NEW-D2-2): offer the "Plan activities touched" field (the project team, not the client). */
  withActivities?: boolean;
  /** Delivery 8 (R-081): the project's cost categories ("C03 · Steel", labels as typed) — the project team only, never the client. */
  costCategories?: { value: string; label: string }[];
}

/** Header primary "New change request" (`btn btn-primary` + plus) opening AF `changes`. */
export function NewChangeRequestButton({ code, context, defaultWbs, autoOpen, closeHref, proposeBaseline, initialValues, withActivities, costCategories }: NewChangeRequestButtonProps) {
  const { t } = useI18n();
  const router = useRouter();
  const [open, setOpen] = useState(!!autoOpen);
  // The baseline proposal applies to the dialog opened on arrival only; the header button raises a plain request.
  const [proposing, setProposing] = useState(!!(autoOpen && proposeBaseline));
  const close = () => {
    setOpen(false);
    setProposing(false);
    if (autoOpen && closeHref) router.replace(closeHref, { scroll: false });
  };
  return (
    <>
      <Button variant="primary" icon={Plus} onClick={() => setOpen(true)}>
        {t('New change request')}
      </Button>
      {open && (
        <FormDialog
          {...translatedChangeRequestForm(newChangeRequestForm(defaultWbs, { proposeBaseline: proposing, withActivities, costCategories }), t)}
          open
          onClose={close}
          context={context}
          initialValues={proposing ? initialValues : undefined}
          onSubmit={(values) => createChangeRequestAction(code, values, proposing ? { proposeBaseline: true } : undefined)}
        />
      )}
    </>
  );
}

/** Header primary "Generate status report" (`btn btn-primary` + plus) opening AF `trends` (run form). */
export function StatusReportButton({ code, context }: { code: string; context: string }) {
  const { t } = useI18n();
  const today = useToday();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="primary" icon={Plus} onClick={() => setOpen(true)}>
        {t('Generate status report')}
      </Button>
      <FormDialog
        {...statusReportForm(today)}
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
