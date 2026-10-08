'use client';
// Inline Reject / Approve of an inbox row (template 1727). Change-request steps are recorded through the Server
// Function (same writer as Change control) and the row leaves the inbox on revalidation; kinds whose module is
// not modelled yet only announce the decision (toast), so nothing throws (08 OQ28, delivery QC).
import { Check } from '@phosphor-icons/react/dist/ssr';
import { useTransition } from 'react';
import { Button } from '@/components/ds/Button';
import { useToast } from '@/components/ds/Toast';
import type { ApprovalDecision } from '@/domain/approvals';
import { useI18n } from '@/i18n/client';
import { decideChangeRequestAction } from './actions';
import s from './myapprovals.module.css';

/** Shown when the Server Function itself fails (network, server error) — same text as its own failure result. */
const FAILED = 'The decision could not be saved';

export function DecisionButtons({ id, decision }: { id: string; decision: ApprovalDecision }) {
  const { t } = useI18n();
  const toast = useToast();
  const [pending, startTransition] = useTransition();

  const decide = (ok: boolean) => {
    if (decision.mode === 'preview') {
      toast.showEn(`${id} · ${ok ? 'Approve' : 'Reject'} — coming soon`);
      return;
    }
    startTransition(async () => {
      try {
        const r = await decideChangeRequestAction({ projectCode: decision.projectCode, number: decision.number, step: decision.step, decision: ok ? 'ok' : 'rejected' });
        toast.showEn(r.ok ? `${id} · ${ok ? 'Approved' : 'Rejected'}` : r.error);
      } catch {
        toast.showEn(FAILED);
      }
    });
  };

  // Accessible names carry the item ("Approve CR-008"): every row has the same two visible labels.
  return (
    <div className={s.actions}>
      <Button variant="ghost" size="compact" disabled={pending} aria-label={`${t('Reject')} ${id}`} onClick={() => decide(false)}>
        {t('Reject')}
      </Button>
      <Button variant="primary" size="row" icon={Check} disabled={pending} aria-label={`${t('Approve')} ${id}`} onClick={() => decide(true)}>
        {t('Approve')}
      </Button>
    </div>
  );
}
