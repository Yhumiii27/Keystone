import 'server-only';
// The current project of the global pages (R-011): the project the header, the shell and the global screens' links refer to
// when the URL names none. The prototype always fell back to HLT-026 (DEFAULT_PROJECT); a production database has no such
// project, so the fallback follows the data:
//   the last project used (cookie) when it still exists → DEFAULT_PROJECT when the database has it (demo database: the
//   behaviour is unchanged) → the first project of the register → none (a new production database before its first project).
// Every viewer is internal since D9-06 (the client's own-organisation filter went with the Client role).
import { asc } from 'drizzle-orm';
import { DEFAULT_PROJECT } from '@/config/screens';
import { getDb } from '@/server/db/client';
import { projects } from '@/server/db/schema';

/** Pure choice (tests): `remembered` when known, else DEFAULT_PROJECT when known, else the first code, else null. */
export function chooseCurrentProject(remembered: string | null | undefined, codes: readonly string[]): string | null {
  if (remembered && codes.includes(remembered)) return remembered;
  if (codes.includes(DEFAULT_PROJECT)) return DEFAULT_PROJECT;
  return codes[0] ?? null;
}

/** The current project for a remembered code (null when there is no project). */
export async function resolveCurrentProject(remembered: string | null | undefined): Promise<string | null> {
  const db = await getDb();
  const pool = await db.select({ code: projects.code }).from(projects).orderBy(asc(projects.sortOrder), asc(projects.code));
  if (remembered && pool.some((r) => r.code === remembered)) return remembered;
  return chooseCurrentProject(null, pool.map((r) => r.code));
}
