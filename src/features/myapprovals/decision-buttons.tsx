'use client';
// Inline Reject / Approve of an inbox row (template 1727). Each decision mode is recorded through its module's Server
// Function (change-request steps: the Change control writer; purchase orders: the Orders writers; delivery quality
// checks: Deliveries' Accept → stock / Reject → quarantine, which the prototype's inbox call crashed on, 08 OQ28) and
// the row leaves the inbox on revalidation; kinds whose module is not modelled yet only announce the decision (toast).
import { Check } from '@phosphor-icons/react/dist/ssr';
import { useTransition } from 'react';
import { Button } from '@/components/ds/Button';
import { useToast } from '@/components/ds/Toast';
import type { ApprovalDecision } from '@/domain/approvals';
import { decideReceiptFromInboxAction } from '@/features/deliveries/actions';
import { decideEcoApprovalAction } from '@/features/eco/actions';
import { decidePurchaseOrderAction } from '@/features/orders/actions';
import { useI18n } from '@/i18n/client';
import { decideChangeRequestAction } from './actions';
import s from './myapprovals.module.css';

/** Shown when the Server Function itself fails (network, server error) — same text as its own failure result. */
const FAILED = 'The decision could not be saved';

/** `toast` (EN source): the module's own success message, e.g. the ECO's "Pending sync with Vigie". */
type Outcome = { ok: true; toast?: string } | { ok: false; error: string };

/** The Server Function recording `decision` (Approve = ok, Reject = rejected); null = no persisted decision (preview). */
function recorder(decision: ApprovalDecision): ((ok: boolean) => Promise<Outcome>) | null {
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
    default:
      return null;
  }
}

export function DecisionButtons({ id, decision }: { id: string; decision: ApprovalDecision }) {
  const { t } = useI18n();
  const toast = useToast();
  const [pending, startTransition] = useTransition();

  const decide = (ok: boolean) => {
    const record = recorder(decision);
    if (!record) {
      toast.showEn(`${id} · ${ok ? 'Approve' : 'Reject'} — coming soon`);
      return;
    }
    startTransition(async () => {
      try {
        const r = await record(ok);
        toast.showEn(r.ok ? (r.toast ?? `${id} · ${ok ? 'Approved' : 'Rejected'}`) : r.error);
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
