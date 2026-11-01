// R-203 (K-203, owner 1 Nov 2026): user-configurable dashboards. A user owns their dashboards (name, layout of widgets —
// validated by the zod schema of src/domain/dashboards.ts before it is stored, and again when it is read back) and may share
// one with other internal users, who see it read-only and rendered with THEIR OWN rights (src/server/dal/dashboard-data.ts),
// and may copy it to their own. One dashboard per user may be their default (opened first on My dashboards). Rows are
// personal settings, deleted with their owner's account or by the owner (the audit trail keeps the history, R-168).
// Relative imports only (drizzle-kit loads this file directly).
import { sql } from 'drizzle-orm';
import { boolean, index, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { id, timestamps } from './_common';
import { users } from './organisation';

export const dashboards = pgTable(
  'dashboards',
  {
    id: id(),
    ownerUserId: uuid('owner_user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    /** Typed by the owner (shown as typed). */
    name: text('name').notNull(),
    /** { version: 1, widgets: [...] } — src/domain/dashboards.ts `layoutSchema`. */
    layout: jsonb('layout').notNull(),
    /** The owner's default dashboard (at most one per owner). */
    isDefault: boolean('is_default').notNull().default(false),
    ...timestamps,
  },
  (t) => [
    index('dashboards_owner_idx').on(t.ownerUserId),
    uniqueIndex('dashboards_one_default_per_owner').on(t.ownerUserId).where(sql`${t.isDefault}`),
  ],
);

/** Users a dashboard is shared with (read-only for them, rendered with their own rights). */
export const dashboardShares = pgTable(
  'dashboard_shares',
  {
    dashboardId: uuid('dashboard_id').notNull().references(() => dashboards.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.dashboardId, t.userId] }), index('dashboard_shares_user_idx').on(t.userId)],
);
