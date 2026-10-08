'use server';
// Sourcing, invoices & suppliers — Server Functions (docs/spec/08 §1.4.5, §1.5, §1.4.3). Each one validates its raw
// input, checks the viewer server-side — the screen must be in their workspace (director, project manager,
// procurement); an award also needs an awarding role, an invoice decision procurement or the director (P-5) — re-checks
// the record's state with the domain rules, writes through the purchasing DAL with the viewer as the actor, then
// revalidates every page (Sourcing, My approvals and its badge, Purchase orders for the drafted order, sidebar badges).
import { revalidatePath } from 'next/cache';
import type { FormDialogResult } from '@/components/app/FormDialog';
import {
  canAwardRfq, canDecideInvoiceRole, invoiceDecisions, match3, parseNewRfq, rfqActions,
} from '@/domain/procurement';
import {
  approveInvoicePayment, approveInvoiceReceivedPart, awardRfq, compareRfqQuotes, createRfq, getRfq, getSupplierInvoice, rejectSupplierInvoice, sendRfq,
} from '@/server/dal/purchasing';
import { getProject } from '@/server/dal/projects';
import { getScreenAccess } from '@/server/project-context';
import { getI18n, getLastProject } from '@/server/session';
import { NEW_RFQ_RESULT } from './forms';
import { procT } from './i18n';

export type SourcingActionResult = { ok: true; toast?: string } | { error: string };

const refresh = () => revalidatePath('/', 'layout');

/** Message translated for the viewer (feature translator, segments on " · "). */
async function tr(english: string) {
  const { t, lang } = await getI18n();
  return procT(t, lang)(english);
}

/** The screen must be in the viewer's workspace (outside → read-only banner, no edit controls). */
async function editor(): Promise<{ name: string; role: Awaited<ReturnType<typeof getScreenAccess>>['viewer']['role'] } | { error: string }> {
  const { viewer, canEdit } = await getScreenAccess('procurement');
  if (!canEdit) return { error: await tr('Sourcing is read-only for you') };
  return { name: viewer.name, role: viewer.role };
}

const isRef = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 40;

/** Form values as sent by the client, keeping string entries only. */
const strings = (values: unknown): Record<string, string> =>
  values && typeof values === 'object' ? Object.fromEntries(Object.entries(values).filter((e): e is [string, string] => typeof e[1] === 'string')) : {};

// ── New RFQ ────────────────────────────────────────────────────────────────────────────────────────────

/**
 * "Send RFQ" (header "New RFQ", AF.procurement): RFQ-2026-nnn, status Open, the viewer as buyer, on the current project
 * (the dialog's sub-line names it). Toast "RFQ sent to suppliers · RFQ-2026-035".
 */
export async function createRfqAction(values: Record<string, string>): Promise<FormDialogResult> {
  const who = await editor();
  if ('error' in who) return who;
  const parsed = parseNewRfq(strings(values));
  if (!parsed.ok) return { error: await tr(parsed.error) };
  const project = await getProject(await getLastProject());
  let number: string;
  try {
    number = await createRfq(
      { title: parsed.value.title, suppliers: parsed.value.suppliers, articles: parsed.value.articles, replyDueOn: parsed.value.replyDueOn, incoterm: parsed.value.incoterm, projectCode: project?.code ?? null },
      who.name,
    );
  } catch {
    return { error: await tr('The change could not be saved') };
  }
  refresh();
  return { toast: `${await tr(NEW_RFQ_RESULT)} · ${number}` };
}

// ── RFQ workflow ───────────────────────────────────────────────────────────────────────────────────────

/** "Send to suppliers" (row or drawer): Draft → Open. */
export async function sendRfqAction(number: string): Promise<SourcingActionResult> {
  const who = await editor();
  if ('error' in who) return who;
  if (!isRef(number)) return { error: await tr('Invalid request') };
  const r = await getRfq(number);
  if (!r) return { error: await tr('Unknown RFQ') };
  if (!rfqActions({ status: r.status, quoteCount: r.quotes.length, awardedTo: r.awardedTo }).canSend) return { error: await tr('This RFQ has already been sent') };
  try {
    await sendRfq(r.number, who.name);
  } catch {
    return { error: await tr('The change could not be saved') };
  }
  refresh();
  return { ok: true };
}

/** "Compare quotes" (row): Open with two quotes or more → Comparing. */
export async function compareRfqAction(number: string): Promise<SourcingActionResult> {
  const who = await editor();
  if ('error' in who) return who;
  if (!isRef(number)) return { error: await tr('Invalid request') };
  const r = await getRfq(number);
  if (!r) return { error: await tr('Unknown RFQ') };
  if (!rfqActions({ status: r.status, quoteCount: r.quotes.length, awardedTo: r.awardedTo }).canCompare) return { error: await tr('This RFQ cannot be compared now') };
  try {
    await compareRfqQuotes(r.number, who.name);
  } catch {
    return { error: await tr('The change could not be saved') };
  }
  refresh();
  return { ok: true };
}

/**
 * "Award" a quote (drawer): Comparing, no winner yet, by the project manager, procurement or the director. The DAL
 * drafts the purchase order (winner × part × quantity at the quoted price) when the RFQ has a project to order for.
 */
export async function awardRfqAction(number: string, supplier: string): Promise<SourcingActionResult> {
  const who = await editor();
  if ('error' in who) return who;
  if (!isRef(number) || typeof supplier !== 'string' || !supplier || supplier.length > 120) return { error: await tr('Invalid request') };
  const r = await getRfq(number);
  if (!r) return { error: await tr('Unknown RFQ') };
  if (!canAwardRfq({ status: r.status, quoteCount: r.quotes.length, awardedTo: r.awardedTo }, who.role)) {
    return { error: await tr(r.status === 'comparing' && !r.awardedTo ? 'Switch to Project manager or Procurement to award.' : 'This RFQ is not ready to award') };
  }
  if (!r.quotes.some((q) => q.supplier === supplier)) return { error: await tr('This supplier has not quoted') };
  let po: string | null;
  try {
    po = (await awardRfq(r.number, supplier, who.name)).purchaseOrderNumber;
  } catch {
    return { error: await tr('The change could not be saved') };
  }
  refresh();
  return { ok: true, toast: po ? `${await tr('Purchase order created as draft')} · ${po}` : undefined };
}

// ── Supplier invoices ──────────────────────────────────────────────────────────────────────────────────

type InvoiceDecision = 'approve' | 'approve_part' | 'reject';

async function decideInvoice(number: string, decision: InvoiceDecision): Promise<SourcingActionResult> {
  const who = await editor();
  if ('error' in who) return who;
  if (!canDecideInvoiceRole(who.role)) return { error: await tr('Supplier invoices are decided by procurement or the portfolio director') };
  if (!isRef(number)) return { error: await tr('Invalid request') };
  const i = await getSupplierInvoice(number);
  if (!i) return { error: await tr('Unknown invoice') };
  const d = invoiceDecisions(i.status, match3({ hasPo: !!i.poNumber, hasReceipt: !!i.receiptNumber, amountEur: i.amountEur, poAmountEur: i.poAmountEur, receiptAmountEur: i.receiptAmountEur }));
  const allowed = decision === 'approve' ? d.canApprove : decision === 'approve_part' ? d.canApprovePart : d.canReject;
  if (!allowed) return { error: await tr(decision === 'reject' ? 'This invoice can no longer be rejected' : 'This invoice is not matched for this approval') };
  try {
    await (decision === 'approve' ? approveInvoicePayment : decision === 'approve_part' ? approveInvoiceReceivedPart : rejectSupplierInvoice)(i.number, who.name);
  } catch {
    return { error: await tr('The change could not be saved') };
  }
  refresh();
  return { ok: true };
}

/** "Approve payment": Blocked / Awaiting receipt with order and receipt matched → Approved for payment. */
export async function approveInvoiceAction(number: string): Promise<SourcingActionResult> {
  return decideInvoice(number, 'approve');
}

/** "Approve received part": Blocked with a partial receipt → Approved for payment at the receipt amount, credit note requested. */
export async function approveInvoicePartAction(number: string): Promise<SourcingActionResult> {
  return decideInvoice(number, 'approve_part');
}

/** "Reject invoice": any open status → Rejected. */
export async function rejectInvoiceAction(number: string): Promise<SourcingActionResult> {
  return decideInvoice(number, 'reject');
}
