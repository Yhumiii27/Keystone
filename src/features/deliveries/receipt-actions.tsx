'use client';
// Client islands of the Deliveries & goods receipt screen (docs/spec/08 §3.4–3.5, template 1621–1652):
// - `RegisterReceiptButton`: "Register receipt" (row `btn-secondary` 12px / drawer `btn-primary` 12.5px, `ph-package`)
//   opening the receipt form (delivered on, carrier, supplier delivery note, delivered per article);
// - `RowQcButtons`: the row's "Accept" (`btn-primary`, `ph-check`) and "Reject" (`btn-ghost`) — default remarks;
// - `QcPanel`: the drawer's inspection remarks, "Accept → stock", "Reject → quarantine" and "Partial rejection"
//   (rejected quantity per article, 08 OQ9);
// - `AttachNoteButton`, `PrintReceiptButton`: the drawer's document actions.
// Every button names its delivery for assistive technologies; a refused or failed change shows its message as a
// toast (row actions) or in the dialog. Rendered only for viewers who may act (the view gates them).
// Each island sits in a `display:contents` wrapper that
// - keeps clicks inside its dialogs (portals bubble through the React tree) from reaching the table row, which would
//   otherwise open or close the delivery drawer behind the "Register receipt" form;
// - moves the focus to the enclosing row or drawer panel when the island disappears after a decision (its buttons
//   are gone once the receipt is no longer Announced / QC pending), instead of dropping it on the page body.
import { Check, Package, Paperclip, X } from '@phosphor-icons/react/dist/ssr';
import { useId, useLayoutEffect, useRef, useState, useTransition, type MouseEvent, type ReactNode } from 'react';
import { FormDialog } from '@/components/app/FormDialog';
import type { FormDef } from '@/components/app/form-def';
import { Button } from '@/components/ds/Button';
import { Dialog } from '@/components/ds/Dialog';
import { DialogActions } from '@/components/ds/DialogParts';
import { Input } from '@/components/ds/Field';
import { Table, Td, Th } from '@/components/ds/Table';
import { showToast } from '@/components/ds/Toast';
import { ExportFileButton } from '@/features/exports/export-file-button';
import { useI18n } from '@/i18n/client';
import { exportHref } from '@/lib/export-href';
import { acceptReceiptAction, attachDeliveryNoteAction, recordPartialQcAction, registerReceiptAction, rejectReceiptAction, type DeliveryActionResult } from './actions';
import s from './deliveries.module.css';

const FAILED = 'The change could not be saved';
/** Dialogs opened from the delivery drawer (z 60/61) sit above it. */
const DIALOG_OVER_DRAWER = 70;
/** Delivery notes and certificates: scans and PDFs. */
const ACCEPTED_FILES = '.pdf,.png,.jpg,.jpeg,.tif,.tiff,.heic';

/** Runs a decision and toasts its outcome (the message comes translated from the server). */
function useRun() {
  const { t } = useI18n();
  const [pending, start] = useTransition();
  const run = (f: () => Promise<DeliveryActionResult>) =>
    start(async () => {
      try {
        const r = await f();
        showToast(r.ok ? (r.message ?? '') : r.error);
      } catch {
        showToast(t(FAILED));
      }
    });
  return { pending, run };
}

const stop = (e: MouseEvent) => e.stopPropagation();

/**
 * `display:contents` wrapper of an island: clicks stay inside it (see the header), and when it unmounts while it
 * holds the focus, the focus goes to the enclosing table row or drawer panel (both stay on screen). The layout-effect
 * cleanup runs before the island's nodes leave the document, so the focused button is still there to be checked.
 */
function Island({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    return () => {
      if (el?.contains(document.activeElement)) el.closest<HTMLElement>('tr, [role="dialog"]')?.focus({ preventScroll: true });
    };
  }, []);
  return (
    <span ref={ref} className={s.contents} onClick={stop}>
      {children}
    </span>
  );
}

// ── Register receipt ───────────────────────────────────────────────────────────────────────────────────

export interface RegisterReceiptButtonProps {
  code: string;
  number: string;
  /** Translated form and its sub-line ("BL-2026-0540 · Cotswold Fire Systems"). */
  form: FormDef;
  context: string;
  /** `row` = table action (secondary, 12px) · `drawer` = Quality check section (primary, 12.5px). */
  variant: 'row' | 'drawer';
}

export function RegisterReceiptButton({ code, number, form, context, variant }: RegisterReceiptButtonProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <Island>
      <Button
        variant={variant === 'row' ? 'secondary' : 'primary'}
        size={variant === 'row' ? 'row' : 'sm'}
        icon={Package}
        className={variant === 'drawer' ? s.receive : undefined}
        aria-label={`${t('Register receipt')} · ${number}`}
        onClick={() => setOpen(true)}
      >
        {t('Register receipt')}
      </Button>
      <FormDialog
        {...form}
        open={open}
        onClose={() => setOpen(false)}
        context={context}
        zIndex={variant === 'drawer' ? DIALOG_OVER_DRAWER : undefined}
        onSubmit={(values) => registerReceiptAction(code, number, values)}
      />
    </Island>
  );
}

// ── Row Accept / Reject ────────────────────────────────────────────────────────────────────────────────

export function RowQcButtons({ code, number }: { code: string; number: string }) {
  const { t } = useI18n();
  const { pending, run } = useRun();
  return (
    <Island>
      <Button variant="primary" size="row" icon={Check} disabled={pending} aria-label={`${t('Accept')} · ${number}`} onClick={() => run(() => acceptReceiptAction(code, number))}>
        {t('Accept')}
      </Button>
      <Button variant="ghost" size="compact" nowrap disabled={pending} aria-label={`${t('Reject')} · ${number}`} onClick={() => run(() => rejectReceiptAction(code, number))}>
        {t('Reject')}
      </Button>
    </Island>
  );
}

// ── Drawer QC panel ────────────────────────────────────────────────────────────────────────────────────

export interface QcPanelProps {
  code: string;
  number: string;
  /** Translated "BL-2026-0521 · Nordvolt" (partial-rejection dialog sub-line). */
  context: string;
  /** Lines of the receipt (translated names). */
  lines: { ref: string; name: string; delivered: number }[];
  /** Quantities as displayed ("1,234" / "1 234"). */
  deliveredText: string[];
}

export function QcPanel({ code, number, context, lines, deliveredText }: QcPanelProps) {
  const { t } = useI18n();
  const { pending, run } = useRun();
  const [remarks, setRemarks] = useState('');
  const [partial, setPartial] = useState(false);
  return (
    <Island>
      <Input className={s.remarks} value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder={t('Inspection remarks')} aria-label={t('Inspection remarks')} maxLength={500} />
      <div className={s.qcButtons}>
        <Button variant="primary" size="sm" icon={Check} disabled={pending} aria-label={`${t('Accept → stock')} · ${number}`} onClick={() => run(() => acceptReceiptAction(code, number, remarks))}>
          {t('Accept → stock')}
        </Button>
        <Button variant="secondary" size="sm" icon={X} disabled={pending} aria-label={`${t('Reject → quarantine')} · ${number}`} onClick={() => run(() => rejectReceiptAction(code, number, remarks))}>
          {t('Reject → quarantine')}
        </Button>
        <Button variant="ghost" size="sm" disabled={pending} aria-label={`${t('Partial rejection')} · ${number}`} onClick={() => setPartial(true)}>
          {t('Partial rejection')}
        </Button>
      </div>
      <PartialRejectionDialog
        open={partial}
        onClose={() => setPartial(false)}
        code={code}
        number={number}
        context={context}
        lines={lines}
        deliveredText={deliveredText}
        remarks={remarks}
        onRemarks={setRemarks}
      />
    </Island>
  );
}

interface PartialProps extends QcPanelProps {
  open: boolean;
  onClose: () => void;
  remarks: string;
  onRemarks: (v: string) => void;
}

/** Rejected quantity per article (the rest is accepted → stock, the rejected units → quarantine) and the remarks. */
function PartialRejectionDialog({ open, onClose, code, number, context, lines, deliveredText, remarks, onRemarks }: PartialProps) {
  const { t } = useI18n();
  const baseId = useId();
  const [rejected, setRejected] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const close = () => {
    setRejected({});
    setError(null);
    onClose();
  };
  const submit = () =>
    start(async () => {
      setError(null);
      try {
        const r = await recordPartialQcAction(code, number, rejected, remarks);
        if (!r.ok) {
          setError(r.error);
          return;
        }
        close();
        if (r.message) showToast(r.message);
      } catch {
        setError(t(FAILED));
      }
    });
  const acceptedOf = (ref: string, delivered: number) => {
    const raw = (rejected[ref] ?? '').trim();
    const n = raw === '' ? 0 : Number(raw);
    return Number.isInteger(n) && n >= 0 && n <= delivered ? String(delivered - n) : '—';
  };
  return (
    <Dialog open={open} onClose={close} title={t('Partial rejection')} subtitle={context} subtitleSize={12} width={640} offsetTop="8vh" maxHeight="84vh" zIndex={DIALOG_OVER_DRAWER}>
      <form
        className={s.dialogBody}
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <span className={s.dialogHint}>{t('Accepted units go to stock · rejected units go to quarantine')}</span>
        <Table size={12.5}>
          <thead>
            <tr>
              <Th>{t('Reference')}</Th>
              <Th>{t('Article')}</Th>
              <Th align="right">{t('Delivered')}</Th>
              <Th align="right">{t('Rejected')}</Th>
              <Th align="right">{t('Accepted')}</Th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={l.ref}>
                <Td className={s.lineRef}>{l.ref}</Td>
                <td>{l.name}</td>
                <Td align="right" numeric>
                  {deliveredText[i]}
                </Td>
                <Td align="right">
                  <Input
                    id={`${baseId}-${l.ref}`}
                    type="number"
                    min={0}
                    max={l.delivered}
                    step={1}
                    size="inline"
                    alignRight
                    className={s.qtyInput}
                    value={rejected[l.ref] ?? ''}
                    placeholder="0"
                    aria-label={`${t('Rejected')} · ${l.ref}`}
                    onChange={(e) => setRejected((cur) => ({ ...cur, [l.ref]: e.target.value }))}
                  />
                </Td>
                <Td align="right" numeric>
                  {acceptedOf(l.ref, l.delivered)}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
        <Input value={remarks} onChange={(e) => onRemarks(e.target.value)} placeholder={t('Inspection remarks')} aria-label={t('Inspection remarks')} maxLength={500} />
        {error && (
          <span role="alert" className={s.error}>
            {error}
          </span>
        )}
        <DialogActions variant="form">
          <Button variant="secondary" onClick={close}>
            {t('Cancel')}
          </Button>
          <Button type="submit" variant="primary" icon={Check} disabled={pending} aria-busy={pending || undefined}>
            {t('Record quality check')}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}

// ── Documents ──────────────────────────────────────────────────────────────────────────────────────────

/**
 * "Attach delivery note" (`btn-ghost`, `ph-paperclip`): opens the file picker and records the chosen file's name on
 * the receipt. The picker input is created on click, so the drawer holds no invisible control to focus.
 */
export function AttachNoteButton({ code, number }: { code: string; number: string }) {
  const { t } = useI18n();
  const { pending, run } = useRun();
  const pick = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = ACCEPTED_FILES;
    input.onchange = () => {
      const f = input.files?.[0];
      if (f) run(() => attachDeliveryNoteAction(code, number, f.name));
    };
    input.click();
  };
  return (
    <Button variant="ghost" size="sm" icon={Paperclip} className={s.attach} disabled={pending} aria-label={`${t('Attach delivery note')} · ${number}`} onClick={pick}>
      {t('Attach delivery note')}
    </Button>
  );
}

/** "Print receipt" (`btn-ghost`, `ph-file-pdf`): the goods receipt as a PDF (chapter 4 exports, document `receipt`). */
export function PrintReceiptButton({ code, number }: { code: string; number: string }) {
  const { t } = useI18n();
  return <ExportFileButton href={exportHref('deliveries', { format: 'pdf', code, variant: 'receipt', id: number })} label={t('Print receipt')} ariaLabel={`${t('Print receipt')} · ${number}`} />;
}
