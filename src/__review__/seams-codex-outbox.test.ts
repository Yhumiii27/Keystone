// Throwaway review test (seams): R-010 outbox claims / R-006 job worker × R-124 Codex outbox.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { getDb, setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { documents } from '@/server/db/schema';
import { insertCodexEntry } from '@/server/integrations/codex/outbox';
import { httpCodexConnector } from '@/server/integrations/codex/connector';
import { JOB_SCHEDULES } from '@/domain/jobs';

beforeAll(async () => {
  setDb(await openDatabase());
}, 120_000);
afterAll(() => {
  vi.unstubAllGlobals();
  delete process.env.CODEX_API_URL;
});

describe('Codex outbox', () => {
  it('two concurrent deliveries POST the same entry twice; no job redelivers it', async () => {
    const db = await getDb();
    const [d] = await db.select({ id: documents.id, number: documents.number }).from(documents).limit(1);
    await insertCodexEntry(db, {
      documentId: d.id, documentNumber: d.number, revision: 'A', kind: 'approval', stepPosition: 1, role: 'pm' as never, decision: 'approved' as never,
      actorName: 'Romain Aubert', actorPersonId: null, actorRole: 'pm', recordedAt: new Date(),
    });
    process.env.CODEX_API_URL = 'http://codex.test';
    const posts: string[] = [];
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        posts.push(String(url));
        await new Promise((r) => setTimeout(r, 50));
        return new Response(JSON.stringify({ id: `cx-${posts.length}` }), { status: 200 });
      }
      return new Response('[]', { status: 200 });
    });
    await Promise.all([httpCodexConnector.sync(), httpCodexConnector.sync()]);
    (await import('node:fs')).writeFileSync('/tmp/claude-0/-home-user-Keystone/daa84d35-0be7-57a3-895a-75069f5e62a4/scratchpad/rv/codex.json', JSON.stringify({ posts, jobs: JOB_SCHEDULES.map((j) => j.name) }));
    expect(posts.length).toBeGreaterThan(0);
  }, 300_000);
});
