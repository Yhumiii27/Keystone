'use client';
// Progress the viewer records on a Vigie ECO (client islands): the row step buttons "Start impact analysis" /
// "Submit for approval" (template 1335–1338) and the drawer's Reject / Approve on the viewer's own key (template 1371).
// The Server Functions send them to Vigie through the connector; the screen then shows "Pending sync with Vigie".
// Clicks inside a register row do not open the drawer (ClickableRow ignores buttons).
import { Check } from '@phosphor-icons/react/dist/ssr';
import { useTransition } from 'react';
import { Button } from '@/components/ds/Button';
import { useToast } from '@/components/ds/Toast';
import type { EcoApproverKey, EcoStatus } from '@/server/db/codes';
import { useI18n } from '@/i18n/client';
import { decideEcoApprovalAction, requestEcoStepAction, type EcoProgressResult } from './actions';

/** Shown when the Server Function itself fails (network, server error). */
const FAILED = 'The progress could not be recorded';

function useProgress() {
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const run = (call: () => Promise<EcoProgressResult>) =>
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

/** "Start impact analysis" (secondary) / "Submit for approval" (primary): a step request sent to Vigie. */
export function StepButton({ number, target, label, variant }: { number: string; target: EcoStatus; label: string; variant: 'primary' | 'secondary' }) {
  const { t } = useI18n();
  const { pending, run } = useProgress();
  return (
    <Button
      variant={variant}
      size="row"
      disabled={pending}
      aria-label={`${label} ${number}`}
      title={t('Sent to Vigie, where the ECO is managed')}
      onClick={() => run(() => requestEcoStepAction({ number, step: target }))}
    >
      {label}
    </Button>
  );
}

/** Reject (ghost) + Approve (primary, check icon) on the viewer's approval key. */
export function ApprovalButtons({ number, approvalKey }: { number: string; approvalKey: EcoApproverKey }) {
  const { t } = useI18n();
  const { pending, run } = useProgress();
  const decide = (decision: 'ok' | 'rejected') => run(() => decideEcoApprovalAction({ number, key: approvalKey, decision }));
  return (
    <>
      <Button variant="ghost" size="compact" disabled={pending} aria-label={`${t('Reject')} ${number}`} onClick={() => decide('rejected')}>
        {t('Reject')}
      </Button>
      <Button variant="primary" size="row" icon={Check} disabled={pending} aria-label={`${t('Approve')} ${number}`} onClick={() => decide('ok')}>
        {t('Approve')}
      </Button>
    </>
  );
}
