'use client';
// Client islands of Quality — NCR & deliverables: the progress the viewer records on a Vigie NCR (log "→ <step>", drawer
// "Move to <step>", the quality manager's verification), the deliverable steps (Start, To internal review, Submit to
// client), the client's Accept (PV) / Reject (row) and "Reject with comments" (dialog), and "Link a Codex document".
// The Server Functions (./actions.ts) re-check everything; the page refreshes on revalidation. Clicks inside a register
// row do not open the drawer (ClickableRow ignores buttons).
import { ArrowCounterClockwise, ArrowRight, Check, Link as LinkIcon, PaperPlaneTilt, Plus } from '@phosphor-icons/react/dist/ssr';
import { useState, useTransition } from 'react';
import { FormDialog } from '@/components/app/FormDialog';
import type { FormDef } from '@/components/app/form-def';
import { Button } from '@/components/ds/Button';
import { useToast } from '@/components/ds/Toast';
import type { NcrStatus, ProducerTarget } from '@/domain/quality';
import { useI18n } from '@/i18n/client';
import {
  advanceNcrAction, createDeliverableAction, decideDeliverableAction, linkDeliverableDocumentAction, moveDeliverableAction, rejectDeliverableWithCommentsAction, verifyNcrAction,
  type QualityResult,
} from './actions';

/** Shown when the Server Function itself fails (network, server error). */
const FAILED = 'The change could not be saved';

function useRun() {
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const run = (call: () => Promise<QualityResult>) =>
    startTransition(async () => {
      try {
        const r = await call();
        toast.showEn(r.ok ? r.toast : r.error);
      } catch {
        toast.showEn(FAILED);
      }
    });
  return { pending, run };
}

interface Target {
  code: string;
  number: string;
}

/** "→ Containment" (log row, secondary) or "Move to Containment" (drawer, primary + arrow): the next step, sent to Vigie. */
export function NcrStepButton({ code, number, step, label, place }: Target & { step: NcrStatus; label: string; place: 'row' | 'drawer' }) {
  const { t } = useI18n();
  const { pending, run } = useRun();
  return (
    <Button
      variant={place === 'row' ? 'secondary' : 'primary'}
      size={place === 'row' ? 'row' : 'sm'}
      icon={place === 'drawer' ? ArrowRight : undefined}
      disabled={pending}
      aria-label={`${label} ${number}`}
      title={t('Sent to Vigie, where the NCR is managed')}
      onClick={() => run(() => advanceNcrAction({ projectCode: code, number, step }))}
    >
      {label}
    </Button>
  );
}

/** Quality verification: "→ Closed" in the log; "Move to Closed" + "Back to corrective action" in the drawer. */
export function NcrVerifyButtons({ code, number, closeLabel, backLabel, place }: Target & { closeLabel: string; backLabel?: string; place: 'row' | 'drawer' }) {
  const { t } = useI18n();
  const { pending, run } = useRun();
  const decide = (decision: 'approved' | 'rejected') => run(() => verifyNcrAction({ projectCode: code, number, decision }));
  return (
    <>
      <Button
        variant={place === 'row' ? 'secondary' : 'primary'}
        size={place === 'row' ? 'row' : 'sm'}
        icon={place === 'drawer' ? ArrowRight : undefined}
        disabled={pending}
        aria-label={`${closeLabel} ${number}`}
        title={t('Sent to Vigie, where the NCR is managed')}
        onClick={() => decide('approved')}
      >
        {closeLabel}
      </Button>
      {backLabel && (
        <Button variant="secondary" size="sm" disabled={pending} aria-label={`${backLabel} ${number}`} title={t('Sent to Vigie, where the NCR is managed')} onClick={() => decide('rejected')}>
          {backLabel}
        </Button>
      )}
    </>
  );
}

/** "Start" / "To internal review" (secondary) and "Submit to client" (primary, paper plane) — row or drawer size. */
export function DeliverableMoveButton({
  code, number, to, label, variant, place, restart,
}: Target & { to: ProducerTarget; label: string; variant: 'primary' | 'secondary'; place: 'row' | 'drawer'; /** "Start next revision" (R-114). */ restart?: boolean }) {
  const { pending, run } = useRun();
  return (
    <Button
      variant={variant}
      size={place === 'row' ? 'row' : 'sm'}
      icon={to === 'submitted' ? PaperPlaneTilt : restart ? ArrowCounterClockwise : undefined}
      disabled={pending}
      aria-label={`${label} ${number}`}
      onClick={() => run(() => moveDeliverableAction({ projectCode: code, number, to }))}
    >
      {label}
    </Button>
  );
}

/** Register row: "Accept" (primary, check) + "Reject" (ghost) — the project's client contact on a submitted deliverable. */
export function DeliverableDecideRow({ code, number }: Target) {
  const { t } = useI18n();
  const { pending, run } = useRun();
  const decide = (decision: 'accepted' | 'rejected') => run(() => decideDeliverableAction({ projectCode: code, number, decision }));
  return (
    <>
      <Button variant="primary" size="row" icon={Check} disabled={pending} aria-label={`${t('Accept')} ${number}`} onClick={() => decide('accepted')}>
        {t('Accept')}
      </Button>
      <Button variant="ghost" size="compact" disabled={pending} aria-label={`${t('Reject')} ${number}`} onClick={() => decide('rejected')}>
        {t('Reject')}
      </Button>
    </>
  );
}

const REJECT_FORM: FormDef = {
  title: 'Reject with comments',
  submit: 'Reject',
  fields: [{ id: 'comments', label: 'Comments', type: 'textarea', placeholder: 'comments issued' }],
};

/** Drawer: "Accept (PV)" (primary, check) + "Reject with comments" (secondary, opens the comments dialog). */
export function DeliverableDecideDrawer({ code, number, context }: Target & { context: string }) {
  const { t } = useI18n();
  const { pending, run } = useRun();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="primary" size="sm" icon={Check} disabled={pending} aria-label={`${t('Accept (PV)')} ${number}`} onClick={() => run(() => decideDeliverableAction({ projectCode: code, number, decision: 'accepted' }))}>
        {t('Accept (PV)')}
      </Button>
      <Button variant="secondary" size="sm" disabled={pending} aria-label={`${t('Reject with comments')} ${number}`} onClick={() => setOpen(true)}>
        {t('Reject with comments')}
      </Button>
      <FormDialog
        {...REJECT_FORM}
        translate
        open={open}
        onClose={() => setOpen(false)}
        context={`${number} · ${context}`}
        onSubmit={(values) => rejectDeliverableWithCommentsAction(code, number, values)}
      />
    </>
  );
}

/** "Link a Codex document": picks the issued document among the project's Codex records. */
export function LinkDocumentButton({ code, number, context, options }: Target & { context: string; options: { value: string; label: string }[] }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const form: FormDef = {
    title: t('Link a Codex document'),
    submit: t('Link document'),
    fields: [{ id: 'doc', label: t('Codex document'), type: 'select', options }],
  };
  return (
    <>
      <Button variant="ghost" size="compact" icon={LinkIcon} disabled={!options.length} onClick={() => setOpen(true)}>
        {t('Link a Codex document')}
      </Button>
      <FormDialog {...form} open={open} onClose={() => setOpen(false)} context={`${number} · ${context}`} onSubmit={(values) => linkDeliverableDocumentAction(code, number, values)} />
    </>
  );
}

/** "New deliverable" (R-115, Q-3b): header primary of the deliverables register for the project's manager and the director. */
export function NewDeliverableButton({ code, label, context, form }: { code: string; label: string; context: string; form: FormDef }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="primary" icon={Plus} onClick={() => setOpen(true)}>
        {label}
      </Button>
      <FormDialog {...form} open={open} onClose={() => setOpen(false)} context={context} onSubmit={(values) => createDeliverableAction(code, values)} />
    </>
  );
}
