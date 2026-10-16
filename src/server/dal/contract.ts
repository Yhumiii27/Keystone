import 'server-only';
// Contract & Billing DAL (docs/spec/04 §3 Contract, §4 Billing, §1.6 Budget › Cash & recovery; 11 §3.5, §7 #3).
// The contract is the billing source of truth (OPEN QUESTION A-5): its value is the base amount plus the signed
// amendments. Payment milestones of the base contract are priced on the base amount, an amendment's own milestones on the
// amendment's amount and become billable when it is signed (NEW-D3-3, R-079); an invoiced milestone keeps its invoice's
// amount. Customer invoices are 1:1 with the invoiced milestones and fall due by the contract's payment rule (C-6, R-076).
// Every amount is in the contract's currency (C-9, R-075); `getCashContract` consolidates them in euros at the project's
// budget rate for Budget › Cash & recovery. The figures are computed by `contractFigures` (src/domain/contract.ts) — one
// rule for the screens and every reader. Late milestone = planned, billable and contractual date before the business date's
// month (the prototype's PG_NOW); overdue invoice = awaiting payment and due before the business date (the prototype's NOWD,
// 30 Sep 2026). R-013: the business date comes from the clock (`businessToday`), resolved once per read or write.
import { and, asc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import {
  INVOICE_BLOCKED_MESSAGE, canSendAmendment, canSignAmendment, contractFigures, invoiceBlocked, isSignedAmendment, plannedMilestoneAmount, termsOfSheet,
  type ContractFigures, type ContractInput,
} from '@/domain/contract';
import { BASE_CURRENCY, currencyOf, documentCurrencyError, eurRate, projectFxOf, type CurrencyCode, type ProjectFx } from '@/domain/currency';
import { isPaymentRule, paymentDueOn, paymentTermsText, termsOfText, type PaymentRule } from '@/domain/payment-terms';
import { businessToday } from '@/server/clock';
import { getDb } from '@/server/db/client';
import {
  amendmentStatus, beforePgNow, bondType, contractType, customerInvoiceStatus, displayOfIso, nextBusinessNumber,
  paymentMilestoneStatus, shortDateYearOfIso,
  type AmendmentStatus, type BondType, type ContractType, type CustomerInvoiceStatus, type PaymentMilestoneStatus,
} from '@/server/db/codes';
import { findPerson, nameOf, recordActivity, requireProject, writeAudit } from '@/server/db/helpers';
import {
  auditEntries, changeRequests, clients, contractAmendments, contractBonds, contracts, customerInvoices, documents, paymentMilestones, projectControls, projects,
} from '@/server/db/schema';
import type { Tx } from '@/server/db/types';
import type { Actor } from './ops-common';
import { editsContract } from './team-guard';

// ── Read model ─────────────────────────────────────────────────────────────────────────────────────────

/** The editable contract sheet (CTR_FIELDS 4873). */
export interface ContractSheet {
  /** "CTR-HLT-001" — also a Codex document number. */
  reference: string;
  /** The Codex record of the reference exists in the index ("Open contract" opens it). */
  documentIndexed: boolean;
  client: string;
  type: ContractType;
  /** "Lump sum (EPC)". */
  typeLabel: string;
  signedOn: string | null;
  /** "14 Jan 2026" (as the sheet shows it). */
  signedText: string;
  /** Thousands of the contract currency. */
  baseAmountKeur: number;
  /** C-9: the contract's currency. */
  currency: CurrencyCode;
  /** "Net 45 days" (EN, rebuilt from the rule). */
  paymentTerms: string;
  /** C-6: payment rule and N (calendar days). */
  paymentRule: PaymentRule;
  paymentDays: number;
  /** N of the rule (the prototype's "payment delay"). */
  termsDays: number;
  retentionPct: number;
  retentionNote: string;
  /** "0.5 % per week · cap 10 %". */
  liquidatedDamages: string;
  warranty: string;
  governingLaw: string;
  scope: string;
}

export interface AmendmentRow {
  position: number;
  /** "Amendment 1 — anti-collision lidar (CR-004)". */
  label: string;
  subject: string;
  changeRequestRef: string | null;
  /** The referenced change request exists on the project. */
  changeRequestLinked: boolean;
  amountKeur: number;
  status: AmendmentStatus;
  statusLabel: string;
  signed: boolean;
  /** Day it was sent for signature (R-079). */
  sentOn: string | null;
  signedOn: string | null;
  /** "8 Jul 2026" or "—". */
  dateText: string;
  documentRef: string | null;
  documentIndexed: boolean;
  /** R-079 transitions offered: draft → "Send for signature"; sent / awaiting → "Mark signed". */
  canSend: boolean;
  canSign: boolean;
}

export interface BondRow {
  position: number;
  type: BondType;
  /** "Performance bond" (+ " · issuer" for bonds registered with an issuer). */
  label: string;
  issuer: string | null;
  amountKeur: number;
  validUntil: string | null;
  releasedOn: string | null;
  inForce: boolean;
  /** "Valid → 30 Jun 2027" / "Released 12 Sep 2026". */
  stateText: string;
}

export interface CustomerInvoiceRow {
  /** "INV-2026-003". */
  number: string;
  milestoneNumber: string;
  milestoneLabel: string;
  issuedOn: string;
  /** "26 Sep" (year only when ≠ 2026, `fmtInvD`). */
  issuedText: string;
  /** Amount invoiced at issue (thousands of `currency`). */
  amountKeur: number;
  currency: CurrencyCode;
  /** Due by the contract's payment rule (R-076). */
  dueOn: string;
  dueText: string;
  paidOn: string | null;
  /** "2 Apr" or "—". */
  paidText: string;
  /** Amount of the invoice (always issued in Keystone with an amount). */
  note: string | null;
  status: CustomerInvoiceStatus;
  statusLabel: string;
  overdue: boolean;
}

export interface ContractMilestoneRow {
  /** "M3". */
  number: string;
  label: string;
  /** Share of the base amount, or of the amendment's amount (`amendment`). */
  sharePct: number;
  /** Invoiced amount once invoiced, else round(basis × share / 100) — thousands of the contract currency. */
  amountKeur: number;
  /** Position of the amendment the milestone belongs to (NEW-D3-3); null = base contract. */
  amendment: number | null;
  /** Base-contract milestone or milestone of a signed amendment: billable, counted in the billing plan. */
  billable: boolean;
  contractualDue: string | null;
  /** "26 Sep 2026" (as stored on the contract). */
  dueText: string;
  condition: string | null;
  status: PaymentMilestoneStatus;
  statusLabel: string;
  /** Planned, billable and contractual date before the prototype's now (Billing badge, "· Late"). */
  late: boolean;
  /** Delivery 8 (R-077, C-7): its schedule group exceeds 100 % — "Issue invoice" is refused until the schedule is corrected. */
  blocked: boolean;
  /** Invoice of an invoiced / paid milestone. */
  invoice: CustomerInvoiceRow | null;
}

export interface ProjectContract {
  projectCode: string;
  sheet: ContractSheet;
  /** C-9: project currency and budget rate (consolidation in euros). */
  fx: ProjectFx;
  amendments: AmendmentRow[];
  bonds: BondRow[];
  /** Every payment milestone (base contract and amendments), contractual order. */
  milestones: ContractMilestoneRow[];
  /** Invoices in milestone order. */
  invoices: CustomerInvoiceRow[];
  /** Base + signed amendments (`ctrTotal`), thousands of the contract currency. */
  valueKeur: number;
  signedAmendments: { count: number; amountKeur: number };
  pendingAmendments: { count: number; amountKeur: number };
  bondsInForce: { count: number; total: number; amountKeur: number };
  /** Σ invoiced / paid billable milestones (`ctrInvoiced`, `ctrPaid`) and the retention held (paid × retention %, C-8). */
  invoicedKeur: number;
  paidKeur: number;
  retentionKeur: number;
  /** Σ shares (%) of the base contract's milestones, 100 when its schedule is complete. */
  sharePctTotal: number;
  /** Next invoice number proposed by "Issue invoice" ("INV-2026-004", the business date's year). */
  nextInvoiceNumber: string;
  /** R-013: business date the figures were computed at (late, overdue, the invoice date proposed). */
  today: string;
  /** Planned milestones whose contractual date has passed (Billing nav badge). */
  lateCount: number;
  /** A customer invoice exists: the contract's currency can no longer change. */
  hasInvoices: boolean;
}

/** R-013: invoice numbers follow the business date's year ("INV-2026-"). */
const invoicePrefix = (today: string) => `INV-${today.slice(0, 4)}-`;
const dash = (iso: string | null, f: (s: string) => string) => (iso ? f(iso) : '—');
/** ISO 'YYYY-MM-DD' of a real calendar day. */
const isIso = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(Date.parse(v + 'T00:00:00Z')) && new Date(v + 'T00:00:00Z').toISOString().slice(0, 10) === v;
function isoOrNull(v: string | null | undefined, what: string): string | null {
  if (v == null || v === '') return null;
  if (!isIso(v)) throw new Error(`Invalid ${what}`);
  return v;
}

/** Contract of a project with its amendments, bonds, payment schedule and invoices; null when none is registered. */
export async function getContract(projectCode: string): Promise<ProjectContract | null> {
  const db = await getDb();
  const today = await businessToday();
  const [row] = await db
    .select({ c: contracts, docId: documents.id, currency: projects.currency, budgetRate: projects.budgetRate })
    .from(contracts)
    .innerJoin(projects, eq(projects.id, contracts.projectId))
    .leftJoin(documents, eq(documents.number, contracts.reference))
    .where(eq(projects.code, projectCode));
  if (!row) return null;
  const c = row.c;
  const [ams, bonds, ms, invs] = await Promise.all([
    db.select({ a: contractAmendments, crId: changeRequests.id, docId: documents.id }).from(contractAmendments)
      .leftJoin(changeRequests, eq(changeRequests.id, contractAmendments.changeRequestId))
      .leftJoin(documents, eq(documents.number, contractAmendments.documentRef))
      .where(eq(contractAmendments.contractId, c.id)).orderBy(asc(contractAmendments.position)),
    db.select().from(contractBonds).where(eq(contractBonds.contractId, c.id)).orderBy(asc(contractBonds.position)),
    db.select().from(paymentMilestones).where(eq(paymentMilestones.contractId, c.id)).orderBy(asc(paymentMilestones.position)),
    db.select({ i: customerInvoices }).from(customerInvoices).innerJoin(paymentMilestones, eq(paymentMilestones.id, customerInvoices.paymentMilestoneId))
      .where(eq(paymentMilestones.contractId, c.id)),
  ]);
  const currency = currencyOf(c.currency);
  const terms = { rule: isPaymentRule(c.paymentRule) ? c.paymentRule : 'net' as const, days: c.paymentDays };
  const amendmentPos = new Map(ams.map(({ a }) => [a.id, a.position]));
  const invByMs = new Map(invs.map(({ i }) => [i.paymentMilestoneId, i]));
  const input: ContractInput = {
    sheet: {
      reference: c.reference, baseAmountKeur: c.baseAmountKeur, currency, paymentTerms: c.paymentTerms, paymentRule: terms.rule, paymentDays: terms.days,
      retentionPct: c.retentionPct, retentionNote: c.retentionNote, liquidatedDamages: c.liquidatedDamages, warranty: c.warranty,
    },
    amendments: ams.map(({ a }) => ({
      position: a.position, label: a.subject + (a.changeRequestRef ? ` (${a.changeRequestRef})` : ''), amountKeur: a.amountKeur, status: a.status,
      signedOn: a.signedOn, documentRef: a.documentRef,
    })),
    bonds: bonds.map((b) => ({ type: b.type, issuer: b.issuer, amountKeur: b.amountKeur, validUntil: b.validUntil, releasedOn: b.releasedOn })),
    milestones: ms.map((m) => {
      const inv = invByMs.get(m.id);
      return {
        number: m.number ?? '', label: m.label, sharePct: m.sharePct ?? 0, contractualDue: m.contractualDue, condition: m.condition, status: m.status,
        invoice: inv ? { number: inv.number, issuedOn: inv.issuedOn, paidOn: inv.paidOn, note: inv.note, amountKeur: inv.amountKeur } : null,
        amendment: m.amendmentId ? amendmentPos.get(m.amendmentId) ?? null : null,
      };
    }),
  };
  const fig = contractFigures(input, today);
  const amendments: AmendmentRow[] = ams.map(({ a, crId, docId }) => ({
    position: a.position, label: a.subject + (a.changeRequestRef ? ` (${a.changeRequestRef})` : ''), subject: a.subject, changeRequestRef: a.changeRequestRef,
    changeRequestLinked: !!crId, amountKeur: a.amountKeur, status: a.status, statusLabel: amendmentStatus.label(a.status), signed: isSignedAmendment(a),
    sentOn: a.sentOn, signedOn: a.signedOn, dateText: dash(a.signedOn, displayOfIso), documentRef: a.documentRef, documentIndexed: !!docId,
    canSend: canSendAmendment(a.status), canSign: canSignAmendment(a.status),
  }));
  const bondRows: BondRow[] = bonds.map((b) => ({
    position: b.position, type: b.type, label: bondType.label(b.type) + (b.issuer ? ` · ${b.issuer}` : ''), issuer: b.issuer, amountKeur: b.amountKeur,
    validUntil: b.validUntil, releasedOn: b.releasedOn, inForce: !b.releasedOn,
    stateText: b.releasedOn ? `Released ${displayOfIso(b.releasedOn)}` : `Valid → ${dash(b.validUntil, displayOfIso)}`,
  }));
  const invoiceOf = new Map(fig.invoices.map((i) => [i.milestone, i]));
  const milestones: ContractMilestoneRow[] = fig.milestones.map((m, k) => {
    const i = invoiceOf.get(m.number);
    const stored = invByMs.get(ms[k].id);
    return {
      number: m.number, label: m.label, sharePct: m.sharePct, amountKeur: m.amountKeur, amendment: m.amendment ?? null, billable: m.billable,
      contractualDue: m.contractualDue, dueText: dash(m.contractualDue, displayOfIso), condition: m.condition, status: m.status,
      statusLabel: paymentMilestoneStatus.label(m.status), late: m.late, blocked: m.blocked,
      invoice: i ? {
        number: i.number, milestoneNumber: m.number, milestoneLabel: m.label, issuedOn: i.issuedOn, issuedText: shortDateYearOfIso(i.issuedOn),
        amountKeur: i.amountKeur, currency: currencyOf(stored?.currency ?? currency), dueOn: i.dueOn, dueText: shortDateYearOfIso(i.dueOn),
        paidOn: i.paidOn, paidText: dash(i.paidOn, shortDateYearOfIso), note: i.note, status: i.status, statusLabel: customerInvoiceStatus.label(i.status), overdue: i.overdue,
      } : null,
    };
  });
  const allNumbers = (await db.select({ n: customerInvoices.number }).from(customerInvoices)).map((r) => r.n);
  return {
    projectCode,
    sheet: {
      reference: c.reference, documentIndexed: !!row.docId, client: c.clientName, type: c.type, typeLabel: contractType.label(c.type), signedOn: c.signedOn,
      signedText: c.signedOn ? displayOfIso(c.signedOn) : '', baseAmountKeur: c.baseAmountKeur, currency, paymentTerms: paymentTermsText(terms),
      paymentRule: terms.rule, paymentDays: terms.days, termsDays: terms.days,
      retentionPct: c.retentionPct, retentionNote: c.retentionNote, liquidatedDamages: c.liquidatedDamages, warranty: c.warranty, governingLaw: c.governingLaw, scope: c.scope,
    },
    fx: projectFxOf({ currency: row.currency, budgetRate: row.budgetRate }),
    amendments,
    bonds: bondRows,
    milestones,
    invoices: milestones.flatMap((m) => (m.invoice ? [m.invoice] : [])),
    valueKeur: fig.valueKeur,
    signedAmendments: fig.signed,
    pendingAmendments: fig.pending,
    bondsInForce: { count: fig.bonds.live, total: fig.bonds.total, amountKeur: fig.bonds.liveAmountKeur },
    invoicedKeur: fig.invoicedKeur,
    paidKeur: fig.paidKeur,
    retentionKeur: fig.retentionKeur,
    sharePctTotal: Math.round(fig.sharePct * 10) / 10,
    nextInvoiceNumber: nextBusinessNumber(allNumbers, invoicePrefix(today), 3),
    today,
    lateCount: fig.lateCount,
    hasInvoices: invs.length > 0,
  };
}

/** The domain figures of a loaded contract (the screens' model input shape). */
export type { ContractFigures };

/** Contract reference and terms of a project (breadcrumb extras of Contract and Billing); null without a contract. */
export async function getContractHeader(projectCode: string): Promise<{ reference: string; paymentTerms: string } | null> {
  const db = await getDb();
  const [r] = await db
    .select({ reference: contracts.reference, rule: contracts.paymentRule, days: contracts.paymentDays })
    .from(contracts)
    .innerJoin(projects, eq(projects.id, contracts.projectId))
    .where(eq(projects.code, projectCode));
  return r ? { reference: r.reference, paymentTerms: paymentTermsText({ rule: isPaymentRule(r.rule) ? r.rule : 'net', days: r.days }) } : null;
}

/** Late planned milestones per project code (Billing nav badge, `ctrBadge`) — billable ones only (base contract or signed amendment). */
export async function lateBillingMilestonesByProject(): Promise<Record<string, number>> {
  const db = await getDb();
  const today = await businessToday();
  const rows = await db
    .select({ code: projects.code, due: paymentMilestones.contractualDue, amendmentStatus: contractAmendments.status, amendmentId: paymentMilestones.amendmentId })
    .from(paymentMilestones)
    .innerJoin(projects, eq(projects.id, paymentMilestones.projectId))
    .leftJoin(contractAmendments, eq(contractAmendments.id, paymentMilestones.amendmentId))
    .where(and(isNotNull(paymentMilestones.contractId), eq(paymentMilestones.status, 'planned')));
  const out: Record<string, number> = {};
  for (const r of rows) if ((!r.amendmentId || r.amendmentStatus === 'signed') && beforePgNow(r.due, today)) out[r.code] = (out[r.code] ?? 0) + 1;
  return out;
}

/** Contract figures read by Budget › Cash & recovery (04 §1.6), consolidated in euros at the project's budget rate (C-9). */
export interface CashContract {
  reference: string;
  /** Base amount (k€) and amendments with their signed flag, in euros. */
  amount: number;
  /** "Net 45 days" (EN). */
  terms: string;
  amendments: { label: string; amount: number; signed: boolean }[];
  /**
   * Billable payment milestones in the `@/domain/evm` shape (display dates "26 Sep" / "14 Dec 2026"), with their amount in
   * euros (NEW-D3-3: no longer value × share) and the payment date of the contract's rule (R-076).
   */
  milestones: {
    id: string; label: string; pct: number; due: string; status: PaymentMilestoneStatus; invoiced: string | null; paid: string | null;
    amount: number; paymentDue: string | null;
  }[];
  /** Orders placed not yet in actual cost (project controls), null → the planned-value rule. */
  openCommit: number | null;
}

/** Shape consumed by `cashRecovery()` — retires the Budget screen's prototype read of CONTRACTS. */
export async function getCashContract(projectCode: string): Promise<CashContract | null> {
  const c = await getContract(projectCode);
  if (!c) return null;
  const db = await getDb();
  const [pc] = await db
    .select({ orders: projectControls.ordersPlacedKeur })
    .from(projectControls)
    .innerJoin(projects, eq(projects.id, projectControls.projectId))
    .where(eq(projects.code, projectCode));
  const rate = eurRate(c.sheet.currency, c.fx);
  const terms = termsOfSheet(c.sheet);
  return {
    reference: c.sheet.reference,
    amount: c.sheet.baseAmountKeur * rate,
    terms: c.sheet.paymentTerms,
    amendments: c.amendments.map((a) => ({ label: a.label, amount: a.amountKeur * rate, signed: a.signed })),
    milestones: c.milestones.filter((m) => m.billable).map((m) => ({
      id: m.number, label: m.label, pct: m.sharePct, due: m.dueText, status: m.status,
      invoiced: m.invoice ? m.invoice.issuedText : null, paid: m.invoice?.paidOn ? m.invoice.paidText : null,
      amount: m.amountKeur * rate,
      // Expected payment: the invoice's due date, else the contractual date + the rule (an undated milestone has none).
      paymentDue: m.invoice ? shortDateYearOfIso(m.invoice.dueOn) : m.contractualDue ? shortDateYearOfIso(paymentDueOn(m.contractualDue, terms)) : null,
    })),
    openCommit: pc?.orders ?? null,
  };
}

// ── Writers ────────────────────────────────────────────────────────────────────────────────────────────

/**
 * The project and its contract, the contract row locked for the transaction: the writers serialise on it, so a currency change
 * cannot cross an invoice being issued, nor two additions draw the same milestone number (PostgreSQL; PGlite is single-writer).
 */
async function loadContract(tx: Tx, projectCode: string) {
  const p = await requireProject(tx, projectCode);
  const [c] = await tx.select().from(contracts).where(eq(contracts.projectId, p.id)).for('update');
  if (!c) throw new Error(`No contract registered for ${projectCode}`);
  return { p, c };
}

async function audit(tx: Tx, actorName: string, objectRef: string, change: string, projectId: string, area = 'Contract', entity?: { type: string; id: string }) {
  const actor = await findPerson(tx, actorName);
  await writeAudit(tx, {
    actorName: actor ? nameOf(actor) : actorName, actorPersonId: actor?.id, objectRef, change, area, entityType: entity?.type ?? null, entityId: entity?.id ?? null, projectId,
  });
  return actor;
}

/** Audit row + activity event of a contract writer (R-079 transitions, rate and currency changes). */
async function trace(tx: Tx, actorName: string, objectRef: string, change: string, activity: string, projectId: string, entity?: { type: string; id: string }) {
  const actor = await audit(tx, actorName, objectRef, change, projectId, 'Contract', entity);
  await recordActivity(tx, { actorName: actor ? nameOf(actor) : actorName, actorPersonId: actor?.id, text: activity, kind: 'change', projectId });
}

export interface ContractSheetPatch {
  reference?: string;
  client?: string;
  type?: ContractType;
  /** ISO date or null. */
  signedOn?: string | null;
  baseAmountKeur?: number;
  /** C-9: EUR or the project currency (with a budget rate), while no invoice is issued. */
  currency?: CurrencyCode;
  /** C-6: payment rule and N; the terms text is rebuilt from them. */
  paymentRule?: PaymentRule;
  paymentDays?: number;
  /** Legacy free text ("Net 30 days", "45 days end of month"): read into the rule and N. */
  paymentTerms?: string;
  retentionPct?: number;
  retentionNote?: string;
  liquidatedDamages?: string;
  warranty?: string;
  governingLaw?: string;
  scope?: string;
}

const SHEET_COLUMN = {
  reference: 'reference', client: 'clientName', type: 'type', signedOn: 'signedOn', baseAmountKeur: 'baseAmountKeur', currency: 'currency',
  paymentRule: 'paymentRule', paymentDays: 'paymentDays', paymentTerms: 'paymentTerms',
  retentionPct: 'retentionPct', retentionNote: 'retentionNote', liquidatedDamages: 'liquidatedDamages', warranty: 'warranty', governingLaw: 'governingLaw', scope: 'scope',
} as const satisfies Record<keyof ContractSheetPatch, keyof typeof contracts.$inferSelect>;

/**
 * Contract sheet edits (`setCtr`, saved per field): validates amounts (≥ 0), retention (0–100), the type code, the reference
 * (non-empty, unique), the currency (C-9: EUR or the project currency with a budget rate, and only while no invoice is issued)
 * and the payment rule and days (C-6; the terms text follows). Changing the base amount re-prices the planned base milestones
 * (invoiced ones keep their amount); the rule changes the due dates. Writes one audit row with the changed fields.
 */
export async function updateContractSheet(projectCode: string, patch: ContractSheetPatch, actorName: string): Promise<void> {
  const db = await getDb();
  await db.transaction(async (tx) => {
    const { p, c } = await loadContract(tx, projectCode);
    const input: ContractSheetPatch = { ...patch };
    if (input.paymentTerms !== undefined) {
      const t = termsOfText(input.paymentTerms);
      input.paymentRule ??= t.rule;
      input.paymentDays ??= t.days;
      delete input.paymentTerms;
    }
    const set: Partial<typeof contracts.$inferInsert> = {};
    const changes: string[] = [];
    for (const [k, col] of Object.entries(SHEET_COLUMN) as [keyof ContractSheetPatch, keyof typeof contracts.$inferSelect][]) {
      if (!(k in input) || k === 'paymentTerms') continue;
      let v = input[k];
      if (typeof v === 'string' && k !== 'signedOn') v = v.trim();
      if ((k === 'baseAmountKeur' || k === 'retentionPct') && (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || (k === 'retentionPct' && v > 100)))
        throw new Error(`Invalid ${k}`);
      if (k === 'type' && !contractType.isCode(v)) throw new Error('Invalid contract type');
      if (k === 'reference' && !v) throw new Error('The reference is required');
      if (k === 'signedOn') v = isoOrNull(v as string | null, 'signature date');
      if (k === 'paymentRule' && !isPaymentRule(v)) throw new Error('Invalid payment rule');
      if (k === 'paymentDays' && !(Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 180)) throw new Error('Invalid payment days');
      if (k === 'currency') {
        // The project row locked: its currency cannot change under this document (setProjectBudgetRate locks it too).
        const [proj] = await tx.select({ currency: projects.currency, budgetRate: projects.budgetRate }).from(projects).where(eq(projects.id, p.id)).for('update');
        const err = documentCurrencyError(v, projectFxOf(proj));
        if (err) throw new Error(err);
        if (v !== c.currency) {
          const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(customerInvoices)
            .innerJoin(paymentMilestones, eq(paymentMilestones.id, customerInvoices.paymentMilestoneId)).where(eq(paymentMilestones.contractId, c.id));
          if (n > 0) throw new Error('The currency cannot change once an invoice is issued');
        }
      }
      const old = c[col];
      if (old === v) continue;
      (set as Record<string, unknown>)[col] = v;
      changes.push(`${k}: ${old ?? '—'} → ${v ?? '—'}`);
    }
    if (!changes.length) return;
    if ('paymentRule' in set || 'paymentDays' in set) {
      set.paymentTerms = paymentTermsText({ rule: (set.paymentRule ?? c.paymentRule) as PaymentRule, days: set.paymentDays ?? c.paymentDays });
    }
    if (set.clientName) set.clientId = (await tx.select({ id: clients.id }).from(clients).where(eq(clients.name, set.clientName)))[0]?.id ?? null;
    if (set.reference) set.documentId = (await tx.select({ id: documents.id }).from(documents).where(eq(documents.number, set.reference)))[0]?.id ?? null;
    await tx.update(contracts).set({ ...set, updatedAt: new Date() }).where(eq(contracts.id, c.id));
    await audit(tx, actorName, c.reference, changes.join(' · '), p.id, 'Contract', { type: 'contract', id: c.id });
  });
}

export interface NewAmendment {
  subject: string;
  changeRequestRef?: string | null;
  amountKeur: number;
  status: AmendmentStatus;
  /** ISO signature date (required when signed). */
  signedOn?: string | null;
  documentRef?: string | null;
}

/**
 * "Add amendment" (AF.amendment): appended; a signed one raises the contract value — not the existing milestones
 * (NEW-D3-3: the amendment's own milestones carry its amount). Returns its label.
 */
export async function addAmendment(projectCode: string, input: NewAmendment, actorName: string): Promise<string> {
  const db = await getDb();
  const today = await businessToday();
  return db.transaction(async (tx) => {
    const { p, c } = await loadContract(tx, projectCode);
    const subject = input.subject.trim();
    if (!subject) throw new Error('The subject is required');
    if (!Number.isFinite(input.amountKeur)) throw new Error('Invalid amount');
    if (!amendmentStatus.isCode(input.status)) throw new Error('Invalid status');
    const signedOn = isoOrNull(input.signedOn, 'signature date');
    if (input.status === 'signed' && !signedOn) throw new Error('A signed amendment needs its signature date');
    const crRef = input.changeRequestRef?.trim() || null;
    const docRef = input.documentRef?.trim() || null;
    const [cr] = crRef ? await tx.select({ id: changeRequests.id }).from(changeRequests).where(and(eq(changeRequests.projectId, p.id), eq(changeRequests.number, crRef))) : [];
    const [doc] = docRef ? await tx.select({ id: documents.id }).from(documents).where(eq(documents.number, docRef)) : [];
    const [{ maxPos }] = await tx.select({ maxPos: sql<number>`coalesce(max(${contractAmendments.position}), -1)::int` }).from(contractAmendments).where(eq(contractAmendments.contractId, c.id));
    const [a] = await tx
      .insert(contractAmendments)
      .values({
        contractId: c.id, position: maxPos + 1, subject, changeRequestRef: crRef, changeRequestId: cr?.id ?? null, amountKeur: input.amountKeur, status: input.status,
        sentOn: input.status === 'draft' ? null : today, signedOn, documentRef: docRef, documentId: doc?.id ?? null,
      })
      .returning({ id: contractAmendments.id });
    const label = subject + (crRef ? ` (${crRef})` : '');
    await audit(tx, actorName, c.reference, `amendment registered · ${label} · ${input.amountKeur} k${c.currency === BASE_CURRENCY ? '€' : ' ' + c.currency} · ${amendmentStatus.label(input.status)}`, p.id, 'Contract', { type: 'contract_amendment', id: a.id });
    return label;
  });
}

async function amendmentAt(tx: Tx, contractId: string, position: number) {
  if (!Number.isInteger(position) || position < 0) throw new Error('Unknown amendment');
  const [a] = await tx.select().from(contractAmendments).where(and(eq(contractAmendments.contractId, contractId), eq(contractAmendments.position, position)));
  if (!a) throw new Error('Unknown amendment');
  return a;
}

/**
 * "Send for signature" (R-079): a draft amendment goes to the client — Draft → Sent for signature, dated `on` (default the
 * business date, the prototype's NOWD; R-013). The
 * status is checked and changed in one guarded UPDATE, so two clicks cannot both succeed. Returns its label.
 */
export async function sendAmendmentForSignature(projectCode: string, position: number, actorName: string, onDate?: string): Promise<string> {
  const db = await getDb();
  const on = onDate ?? (await businessToday());
  return db.transaction(async (tx) => {
    const { p, c } = await loadContract(tx, projectCode);
    const a = await amendmentAt(tx, c.id, position);
    if (!isIso(on)) throw new Error('Invalid date');
    const [done] = await tx.update(contractAmendments).set({ status: 'sent_for_signature', sentOn: on, updatedAt: new Date() })
      .where(and(eq(contractAmendments.id, a.id), eq(contractAmendments.status, 'draft'))).returning({ id: contractAmendments.id });
    if (!done) throw new Error('Only a draft amendment can be sent for signature');
    const label = a.subject + (a.changeRequestRef ? ` (${a.changeRequestRef})` : '');
    await trace(tx, actorName, c.reference, `amendment ${label} · status: Draft → Sent for signature`, `Sent ${label} for signature`, p.id, { type: 'contract_amendment', id: a.id });
    return label;
  });
}

export interface SignAmendmentInput {
  /** ISO signature date. */
  signedOn: string;
  /** Codex number of the signed amendment. */
  documentRef?: string | null;
}

/**
 * "Mark signed" (R-079): an amendment sent for signature (or awaiting it) is signed on `signedOn` — it adds its amount to the
 * contract value and its own milestones become billable (NEW-D3-3); the existing milestones do not move. Guarded UPDATE.
 */
export async function signAmendment(projectCode: string, position: number, input: SignAmendmentInput, actorName: string): Promise<string> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const { p, c } = await loadContract(tx, projectCode);
    const a = await amendmentAt(tx, c.id, position);
    if (!isIso(input.signedOn)) throw new Error('Invalid signature date');
    const docRef = input.documentRef?.trim() || a.documentRef || null;
    if (docRef && docRef.length > 60) throw new Error('Reference is too long');
    const [doc] = docRef ? await tx.select({ id: documents.id }).from(documents).where(eq(documents.number, docRef)) : [];
    const [done] = await tx.update(contractAmendments)
      .set({ status: 'signed', signedOn: input.signedOn, documentRef: docRef, documentId: doc?.id ?? null, updatedAt: new Date() })
      .where(and(eq(contractAmendments.id, a.id), inArray(contractAmendments.status, ['sent_for_signature', 'awaiting_signature'])))
      .returning({ id: contractAmendments.id });
    if (!done) throw new Error('Only an amendment sent for signature can be signed');
    const label = a.subject + (a.changeRequestRef ? ` (${a.changeRequestRef})` : '');
    const unit = c.currency === BASE_CURRENCY ? 'k€' : `k ${c.currency}`;
    await trace(tx, actorName, c.reference, `amendment ${label} · status: ${amendmentStatus.label(a.status)} → Signed · ${input.signedOn}${docRef ? ` · ${docRef}` : ''}`,
      `Signed ${label} · ${a.amountKeur >= 0 ? '+' : '−'}${Math.abs(a.amountKeur)} ${unit}`, p.id, { type: 'contract_amendment', id: a.id });
    return label;
  });
}

/** "Release" of a bond in force (R-079): released on `releasedOn` (no longer counted in force). Guarded UPDATE. Returns its label. */
export async function releaseBond(projectCode: string, position: number, releasedOn: string, actorName: string): Promise<string> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const { p, c } = await loadContract(tx, projectCode);
    if (!Number.isInteger(position) || position < 0) throw new Error('Unknown guarantee');
    if (!isIso(releasedOn)) throw new Error('Invalid release date');
    const [b] = await tx.select().from(contractBonds).where(and(eq(contractBonds.contractId, c.id), eq(contractBonds.position, position)));
    if (!b) throw new Error('Unknown guarantee');
    const [done] = await tx.update(contractBonds).set({ releasedOn, updatedAt: new Date() })
      .where(and(eq(contractBonds.id, b.id), sql`${contractBonds.releasedOn} is null`)).returning({ id: contractBonds.id });
    if (!done) throw new Error('This guarantee is already released');
    const label = bondType.label(b.type) + (b.issuer ? ` · ${b.issuer}` : '');
    await trace(tx, actorName, c.reference, `guarantee released · ${label} · ${releasedOn}`, `Released ${label}`, p.id, { type: 'contract_bond', id: b.id });
    return label;
  });
}

export interface NewBond {
  type: BondType;
  amountKeur: number;
  issuer: string;
  /** ISO date. */
  validUntil: string;
}

/** "Add guarantee" (AF.bond): appended, in force until its date. Returns its label ("Performance bond · BNP"). */
export async function addBond(projectCode: string, input: NewBond, actorName: string): Promise<string> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const { p, c } = await loadContract(tx, projectCode);
    if (!bondType.isCode(input.type)) throw new Error('Invalid guarantee type');
    if (!Number.isFinite(input.amountKeur) || input.amountKeur < 0) throw new Error('Invalid amount');
    const issuer = input.issuer.trim();
    if (!issuer) throw new Error('The issuer is required');
    if (!isIso(input.validUntil)) throw new Error('Invalid validity date');
    const [{ maxPos }] = await tx.select({ maxPos: sql<number>`coalesce(max(${contractBonds.position}), -1)::int` }).from(contractBonds).where(eq(contractBonds.contractId, c.id));
    const [b] = await tx
      .insert(contractBonds)
      .values({ contractId: c.id, position: maxPos + 1, type: input.type, issuer, amountKeur: input.amountKeur, validUntil: input.validUntil, releasedOn: null })
      .returning({ id: contractBonds.id });
    const label = `${bondType.label(input.type)} · ${issuer}`;
    await audit(tx, actorName, c.reference, `guarantee registered · ${label} · ${input.amountKeur} k`, p.id, 'Contract', { type: 'contract_bond', id: b.id });
    return label;
  });
}

export interface NewPaymentMilestone {
  label: string;
  sharePct: number;
  /** ISO contractual date. */
  contractualDue: string;
  condition?: string | null;
  /** NEW-D3-3: position of the amendment the milestone belongs to (share of its amount); null = base contract. */
  amendment?: number | null;
}

/** "payment milestone M7 removed …": the audit line of a removal (R-077), read back so a removed number is never reused. */
const REMOVED_RE = /^payment milestone (M\d+) removed\b/;

/**
 * Numbers of the project's removed milestones, from the audit trail (R-077: numbers are never reused — one contract per project;
 * the reference may change, so the project and the entity type select the lines).
 */
async function removedMilestoneNumbers(tx: Tx, projectId: string): Promise<string[]> {
  const rows = await tx
    .select({ change: auditEntries.change })
    .from(auditEntries)
    .where(and(eq(auditEntries.projectId, projectId), eq(auditEntries.entityType, 'payment_milestone'), sql`${auditEntries.change} like 'payment milestone M% removed%'`));
  return rows.map((r) => REMOVED_RE.exec(r.change)?.[1]).filter((n): n is string => !!n);
}

/**
 * "Add payment milestone" (AF.milestone): M6, M7… Planned — of the base contract, or of an amendment (R-079; billable once the
 * amendment is signed). Shares may exceed 100 % (C-7a: the schedule can be retouched), but then invoicing of the group is blocked
 * until corrected (delivery 8, R-077). The number is above every number ever used on the contract (removed ones included, R-077).
 * Returns the number.
 */
export async function addPaymentMilestone(projectCode: string, input: NewPaymentMilestone, actorName: string): Promise<string> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const { p, c } = await loadContract(tx, projectCode);
    const label = input.label.trim();
    if (!label) throw new Error('The milestone is required');
    if (!Number.isFinite(input.sharePct) || input.sharePct < 0 || input.sharePct > 100) throw new Error('Invalid share');
    if (!isIso(input.contractualDue)) throw new Error('Invalid contractual date');
    const a = input.amendment != null ? await amendmentAt(tx, c.id, input.amendment) : null;
    const existing = await tx.select({ number: paymentMilestones.number, position: paymentMilestones.position }).from(paymentMilestones).where(eq(paymentMilestones.contractId, c.id));
    const number = nextBusinessNumber([...existing.map((m) => m.number ?? ''), ...(await removedMilestoneNumbers(tx, p.id))], 'M', 1);
    const [m] = await tx
      .insert(paymentMilestones)
      .values({
        projectId: p.id, contractId: c.id, amendmentId: a?.id ?? null, number, label, sharePct: input.sharePct, amountKeur: null, contractualDue: input.contractualDue,
        condition: input.condition?.trim() || null, status: 'planned', position: Math.max(-1, ...existing.map((e) => e.position)) + 1,
      })
      .returning({ id: paymentMilestones.id });
    const of = a ? ` of ${a.subject}` : '';
    await audit(tx, actorName, c.reference, `payment milestone ${number} added${of} · ${label} · ${input.sharePct} %`, p.id, 'Contract', { type: 'payment_milestone', id: m.id });
    return number;
  });
}

// ── Delivery 8 (R-077, C-7 / C-7a): correcting the schedule ────────────────────────────────────────────────────────────

/** A milestone change the schedule refuses (EN source message): not planned any more, unknown, or not the actor's to change. */
export class MilestoneEditError extends Error {
  readonly code: 'not_planned' | 'unknown' | 'not_allowed';
  constructor(code: MilestoneEditError['code'], message: string) {
    super(message);
    this.name = 'MilestoneEditError';
    this.code = code;
  }
}

/** The actor edits the contract of this project (the Server Function's `canEdit('contract')`, re-checked — P-4, R-044). */
async function requireContractEditor(tx: Tx, actor: Actor, projectId: string): Promise<void> {
  if (!(await editsContract(tx, actor, projectId))) throw new MilestoneEditError('not_allowed', 'This contract is read-only for you');
}

export interface PaymentMilestonePatch {
  label: string;
  sharePct: number;
  /** ISO contractual date. */
  contractualDue: string;
  condition: string | null;
}

/**
 * "Edit milestone" (R-077, C-7a "on peut toujours retoucher"): label, share (0–100, of its basis), contractual date and condition
 * of a PLANNED milestone; the basis (base contract or amendment) does not change. Guarded update (status still planned),
 * audited (area Contract, entity payment_milestone). Returns the number.
 */
export async function updatePaymentMilestone(projectCode: string, number: string, patch: PaymentMilestonePatch, actor: Actor): Promise<string> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const { p, c } = await loadContract(tx, projectCode);
    await requireContractEditor(tx, actor, p.id);
    const label = patch.label.trim();
    if (!label || label.length > 200) throw new Error('The milestone is required');
    if (!Number.isFinite(patch.sharePct) || patch.sharePct < 0 || patch.sharePct > 100) throw new Error('Invalid share');
    if (!isIso(patch.contractualDue)) throw new Error('Invalid contractual date');
    const [m] = await tx.select().from(paymentMilestones).where(and(eq(paymentMilestones.contractId, c.id), eq(paymentMilestones.number, number)));
    if (!m) throw new MilestoneEditError('unknown', 'Unknown milestone');
    if (m.status !== 'planned') throw new MilestoneEditError('not_planned', 'Only a planned milestone can be changed');
    const condition = patch.condition?.trim() || null;
    const changes: string[] = [];
    if (label !== m.label) changes.push(`label: ${m.label} → ${label}`);
    if (patch.sharePct !== (m.sharePct ?? 0)) changes.push(`share: ${m.sharePct ?? 0} → ${patch.sharePct} %`);
    if (patch.contractualDue !== m.contractualDue) changes.push(`contractual date: ${m.contractualDue ?? '—'} → ${patch.contractualDue}`);
    if (condition !== (m.condition ?? null)) changes.push('condition changed');
    if (!changes.length) return number;
    const [done] = await tx.update(paymentMilestones)
      .set({ label, sharePct: patch.sharePct, contractualDue: patch.contractualDue, condition, updatedAt: new Date() })
      .where(and(eq(paymentMilestones.id, m.id), eq(paymentMilestones.status, 'planned')))
      .returning({ id: paymentMilestones.id });
    if (!done) throw new MilestoneEditError('not_planned', 'Only a planned milestone can be changed');
    await audit(tx, actor.name, c.reference, `payment milestone ${number} changed · ${changes.join(' · ')}`, p.id, 'Contract', { type: 'payment_milestone', id: m.id });
    return number;
  });
}

/**
 * "Remove milestone" (R-077, after a confirmation): a PLANNED milestone is deleted (nothing references it: invoices exist only
 * for invoiced ones). Its number is never reused (the audit line is read back by addPaymentMilestone). Audited.
 */
export async function removePaymentMilestone(projectCode: string, number: string, actor: Actor): Promise<void> {
  const db = await getDb();
  await db.transaction(async (tx) => {
    const { p, c } = await loadContract(tx, projectCode);
    await requireContractEditor(tx, actor, p.id);
    const [m] = await tx.select().from(paymentMilestones).where(and(eq(paymentMilestones.contractId, c.id), eq(paymentMilestones.number, number)));
    if (!m) throw new MilestoneEditError('unknown', 'Unknown milestone');
    if (m.status !== 'planned') throw new MilestoneEditError('not_planned', 'Only a planned milestone can be removed');
    const [gone] = await tx.delete(paymentMilestones)
      .where(and(eq(paymentMilestones.id, m.id), eq(paymentMilestones.status, 'planned')))
      .returning({ id: paymentMilestones.id });
    if (!gone) throw new MilestoneEditError('not_planned', 'Only a planned milestone can be removed');
    await audit(tx, actor.name, c.reference, `payment milestone ${number} removed · ${m.label} · ${m.sharePct ?? 0} %`, p.id, 'Contract', { type: 'payment_milestone', id: m.id });
  });
}

export interface IssueInvoiceInput {
  /** "M4". */
  milestone: string;
  /** Defaults to the next INV-<business year>-nnn. */
  invoiceNumber?: string | null;
  /** ISO invoice date (default the business date — the prototype's NOWD; R-013). */
  issuedOn?: string | null;
  note?: string | null;
}

/**
 * "Issue invoice" (AF.billing): a planned billable milestone becomes Invoiced and its invoice is recorded at the milestone's
 * current amount — round(base amount × share / 100), or of the amendment's amount for an amendment milestone (NEW-D3-3) — in
 * the contract's currency. A milestone of an amendment not signed yet is refused. Returns the invoice number (toast
 * "{no} · {M} · Invoice issued · sent to the client").
 */
export async function issueInvoice(projectCode: string, input: IssueInvoiceInput, actorName: string): Promise<string> {
  const db = await getDb();
  const today = await businessToday();
  return db.transaction(async (tx) => {
    const { p, c } = await loadContract(tx, projectCode);
    const [m] = await tx.select().from(paymentMilestones).where(and(eq(paymentMilestones.contractId, c.id), eq(paymentMilestones.number, input.milestone)));
    if (!m) throw new Error(`Unknown milestone ${input.milestone}`);
    if (m.status !== 'planned') throw new Error(`${input.milestone} is already invoiced`);
    // R-077 (C-7): no invoice while the milestone's group (base contract or its amendment) exceeds 100 % — recomputed here, the
    // contract row being locked by loadContract.
    const group = await tx.select({ number: paymentMilestones.number, sharePct: paymentMilestones.sharePct, amendmentId: paymentMilestones.amendmentId })
      .from(paymentMilestones).where(eq(paymentMilestones.contractId, c.id));
    if (invoiceBlocked(group.map((g) => ({ number: g.number ?? '', sharePct: g.sharePct ?? 0, amendment: g.amendmentId })), input.milestone)) {
      throw new Error(INVOICE_BLOCKED_MESSAGE);
    }
    let basis = c.baseAmountKeur;
    if (m.amendmentId) {
      const [a] = await tx.select().from(contractAmendments).where(eq(contractAmendments.id, m.amendmentId));
      if (!a || a.status !== 'signed') throw new Error(`${input.milestone} belongs to an amendment not signed yet`);
      basis = a.amountKeur;
    }
    const all = (await tx.select({ n: customerInvoices.number }).from(customerInvoices)).map((r) => r.n);
    const number = input.invoiceNumber?.trim() || nextBusinessNumber(all, invoicePrefix(today), 3);
    if (all.includes(number)) throw new Error(`Invoice ${number} already exists`);
    const amount = plannedMilestoneAmount(basis, m.sharePct ?? 0);
    const issuedOn = isoOrNull(input.issuedOn, 'invoice date') ?? today;
    const [moved] = await tx.update(paymentMilestones).set({ status: 'invoiced', updatedAt: new Date() })
      .where(and(eq(paymentMilestones.id, m.id), eq(paymentMilestones.status, 'planned'))).returning({ id: paymentMilestones.id });
    if (!moved) throw new Error(`${input.milestone} is already invoiced`);
    const [inv] = await tx.insert(customerInvoices).values({ paymentMilestoneId: m.id, number, issuedOn, amountKeur: amount, currency: currencyOf(c.currency), note: input.note?.trim() || null })
      .returning({ id: customerInvoices.id });
    const unit = c.currency === BASE_CURRENCY ? 'k€' : `k ${c.currency}`;
    const actor = await audit(tx, actorName, number, `issued · ${input.milestone} · ${amount} ${unit} · milestone: Planned → Invoiced`, p.id, 'Billing', { type: 'customer_invoice', id: inv.id });
    await recordActivity(tx, { actorName: actor ? nameOf(actor) : actorName, actorPersonId: actor?.id, text: `Issued invoice ${number} · ${input.milestone} ${m.label} · ${amount} ${unit}`, kind: 'invoice', projectId: p.id });
    return number;
  });
}

/** "Mark paid": an invoiced milestone becomes Paid, its invoice paid on `on` (default the business date — the prototype's NOWD; R-013). */
export async function markInvoicePaid(projectCode: string, milestone: string, actorName: string, onDate?: string): Promise<void> {
  const db = await getDb();
  const on = onDate ?? (await businessToday());
  await db.transaction(async (tx) => {
    const { p, c } = await loadContract(tx, projectCode);
    const [m] = await tx.select().from(paymentMilestones).where(and(eq(paymentMilestones.contractId, c.id), eq(paymentMilestones.number, milestone)));
    if (!m) throw new Error(`Unknown milestone ${milestone}`);
    if (m.status !== 'invoiced') throw new Error(`${milestone} is not awaiting payment`);
    const [inv] = await tx.select().from(customerInvoices).where(eq(customerInvoices.paymentMilestoneId, m.id));
    const [moved] = await tx.update(paymentMilestones).set({ status: 'paid', updatedAt: new Date() })
      .where(and(eq(paymentMilestones.id, m.id), eq(paymentMilestones.status, 'invoiced'))).returning({ id: paymentMilestones.id });
    if (!moved) throw new Error(`${milestone} is not awaiting payment`);
    if (inv) await tx.update(customerInvoices).set({ paidOn: on }).where(eq(customerInvoices.id, inv.id));
    const ref = inv?.number ?? `${c.reference} ${milestone}`;
    const actor = await audit(tx, actorName, ref, `paid · ${milestone} · milestone: Invoiced → Paid`, p.id, 'Billing', inv ? { type: 'customer_invoice', id: inv.id } : undefined);
    await recordActivity(tx, { actorName: actor ? nameOf(actor) : actorName, actorPersonId: actor?.id, text: `Payment received · ${ref} · ${milestone} ${m.label}`, kind: 'invoice', projectId: p.id });
  });
}
