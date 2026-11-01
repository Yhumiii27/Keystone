import 'server-only';
// R-010 — the writers' side of optimistic locking (rules: src/domain/record-version.ts). A writer that saves an edit form calls
// `assertRecordFresh` first, inside its transaction: the record's row is locked (SELECT … FOR UPDATE, so two saves of the same
// record never interleave, whatever the isolation level) and its version compared with the form's token. A record changed
// meanwhile by someone else throws `StaleRecordError` (who and when from its audit entries); the Server Function turns it into
// `{ error: <the refusal>, conflict: true }` (`staleRecordResult`), shown with a "Reload" action by the forms.
import { and, desc, eq, gte, sql } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import { freshness, parseVersionToken, staleRecordText, versionToken, type Saver, type StaleRecord } from '@/domain/record-version';
import type { Lang } from '@/i18n/translate';
import { auditEntries } from '@/server/db/schema';
import type { DB, Tx } from '@/server/db/types';

/** A save refused because the record changed since the form read it. */
export class StaleRecordError extends Error implements StaleRecord {
  constructor(
    readonly by: string | null,
    readonly at: Date | null,
  ) {
    super(`Record modified meanwhile${by ? ` by ${by}` : ''}`);
    this.name = 'StaleRecordError';
  }
}

/** A table under optimistic locking: its id and version columns, and the audit entity type its writers record. */
export interface VersionedTable {
  table: PgTable;
  id: PgColumn;
  version: PgColumn;
  entityType: string;
}

/** The token a screen hands its edit form for a row it just read (`readAt`: when the read started). */
export const tokenOf = (version: number, readAt: Date) => versionToken(version, readAt);

/**
 * Inside the writer's transaction, before writing: refuses (`StaleRecordError`) a save whose `token` was read on another
 * version of the record, unless every change since was the saver's own. No token = no check. A malformed token is refused like
 * a stale one (a forged or truncated value never overwrites silently).
 */
export async function assertRecordFresh(tx: Tx | DB, t: VersionedTable, recordId: string, token: string | null | undefined, saver: Saver): Promise<void> {
  if (token == null || token === '') return;
  const parsed = parseVersionToken(token);
  const [row] = (await tx.select({ version: t.version }).from(t.table).where(eq(t.id, recordId)).for('update')) as { version: number }[];
  if (!row) return; // the writer reports the unknown record itself
  if (!parsed) throw new StaleRecordError(null, null);
  const changes = await tx
    .select({ actorName: auditEntries.actorName, actorPersonId: auditEntries.actorPersonId, at: auditEntries.occurredAt })
    .from(auditEntries)
    .where(and(eq(auditEntries.entityType, t.entityType), eq(auditEntries.entityId, recordId), gte(auditEntries.occurredAt, new Date(parsed.readAt))))
    .orderBy(desc(auditEntries.occurredAt))
    .limit(50);
  const verdict = freshness(row.version, parsed, changes, saver);
  if (!verdict.ok) throw new StaleRecordError(verdict.by, verdict.at);
}

/** `version = version + 1`: for a writer that changes what belongs to a record without touching its row (see rowVersion). */
export const bumpVersion = (version: PgColumn) => sql`${version} + 1`;

/** The Server Functions' answer to a refused save; null for any other error (rethrow it). */
export function staleRecordResult(e: unknown, lang: Lang): { error: string; conflict: true } | null {
  return e instanceof StaleRecordError ? { error: staleRecordText(e, lang), conflict: true } : null;
}
