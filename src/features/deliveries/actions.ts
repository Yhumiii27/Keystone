'use server';
// Deliveries & goods receipt Server Functions (docs/spec/08 §3.5; SC-3, SC-4; 08 OQ8–9, OQ11, OQ28). Each one
// validates its raw input with the domain parsers (src/domain/deliveries.ts), checks the viewer may edit the screen
// for this project (not outside the workspace, not a read-only project) — and, for a quality decision, that the
// viewer records quality checks (quality manager, procurement, portfolio director) — writes through the data-layer
// writers with the viewer as the actor, then revalidates every screen the receipt touches (badges, stock, orders,
// invoices, My approvals). Messages come back translated, except the My approvals decision, whose English result
// the inbox shows with `toast.showEn` like the change-request decision.
import { revalidatePath } from 'next/cache';
import type { FormDialogResult } from '@/components/app/FormDialog';
import { QC_INBOX_ROLES, canDecideQc, parseAnnounceForm, parseRegisterForm, qcPlan, type QcDecision } from '@/domain/deliveries';
import { parseDateInput } from '@/domain/contract';
import { STATUS_ISO, receiptStatus, type ReceiptStatus } from '@/server/db/codes';
import {
  acceptReceipt, announceDelivery, attachReceiptDocument, getPutAwayOptions, getReceipt, listAnnounceableOrders, recordReceiptQc, registerReceipt, rejectReceipt,
  type ReceiptRow,
} from '@/server/dal/deliveries';
import { getProject } from '@/server/dal/projects';
import { getProjectContext, getScreenAccess } from '@/server/project-context';
import { invoiceStatusesOfReceipt, notifyReceiptDecision } from '@/server/dal/receipt-notices';
import { getI18n, type Viewer } from '@/server/session';
import { DECLARE_NCR_HINT, messageText, rejectedCountText, statusText } from './i18n';
import { logError } from '@/server/log';

export type DeliveryActionResult = { ok: true; status?: string; message?: string } | { ok: false; error: string };

const READ_ONLY = 'This delivery register is read-only for you';
const NOT_QC = 'Quality decisions belong to the quality manager and procurement';
const INVALID = 'Invalid request';
const FAILED = 'The change could not be saved';
const NUMBER_RE = /^BL-\d{4}-\d{4}$/;

/** Every screen a receipt touches: the project's pages and badges, Stock, Sourcing (invoices), My approvals. */
const refresh = () => revalidatePath('/', 'layout');

async function tr(english: string) {
  const { t, lang } = await getI18n();
  return messageText(english, t, lang);
}
const fail = async (english: string): Promise<{ ok: false; error: string }> => ({ ok: false, error: await tr(english) });

/** Resolves the project and the viewer's right to edit its Deliveries screen (and to record a quality check). */
async function access(code: unknown, need: 'edit' | 'qc'): Promise<{ code: string; viewer: Viewer } | { error: string }> {
  if (typeof code !== 'string' || !code) return { error: INVALID };
  const project = await getProject(code);
  if (!project) return { error: 'Unknown project' };
  const ctx = await getProjectContext(project.code, 'deliveries');
  if (!ctx.canEdit('deliveries')) return { error: READ_ONLY };
  if (need === 'qc' && !canDecideQc(ctx.viewer.role)) return { error: NOT_QC };
  return { code: project.code, viewer: ctx.viewer };
}

/** The receipt `number` of project `code`, or an error. */
async function receiptOf(code: string, number: unknown): Promise<ReceiptRow | { error: string }> {
  if (typeof number !== 'string' || !NUMBER_RE.test(number)) return { error: INVALID };
  const r = await getReceipt(number);
  if (!r || r.projectCode !== code) return { error: 'Unknown delivery' };
  return r;
}

/** Form values as sent by the client, keeping string entries only (a forged payload never reaches `.trim()`). */
const strings = (values: unknown): Record<string, string> =>
  values && typeof values === 'object' && !Array.isArray(values)
    ? Object.fromEntries(Object.entries(values).filter((e): e is [string, string] => typeof e[1] === 'string'))
    : {};

// ── Announce a delivery ────────────────────────────────────────────────────────────────────────────────

/**
 * Header primary "Announce a delivery" (SC-4): an Announced receipt BL-2026-0600… for what is still to come on the
 * chosen order; listed at once (the prototype stored it where nothing listed it). Returns the new number.
 */
export async function announceDeliveryAction(code: string, values: Record<string, string>): Promise<FormDialogResult & { number?: string }> {
  const ok = await access(code, 'edit');
  if ('error' in ok) return { error: await tr(ok.error) };
  const [orders, putAway] = await Promise.all([listAnnounceableOrders(ok.code), getPutAwayOptions(ok.code)]);
  if (!orders.length) return { error: await tr('No ordered purchase order is waiting for a delivery') };
  const parsed = parseAnnounceForm(strings(values), { orders: orders.map((o) => o.number), locations: putAway.locations, parseDate: (s) => parseDateInput(s) });
  if (!parsed.ok) return { error: await tr(parsed.error) };
  try {
    const number = await announceDelivery(ok.code, parsed.value, ok.viewer.name);
    refresh();
    return { toast: await tr(`Delivery ${number} announced`), number };
  } catch (e) {
    logError('announceDeliveryAction', e);
    return { error: await tr(FAILED) };
  }
}

// ── Register receipt ───────────────────────────────────────────────────────────────────────────────────

/** "Register receipt" (Announced → QC pending): delivered on, carrier, supplier delivery note, delivered per article. */
export async function registerReceiptAction(code: string, number: string, values: Record<string, string>): Promise<FormDialogResult> {
  const ok = await access(code, 'edit');
  if ('error' in ok) return { error: await tr(ok.error) };
  const r = await receiptOf(ok.code, number);
  if ('error' in r) return { error: await tr(r.error) };
  if (r.status !== 'announced') {
    refresh();
    return { error: await tr('This delivery is no longer waiting to be received') };
  }
  const parsed = parseRegisterForm(strings(values), r.lines, { today: STATUS_ISO, parseDate: (s) => parseDateInput(s) });
  if (!parsed.ok) return { error: await tr(parsed.error) };
  const v = parsed.value;
  try {
    await registerReceipt(r.number, { receivedOn: v.receivedOn, carrier: v.carrier, supplierDeliveryNote: v.supplierDeliveryNote, delivered: v.plan.delivered }, ok.viewer.name);
  } catch (e) {
    logError('registerReceiptAction', e);
    return { error: await tr(FAILED) };
  }
  refresh();
  return { toast: await tr(`${r.number} received · quality check to do`) };
}

// ── Quality check ──────────────────────────────────────────────────────────────────────────────────────

async function decide(code: string, number: unknown, decision: QcDecision, remarks: unknown, english: boolean): Promise<DeliveryActionResult> {
  const msg = async (s: string) => (english ? s : tr(s));
  const ok = await access(code, 'qc');
  if ('error' in ok) return { ok: false, error: await msg(ok.error) };
  const r = await receiptOf(ok.code, number);
  if ('error' in r) return { ok: false, error: await msg(r.error) };
  if (r.status !== 'qc_pending') {
    refresh(); // the row is stale
    return { ok: false, error: await msg('This delivery is no longer waiting for a quality check') };
  }
  const text = typeof remarks === 'string' ? remarks : '';
  // Same plan as the writer: an invalid split is refused with the domain's message before anything is written.
  const plan = qcPlan(r.lines, decision, text);
  if (!plan.ok) return { ok: false, error: await msg(plan.error) };
  // R-015 (X-6a): the invoices of the receipt or its order as the 3-way match sees them before the decision, to tell
  // who must know when one becomes blocked. Best effort: a failed read only loses that notice.
  const invoicesBefore = await invoiceStatusesOfReceipt(r).catch((e) => {
    logError('decideReceipt · invoices before QC', e);
    return null;
  });
  let status: ReceiptStatus;
  try {
    if (decision.mode === 'accept') status = await acceptReceipt(r.number, { remarks: text }, ok.viewer.name);
    else if (decision.mode === 'reject') status = await rejectReceipt(r.number, { remarks: text }, ok.viewer.name);
    else status = await recordReceiptQc(r.number, { lines: plan.value.lines, remarks: text }, ok.viewer.name);
  } catch (e) {
    logError('decideReceipt', e);
    return { ok: false, error: await msg(english ? 'The decision could not be saved' : FAILED) };
  }
  // R-096 / R-015: the buyer (else procurement) and the project's leads learn of rejected goods, the buyer and the director
  // of an invoice the match now blocks — after the commit, never undoing the decision (bell only, X-6).
  if (invoicesBefore) {
    try {
      await notifyReceiptDecision(r.number, invoicesBefore, ok.viewer);
    } catch (e) {
      logError('decideReceipt · notifications', e);
    }
  }
  refresh();
  const { t, lang } = await getI18n();
  const label = english ? receiptStatus.label(status) : statusText(status, t, lang);
  // On the Deliveries screen a rejection reminds to declare the supplier NCR in Vigie (R-096, NEW-D4-3); the My approvals
  // inbox (English, no Vigie link there) keeps the neutral message.
  const rejected = plan.value.rejected;
  const message = english || rejected <= 0
    ? `${r.number} · ${label}`
    : [r.number, label, messageText(rejectedCountText(rejected), t, lang), messageText(DECLARE_NCR_HINT, t, lang)].join(' · ');
  return { ok: true, status: label, message };
}

/** "Accept" / "Accept → stock" (row, drawer): every delivered unit accepted, released to the put-away location. */
export async function acceptReceiptAction(code: string, number: string, remarks?: string): Promise<DeliveryActionResult> {
  return decide(code, number, { mode: 'accept' }, remarks, false);
}

/** "Reject" / "Reject → quarantine" (row, drawer): every delivered unit rejected to the quarantine zone. */
export async function rejectReceiptAction(code: string, number: string, remarks?: string): Promise<DeliveryActionResult> {
  return decide(code, number, { mode: 'reject' }, remarks, false);
}

/** "Partial rejection" (drawer, 08 OQ9): rejected quantity per article, the rest accepted. */
export async function recordPartialQcAction(code: string, number: string, rejected: Record<string, string>, remarks?: string): Promise<DeliveryActionResult> {
  return decide(code, number, { mode: 'lines', rejected: strings(rejected) }, remarks, false);
}

/**
 * Inline Approve / Reject of a "Delivery — quality check" row in My approvals (08 §7.5; the prototype's call threw,
 * 08 OQ28): the same Accept → stock / Reject → quarantine, default remarks. Only the inbox's QC roles (quality
 * manager, procurement) decide from the inbox. English result (the inbox translates it).
 */
export async function decideReceiptFromInboxAction(input: { projectCode: string; number: string; decision: string }): Promise<DeliveryActionResult> {
  const { canEdit, viewer } = await getScreenAccess('myapprovals');
  if (!canEdit || !QC_INBOX_ROLES.includes(viewer.role)) return { ok: false, error: 'Read-only — you cannot decide from this inbox' };
  const decision = input?.decision === 'ok' ? 'accept' : input?.decision === 'rejected' ? 'reject' : null;
  const code = typeof input?.projectCode === 'string' ? input.projectCode.trim() : '';
  if (!decision || !/^[A-Z]{3}-\d{3}$/.test(code)) return { ok: false, error: INVALID };
  return decide(code, input.number, { mode: decision }, '', true);
}

// ── Documents ──────────────────────────────────────────────────────────────────────────────────────────

/** "Attach delivery note": the chosen file's name on the receipt (file storage comes with the Codex hand-off, D-1). */
export async function attachDeliveryNoteAction(code: string, number: string, fileName: string): Promise<DeliveryActionResult> {
  const ok = await access(code, 'edit');
  if ('error' in ok) return fail(ok.error);
  const r = await receiptOf(ok.code, number);
  if ('error' in r) return fail(r.error);
  const name = typeof fileName === 'string' ? fileName.replace(/[\\/]/g, ' ').trim().slice(0, 160) : '';
  if (!name) return fail('Choose a file to attach');
  try {
    await attachReceiptDocument(r.number, name, ok.viewer.name);
  } catch (e) {
    logError('attachDeliveryNoteAction', e);
    return fail(FAILED);
  }
  refresh();
  return { ok: true, message: await tr(`${name} attached to ${r.number}`) };
}
