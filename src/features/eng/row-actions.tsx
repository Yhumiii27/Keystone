'use client';
// Row actions of the discipline screens (client islands, template 2427–2446): "Confirm" an input, "Freeze" /
// "Propose release" / "Validate release (PM)" a deliverable, "Generate xlsx" an output, "Resolve here" / "Send back to
// tool" a consistency check. The Server Functions write and revalidate; the page re-renders with the new state (the
// prototype shows no toast); a refusal is shown as a toast.
import { FileXls } from '@phosphor-icons/react/dist/ssr';
import { useTransition } from 'react';
import { Button, type ButtonVariant } from '@/components/ds/Button';
import { useToast } from '@/components/ds/Toast';
import { useI18n } from '@/i18n/client';
import type { DeliverableStep, Discipline } from '@/domain/engineering';
import { closeCheckAction, confirmInputAction, deliverableStepAction, generateOutputAction, type EngActionResult } from './actions';

/** Shown when the Server Function itself fails (network, server error). */
const FAILED = 'The change could not be saved';

function useEngAction() {
  const { t } = useI18n();
  const toast = useToast();
  const [pending, start] = useTransition();
  const run = (call: () => Promise<EngActionResult>) =>
    start(async () => {
      try {
        const r = await call();
        if (!r.ok) toast.show(r.error);
        else if (r.toast) toast.show(r.toast);
      } catch {
        toast.show(t(FAILED));
      }
    });
  return { pending, run, t };
}

/** "Confirm" (secondary): the referent confirms consumption of the revision in use. */
export function ConfirmInputButton({ code, disc, doc }: { code: string; disc: Discipline; doc: string }) {
  const { pending, run, t } = useEngAction();
  return (
    <Button variant="secondary" size="xs" nowrap disabled={pending} aria-label={`${t('Confirm')} ${doc}`} onClick={() => run(() => confirmInputAction({ code, disc, doc }))}>
      {t('Confirm')}
    </Button>
  );
}

const STEP_LOOK: Record<DeliverableStep, { label: string; variant: ButtonVariant }> = {
  freeze: { label: 'Freeze', variant: 'ghost' },
  propose: { label: 'Propose release', variant: 'secondary' },
  validate: { label: 'Validate release (PM)', variant: 'primary' },
};

/** "Freeze" (ghost) / "Propose release" (secondary) / "Validate release (PM)" (primary) on an own deliverable. */
export function DeliverableStepButton({ code, disc, number, step }: { code: string; disc: Discipline; number: string; step: DeliverableStep }) {
  const { pending, run, t } = useEngAction();
  const look = STEP_LOOK[step];
  return (
    <Button
      variant={look.variant}
      size="xs"
      nowrap
      disabled={pending}
      aria-label={`${t(look.label)} ${number}`}
      onClick={() => run(() => deliverableStepAction({ code, disc, number, step }))}
    >
      {t(look.label)}
    </Button>
  );
}

/** "Generate xlsx" (secondary, xls icon) on an output that is not Blocked. */
export function GenerateOutputButton({ code, disc, number }: { code: string; disc: Discipline; number: string }) {
  const { pending, run, t } = useEngAction();
  return (
    <Button
      variant="secondary"
      size="xs"
      nowrap
      icon={FileXls}
      disabled={pending}
      aria-label={`${t('Generate xlsx')} ${number}`}
      onClick={() => run(() => generateOutputAction({ code, disc, number }))}
    >
      {t('Generate xlsx')}
    </Button>
  );
}

/** "Resolve here" (secondary) and "Send back to tool" (ghost) on an open check. */
export function CheckActions({ code, disc, number }: { code: string; disc: Discipline; number: string }) {
  const { pending, run, t } = useEngAction();
  const close = (how: 'resolved' | 'sent_back') => run(() => closeCheckAction({ code, disc, number, how }));
  return (
    <>
      <Button variant="secondary" size="xs" disabled={pending} aria-label={`${t('Resolve here')} ${number}`} onClick={() => close('resolved')}>
        {t('Resolve here')}
      </Button>
      <Button variant="ghost" size="xs" disabled={pending} aria-label={`${t('Send back to tool')} ${number}`} onClick={() => close('sent_back')}>
        {t('Send back to tool')}
      </Button>
    </>
  );
}
