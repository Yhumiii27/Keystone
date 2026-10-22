// Data shared with the other EPC2I tools (docs/delivery-9/notes-share-views.md). Most pub_ views read the business tables
// directly (drizzle/0035_share.sql, 0038_share_followup.sql); this table holds what SQL cannot compute: a project's earned-value
// progress and SPI, computed in TypeScript at its data date (src/server/dal/evm.ts) and refreshed by the scheduled job
// `share-progress` (src/server/dal/share-progress.ts). Read by pub_avancement_projets (Arche, R-189). Sales side only: no cost,
// rate, CPI, EAC or margin is stored here (open question P-05 / AC-2).
import { date, pgTable, timestamp, uuid } from 'drizzle-orm/pg-core';
import { num } from './_common';
import { projects } from './portfolio';

/** One row per project: its progress and SPI as Keystone shows them (the projects register's rule), and when they last changed. */
export const shareProjectProgress = pgTable('share_project_progress', {
  projectId: uuid('project_id').primaryKey().references(() => projects.id, { onDelete: 'cascade' }),
  /** Data date the figures are computed at (the project's data date, else the business date). */
  situationOn: date('situation_on', { mode: 'string' }).notNull(),
  /** Physical progress, % (0–100, one decimal). */
  progressPct: num('progress_pct').notNull(),
  /** Schedule performance index EV / PV at the data date (two decimals); null without a planned value. */
  spi: num('spi'),
  /** When the values last changed (a refresh that changes nothing keeps it): `maj_le` of pub_avancement_projets. */
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
