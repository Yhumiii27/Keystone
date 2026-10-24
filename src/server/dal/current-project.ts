import 'server-only';
// The current project of the global pages (R-011): the project the header, the shell and the global screens' links refer to
// when the URL names none. The prototype always fell back to HLT-026 (DEFAULT_PROJECT); a production database has no such
// project, so the fallback follows the data:
//   the last project used (cookie) when it still exists → DEFAULT_PROJECT when the database has it (demo database: the
//   behaviour is unchanged) → the first project of the register → none (a new production database before its first project).
// A client only ever gets a project of their own organisation (P-10a, R-042): a remembered project of another organisation is
// ignored, and with no organisation (or none of its projects) there is no current project. R-190: never a project whose client is
// a group subsidiary (`clientRefusedProject`).
import { asc, eq } from 'drizzle-orm';
import { DEFAULT_PROJECT } from '@/config/screens';
import { clientRefusedProject } from '@/domain/rights';
import { getDb } from '@/server/db/client';
import { clients, projects } from '@/server/db/schema';

/** Pure choice (tests): `remembered` when known, else DEFAULT_PROJECT when known, else the first code, else null. */
export function chooseCurrentProject(remembered: string | null | undefined, codes: readonly string[]): string | null {
  if (remembered && codes.includes(remembered)) return remembered;
  if (codes.includes(DEFAULT_PROJECT)) return DEFAULT_PROJECT;
  return codes[0] ?? null;
}

/** The current project for a remembered code and a viewer (null when the viewer has no project). */
export async function resolveCurrentProject(remembered: string | null | undefined, viewer?: { role: string; organisation?: string | null }): Promise<string | null> {
  const db = await getDb();
  const rows = await db
    .select({ code: projects.code, client: clients.name, internal: clients.isInternal })
    .from(projects)
    .leftJoin(clients, eq(clients.id, projects.clientId))
    .orderBy(asc(projects.sortOrder), asc(projects.code));
  const pool = viewer?.role === 'client'
    ? rows.filter((r) => !clientRefusedProject({ role: 'client', organisation: viewer.organisation ?? null }, { client: r.client ?? '—', clientInternal: !!r.internal }))
    : rows;
  if (remembered && pool.some((r) => r.code === remembered)) return remembered;
  return chooseCurrentProject(null, pool.map((r) => r.code));
}
