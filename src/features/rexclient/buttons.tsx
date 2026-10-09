'use client';
// Interactive islands of Lessons learned & closure and of the client portal: the header primary actions with their
// action-form dialogs (AF `rex` "Add lesson", AF `client` "Download status report"), the lesson step buttons, the
// closure checklist rows, the client's decisions, "Raise issue", "Acknowledge receipt" and "Download statement"
// (account statement PDF; the status report form also downloads the report PDF — chapter 4 exports).
// They call the Server Functions of ./actions; the page re-renders from the database after each write. Labels arrive
// translated from the Server Components; refusals show their (translated) error in a toast.
import { Check, Plus } from '@phosphor-icons/react/dist/ssr';
import { useState, useTransition, type CSSProperties, type ReactNode } from 'react';
import { FormDialog, type FormDialogResult } from '@/components/app/FormDialog';
import { Button } from '@/components/ds/Button';
import { Input } from '@/components/ds/Field';
import { showToast } from '@/components/ds/Toast';
import { downloadExport } from '@/features/exports/download';
import { ExportFileButton } from '@/features/exports/export-file-button';
import { useI18n } from '@/i18n/client';
import { exportHref } from '@/lib/export-href';
import type { ClosureItemStatus, LessonStatus } from '@/server/db/codes';
import {
  acknowledgeSharedDocumentAction, addLessonAction, advanceLessonAction, cycleClosureAction, decideClientChangeAction, decideClientDeliverableAction,
  downloadStatusReportAction, raiseClientIssueAction, type RexClientResult,
} from './actions';
import { LESSON_FORM, STATUS_REPORT_FORM } from './forms';
import { recordVerb } from './i18n';
import s from './rexclient.module.css';

/** Runs a write and toasts its error, if any. */
function useWrite() {
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<RexClientResult>, after?: () => void) =>
    start(async () => {
      try {
        const r = await fn();
        if ('error' in r) showToast(r.error);
        else after?.();
      } catch (e) {
        showToast(e instanceof Error ? e.message : String(e));
      }
    });
  return { pending, run };
}

interface PrimaryProps {
  code: string;
  /** Translated "#026 · Harbor Line Terminal Expansion" (dialog sub-line). */
  context: string;
}

/** Header primary "Add lesson" (`btn btn-primary` + plus) opening AF `rex`. */
export function AddLessonButton({ code, context }: PrimaryProps) {
  const { t, lang } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="primary" icon={Plus} onClick={() => setOpen(true)}>
        {t('Add lesson')}
      </Button>
      <FormDialog {...LESSON_FORM} submit={recordVerb(lang)} translate open={open} onClose={() => setOpen(false)} context={context} onSubmit={(values) => addLessonAction(code, values)} />
    </>
  );
}

/**
 * "Download status report": records the request (Server Function), then downloads the client status report PDF of the
 * chosen period (chapter 4 exports, document `status`). PowerPoint is not produced: the PDF is downloaded instead.
 */
async function downloadStatusReport(code: string, values: Record<string, string>, failed: string): Promise<FormDialogResult> {
  const r = await downloadStatusReportAction(code, values);
  if (!(r && typeof r === 'object' && r.error)) await downloadExport(exportHref('client', { format: 'pdf', code, variant: 'status', params: { period: values.period ?? '' } }), failed);
  return r;
}

/** Header primary "Download status report" (`btn btn-primary` + plus) opening AF `client` (run form). */
export function StatusReportButton({ code, context }: PrimaryProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="primary" icon={Plus} onClick={() => setOpen(true)}>
        {t('Download status report')}
      </Button>
      <FormDialog {...STATUS_REPORT_FORM} translate open={open} onClose={() => setOpen(false)} context={context} onSubmit={(values) => downloadStatusReport(code, values, t('Export failed'))} />
    </>
  );
}

/** Row action "Validate" / "Mark applied" (`btn btn-secondary` 12px, nowrap). */
export function LessonStepButton({ code, number, from, label }: { code: string; number: string; from: LessonStatus; label: string }) {
  const { pending, run } = useWrite();
  return (
    <Button variant="secondary" size="xs" nowrap disabled={pending} aria-busy={pending || undefined} onClick={() => run(() => advanceLessonAction(code, number, from))}>
      {label}
    </Button>
  );
}

/** Closure checklist row: the whole row is the button that cycles the item. */
export function ClosureToggle({ code, position, from, label, style, children }: { code: string; position: number; from: ClosureItemStatus; label: string; style: CSSProperties; children: ReactNode }) {
  const { pending, run } = useWrite();
  return (
    <button
      type="button"
      className={s.clRow}
      style={style}
      title={label}
      disabled={pending}
      aria-busy={pending || undefined}
      onClick={() => run(() => cycleClosureAction(code, position, from))}
    >
      {children}
    </button>
  );
}

/** Ghost "Reject" + primary "Approve" / "Accept (PV)" of a decision waiting for the client. */
export function DecisionButtons({
  code, kind, id, approveLabel, rejectLabel,
}: { code: string; kind: 'change_request' | 'deliverable'; id: string; approveLabel: string; rejectLabel: string }) {
  const { pending, run } = useWrite();
  const decide = (ok: boolean) =>
    run(() => (kind === 'change_request' ? decideClientChangeAction(code, id, ok ? 'ok' : 'rejected') : decideClientDeliverableAction(code, id, ok ? 'accepted' : 'rejected')));
  return (
    <div className={s.decActions}>
      <Button variant="ghost" size="compact" disabled={pending} aria-label={`${rejectLabel} · ${id}`} onClick={() => decide(false)}>
        {rejectLabel}
      </Button>
      <Button variant="primary" size="row" icon={Check} disabled={pending} aria-busy={pending || undefined} aria-label={`${approveLabel} · ${id}`} onClick={() => decide(true)}>
        {approveLabel}
      </Button>
    </div>
  );
}

/** "Describe a new issue or request" + primary "Raise issue" (blank text does nothing, as in the prototype). */
export function RaiseIssueForm({ code, placeholder, label }: { code: string; placeholder: string; label: string }) {
  const [text, setText] = useState('');
  const { pending, run } = useWrite();
  const submit = () => {
    if (!text.trim()) return;
    run(
      async () => {
        const r = await raiseClientIssueAction(code, text);
        return 'error' in r ? r : { ok: true as const };
      },
      () => setText(''),
    );
  };
  return (
    <form
      className={s.issueForm}
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <Input className={s.issueInput} value={text} onChange={(e) => setText(e.target.value)} placeholder={placeholder} aria-label={placeholder} maxLength={500} />
      <Button type="submit" variant="primary" icon={Plus} className={s.issueButton} disabled={pending} aria-busy={pending || undefined}>
        {label}
      </Button>
    </form>
  );
}

/** Primary "Acknowledge receipt" (12px) of a shared document's current revision. */
export function AcknowledgeButton({ code, number, label }: { code: string; number: string; label: string }) {
  const { pending, run } = useWrite();
  return (
    <Button variant="primary" size="xs" disabled={pending} aria-busy={pending || undefined} aria-label={`${label} · ${number}`} onClick={() => run(() => acknowledgeSharedDocumentAction(code, number))}>
      {label}
    </Button>
  );
}

/** Ghost "Download statement": the client's account statement as a PDF (chapter 4 exports, document `statement`). */
export function DownloadStatementButton({ code, label }: { code: string; label: string }) {
  return <ExportFileButton href={exportHref('client', { format: 'pdf', code, variant: 'statement' })} label={label} variant="ghost" size="md" className={s.statement} />;
}
