import 'server-only';
// Rights of a person read in Clavis's publication clavis.pub_acces on the shared server (owner, 23 Nov 2026: one database
// for every tool; KEYSTONE_ACCESS_FROM_CLAVIS=on). Read with Keystone's own connection (role keystone_app, SELECT granted
// by Matrix): at sign-in and on every request, so a change made by IT in Clavis applies at the next page. Never writes.
// A failure (view missing, grant missing) throws: the caller refuses the access (fail closed).
import { sql } from 'drizzle-orm';
import { getDb } from '@/server/db/client';
import type { DB } from '@/server/db/types';

export const CLAVIS_ACCESS_VIEW = 'clavis.pub_acces';

/** Keystone's application code in Clavis. */
const APPLICATION = 'keystone';

/** The person's Keystone row of clavis.pub_acces (`personne_id` = the `oid` of the sign-in token), or null. */
export async function readClavisAccess(personId: string, db?: DB): Promise<Record<string, unknown> | null> {
  const q = db ?? (await getDb());
  const rows = (await q.execute(sql`select to_jsonb(v) as r from ${sql.raw(CLAVIS_ACCESS_VIEW)} v
    where v.personne_id::text = ${personId} and v.application = ${APPLICATION} limit 1`)).rows as { r: Record<string, unknown> | string }[];
  const r = rows[0]?.r;
  return r == null ? null : typeof r === 'string' ? (JSON.parse(r) as Record<string, unknown>) : r;
}
