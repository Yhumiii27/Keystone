// Shared column helpers (docs/spec/11 §0). Relative imports only: drizzle-kit loads these files directly.
import { doublePrecision, numeric, timestamp, uuid } from 'drizzle-orm/pg-core';

/** Surrogate key (UUID). Seeds generate ids client-side so foreign keys can be resolved in one pass. */
export const id = () => uuid('id').primaryKey().defaultRandom();

/** Money in thousands of euros (k€), arbitrary-precision numeric read back as a JS number. */
export const keur = (name: string) => numeric(name, { mode: 'number' });

/** Plain numeric read back as a JS number (ratios, hours, percentages). */
export const num = (name: string) => numeric(name, { mode: 'number' });

/** Fractional month offsets (e.g. 9.8 months since project start); double keeps prototype values bit-exact. */
export const months = (name: string) => doublePrecision(name);

export const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
};
