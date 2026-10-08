// Portfolio prioritisation & capacity (docs/spec/11 §3.2 PortfolioScore / ScoreWeight; screen 03 §6): scoring
// axes with their default weights, per-project scores, per-user weights, and the demand rates of the capacity
// what-if (hours per €1M of budget by department, logic 4505).
import { integer, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import type { ScoreAxis } from '../codes';
import { num } from './_common';
import { departments, persons, users } from './organisation';
import { projects } from './portfolio';

/** Scoring axes (SCORE_AXES 3539) with their default weight. */
export const scoreAxes = pgTable('score_axes', {
  code: text('code').$type<ScoreAxis>().primaryKey(),
  /** EN source string: "Strategic fit". */
  label: text('label').notNull(),
  defaultWeight: num('default_weight').notNull(),
  position: integer('position').notNull(),
});

/** Score 1–5 of a project on an axis (SCORES 3540, obsolete codes remapped; for `risk`, 5 = low risk). */
export const portfolioScores = pgTable(
  'portfolio_scores',
  {
    projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
    axis: text('axis').$type<ScoreAxis>().notNull().references(() => scoreAxes.code),
    score: integer('score').notNull(),
    /** "Score a proposal" (AF.portfolio): who scored, when, with the form comment. Null for the seed. */
    scoredByPersonId: uuid('scored_by_person_id').references(() => persons.id),
    scoredAt: timestamp('scored_at', { withTimezone: true }),
    comment: text('comment'),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.axis] })],
);

/** Weights edited on the Prioritisation screen (`pfWeights`), per user (scope OPEN QUESTION L-5). Absent = default. */
export const scoreWeights = pgTable(
  'score_weights',
  {
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    axis: text('axis').$type<ScoreAxis>().notNull().references(() => scoreAxes.code),
    weight: num('weight').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.axis] })],
);

/** Demand per €1M of budget by department (capacity what-if: Engineering 140 h, Site 90, MEP 60, C&P 70, Quality 40). */
export const capacityDemandRates = pgTable('capacity_demand_rates', {
  departmentId: uuid('department_id').primaryKey().references(() => departments.id, { onDelete: 'cascade' }),
  hoursPerMeur: num('hours_per_meur').notNull(),
  position: integer('position').notNull(),
});
