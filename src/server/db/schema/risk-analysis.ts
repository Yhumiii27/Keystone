// R-205 (K-205, K-205b): Monte-Carlo risk analysis of a project — the three-point estimates the project manager enters on the
// activities, the delay of the risks linked to an activity, and the stored runs (date, inputs summary, result) so a run is not
// recomputed on every view. Pure model: src/domain/monte-carlo.ts. Relative imports only (drizzle-kit loads this file directly).
import { check, date, index, integer, jsonb, numeric, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { id, keur, timestamps } from './_common';
import { risks } from './control';
import { persons } from './organisation';
import { activities } from './planning';
import { projects } from './portfolio';

/**
 * The three-point estimate of an activity (K-205b): duration in working days and cost at completion in k€, min ≤ most likely ≤
 * max. A triple left null takes the default range (−10 % / +25 % around the current value). One row per activity at most.
 */
export const riskAnalysisRanges = pgTable(
  'risk_analysis_ranges',
  {
    id: id(),
    projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
    activityId: uuid('activity_id').notNull().unique().references(() => activities.id, { onDelete: 'cascade' }),
    durationMin: numeric('duration_min', { mode: 'number' }),
    durationLikely: numeric('duration_likely', { mode: 'number' }),
    durationMax: numeric('duration_max', { mode: 'number' }),
    costMinKeur: keur('cost_min_keur'),
    costLikelyKeur: keur('cost_likely_keur'),
    costMaxKeur: keur('cost_max_keur'),
    updatedByPersonId: uuid('updated_by_person_id').references(() => persons.id),
    updatedByName: text('updated_by_name').notNull(),
    ...timestamps,
  },
  (t) => [
    index('risk_analysis_ranges_project_id_idx').on(t.projectId),
    check(
      'risk_analysis_ranges_duration_check',
      sql`(${t.durationMin} is null and ${t.durationLikely} is null and ${t.durationMax} is null) or (0 <= ${t.durationMin} and ${t.durationMin} <= ${t.durationLikely} and ${t.durationLikely} <= ${t.durationMax})`,
    ),
    check(
      'risk_analysis_ranges_cost_check',
      sql`(${t.costMinKeur} is null and ${t.costLikelyKeur} is null and ${t.costMaxKeur} is null) or (0 <= ${t.costMinKeur} and ${t.costMinKeur} <= ${t.costLikelyKeur} and ${t.costLikelyKeur} <= ${t.costMaxKeur})`,
    ),
  ],
);

/** Delay a risk adds to its linked activity when it occurs (working days); no row = impact × 5 days (domain default). */
export const riskAnalysisDelays = pgTable(
  'risk_analysis_delays',
  {
    id: id(),
    projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
    riskId: uuid('risk_id').notNull().unique().references(() => risks.id, { onDelete: 'cascade' }),
    delayDays: integer('delay_days').notNull(),
    updatedByPersonId: uuid('updated_by_person_id').references(() => persons.id),
    updatedByName: text('updated_by_name').notNull(),
    ...timestamps,
  },
  (t) => [index('risk_analysis_delays_project_id_idx').on(t.projectId), check('risk_analysis_delays_days_check', sql`${t.delayDays} >= 0`)],
);

/** One stored run of the analysis: when, by whom, at which data date, its inputs summary and its result (McResult as JSON). */
export const riskAnalysisRuns = pgTable(
  'risk_analysis_runs',
  {
    id: id(),
    projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
    ranAt: timestamp('ran_at', { withTimezone: true }).notNull().defaultNow(),
    ranByPersonId: uuid('ran_by_person_id').references(() => persons.id),
    ranByName: text('ran_by_name').notNull(),
    dataDate: date('data_date', { mode: 'string' }).notNull(),
    iterations: integer('iterations').notNull(),
    seed: integer('seed').notNull(),
    /** Target finish and budget the probabilities are computed against, and where the target finish comes from. */
    targetFinish: date('target_finish', { mode: 'string' }),
    targetFinishSource: text('target_finish_source').$type<'planned' | 'baseline' | 'none'>().notNull(),
    targetCostKeur: keur('target_cost_keur'),
    /** Inputs summary (activities, entered ranges, risks) and the result (src/domain/monte-carlo.ts McResult). */
    inputs: jsonb('inputs').$type<Record<string, unknown>>().notNull(),
    result: jsonb('result').$type<Record<string, unknown>>().notNull(),
    durationMs: integer('duration_ms').notNull(),
  },
  (t) => [index('risk_analysis_runs_project_ran_idx').on(t.projectId, t.ranAt)],
);
