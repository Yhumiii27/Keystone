// Project control (docs/spec/11 §3.3 StatusSnapshot, §3.5 ContingencyRegister / ContingencyDraw, §3.7 Risk;
// screens 07 §2.1 risks, 04 §2 trends, 04 §5 contingency): risks, weekly status snapshots, generated status
// reports, contingency registers and draw-downs.
import { date, index, integer, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import type {
  ContingencyDrawStatus, ContingencyLinkType, ReportAudience, ReportPeriod, ReportSections, RiskCategory, RiskResponse, RiskStatus, RiskTrend,
} from '../codes';
import { id, keur, num, timestamps } from './_common';
import { persons } from './organisation';
import { activities } from './planning';
import { projects } from './portfolio';

/**
 * Risk register (RISKS_HLT 3487 for HLT-026; the 5 other projects with data get the prototype's generated
 * register: RISKS_HLT[0..3] renumbered R-01…R-04, owned by the project PM, EMV scaled to the BAC).
 * Score and level are derived (codes.ts riskScore / riskLevelOf). Delivery 7 (Q-1): the cost if the risk occurs is
 * entered and stored (`costKeur`); the EMV is derived from it (cost × P / 5, src/domain/risk.ts emvOf).
 */
export const risks = pgTable(
  'risks',
  {
    id: id(),
    projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
    /** "R-03" (numbering global in the prototype: added risks R-21…, OPEN QUESTION Q-7). */
    number: text('number').notNull(),
    title: text('title').notNull(),
    category: text('category').$type<RiskCategory>().notNull(),
    /** 1–5 each. */
    probability: integer('probability').notNull(),
    impact: integer('impact').notNull(),
    ownerPersonId: uuid('owner_person_id').references(() => persons.id),
    response: text('response').$type<RiskResponse>().notNull(),
    responsePlan: text('response_plan').notNull(),
    /** Linked schedule activity (prototype `act`; '' → null). */
    activityId: uuid('activity_id').references(() => activities.id, { onDelete: 'set null' }),
    /**
     * Legacy: the EMV entered before Q-1 (k€). No longer written nor read, except to backfill `costKeur` of a database seeded
     * before delivery 7 (cost = EMV / (P/5), so the EMV shown is unchanged). Drop in a later delivery.
     */
    emvKeur: keur('emv_keur'),
    /** Cost if the risk occurs, k€ (Q-1: entered; EMV = cost × P / 5). Null only on rows not backfilled yet. */
    costKeur: keur('cost_keur'),
    /** "Mill confirms > 2 weeks delay"; "—" when none. */
    trigger: text('trigger').notNull(),
    status: text('status').$type<RiskStatus>().notNull(),
    trend: text('trend').$type<RiskTrend>().notNull(),
    /** Register source order (added risks are prepended with a lower value). */
    sortOrder: integer('sort_order').notNull(),
    ...timestamps,
  },
  (t) => [unique().on(t.projectId, t.number), index('risks_activity_id_idx').on(t.activityId)],
);

/**
 * Weekly status snapshots frozen at each Friday status date (HLT_SNAPS 3486 × SNAP_WEEKS 3485 / SNAP_DATES 4566
 * for HLT-026; the 5 other projects with data get the prototype's generated linear series, 04 §2.6).
 */
export const statusSnapshots = pgTable(
  'status_snapshots',
  {
    id: id(),
    projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
    /** "W39" (ISO week of the status date). */
    weekCode: text('week_code').notNull(),
    statusDate: date('status_date', { mode: 'string' }).notNull(),
    cpi: num('cpi').notNull(),
    spi: num('spi').notNull(),
    eacKeur: keur('eac_keur').notNull(),
    /** Critical-path float, days (signed). */
    floatDays: integer('float_days').notNull(),
    /** Σ EMV of open risks at that date, k€. */
    riskEmvKeur: keur('risk_emv_keur').notNull(),
    milestoneSlipDays: integer('milestone_slip_days').notNull(),
    frozenAt: timestamp('frozen_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.projectId, t.weekCode)],
);

/** Status reports generated from the Trends screen (AF.trends — the prototype only toasts, nothing is seeded). */
export const statusReports = pgTable('status_reports', {
  id: id(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  period: text('period').$type<ReportPeriod>().notNull(),
  audience: text('audience').$type<ReportAudience>().notNull(),
  sections: text('sections').$type<ReportSections>().notNull(),
  /** "Manager note". */
  note: text('note'),
  /** Status date the report was generated for. */
  statusDate: date('status_date', { mode: 'string' }).notNull(),
  generatedByPersonId: uuid('generated_by_person_id').references(() => persons.id),
  generatedAt: timestamp('generated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('status_reports_project_id_idx').on(t.projectId)]);

/**
 * Contingency provision of a project (CONTINGENCY 3720: HLT-026 initial 150 k€). Projects without a row use
 * the default round(BAC × 3 %) (04 §5.3); the row is created on their first draw-down.
 */
export const contingencyRegisters = pgTable('contingency_registers', {
  id: id(),
  projectId: uuid('project_id').notNull().unique().references(() => projects.id, { onDelete: 'cascade' }),
  initialKeur: keur('initial_keur').notNull(),
  ...timestamps,
});

/**
 * Draw-downs on the contingency (CONTINGENCY.draws; AF.contingency). Stored oldest first.
 * Delivery 7 (R-071, C-4): a draw-down is linked to a change request, a risk or an NCR of the project and only counts once
 * the portfolio director validates it in My approvals (submitted → validated / rejected). The prototype's draw-downs were
 * approved when recorded: they are `validated` (the column default, which also covers a database seeded before).
 */
export const contingencyDraws = pgTable('contingency_draws', {
  id: id(),
  registerId: uuid('register_id').notNull().references(() => contingencyRegisters.id, { onDelete: 'cascade' }),
  drawnOn: date('drawn_on', { mode: 'string' }).notNull(),
  amountKeur: keur('amount_keur').notNull(),
  reason: text('reason').notNull(),
  /** Reference of the linked item ("CR-004", "R-03", "NCR-026"); required for the draw-downs recorded in Keystone. */
  linkRef: text('link_ref'),
  /** Kind of the linked item; linkedEntityId = the change request / risk / Vigie NCR mirror row (null when not resolved). */
  linkedEntityType: text('linked_entity_type').$type<ContingencyLinkType>(),
  linkedEntityId: uuid('linked_entity_id'),
  /** Who validated it (the prototype's "Approved by"); null while awaiting validation or when rejected. */
  approvedByPersonId: uuid('approved_by_person_id').references(() => persons.id),
  position: integer('position').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  // ── Delivery 7 (R-071) ──
  status: text('status').$type<ContingencyDrawStatus>().notNull().default('validated'),
  /** Who recorded it (the "Requested by" of My approvals). */
  requestedByPersonId: uuid('requested_by_person_id').references(() => persons.id),
  requestedByName: text('requested_by_name'),
  /** The director's decision (validated or rejected): who, when, comment. */
  decidedByPersonId: uuid('decided_by_person_id').references(() => persons.id),
  decidedAt: timestamp('decided_at', { withTimezone: true }),
  decisionComment: text('decision_comment'),
}, (t) => [index('contingency_draws_register_id_idx').on(t.registerId)]);
