// Matrix D21 (REQUESTS.md entry "Relier les clients filiales au code de la filiale de Matrix" of 23 Oct 2026; notes
// docs/delivery-9/notes-matrix-d21-d22.md): read-only mirror of Matrix's view matrix.pub_filiales — the group's subsidiaries.
// Matrix is the source of truth (D21): the mirror is replaced by every successful read (src/server/integrations/matrix/
// subsidiaries.ts) and never written otherwise. It gives the choices of the Contract screen's "Client" card and the client codes
// reserved to a subsidiary (clients.code3, src/server/dal/subsidiaries.ts).
import { boolean, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { CODE3_RE, COUNTRY_RE, CURRENCY_RE, filled, shaped } from './_checks';

export const matrixSubsidiaries = pgTable('matrix_subsidiaries', {
  /** pub_filiales.code: three capitals ("SAI"), stable — Arche's CAPEX codes, keystone.clients.code3 of the subsidiary. */
  code: text('code').primaryKey(),
  /** pub_filiales.nom. */
  name: text('name').notNull(),
  countryIso2: text('country_iso2'),
  zoneCode: text('zone_code'),
  /** ISO 4217 (pub_filiales.devise). */
  currency: text('currency'),
  /** pub_filiales.ordre: display order. */
  position: integer('position'),
  /** pub_filiales.actif: an inactive subsidiary is neither offered nor reserved. */
  active: boolean('active').notNull(),
  /** When this copy was written by a read of the source. */
  syncedAt: timestamp('synced_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  shaped('matrix_subsidiaries_code_shape', t.code, CODE3_RE),
  filled('matrix_subsidiaries_name_filled', t.name),
  shaped('matrix_subsidiaries_country_iso2_shape', t.countryIso2, COUNTRY_RE),
  shaped('matrix_subsidiaries_currency_shape', t.currency, CURRENCY_RE),
]);
