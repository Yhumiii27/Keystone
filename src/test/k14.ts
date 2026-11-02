// K-14 (Arche, approved 2 Nov 2026): the demo data set adds APM-008, the project delivering Arche's need CPX-APM-2025-01/B01
// (src/server/db/seed/capex-k14.ts) — a register row, a site, a machine of the installed base (MCH-045), an accepted offer (RB-006)
// and its client Atlas Process Maroc (internal). The golden tests compare Keystone with the prototype, which has none of them: they
// run on the demo database without these rows (and say so). RCF-019's planned SAT stays (no prototype screen reads it).
import { eq, or } from 'drizzle-orm';
import { K14_CLIENT, K14_MACHINE, K14_PROJECT } from '@/server/db/seed/capex-k14';
import { clients, machines, needAnswers, projects } from '@/server/db/schema';
import type { DB } from '@/server/db/types';

/** The demo database without the K-14 project, its machine, its answer and its client (the project's other rows cascade). */
export async function withoutK14Demo(db: DB): Promise<DB> {
  await db.delete(needAnswers).where(eq(needAnswers.needRef, K14_PROJECT.needRef));
  await db.delete(machines).where(eq(machines.number, K14_MACHINE));
  await db.delete(projects).where(eq(projects.code, K14_PROJECT.code));
  await db.delete(clients).where(or(eq(clients.subsidiaryCode, K14_CLIENT.subsidiaryCode), eq(clients.name, K14_CLIENT.name)));
  return db;
}
