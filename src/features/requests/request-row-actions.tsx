'use client';
// PM row actions of the Requests table (docs/spec/08 §5.4 last column, §5.6): reschedule proposed → "Accept {dates}"
// + "Withdraw"; pending → "Withdraw"; rejected → "Re-request". Each calls its Server Function; errors are toasted.
import { ArrowCounterClockwise, Check } from '@phosphor-icons/react/dist/ssr';
import { useTransition } from 'react';
import { Button } from '@/components/ds/Button';
import { useToast } from '@/components/ds/Toast';
import { useI18n } from '@/i18n/client';
import { acceptRescheduleAction, reRequestAction, withdrawRequestAction, type RequestActionResult } from './actions';
import s from './requests.module.css';

export interface RequestRowActionsProps {
  id: string;
  isPending: boolean;
  isReschedule: boolean;
  isRejected: boolean;
  /** Proposed dates, already translated ("12 Oct – 16 Oct"). */
  proposed: string;
}

export function RequestRowActions({ id, isPending, isReschedule, isRejected, proposed }: RequestRowActionsProps) {
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
      {isRejected && (
        <Button variant="secondary" icon={ArrowCounterClockwise} className={s.rowBtn} disabled={busy} onClick={() => run(() => reRequestAction(id))}>
          {t('Re-request')}
        </Button>
      )}
    </>
  );
}
