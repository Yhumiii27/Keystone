'use client';
// Inline Reject / Approve of an inbox row (template 1727). Each decision mode is recorded through its module's Server
// Function (change-request steps: the Change control writer; purchase orders: the Orders writers; delivery quality
// checks: Deliveries' Accept → stock / Reject → quarantine, which the prototype's inbox call crashed on, 08 OQ28; NCR
// verifications and deliverable acceptances: the Quality writers; chapter 4: resource requests through the Approvals
// screen's Server Functions and forced stage changes through the lifecycle writer, L-1) and the row leaves the inbox on
// revalidation. Every mode is recorded — no row announces a decision it does not make.
// Two rejections ask first (a small dialog, Esc / Cancel closes it): a resource request (the reason the PM sees, as on
// Approvals) and a forced stage change (the project goes back to the stage it left; optional comment).
import { Check, Warning, X } from '@phosphor-icons/react/dist/ssr';
import { useId, useState, useTransition } from 'react';
import { Callout } from '@/components/app/Callout';
import { Button } from '@/components/ds/Button';
import { Dialog } from '@/components/ds/Dialog';
import { DialogActions } from '@/components/ds/DialogParts';
import { Field, Textarea } from '@/components/ds/Field';
import { useToast } from '@/components/ds/Toast';
import type { ApprovalDecision } from '@/domain/approvals';
import { FORCED_STAGE_COMMENT_MAX, FORCED_STAGE_REJECT_COMMENT_REQUIRED } from '@/domain/forced-stage';
import { decideReceiptFromInboxAction } from '@/features/deliveries/actions';
import { decideEcoApprovalAction } from '@/features/eco/actions';
import { decidePurchaseOrderAction } from '@/features/orders/actions';
import { decideDeliverableAction, verifyNcrAction } from '@/features/quality/actions';
import { useI18n } from '@/i18n/client';
import { decideChangeRequestAction, decideForcedStageChangeAction, decideResourceRequestAction } from './actions';
import s from './myapprovals.module.css';

/** Shown when the Server Function itself fails (network, server error) — same text as its own failure result. */
const FAILED = 'The decision could not be saved';

/** `toast` (EN source): the module's own success message, e.g. the ECO's "Pending sync with Vigie". */
type Outcome = { ok: true; toast?: string } | { ok: false; error: string };

/** The Server Function recording `decision` (Approve = ok, Reject = rejected); `note` = the reason / comment typed when rejecting. */
function recorder(decision: ApprovalDecision): (ok: boolean, note?: string) => Promise<Outcome> {
  switch (decision.mode) {
    case 'change-request':
      return (ok) => decideChangeRequestAction({ projectCode: decision.projectCode, number: decision.number, step: decision.step, decision: ok ? 'ok' : 'rejected' });
    case 'purchase-order':
      return (ok) => decidePurchaseOrderAction({ projectCode: decision.projectCode, number: decision.number, decision: ok ? 'ok' : 'rejected' });
    case 'delivery-qc':
      return (ok) => decideReceiptFromInboxAction({ projectCode: decision.projectCode, number: decision.number, decision: ok ? 'ok' : 'rejected' });
    case 'eco':
      // Recorded in Keystone and sent to Vigie, which owns the ECO (toast "… · Approved · Pending sync with Vigie").
      return (ok) => decideEcoApprovalAction({ number: decision.number, key: decision.key, decision: ok ? 'ok' : 'rejected' });
    case 'ncr-verification':
      // Quality verification sent to Vigie (Approve → Closed, Reject → back to Corrective action; "… · Pending sync with Vigie").
      return (ok) => verifyNcrAction({ projectCode: decision.projectCode, number: decision.number, decision: ok ? 'approved' : 'rejected' });
    case 'deliverable':
      // The client's acceptance (PV) or rejection of a submitted deliverable.
      return (ok) => decideDeliverableAction({ projectCode: decision.projectCode, number: decision.number, decision: ok ? 'accepted' : 'rejected' });
    case 'resource-request':
      // Approve → task created in the person's list; Reject → the reason the PM sees (Approvals screen rules).
      return (ok, note) => decideResourceRequestAction({ number: decision.number, decision: ok ? 'ok' : 'rejected', note });
    case 'stage':
      // L-1: Approve keeps the stage; Reject reverts the project to the stage it left.
      return (ok, note) => decideForcedStageChangeAction({ projectCode: decision.projectCode, transitionId: decision.transitionId, decision: ok ? 'approved' : 'rejected', comment: note });
    default: {
      const unknown: never = decision;
      throw new Error(`Unknown decision mode ${JSON.stringify(unknown)}`);
    }
  }
}

/** What the confirmation of a rejection asks (EN source strings); null = Reject decides at once. */
interface RejectPrompt {
  label: string;
  required: boolean;
  max: number;
  /** Consequence shown above the field (EN), with an optional value appended after ": " (a stage label). */
  notice: string | null;
  noticeValue: string | null;
}

function rejectPrompt(decision: ApprovalDecision): RejectPrompt | null {
  if (decision.mode === 'resource-request') return { label: 'Reason — the PM sees this', required: false, max: 1000, notice: null, noticeValue: null };
  if (decision.mode === 'stage')
    return {
      label: 'Comment — the project manager sees this', required: FORCED_STAGE_REJECT_COMMENT_REQUIRED, max: FORCED_STAGE_COMMENT_MAX,
      notice: 'Rejecting reverts the project to the stage it left', noticeValue: decision.fromLabel,
    };
  return null;
}

export function DecisionButtons({ id, decision }: { id: string; decision: ApprovalDecision }) {
  const { t } = useI18n();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [asking, setAsking] = useState(false);
  const prompt = rejectPrompt(decision);

  const decide = (ok: boolean, note?: string, done?: () => void) => {
    const record = recorder(decision);
    startTransition(async () => {
      try {
        const r = await record(ok, note);
        toast.showEn(r.ok ? (r.toast ?? `${id} · ${ok ? 'Approved' : 'Rejected'}`) : r.error);
        if (r.ok) done?.();
      } catch {
        toast.showEn(FAILED);
      }
    });
  };

  // Accessible names carry the item ("Approve CR-008"): every row has the same two visible labels.
  return (
    <div className={s.actions}>
      <Button
        variant="ghost"
        size="compact"
        disabled={pending}
        aria-label={`${t('Reject')} ${id}`}
        aria-haspopup={prompt ? 'dialog' : undefined}
        onClick={() => (prompt ? setAsking(true) : decide(false))}
      >
        {t('Reject')}
      </Button>
      <Button variant="primary" size="row" icon={Check} disabled={pending} aria-label={`${t('Approve')} ${id}`} onClick={() => decide(true)}>
        {t('Approve')}
      </Button>
      {prompt && (
        // The dialog is portalled, but React events still bubble to the row: the guard keeps its clicks from opening the item.
        <span className={s.guard} onClick={(e) => e.stopPropagation()}>
          <RejectDialog
            open={asking}
            id={id}
            prompt={prompt}
            pending={pending}
            onClose={() => setAsking(false)}
            onConfirm={(note) => decide(false, note, () => setAsking(false))}
          />
        </span>
      )}
    </div>
  );
}

/** "Reject {id}": the consequence, the reason / comment field and Cancel / Confirm reject. */
function RejectDialog({ open, id, prompt, pending, onClose, onConfirm }: {
  open: boolean; id: string; prompt: RejectPrompt; pending: boolean; onClose: () => void; onConfirm: (note: string) => void;
}) {
  const { t, lang } = useI18n();
  const fieldId = useId();
  const [note, setNote] = useState('');
  const close = () => {
    setNote('');
    onClose();
  };
  const blocked = pending || (prompt.required && !note.trim());
  return (
    <Dialog open={open} onClose={close} title={`${t('Reject')} ${id}`} width={440} placement="center" maxHeight={null}>
      <form
        className={s.rejectForm}
        onSubmit={(e) => {
          e.preventDefault();
          if (!blocked) onConfirm(note.trim());
        }}
      >
        {prompt.notice && (
          <Callout variant="emphasis" icon={Warning}>
            {t(prompt.notice)}
            {prompt.noticeValue ? `${lang === 'fr' ? ' : ' : ': '}${t(prompt.noticeValue)}` : ''}
          </Callout>
        )}
        <Field label={t(prompt.label)} required={prompt.required} htmlFor={fieldId}>
          <Textarea id={fieldId} short value={note} maxLength={prompt.max} autoFocus onChange={(e) => setNote(e.target.value)} />
        </Field>
        <DialogActions variant="flush">
          <Button variant="secondary" onClick={close}>
            {t('Cancel')}
          </Button>
          <Button type="submit" variant="primary" icon={X} disabled={blocked} aria-busy={pending || undefined}>
            {t('Confirm reject')}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
