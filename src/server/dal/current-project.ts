import 'server-only';
// The current project of the global pages (R-011): the project the header, the shell and the global screens' links refer to
// when the URL names none. The prototype always fell back to HLT-026 (DEFAULT_PROJECT); a production database has no such
// project, so the fallback follows the data:
//   the last project used (cookie) when it still exists → DEFAULT_PROJECT when the database has it (demo database: the
//   behaviour is unchanged) → the first project of the register → none (a new production database before its first project).
// The fallback of a client is a project of their organisation (the rule of project-context isMineProject), never another
// organisation's; a project they opened themselves stays current (what a client may open is P-1, R-042 of the rights lot).
import { asc, eq } from 'drizzle-orm';
import { CLIENT_ORG } from '@/config/personas';
import { DEFAULT_PROJECT } from '@/config/screens';
import { getDb } from '@/server/db/client';
import { clients, projects } from '@/server/db/schema';

/** Pure choice (tests): `remembered` when known, else DEFAULT_PROJECT when known, else the first code, else null. */
export function chooseCurrentProject(remembered: string | null | undefined, codes: readonly string[]): string | null {
  if (remembered && codes.includes(remembered)) return remembered;
  if (codes.includes(DEFAULT_PROJECT)) return DEFAULT_PROJECT;
  return codes[0] ?? null;
}

/** The current project for a remembered code and a viewer (null when the viewer has no project). */
export async function resolveCurrentProject(remembered: string | null | undefined, viewer?: { role: string }): Promise<string | null> {
  const db = await getDb();
  const rows = await db
    .select({ code: projects.code, client: clients.name })
    .from(projects)
    .leftJoin(clients, eq(clients.id, projects.clientId))
    .orderBy(asc(projects.sortOrder), asc(projects.code));
  if (remembered && rows.some((r) => r.code === remembered)) return remembered;
  const pool = viewer?.role === 'client' ? rows.filter((r) => r.client === CLIENT_ORG) : rows;
  return chooseCurrentProject(null, pool.map((r) => r.code));
}
