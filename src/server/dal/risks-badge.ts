import 'server-only';
// Sidebar badge of the Risk register (docs/spec/07 §1.1, logic 5146): number of open risks with score
// (probability × impact) ≥ 15, shown only when > 0. HLT-026 seed → "1"; every generated register → "1".
// The shell can call riskBadge(code) per project or riskBadges() once for every project (one query).
import { and, eq, gte, sql } from 'drizzle-orm';
import { RISK_CRITICAL, badgeText } from '@/domain/risk';
import { getDb } from '@/server/db/client';
import { projects, risks } from '@/server/db/schema';

const critical = and(eq(risks.status, 'open'), gte(sql`${risks.probability} * ${risks.impact}`, RISK_CRITICAL));

/** Badge text of the Risk register for one project: "1", or '' when no open risk scores ≥ 15. */
export async function riskBadge(projectCode: string): Promise<string> {
  const db = await getDb();
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(risks)
    .innerJoin(projects, eq(projects.id, risks.projectId))
    .where(and(eq(projects.code, projectCode), critical));
  return badgeText(r?.n ?? 0);
}

/** Badge texts of every project that has at least one open risk scoring ≥ 15, keyed by project code. */
export async function riskBadges(): Promise<Record<string, string>> {
  const db = await getDb();
  const rows = await db
    .select({ code: projects.code, n: sql<number>`count(*)::int` })
    .from(risks)
    .innerJoin(projects, eq(projects.id, risks.projectId))
    .where(critical)
    .groupBy(projects.code);
  return Object.fromEntries(rows.filter((r) => r.n > 0).map((r) => [r.code, badgeText(r.n)]));
}
