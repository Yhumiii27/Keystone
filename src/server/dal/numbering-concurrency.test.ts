// R-010 — business numbering under concurrent writers. The number is read ("max + 1") inside the writer's transaction; PGlite
// runs transactions one at a time and the PostgreSQL server takes Keystone's write lock first (src/server/db/transactions.ts), so
// simultaneous writers get consecutive numbers. Should a writer ever draw a number taken meanwhile, the insert fails on the
// numbering's unique constraint and the transaction is run again (NUMBERING_CONSTRAINTS) — checked here with a real collision.
// The same scenarios on separate PostgreSQL connections: src/server/db/postgres.integration.test.ts (KEYSTONE_TEST_DATABASE_URL).
import { beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { getDb, setDb } from '@/server/db/client';
import { nextNumber, requireProject } from '@/server/db/helpers';
import { openDatabase } from '@/server/db/open';
import { risks } from '@/server/db/schema';
import { addActivityTodo } from './activity-todos';
import { createRisk } from './risks';

const riskInput = (title: string) => ({ title, category: 'technical' as const, probability: 2, impact: 2, owner: null, response: 'mitigate' as const, costKeur: 0, plan: '' });

describe('business numbering under concurrent writers', () => {
  beforeAll(async () => {
    setDb(await openDatabase());
  }, 60_000);

  it('8 risks created at once get 8 distinct, consecutive numbers', async () => {
    const numbers = await Promise.all(Array.from({ length: 8 }, (_, i) => createRisk('HLT-026', riskInput(`Concurrent ${i}`), 'Romain Aubert')));
    const n = numbers.map((x) => Number(x.slice(2))).sort((a, b) => a - b);
    expect(new Set(numbers).size).toBe(8);
    expect(n.at(-1)! - n[0]).toBe(7);
  });

  it('6 to-dos added at once on different activities get distinct task numbers', async () => {
    const acts = ['A1250', 'A1260', 'A1320', 'A1330', 'A1520', 'A1610'];
    const ids = await Promise.all(acts.map((a) => addActivityTodo('HLT-026', a, { title: `Concurrent to-do ${a}`, assignee: 'Romain Aubert' }, 'Romain Aubert')));
    expect(new Set(ids).size).toBe(6);
    for (const id of ids) expect(id).toMatch(/^T-\d{4,}$/);
  });

  it('a number taken meanwhile: the insert fails on its unique constraint and the transaction is run again with the next number', async () => {
    const db = await getDb();
    const p = await requireProject(db, 'HLT-026');
    const stale = await nextNumber(db, risks, risks.number, 'R-', 2, 20);
    // Another writer takes that number first (committed).
    await createRisk('HLT-026', riskInput('Taken meanwhile'), 'Léa Marchand');
    let attempts = 0;
    const got = await db.transaction(async (tx) => {
      attempts++;
      const number = attempts === 1 ? stale : await nextNumber(tx, risks, risks.number, 'R-', 2, 20);
      await tx.insert(risks).values({
        projectId: p.id, number, title: 'Collision', category: 'technical', probability: 1, impact: 1, response: 'accept', responsePlan: '—', trigger: '—',
        status: 'open', trend: 'flat', sortOrder: -1000, costKeur: 0,
      });
      return number;
    });
    expect(attempts).toBe(2);
    expect(Number(got.slice(2))).toBe(Number(stale.slice(2)) + 1);
    expect((await db.select({ n: risks.number }).from(risks).where(and(eq(risks.projectId, p.id), eq(risks.title, 'Collision')))).map((r) => r.n)).toEqual([got]);
  });
});
