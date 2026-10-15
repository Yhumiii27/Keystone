'use client';
// PM row actions of the Requests table (docs/spec/08 §5.4 last column, §5.6): reschedule proposed → "Accept {dates}"
// + "Withdraw"; pending → "Withdraw"; rejected or withdrawn → "Re-request" (P-8c a, R-090). Drafts made by the what-if levelling (chapter 4, S-7)
// → "Send" + "Discard" (confirmed in a dialog). Each calls its Server Function; errors are toasted.
import { ArrowCounterClockwise, Check, PaperPlaneTilt, Trash } from '@phosphor-icons/react/dist/ssr';
import { useState, useTransition } from 'react';
import { Button } from '@/components/ds/Button';
import { Dialog } from '@/components/ds/Dialog';
import { DialogActions } from '@/components/ds/DialogParts';
import { useToast } from '@/components/ds/Toast';
import { useI18n } from '@/i18n/client';
import {
  acceptRescheduleAction, discardDraftRequestAction, reRequestAction, sendDraftRequestAction, withdrawRequestAction, type RequestActionResult,
} from './actions';
import s from './requests.module.css';

export interface RequestRowActionsProps {
  id: string;
  isPending: boolean;
  isReschedule: boolean;
  /** Rejected or withdrawn (P-8c): "Re-request". */
  canReRequest: boolean;
  /** Proposed dates, already translated ("12 Oct – 16 Oct"). */
  proposed: string;
}

export function RequestRowActions({ id, isPending, isReschedule, canReRequest, proposed }: RequestRowActionsProps) {
  const { t } = useI18n();
  const toast = useToast();
  const [busy, start] = useTransition();
  const run = (fn: () => Promise<RequestActionResult>) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) toast.showEn(r.error);
    });
  return (
    <>
      {isReschedule && (
        <Button variant="primary" icon={Check} className={s.rowBtn} disabled={busy} onClick={() => run(() => acceptRescheduleAction(id))}>
          {`${t('Accept')} ${proposed}`}
        </Button>
      )}
      {(isReschedule || isPending) && (
        <Button variant="ghost" className={s.rowGhost} disabled={busy} onClick={() => run(() => withdrawRequestAction(id))}>
          {t('Withdraw')}
        </Button>
      )}
      {canReRequest && (
        <Button variant="secondary" icon={ArrowCounterClockwise} className={s.rowBtn} disabled={busy} onClick={() => run(() => reRequestAction(id))}>
          {t('Re-request')}
        </Button>
      )}
    </>
  );
}

export interface DraftRowActionsProps {
  id: string;
  /** Request title, already translated (confirmation text). */
  title: string;
}

/** S-7: "Send" (draft → pending review, the department head is notified) and "Discard" (deleted after confirmation). */
export function DraftRowActions({ id, title }: DraftRowActionsProps) {
  const { t } = useI18n();
  const toast = useToast();
  const [busy, start] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const send = () =>
    start(async () => {
      const r = await sendDraftRequestAction(id);
      toast.showEn(r.ok ? 'Draft sent to the department' : r.error);
    });
  const discard = () =>
    start(async () => {
      const r = await discardDraftRequestAction(id);
      setConfirming(false);
      toast.showEn(r.ok ? 'Draft discarded' : r.error);
    });
  return (
    <>
      <Button variant="primary" icon={PaperPlaneTilt} className={s.rowBtn} disabled={busy} onClick={send}>
        {t('Send')}
      </Button>
      <Button variant="ghost" className={s.rowGhost} disabled={busy} onClick={() => setConfirming(true)}>
        {t('Discard')}
      </Button>
      <Dialog open={confirming} onClose={() => setConfirming(false)} title={t('Discard draft')} width={440}>
        <p className={s.confirmText}>{`${id} · ${title}`}</p>
        <p className={s.confirmText}>{t('The draft is deleted; it was never sent to the department.')}</p>
        <DialogActions>
          <Button variant="secondary" onClick={() => setConfirming(false)}>
            {t('Cancel')}
          </Button>
          <Button variant="primary" icon={Trash} onClick={discard} disabled={busy} aria-busy={busy || undefined}>
            {t('Discard draft')}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
