'use client';
// Client islands of the Purchase orders screen (docs/spec/08 §2.4–2.5): the BOM shortfall assistant (header
// "New purchase order" and banner "Create draft POs by supplier"), the row actions "Send for approval" / "Approve &
// order", and the drawer's "Export PO" (the purchase order PDF) and "Push to X3". Rendered only for
// viewers who may act (the page gates them; the Server Functions check again). A refused or failed change shows its
// message as a toast; successful changes refresh the page through revalidation, as in the prototype (no toast),
// except "Push to X3", which confirms with the X3 reference.
import { Check, Plus, UploadSimple } from '@phosphor-icons/react/dist/ssr';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { Button } from '@/components/ds/Button';
import { useToast } from '@/components/ds/Toast';
import { ExportFileButton } from '@/features/exports/export-file-button';
import { useI18n } from '@/i18n/client';
import { exportHref } from '@/lib/export-href';
import { approveOrderAction, createDraftOrdersAction, pushOrderToX3Action, submitOrderAction, type OrderActionResult } from './actions';

const FAILED = 'The change could not be saved';

function useRun() {
  const toast = useToast();
  const [pending, start] = useTransition();
  const run = (action: () => Promise<OrderActionResult>, then?: (r: Extract<OrderActionResult, { ok: true }>) => void) =>
    start(async () => {
      try {
        const r = await action();
        if (!r.ok) toast.showEn(r.error);
        else then?.(r);
      } catch {
        toast.showEn(FAILED);
      }
    });
  return { pending, run, toast };
}

export interface CreateDraftsButtonProps {
  code: string;
  /** `header` = "New purchase order" (DS 14px), `banner` = "Create draft POs by supplier" (12.5px). */
  place: 'header' | 'banner';
  /** Where to go once the drafts exist: the list with the chip filter reset to All (prototype poFilter null). */
  afterHref: string;
}

export function CreateDraftsButton({ code, place, afterHref }: CreateDraftsButtonProps) {
  const { t } = useI18n();
  const router = useRouter();
  const { pending, run } = useRun();
  return (
    <Button
      variant="primary"
      size={place === 'banner' ? 'sm' : undefined}
      icon={Plus}
      disabled={pending}
      onClick={() => run(() => createDraftOrdersAction(code), () => router.replace(afterHref, { scroll: false }))}
    >
      {t(place === 'banner' ? 'Create draft POs by supplier' : 'New purchase order')}
    </Button>
  );
}

export interface OrderRowActionsProps {
  code: string;
  number: string;
  canSubmit: boolean;
  /** Awaiting approval and the viewer approves this project's orders. */
  canApprove: boolean;
}

/** "Send for approval" (secondary, Draft) · "Approve & order" (primary + check, Awaiting approval), 12px row buttons. */
export function OrderRowActions({ code, number, canSubmit, canApprove }: OrderRowActionsProps) {
  const { t } = useI18n();
  const { pending, run } = useRun();
  return (
    <>
      {canSubmit && (
        <Button variant="secondary" size="row" disabled={pending} aria-label={`${t('Send for approval')} · ${number}`} onClick={() => run(() => submitOrderAction(code, number))}>
          {t('Send for approval')}
        </Button>
      )}
      {canApprove && (
        <Button variant="primary" size="row" icon={Check} disabled={pending} aria-label={`${t('Approve & order')} · ${number}`} onClick={() => run(() => approveOrderAction(code, number))}>
          {t('Approve & order')}
        </Button>
      )}
    </>
  );
}

/** Drawer "Export PO" (ghost + file-pdf): the internal purchase order summary as a PDF (document `po`; SC-4b: the legal order is issued by Sage X3). */
export function ExportPoButton({ code, number }: { code: string; number: string }) {
  const { t } = useI18n();
  return <ExportFileButton href={exportHref('orders', { format: 'pdf', code, variant: 'po', id: number })} label={t('Export PO')} ariaLabel={`${t('Export PO')} · ${number}`} />;
}

/** Drawer "Push to X3" (ghost + upload, as on Stock): an approved order drafted in Keystone gets its X3 reference. */
export function PushToX3Button({ code, number }: { code: string; number: string }) {
  const { t } = useI18n();
  const { pending, run, toast } = useRun();
  return (
    <Button
      variant="ghost"
      size="sm"
      icon={UploadSimple}
      disabled={pending}
      aria-label={`${t('Push to X3')} · ${number}`}
      onClick={() => run(() => pushOrderToX3Action(code, number), (r) => r.message && toast.showEn(r.message))}
    >
      {t('Push to X3')}
    </Button>
  );
}
