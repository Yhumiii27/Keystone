// Contract, billing and cash (docs/spec/11 §3.5 Contract / Amendment / Bond / PaymentMilestone / CustomerInvoice,
// §7 #3; screens 04 §3 Contract, §4 Billing, §1.6 Budget › Cash & recovery; 03 §7 Cash flow, §6 margin).
//
// Billing source of truth (OPEN QUESTION A-5, resolved as 11 §7 #3): the contract (`contracts` + its payment
// milestones and customer invoices) is authoritative. Projects without a contract keep their legacy billing plan
// (`BILLING` 3541) migrated into `billing_plans` + `payment_milestones` (fixed amounts, no contract): Cash flow,
// Prioritisation margins and the client portal read the same rows. A project with a contract derives its billing
// plan from the contract (value = base + signed amendments; milestone amount = round(value × share / 100)).
import { date, index, integer, pgTable, text, timestamp, unique, uuid, type AnyPgColumn } from 'drizzle-orm/pg-core';
import type { AmendmentStatus, BillingModel, BondType, ContractType, PaymentMilestoneStatus, PaymentRule } from '../codes';
import { id, keur, num, timestamps } from './_common';
import { changeRequests } from './change';
import { documents } from './documents';
import { clients } from './organisation';
import { projects } from './portfolio';
import { incoterms } from './shipments';

/** Client contract of a project (CONTRACTS 3713 — HLT-026 only). The contract sheet fields are editable. */
export const contracts = pgTable('contracts', {
  id: id(),
  projectId: uuid('project_id').notNull().unique().references(() => projects.id, { onDelete: 'cascade' }),
  /** "CTR-HLT-001" — also the Codex document number. */
  reference: text('reference').notNull().unique(),
  documentId: uuid('document_id').references(() => documents.id, { onDelete: 'set null' }),
  /** Sheet value "Port authority" (free text) and the resolved client organisation. */
  clientName: text('client_name').notNull(),
  clientId: uuid('client_id').references(() => clients.id),
  type: text('type').$type<ContractType>().notNull(),
  signedOn: date('signed_on', { mode: 'string' }),
  /**
   * Base amount in thousands of the contract currency (`currency`; the column name predates C-9). Every amount of the
   * contract — amendments, bonds, milestones, invoices — is in that currency; portfolio screens convert at the project's
   * budget rate (`projects.budget_rate`).
   */
  baseAmountKeur: keur('base_amount_keur').notNull(),
  /** C-9 (R-075): currency of the contract — EUR or the project currency. */
  currency: text('currency').notNull().default('EUR'),
  /** C-6 (R-076): payment rule — 'net' (N days from the invoice date), 'days_eom' (N days, then end of month), 'eom_days' (end of month + N days). */
  paymentRule: text('payment_rule').$type<PaymentRule>().notNull().default('net'),
  /** N of the payment rule, calendar days. */
  paymentDays: integer('payment_days').notNull().default(45),
  /** "Net 45 days" — the payment terms as text, rebuilt from the rule and the days whenever they change (R-076). */
  paymentTerms: text('payment_terms').notNull(),
  retentionPct: num('retention_pct').notNull(),
  retentionNote: text('retention_note').notNull(),
  /** "0.5 % per week · cap 10 %" (rate · cap). */
  liquidatedDamages: text('liquidated_damages').notNull(),
  warranty: text('warranty').notNull(),
  governingLaw: text('governing_law').notNull(),
  scope: text('scope').notNull(),
  /**
   * R-158 (owner's decision 2): the contract's Incoterm and its named place ("DAP" + "Dakar — site"); the shipments organise
   * the seller's steps from it. Null = not set yet.
   */
  incotermId: uuid('incoterm_id').references(() => incoterms.id),
  incotermPlace: text('incoterm_place'),
  ...timestamps,
});

/** Amendments (avenants). Only signed ones add to the contract value. */
export const contractAmendments = pgTable('contract_amendments', {
  id: id(),
  contractId: uuid('contract_id').notNull().references(() => contracts.id, { onDelete: 'cascade' }),
  position: integer('position').notNull(),
  /** "Amendment 1 — anti-collision lidar" (the label shows " (CR-004)" when a change request is linked). */
  subject: text('subject').notNull(),
  /** "CR-004" as entered; resolved to the project's change request when it exists. */
  changeRequestRef: text('change_request_ref'),
  changeRequestId: uuid('change_request_id').references(() => changeRequests.id, { onDelete: 'set null' }),
  amountKeur: keur('amount_keur').notNull(),
  /** Signature cycle (R-079): draft → sent for signature (or awaiting signature, the seed's wording) → signed. */
  status: text('status').$type<AmendmentStatus>().notNull(),
  /** Day it was sent to the client for signature (R-079); null while draft or for the seed rows. */
  sentOn: date('sent_on', { mode: 'string' }),
  signedOn: date('signed_on', { mode: 'string' }),
  /** "CTR-HLT-002" as entered; resolved to the Codex document when indexed. */
  documentRef: text('document_ref'),
  documentId: uuid('document_id').references(() => documents.id, { onDelete: 'set null' }),
  ...timestamps,
}, (t) => [index('contract_amendments_contract_id_idx').on(t.contractId)]);

/** Bonds and guarantees. In force unless released. */
export const contractBonds = pgTable('contract_bonds', {
  id: id(),
  contractId: uuid('contract_id').notNull().references(() => contracts.id, { onDelete: 'cascade' }),
  position: integer('position').notNull(),
  type: text('type').$type<BondType>().notNull(),
  /** Issuing bank / insurer (added bonds; the seed bonds have none). */
  issuer: text('issuer'),
  amountKeur: keur('amount_keur').notNull(),
  validUntil: date('valid_until', { mode: 'string' }),
  releasedOn: date('released_on', { mode: 'string' }),
  ...timestamps,
}, (t) => [index('contract_bonds_contract_id_idx').on(t.contractId)]);

/**
 * Billing plan of a project (BILLING 3541): billing model and, for projects without a contract, the contract value
 * of the legacy plan. Null value = read the contract (base + signed amendments).
 */
export const billingPlans = pgTable('billing_plans', {
  projectId: uuid('project_id').primaryKey().references(() => projects.id, { onDelete: 'cascade' }),
  model: text('model').$type<BillingModel>().notNull(),
  contractValueKeur: keur('contract_value_keur'),
  ...timestamps,
});

/**
 * Payment milestones: contractual ones (`contractId` set — share of the contract value, contractual date, status)
 * and the legacy billing-plan rows of projects without a contract (fixed amount, no date).
 */
export const paymentMilestones = pgTable(
  'payment_milestones',
  {
    id: id(),
    projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
    contractId: uuid('contract_id').references(() => contracts.id, { onDelete: 'cascade' }),
    /**
     * NEW-D3-3 (R-079): the amendment this milestone belongs to — its share is a share of the amendment's amount and it is
     * billable once the amendment is signed. Null = a milestone of the base contract (share of the base amount).
     */
    amendmentId: uuid('amendment_id').references((): AnyPgColumn => contractAmendments.id, { onDelete: 'cascade' }),
    /** "M3" for contractual milestones (M6… for added ones); null for billing-plan rows. */
    number: text('number'),
    /** "Structure topped out (80 % erected)" / "Jun" / "Strip-out". */
    label: text('label').notNull(),
    /** Share, %, of the base amount (base milestones) or of the amendment's amount (amendment milestones) — NEW-D3-3. */
    sharePct: num('share_pct'),
    /** Fixed amount (billing-plan rows without a contract). */
    amountKeur: keur('amount_keur'),
    contractualDue: date('contractual_due', { mode: 'string' }),
    condition: text('condition'),
    status: text('status').$type<PaymentMilestoneStatus>().notNull(),
    position: integer('position').notNull(),
    ...timestamps,
  },
  (t) => [unique().on(t.projectId, t.number), index('payment_milestones_contract_id_idx').on(t.contractId)],
);

/**
 * Customer invoices (1:1 with an invoiced milestone). Due date derived from the contract's payment rule (R-076). The amount
 * is frozen at issue: the milestone keeps it whatever the contract becomes (NEW-D3-3).
 */
export const customerInvoices = pgTable('customer_invoices', {
  id: id(),
  paymentMilestoneId: uuid('payment_milestone_id').notNull().unique().references(() => paymentMilestones.id, { onDelete: 'cascade' }),
  /** "INV-2026-004". */
  number: text('number').notNull().unique(),
  issuedOn: date('issued_on', { mode: 'string' }).notNull(),
  /** Amount invoiced at issue (thousands of `currency`) = the milestone's amount then. */
  amountKeur: keur('amount_keur').notNull(),
  /** C-9: currency of the invoice (the contract's at issue). */
  currency: text('currency').notNull().default('EUR'),
  paidOn: date('paid_on', { mode: 'string' }),
  /** "Note on the invoice". */
  note: text('note'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Portfolio cash forecast, next 6 months (CASH_M 3542 with the prototype's cash-in / cash-out arrays, logic 4518):
 * planning figures in k€ for the whole portfolio, scaled by zone share on screen. OPEN QUESTION C-10: derive cash-in
 * from the billing plan and cash-out from the forecast spend.
 */
export const portfolioCashForecasts = pgTable('portfolio_cash_forecasts', {
  /** First day of the month. */
  month: date('month', { mode: 'string' }).primaryKey(),
  cashInKeur: keur('cash_in_keur').notNull(),
  cashOutKeur: keur('cash_out_keur').notNull(),
  position: integer('position').notNull(),
});
