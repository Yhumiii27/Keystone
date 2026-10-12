// Resources and HR (docs/spec/11 §3.3 Calendar / WhatIf, §3.6; screens 06 resources, rates, skills, leave,
// hours; 05 §4 what-if levelling): weekly allocations, the dated rate grid (roles, multipliers and their versions — R-083),
// skills and certifications,
// leave and public holidays, Lucca hours imports, what-if levers and scenarios.
import { boolean, date, integer, jsonb, pgTable, primaryKey, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import type { HoursMatching, LeaveType, RateMultiplierKey, WhatIfActionKind, WhatIfLeverCode, WhatIfPriority } from '../codes';
import { id, keur, num, timestamps } from './_common';
import { departments, persons } from './organisation';
import { activities, wbsNodes } from './planning';
import { projects } from './portfolio';

// ── Allocations ────────────────────────────────────────────────────────────────────────────────────────

/**
 * Weekly load of a person, % of available hours (PEOPLE[i][2]: 8 weeks from w/c 28 Sep 2026). The prototype
 * holds one total per week (projectId null); project-level rows are allowed for later use.
 * Pool membership and order: persons.resourcePoolPosition.
 */
export const allocations = pgTable(
  'allocations',
  {
    id: id(),
    personId: uuid('person_id').notNull().references(() => persons.id, { onDelete: 'cascade' }),
    /** Monday of the week. */
    weekStart: date('week_start', { mode: 'string' }).notNull(),
    loadPct: num('load_pct').notNull(),
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }),
  },
  (t) => [unique().on(t.personId, t.weekStart, t.projectId).nullsNotDistinct()],
);

// ── Rates ──────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Roles of the rate grid (RATE_ROLES 3454): the identity only — R-083 moved the base rate to its dated versions
 * (`rate_role_rates`, the single source; the former base_rate_eur / effective_from columns are retired). Rates are visible to
 * the director, the PMs and Finance (`canSeeRates`) and edited by the director and Finance (`canEditRates`, P-12 c).
 */
export const rateRoles = pgTable('rate_roles', {
  id: id(),
  /** "Project manager", "Contractor — structural (external)". */
  role: text('role').notNull().unique(),
  /** /external/ in the role name. */
  isExternal: boolean('is_external').notNull(),
  /** "Add role" form fields — information only (R-4b: the grade does not change the rate). */
  costCenter: text('cost_center'),
  grade: text('grade'),
  position: integer('position').notNull(),
  ...timestamps,
});

/**
 * R-083 (A-10, R-4a): dated base rates of a grid role — the single source of an hourly rate. The version in force on a date is
 * the latest `effective_from` on or before it (`rateAt`, src/domain/hr.ts); one version per role and date.
 */
export const rateRoleRates = pgTable(
  'rate_role_rates',
  {
    id: id(),
    rateRoleId: uuid('rate_role_id').notNull().references(() => rateRoles.id, { onDelete: 'cascade' }),
    effectiveFrom: date('effective_from', { mode: 'string' }).notNull(),
    baseRateEur: num('base_rate_eur').notNull(),
    createdByName: text('created_by_name'),
    createdByPersonId: uuid('created_by_person_id').references(() => persons.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.rateRoleId, t.effectiveFrom)],
);

/** Premium multipliers (MULTS 3455): the identity — the factor is dated (`rate_multiplier_rates`, R-083). */
export const rateMultipliers = pgTable('rate_multipliers', {
  key: text('key').$type<RateMultiplierKey>().primaryKey(),
  /** EN source string: "Overtime > 8 h/day". */
  label: text('label').notNull(),
  position: integer('position').notNull(),
  ...timestamps,
});

/** R-083 (A-10): dated factors of a premium multiplier (`multiplierAt`); one version per key and date. */
export const rateMultiplierRates = pgTable(
  'rate_multiplier_rates',
  {
    id: id(),
    key: text('key').$type<RateMultiplierKey>().notNull().references(() => rateMultipliers.key, { onDelete: 'cascade' }),
    effectiveFrom: date('effective_from', { mode: 'string' }).notNull(),
    factor: num('factor').notNull(),
    createdByName: text('created_by_name'),
    createdByPersonId: uuid('created_by_person_id').references(() => persons.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.key, t.effectiveFrom)],
);

// The legacy rate per job title (RATES 3262, `job_title_rates`) is retired by R-083 (A-10: one valuation of hours, by the
// person's grid role — persons.rate_role_id).

// ── Skills ─────────────────────────────────────────────────────────────────────────────────────────────

/** Skill families (SKILLS 3456; matrix column order). */
export const skills = pgTable('skills', {
  id: id(),
  name: text('name').notNull().unique(),
  /** "Add skill" form category (Engineering, Site, Automation, Management, Safety); null for seed skills. */
  category: text('category'),
  position: integer('position').notNull(),
});

/** Level 0–5 of a person on a skill (SKILL_LV 3457; 0 = none). */
export const personSkills = pgTable(
  'person_skills',
  {
    personId: uuid('person_id').notNull().references(() => persons.id, { onDelete: 'cascade' }),
    skillId: uuid('skill_id').notNull().references(() => skills.id, { onDelete: 'cascade' }),
    level: integer('level').notNull(),
  },
  (t) => [primaryKey({ columns: [t.personId, t.skillId] })],
);

/** Certifications (CERTS 3458, one free-text line per person split on " · "). Expiry tracked in Lucca. */
export const certifications = pgTable('certifications', {
  id: id(),
  personId: uuid('person_id').notNull().references(() => persons.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  expiresOn: date('expires_on', { mode: 'string' }),
  position: integer('position').notNull(),
});

// ── Leave and calendar ─────────────────────────────────────────────────────────────────────────────────

/** Leave types with the working days lost in a week (LEAVE_DAYS 3460). */
export const leaveTypes = pgTable('leave_types', {
  code: text('code').$type<LeaveType>().primaryKey(),
  /** Lucca label "CP", "RTT", "Sick", "Training". */
  label: text('label').notNull(),
  daysPerWeek: integer('days_per_week').notNull(),
  position: integer('position').notNull(),
});

/** Approved absences mirrored from Lucca (LEAVE 3459, week-indexed in the prototype → one row per week). */
export const leaveEntries = pgTable('leave_entries', {
  id: id(),
  personId: uuid('person_id').notNull().references(() => persons.id, { onDelete: 'cascade' }),
  leaveType: text('leave_type').$type<LeaveType>().notNull().references(() => leaveTypes.code),
  /** Monday of the week the absence falls in. */
  weekStart: date('week_start', { mode: 'string' }).notNull(),
  startDate: date('start_date', { mode: 'string' }).notNull(),
  endDate: date('end_date', { mode: 'string' }).notNull(),
  /** Working days lost (LEAVE_DAYS of the type). */
  days: integer('days').notNull(),
  /** Read-only mirror: always approved in Lucca. */
  status: text('status').notNull().default('approved'),
  source: text('source').notNull().default('lucca'),
  externalId: text('external_id'),
});

/** Public holidays (SETTINGS0.holidays 3467, France 2026; HOLIDAYS 3461 = those on a weekday of the 8-week window). */
export const publicHolidays = pgTable(
  'public_holidays',
  {
    id: id(),
    countryCode: text('country_code').notNull().default('FR'),
    date: date('date', { mode: 'string' }).notNull(),
    /** "Armistice". */
    name: text('name').notNull(),
    position: integer('position').notNull(),
  },
  (t) => [unique().on(t.countryCode, t.date)],
);

// ── Lucca hours ────────────────────────────────────────────────────────────────────────────────────────

/** Monthly import of hours declared in Lucca on the project analytic code (HOURS 3735: HLT-026, September 2026). */
export const hoursImports = pgTable(
  'hours_imports',
  {
    id: id(),
    projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
    /** "HAV004". */
    analyticCode: text('analytic_code').notNull(),
    /** First day of the imported month. */
    periodStart: date('period_start', { mode: 'string' }).notNull(),
    importedOn: date('imported_on', { mode: 'string' }).notNull(),
    source: text('source').notNull().default('lucca'),
    matchingMode: text('matching_mode').$type<HoursMatching>().notNull(),
    ...timestamps,
  },
  (t) => [unique().on(t.projectId, t.periodStart)],
);

/** Matched lines: resource × work package, planned vs declared hours. */
export const hoursLines = pgTable('hours_lines', {
  id: id(),
  importId: uuid('import_id').notNull().references(() => hoursImports.id, { onDelete: 'cascade' }),
  personId: uuid('person_id').notNull().references(() => persons.id),
  wbsNodeId: uuid('wbs_node_id').references(() => wbsNodes.id, { onDelete: 'set null' }),
  /** Label as imported: "1.3 · Foundations". */
  wbsLabel: text('wbs_label').notNull(),
  plannedH: num('planned_h').notNull(),
  declaredH: num('declared_h').notNull(),
  position: integer('position').notNull(),
});

/** Hours declared without a planned task ("To assign"). */
export const unassignedHours = pgTable('unassigned_hours', {
  id: id(),
  importId: uuid('import_id').notNull().references(() => hoursImports.id, { onDelete: 'cascade' }),
  personId: uuid('person_id').notNull().references(() => persons.id),
  hours: num('hours').notNull(),
  /** "Declared on HAV004 · no planned task this month". */
  reason: text('reason').notNull(),
  /** "Assign" target (OPEN QUESTION R-6; no handler in the prototype). */
  assignedWbsNodeId: uuid('assigned_wbs_node_id').references(() => wbsNodes.id, { onDelete: 'set null' }),
  assignedAt: timestamp('assigned_at', { withTimezone: true }),
  position: integer('position').notNull(),
});

// ── What-if levelling ──────────────────────────────────────────────────────────────────────────────────

/** Levelling levers with their static effects (LEVERS 3462; OPEN QUESTION S-7). */
export const whatIfLevers = pgTable('whatif_levers', {
  code: text('code').$type<WhatIfLeverCode>().primaryKey(),
  /** EN source string. */
  label: text('label').notNull(),
  /** Float gained (days), cost (k€), peak load change (points), people above 100 % change. */
  floatDays: integer('float_days').notNull(),
  costKeur: keur('cost_keur').notNull(),
  peakPts: integer('peak_pts').notNull(),
  overPeople: integer('over_people').notNull(),
  /** "Westfield SPI −0.02". */
  sideEffect: text('side_effect'),
  position: integer('position').notNull(),
});

/** Auto-level rule: levers enabled for a priority (AUTO 3463). */
export const whatIfAutoLevers = pgTable(
  'whatif_auto_levers',
  {
    priority: text('priority').$type<WhatIfPriority>().notNull(),
    leverCode: text('lever_code').$type<WhatIfLeverCode>().notNull().references(() => whatIfLevers.code),
    position: integer('position').notNull(),
  },
  (t) => [primaryKey({ columns: [t.priority, t.leverCode] })],
);

/**
 * Levelling context of a project: the 8-week peak-load profile the scenarios start from (hard-coded
 * [100,110,130,125,110,100,80,60] for HLT-026 in the prototype, 05 §4.4).
 */
export const whatIfContexts = pgTable('whatif_contexts', {
  projectId: uuid('project_id').primaryKey().references(() => projects.id, { onDelete: 'cascade' }),
  weekStart: date('week_start', { mode: 'string' }).notNull(),
  peakLoad: integer('peak_load').array().notNull(),
});

/** Scenarios (state.whatif A/B of HLT-026; "New scenario" form fields). */
export const whatIfScenarios = pgTable(
  'whatif_scenarios',
  {
    id: id(),
    projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
    /** "A", "B". */
    name: text('name').notNull(),
    priority: text('priority').$type<WhatIfPriority>().notNull(),
    /** "Select scenario" (state.chosen). */
    selected: boolean('selected').notNull().default(false),
    /** New scenario form: basis (Current plan / Baseline BL1 / Last approved scenario), horizon months, hypotheses. */
    basis: text('basis'),
    horizonMonths: integer('horizon_months'),
    hypotheses: text('hypotheses'),
    position: integer('position').notNull(),
    // ── Chapter 4 (S-7): persisted scenarios with computed effects. ──
    createdByPersonId: uuid('created_by_person_id').references(() => persons.id),
    createdByName: text('created_by_name'),
    /** Effects computed by the CPM engine on a copy of the plan (new finish, cost delta, load delta…), and when. */
    result: jsonb('result').$type<Record<string, unknown>>(),
    computedAt: timestamp('computed_at', { withTimezone: true }),
    /** "Apply" drafted resource requests (resource_requests.scenario_id). */
    appliedAt: timestamp('applied_at', { withTimezone: true }),
    appliedByName: text('applied_by_name'),
    ...timestamps,
  },
  (t) => [unique().on(t.projectId, t.name)],
);

export const whatIfScenarioLevers = pgTable(
  'whatif_scenario_levers',
  {
    scenarioId: uuid('scenario_id').notNull().references(() => whatIfScenarios.id, { onDelete: 'cascade' }),
    leverCode: text('lever_code').$type<WhatIfLeverCode>().notNull().references(() => whatIfLevers.code),
    enabled: boolean('enabled').notNull(),
  },
  (t) => [primaryKey({ columns: [t.scenarioId, t.leverCode] })],
);

/**
 * Chapter 4 (S-7): actions of a scenario, derived from real allocations — overtime (more hours per day on an activity), an
 * extra resource (shorter duration) or a shifted start (start constraint). `params` holds the figures ({ hoursPerDay },
 * { extraUnits, hoursPerDay }, { shiftDays } …); the effects are computed on an in-memory copy of the plan.
 */
export const whatIfScenarioActions = pgTable('whatif_scenario_actions', {
  id: id(),
  scenarioId: uuid('scenario_id').notNull().references(() => whatIfScenarios.id, { onDelete: 'cascade' }),
  position: integer('position').notNull(),
  kind: text('kind').$type<WhatIfActionKind>().notNull(),
  activityId: uuid('activity_id').references(() => activities.id, { onDelete: 'cascade' }),
  personId: uuid('person_id').references(() => persons.id),
  departmentId: uuid('department_id').references(() => departments.id),
  params: jsonb('params').$type<Record<string, unknown>>().notNull().default({}),
  enabled: boolean('enabled').notNull().default(true),
  /** EN source label ("Overtime 10 h/d on A1250"). */
  label: text('label').notNull().default(''),
  ...timestamps,
});
