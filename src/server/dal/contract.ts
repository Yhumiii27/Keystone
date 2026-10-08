import 'server-only';
// Contract & Billing DAL (docs/spec/04 §3 Contract, §4 Billing, §1.6 Budget › Cash & recovery; 11 §3.5, §7 #3).
// The contract is the billing source of truth (OPEN QUESTION A-5): its value is the base amount plus the signed
// amendments, every payment milestone is priced round(value × share / 100), and customer invoices are 1:1 with the
// invoiced milestones (due = issued + the payment delay of the terms, in calendar days — not the prototype's
// DST-sensitive ms arithmetic, 04 Q12). Late milestone = planned and contractual date before the prototype's now
// (PG_NOW); overdue invoice = awaiting payment and due before NOWD (30 Sep 2026).
import { and, asc, eq, isNotNull, sql } from 'drizzle-orm';
import { termsDays } from '@/domain/evm';
import { getDb } from '@/server/db/client';
import {
  NOW_ISO, addDaysIso, amendmentStatus, beforePgNow, bondType, contractType, customerInvoiceStatus, displayOfIso, nextBusinessNumber,
  paymentMilestoneStatus, shortDateYearOfIso,
  type AmendmentStatus, type BondType, type ContractType, type CustomerInvoiceStatus, type PaymentMilestoneStatus,
} from '@/server/db/codes';
import { findPerson, nameOf, recordActivity, requireProject, writeAudit } from '@/server/db/helpers';
import {
  changeRequests, clients, contractAmendments, contractBonds, contracts, customerInvoices, documents, paymentMilestones, projectControls, projects,
} from '@/server/db/schema';
import type { Tx } from '@/server/db/types';

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
  baseAmountKeur: number;
  /** "Net 45 days". */
  paymentTerms: string;
  /** Payment delay (first integer of the terms, default 45). */
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
  signedOn: string | null;
  /** "8 Jul 2026" or "—". */
  dateText: string;
  documentRef: string | null;
  documentIndexed: boolean;
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
  /** Amount invoiced at issue (k€). */
  amountKeur: number;
  /** Issued + payment delay (calendar days). */
  dueOn: string;
  dueText: string;
  paidOn: string | null;
  /** "2 Apr" or "—". */
  paidText: string;
  note: string | null;
  status: CustomerInvoiceStatus;
  statusLabel: string;
  overdue: boolean;
}

export interface ContractMilestoneRow {
  /** "M3". */
  number: string;
  label: string;
  sharePct: number;
  /** round(contract value × share / 100), k€. */
  amountKeur: number;
  contractualDue: string | null;
  /** "26 Sep 2026" (as stored on the contract). */
  dueText: string;
  condition: string | null;
  status: PaymentMilestoneStatus;
  statusLabel: string;
  /** Planned and contractual date before the prototype's now (Billing badge, "· Late"). */
  late: boolean;
  /** Invoice of an invoiced / paid milestone. */
  invoice: CustomerInvoiceRow | null;
}

export interface ProjectContract {
  projectCode: string;
  sheet: ContractSheet;
  amendments: AmendmentRow[];
  bonds: BondRow[];
  milestones: ContractMilestoneRow[];
  /** Invoices in milestone order. */
  invoices: CustomerInvoiceRow[];
  /** Base + signed amendments (`ctrTotal`). */
  valueKeur: number;
  signedAmendments: { count: number; amountKeur: number };
  pendingAmendments: { count: number; amountKeur: number };
  bondsInForce: { count: number; total: number; amountKeur: number };
  /** Σ milestones not planned / paid (`ctrInvoiced`, `ctrPaid`) and the retention held (paid × retention %, C-8). */
  invoicedKeur: number;
  paidKeur: number;
  retentionKeur: number;
  /** Σ shares (%), 100 when the schedule is complete. */
  sharePctTotal: number;
  /** Next invoice number proposed by "Issue invoice" ("INV-2026-004"). */
  nextInvoiceNumber: string;
  /** Planned milestones whose contractual date has passed (Billing nav badge). */
  lateCount: number;
}

const dash = (iso: string | null, f: (s: string) => string) => (iso ? f(iso) : '—');
/** ISO 'YYYY-MM-DD' of a real calendar day. */
const isIso = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(Date.parse(v + 'T00:00:00Z')) && new Date(v + 'T00:00:00Z').toISOString().slice(0, 10) === v;
function isoOrNull(v: string | null | undefined, what: string): string | null {
  if (v == null || v === '') return null;
  if (!isIso(v)) throw new Error(`Invalid ${what}`);
  return v;
}

function invoiceRow(i: typeof customerInvoices.$inferSelect, m: { number: string; label: string; status: PaymentMilestoneStatus }, delay: number): CustomerInvoiceRow {
  const dueOn = addDaysIso(i.issuedOn, delay);
  const paid = m.status === 'paid';
  const overdue = !paid && dueOn < NOW_ISO;
  const status: CustomerInvoiceStatus = paid ? 'paid' : overdue ? 'overdue' : 'awaiting_payment';
  return {
    number: i.number, milestoneNumber: m.number, milestoneLabel: m.label, issuedOn: i.issuedOn, issuedText: shortDateYearOfIso(i.issuedOn), amountKeur: i.amountKeur,
    dueOn, dueText: shortDateYearOfIso(dueOn), paidOn: i.paidOn, paidText: dash(i.paidOn, shortDateYearOfIso), note: i.note, status,
    statusLabel: customerInvoiceStatus.label(status), overdue,
  };
}

/** Contract of a project with its amendments, bonds, payment schedule and invoices; null when none is registered. */
export async function getContract(projectCode: string): Promise<ProjectContract | null> {
  const db = await getDb();
  const [row] = await db
    .select({ c: contracts, docId: documents.id })
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
  const delay = termsDays(c.paymentTerms);
  const amendments: AmendmentRow[] = ams.map(({ a, crId, docId }) => ({
    position: a.position, label: a.subject + (a.changeRequestRef ? ` (${a.changeRequestRef})` : ''), subject: a.subject, changeRequestRef: a.changeRequestRef,
    changeRequestLinked: !!crId, amountKeur: a.amountKeur, status: a.status, statusLabel: amendmentStatus.label(a.status), signed: a.status === 'signed',
    signedOn: a.signedOn, dateText: dash(a.signedOn, displayOfIso), documentRef: a.documentRef, documentIndexed: !!docId,
  }));
  const signed = amendments.filter((a) => a.signed);
  const pending = amendments.filter((a) => !a.signed);
  const valueKeur = c.baseAmountKeur + signed.reduce((s, a) => s + a.amountKeur, 0);
  const bondRows: BondRow[] = bonds.map((b) => ({
    position: b.position, type: b.type, label: bondType.label(b.type) + (b.issuer ? ` · ${b.issuer}` : ''), issuer: b.issuer, amountKeur: b.amountKeur,
    validUntil: b.validUntil, releasedOn: b.releasedOn, inForce: !b.releasedOn,
    stateText: b.releasedOn ? `Released ${displayOfIso(b.releasedOn)}` : `Valid → ${dash(b.validUntil, displayOfIso)}`,
  }));
  const invByMs = new Map(invs.map(({ i }) => [i.paymentMilestoneId, i]));
  const milestones: ContractMilestoneRow[] = ms.map((m) => {
    const number = m.number ?? '';
    const inv = invByMs.get(m.id);
    return {
      number, label: m.label, sharePct: m.sharePct ?? 0, amountKeur: Math.round((valueKeur * (m.sharePct ?? 0)) / 100), contractualDue: m.contractualDue,
      dueText: dash(m.contractualDue, displayOfIso), condition: m.condition, status: m.status, statusLabel: paymentMilestoneStatus.label(m.status),
      late: m.status === 'planned' && beforePgNow(m.contractualDue), invoice: inv ? invoiceRow(inv, { number, label: m.label, status: m.status }, delay) : null,
    };
  });
  const invoicedKeur = milestones.filter((m) => m.status !== 'planned').reduce((s, m) => s + m.amountKeur, 0);
  const paidKeur = milestones.filter((m) => m.status === 'paid').reduce((s, m) => s + m.amountKeur, 0);
  const allNumbers = (await db.select({ n: customerInvoices.number }).from(customerInvoices)).map((r) => r.n);
  return {
    projectCode,
    sheet: {
      reference: c.reference, documentIndexed: !!row.docId, client: c.clientName, type: c.type, typeLabel: contractType.label(c.type), signedOn: c.signedOn,
      signedText: c.signedOn ? displayOfIso(c.signedOn) : '', baseAmountKeur: c.baseAmountKeur, paymentTerms: c.paymentTerms, termsDays: delay,
      retentionPct: c.retentionPct, retentionNote: c.retentionNote, liquidatedDamages: c.liquidatedDamages, warranty: c.warranty, governingLaw: c.governingLaw, scope: c.scope,
    },
    amendments,
    bonds: bondRows,
    milestones,
    invoices: milestones.flatMap((m) => (m.invoice ? [m.invoice] : [])),
    valueKeur,
    signedAmendments: { count: signed.length, amountKeur: signed.reduce((s, a) => s + a.amountKeur, 0) },
    pendingAmendments: { count: pending.length, amountKeur: pending.reduce((s, a) => s + a.amountKeur, 0) },
    bondsInForce: { count: bondRows.filter((b) => b.inForce).length, total: bondRows.length, amountKeur: bondRows.filter((b) => b.inForce).reduce((s, b) => s + b.amountKeur, 0) },
    invoicedKeur,
    paidKeur,
    retentionKeur: Math.round((paidKeur * c.retentionPct) / 100),
    sharePctTotal: Math.round(milestones.reduce((s, m) => s + m.sharePct, 0) * 10) / 10,
    nextInvoiceNumber: nextBusinessNumber(allNumbers, 'INV-2026-', 3),
    lateCount: milestones.filter((m) => m.late).length,
  };
}

/** Contract reference and terms of a project (breadcrumb extras of Contract and Billing); null without a contract. */
export async function getContractHeader(projectCode: string): Promise<{ reference: string; paymentTerms: string } | null> {
  const db = await getDb();
  const [r] = await db
    .select({ reference: contracts.reference, paymentTerms: contracts.paymentTerms })
    .from(contracts)
    .innerJoin(projects, eq(projects.id, contracts.projectId))
    .where(eq(projects.code, projectCode));
  return r ?? null;
}

/** Late planned milestones per project code (Billing nav badge, `ctrBadge`). */
export async function lateBillingMilestonesByProject(): Promise<Record<string, number>> {
  const db = await getDb();
  const rows = await db
    .select({ code: projects.code, due: paymentMilestones.contractualDue })
    .from(paymentMilestones)
    .innerJoin(projects, eq(projects.id, paymentMilestones.projectId))
    .where(and(isNotNull(paymentMilestones.contractId), eq(paymentMilestones.status, 'planned')));
  const out: Record<string, number> = {};
  for (const r of rows) if (beforePgNow(r.due)) out[r.code] = (out[r.code] ?? 0) + 1;
  return out;
}

/** Contract figures read by Budget › Cash & recovery (04 §1.6). */
export interface CashContract {
  reference: string;
  /** Base amount (k€) and amendments with their signed flag. */
  amount: number;
  terms: string;
  amendments: { label: string; amount: number; signed: boolean }[];
  /** Payment schedule in the `@/domain/evm` shape (display dates "26 Sep" / "14 Dec 2026"). */
  milestones: { id: string; label: string; pct: number; due: string; status: PaymentMilestoneStatus; invoiced: string | null; paid: string | null }[];
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
  return {
    reference: c.sheet.reference,
    amount: c.sheet.baseAmountKeur,
    terms: c.sheet.paymentTerms,
    amendments: c.amendments.map((a) => ({ label: a.label, amount: a.amountKeur, signed: a.signed })),
    milestones: c.milestones.map((m) => ({
      id: m.number, label: m.label, pct: m.sharePct, due: m.dueText, status: m.status,
      invoiced: m.invoice ? m.invoice.issuedText : null, paid: m.invoice?.paidOn ? m.invoice.paidText : null,
    })),
    openCommit: pc?.orders ?? null,
  };
}

// ── Writers ────────────────────────────────────────────────────────────────────────────────────────────

async function loadContract(tx: Tx, projectCode: string) {
  const p = await requireProject(tx, projectCode);
  const [c] = await tx.select().from(contracts).where(eq(contracts.projectId, p.id));
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

export interface ContractSheetPatch {
  reference?: string;
  client?: string;
  type?: ContractType;
  /** ISO date or null. */
  signedOn?: string | null;
  baseAmountKeur?: number;
  paymentTerms?: string;
  retentionPct?: number;
  retentionNote?: string;
  liquidatedDamages?: string;
  warranty?: string;
  governingLaw?: string;
  scope?: string;
}

const SHEET_COLUMN = {
  reference: 'reference', client: 'clientName', type: 'type', signedOn: 'signedOn', baseAmountKeur: 'baseAmountKeur', paymentTerms: 'paymentTerms',
  retentionPct: 'retentionPct', retentionNote: 'retentionNote', liquidatedDamages: 'liquidatedDamages', warranty: 'warranty', governingLaw: 'governingLaw', scope: 'scope',
} as const satisfies Record<keyof ContractSheetPatch, keyof typeof contracts.$inferSelect>;

/**
 * Contract sheet edits (`setCtr`, saved per field): validates amounts (≥ 0), retention (0–100), the type code and
 * the reference (non-empty, unique). Changing the base amount re-prices every milestone; the terms change the due
 * dates. Writes one audit row with the changed fields.
 */
export async function updateContractSheet(projectCode: string, patch: ContractSheetPatch, actorName: string): Promise<void> {
  const db = await getDb();
  await db.transaction(async (tx) => {
    const { p, c } = await loadContract(tx, projectCode);
    const set: Partial<typeof contracts.$inferInsert> = {};
    const changes: string[] = [];
    for (const [k, col] of Object.entries(SHEET_COLUMN) as [keyof ContractSheetPatch, keyof typeof contracts.$inferSelect][]) {
      if (!(k in patch)) continue;
      let v = patch[k];
      if (typeof v === 'string' && k !== 'signedOn') v = v.trim();
      if ((k === 'baseAmountKeur' || k === 'retentionPct') && (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || (k === 'retentionPct' && v > 100)))
        throw new Error(`Invalid ${k}`);
      if (k === 'type' && !contractType.isCode(v)) throw new Error('Invalid contract type');
      if (k === 'reference' && !v) throw new Error('The reference is required');
      if (k === 'signedOn') v = isoOrNull(v as string | null, 'signature date');
      const old = c[col];
      if (old === v) continue;
      (set as Record<string, unknown>)[col] = v;
      changes.push(`${k}: ${old ?? '—'} → ${v ?? '—'}`);
    }
    if (!changes.length) return;
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
  /** ISO signature date. */
  signedOn?: string | null;
  documentRef?: string | null;
}

/** "Add amendment" (AF.amendment): appended; a signed one raises the contract value and every milestone amount. Returns its label. */
export async function addAmendment(projectCode: string, input: NewAmendment, actorName: string): Promise<string> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const { p, c } = await loadContract(tx, projectCode);
    const subject = input.subject.trim();
    if (!subject) throw new Error('The subject is required');
    if (!Number.isFinite(input.amountKeur)) throw new Error('Invalid amount');
    if (!amendmentStatus.isCode(input.status)) throw new Error('Invalid status');
    const crRef = input.changeRequestRef?.trim() || null;
    const docRef = input.documentRef?.trim() || null;
    const [cr] = crRef ? await tx.select({ id: changeRequests.id }).from(changeRequests).where(and(eq(changeRequests.projectId, p.id), eq(changeRequests.number, crRef))) : [];
    const [doc] = docRef ? await tx.select({ id: documents.id }).from(documents).where(eq(documents.number, docRef)) : [];
    const [{ maxPos }] = await tx.select({ maxPos: sql<number>`coalesce(max(${contractAmendments.position}), -1)::int` }).from(contractAmendments).where(eq(contractAmendments.contractId, c.id));
    const [a] = await tx
      .insert(contractAmendments)
      .values({
        contractId: c.id, position: maxPos + 1, subject, changeRequestRef: crRef, changeRequestId: cr?.id ?? null, amountKeur: input.amountKeur, status: input.status,
        signedOn: isoOrNull(input.signedOn, 'signature date'), documentRef: docRef, documentId: doc?.id ?? null,
      })
      .returning({ id: contractAmendments.id });
    const label = subject + (crRef ? ` (${crRef})` : '');
    await audit(tx, actorName, c.reference, `amendment registered · ${label} · ${input.amountKeur} k€ · ${amendmentStatus.label(input.status)}`, p.id, 'Contract', { type: 'contract_amendment', id: a.id });
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
    await audit(tx, actorName, c.reference, `guarantee registered · ${label} · ${input.amountKeur} k€`, p.id, 'Contract', { type: 'contract_bond', id: b.id });
    return label;
  });
}

export interface NewPaymentMilestone {
  label: string;
  sharePct: number;
  /** ISO contractual date. */
  contractualDue: string;
  condition?: string | null;
}

/** "Add payment milestone" (AF.milestone): M6, M7… Planned. Shares may exceed 100 % (only a hint, C-7). Returns the number. */
export async function addPaymentMilestone(projectCode: string, input: NewPaymentMilestone, actorName: string): Promise<string> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const { p, c } = await loadContract(tx, projectCode);
    const label = input.label.trim();
    if (!label) throw new Error('The milestone is required');
    if (!Number.isFinite(input.sharePct) || input.sharePct < 0 || input.sharePct > 100) throw new Error('Invalid share');
    if (!isIso(input.contractualDue)) throw new Error('Invalid contractual date');
    const existing = await tx.select({ number: paymentMilestones.number, position: paymentMilestones.position }).from(paymentMilestones).where(eq(paymentMilestones.contractId, c.id));
    const number = nextBusinessNumber(existing.map((m) => m.number ?? ''), 'M', 1);
    const [m] = await tx
      .insert(paymentMilestones)
      .values({
        projectId: p.id, contractId: c.id, number, label, sharePct: input.sharePct, amountKeur: null, contractualDue: input.contractualDue,
        condition: input.condition?.trim() || null, status: 'planned', position: Math.max(-1, ...existing.map((e) => e.position)) + 1,
      })
      .returning({ id: paymentMilestones.id });
    await audit(tx, actorName, c.reference, `payment milestone ${number} added · ${label} · ${input.sharePct} %`, p.id, 'Contract', { type: 'payment_milestone', id: m.id });
    return number;
  });
}

export interface IssueInvoiceInput {
  /** "M4". */
  milestone: string;
  /** Defaults to the next INV-2026-nnn. */
  invoiceNumber?: string | null;
  /** ISO invoice date (default NOWD, 30 Sep 2026). */
  issuedOn?: string | null;
  note?: string | null;
}

/**
 * "Issue invoice" (AF.billing): a planned milestone becomes Invoiced and its invoice is recorded at the current
 * milestone amount. Returns the invoice number (toast "{no} · {M} · Invoice issued · sent to the client").
 */
export async function issueInvoice(projectCode: string, input: IssueInvoiceInput, actorName: string): Promise<string> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const { p, c } = await loadContract(tx, projectCode);
    const [m] = await tx.select().from(paymentMilestones).where(and(eq(paymentMilestones.contractId, c.id), eq(paymentMilestones.number, input.milestone)));
    if (!m) throw new Error(`Unknown milestone ${input.milestone}`);
    if (m.status !== 'planned') throw new Error(`${input.milestone} is already invoiced`);
    const all = (await tx.select({ n: customerInvoices.number }).from(customerInvoices)).map((r) => r.n);
    const number = input.invoiceNumber?.trim() || nextBusinessNumber(all, 'INV-2026-', 3);
    if (all.includes(number)) throw new Error(`Invoice ${number} already exists`);
    const signed = await tx.select({ amount: contractAmendments.amountKeur }).from(contractAmendments)
      .where(and(eq(contractAmendments.contractId, c.id), eq(contractAmendments.status, 'signed')));
    const value = c.baseAmountKeur + signed.reduce((s, a) => s + a.amount, 0);
    const amount = Math.round((value * (m.sharePct ?? 0)) / 100);
    const issuedOn = isoOrNull(input.issuedOn, 'invoice date') ?? NOW_ISO;
    await tx.update(paymentMilestones).set({ status: 'invoiced', updatedAt: new Date() }).where(eq(paymentMilestones.id, m.id));
    const [inv] = await tx.insert(customerInvoices).values({ paymentMilestoneId: m.id, number, issuedOn, amountKeur: amount, note: input.note?.trim() || null })
      .returning({ id: customerInvoices.id });
    const actor = await audit(tx, actorName, number, `issued · ${input.milestone} · ${amount} k€ · milestone: Planned → Invoiced`, p.id, 'Billing', { type: 'customer_invoice', id: inv.id });
    await recordActivity(tx, { actorName: actor ? nameOf(actor) : actorName, actorPersonId: actor?.id, text: `Issued invoice ${number} · ${input.milestone} ${m.label} · ${amount} k€`, kind: 'invoice', projectId: p.id });
    return number;
  });
}

/** "Mark paid": an invoiced milestone becomes Paid, its invoice paid on `on` (default NOWD, "30 Sep"). */
export async function markInvoicePaid(projectCode: string, milestone: string, actorName: string, on: string = NOW_ISO): Promise<void> {
  const db = await getDb();
  await db.transaction(async (tx) => {
    const { p, c } = await loadContract(tx, projectCode);
    const [m] = await tx.select().from(paymentMilestones).where(and(eq(paymentMilestones.contractId, c.id), eq(paymentMilestones.number, milestone)));
    if (!m) throw new Error(`Unknown milestone ${milestone}`);
    if (m.status !== 'invoiced') throw new Error(`${milestone} is not awaiting payment`);
    const [inv] = await tx.select().from(customerInvoices).where(eq(customerInvoices.paymentMilestoneId, m.id));
    await tx.update(paymentMilestones).set({ status: 'paid', updatedAt: new Date() }).where(eq(paymentMilestones.id, m.id));
    if (inv) await tx.update(customerInvoices).set({ paidOn: on }).where(eq(customerInvoices.id, inv.id));
    const ref = inv?.number ?? `${c.reference} ${milestone}`;
    const actor = await audit(tx, actorName, ref, `paid · ${milestone} · milestone: Invoiced → Paid`, p.id, 'Billing', inv ? { type: 'customer_invoice', id: inv.id } : undefined);
    await recordActivity(tx, { actorName: actor ? nameOf(actor) : actorName, actorPersonId: actor?.id, text: `Payment received · ${ref} · ${milestone} ${m.label}`, kind: 'invoice', projectId: p.id });
  });
}
