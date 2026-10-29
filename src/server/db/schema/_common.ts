// Shared column helpers (docs/spec/11 §0). Relative imports only: drizzle-kit loads these files directly.
import { doublePrecision, integer, numeric, timestamp, uuid } from 'drizzle-orm/pg-core';

/** Surrogate key (UUID). Seeds generate ids client-side so foreign keys can be resolved in one pass. */
export const id = () => uuid('id').primaryKey().defaultRandom();

/** Money in thousands of euros (k€), arbitrary-precision numeric read back as a JS number. */
export const keur = (name: string) => numeric(name, { mode: 'number' });

/** Money in euros (part prices, purchase orders, supplier invoices, stock values — docs/spec/11 §0 `eur`). */
export const eur = (name: string) => numeric(name, { mode: 'number' });

/** Plain numeric read back as a JS number (ratios, hours, percentages). */
export const num = (name: string) => numeric(name, { mode: 'number' });

/** Fractional month offsets (e.g. 9.8 months since project start); double keeps prototype values bit-exact. */
export const months = (name: string) => doublePrecision(name);

export const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
};

/**
 * R-010: version of an edited record (optimistic locking). Starts at 1; a database trigger (`ks_bump_row_version`, migration
 * "row_versions") adds 1 whenever an UPDATE changes the row's content, except the derived columns the trigger names (CPM dates,
 * positions…) and `updated_at`. A writer that changes what belongs to the record without touching its row (an activity's
 * relationships) sets `version = version + 1` itself. Edit forms carry it back (src/domain/record-version.ts) and the writers
 * refuse a save on a record changed meanwhile by someone else (src/server/dal/record-version.ts).
 */
export const rowVersion = () => integer('version').notNull().default(1);
