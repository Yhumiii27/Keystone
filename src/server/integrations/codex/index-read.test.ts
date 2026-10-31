// Codex connector, Keystone side (Delivery 8, R-033; I-3a, D-1a, D-2 = a, A-15 = a) on a seeded in-memory database with a
// stub Codex over HTTP: the index read (`applyCodexIndex` — upsert of the record, its current revision and circuit; unknown
// projects and types skipped and logged, never filed as QMS), the read recorded as a real sync, the honest Codex row of
// Activity & integrations (live with CODEX_API_URL: outbox counts, last read, "Sync now" exchanging with Codex), the hourly
// "codex-index" job and the local deposit refused while Codex is connected. Without CODEX_API_URL nothing changes (mock).
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { getDb, setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { closeCodexEntries, openCodexEntries } from '@/server/integrations/codex/outbox';
import { documentApprovals, documentIndexSyncs, documentRevisions, documents } from '@/server/db/schema';
import { listAdminConnectors, syncAdminConnector } from '@/server/dal/admin-connectors';
import {
  DepositInCodexOnlyError, depositInCodex, getCodexSyncState, getDocumentRecord, nextCodexIndexSince, listVaultDocuments, refreshCodexIndex,
} from '@/server/dal/documents';
import { listAudit } from '@/server/dal/notifications';
import { jobDefinition } from '@/server/jobs/definitions';
import { applyCodexIndex, type CodexIndexRecord } from './mirror';

const DIRECTOR = { name: 'Marie Lefebvre', role: 'director' };

/** A record of Codex's index (proposed payload, TODO(codex) D-1). */
const rec = (o: Partial<CodexIndexRecord> = {}): CodexIndexRecord => ({
  id: 'CDX-1', url: 'https://codex.epc2i.fr/documents/CDX-1', number: 'RPT-HLT-099', type: 'RPT', project: 'HLT-026', title: 'Crane rail weld inspection',
  service: 'quality', status: 'release_proposed', confidentiality: 'client', author: 'G. Comte', tags: ['A1320', 'D-014'], recipients: ['client'],
  revision: { letter: 'A', issuedOn: '2026-10-01', workingVersions: 2 },
  approvals: [{ step: 0, signedOn: '2026-10-01', signedBy: 'G. Comte' }, { step: 1, approver: 'G. Comte', signedOn: null }, { step: 2, approver: 'R. Aubert', signedOn: null }],
  ...o,
});

const stubCodex = (handler: (url: string, init?: RequestInit) => Response | Promise<Response>) => {
  const calls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? 'GET'} ${url}`);
    return handler(url, init);
  }));
  return calls;
};

beforeAll(async () => {
  setDb(await openDatabase());
}, 60_000);
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('applyCodexIndex (index read, D-2 scope)', () => {
  it('creates a record of a known project and type with its current revision, circuit, Codex id and link', async () => {
    const db = await getDb();
    const r = await db.transaction((tx) => applyCodexIndex(tx, [rec()]));
    expect(r).toEqual({ applied: 1, created: 1, skipped: [] });
    const d = (await getDocumentRecord('RPT-HLT-099'))!;
    expect([d.project, d.type, d.status, d.revision, d.author, d.codexUrl, d.isNew, d.tags, d.confidentiality]).toEqual([
      'HLT-026', 'RPT', 'release_proposed', 'A', 'G. Comte', 'https://codex.epc2i.fr/documents/CDX-1', false, ['A1320', 'D-014'], 'client',
    ]);
    expect(d.revisions.map((x) => [x.revision, x.issuedOn, x.workingVersions])).toEqual([['A', '2026-10-01', 2]]);
    expect(d.approvals.map((a) => [a.position, a.roleLabel, a.who, a.signed])).toEqual([
      [0, 'Author', 'G. Comte', true], [1, 'Quality manager', 'G. Comte', false], [2, 'Project manager', 'R. Aubert', false],
    ]);
    // The step open in Keystone follows the circuit: the quality manager approves next.
    expect([d.canApprove, d.nextApprover]).toEqual([true, 'G. Comte']);
    // Listed last in the vault (Codex order), audited as indexed from Codex.
    expect((await listVaultDocuments()).at(-1)!.number).toBe('RPT-HLT-099');
    expect((await listAudit({ projectCode: 'HLT-026' }))[0]).toMatchObject({ who: 'Codex', object: 'RPT-HLT-099', change: 'indexed from Codex · Release proposed rev A' });
  });

  it('updates an existing record: new revision, circuit, status through the shared state rule (audit, acknowledgement reset)', async () => {
    const db = await getDb();
    const before = (await getDocumentRecord('PID-HLT-026'))!;
    expect([before.status, before.revision]).toEqual(['released', 'D']);
    const r = await db.transaction((tx) => applyCodexIndex(tx, [rec({
      id: 'CDX-PID', url: null, number: 'PID-HLT-026', type: 'PID', title: 'P&ID — crane rail drainage', service: 'process', status: 'draft', confidentiality: 'client',
      author: 'P. Noguès', revision: { letter: 'E', issuedOn: '2026-10-02' }, approvals: [{ step: 0, signedOn: '2026-10-02' }],
    })]));
    expect(r.applied).toBe(1);
    const d = (await getDocumentRecord('PID-HLT-026'))!;
    expect([d.status, d.revision, d.title, d.codexUrl, d.shared]).toEqual(['draft', 'E', 'P&ID — crane rail drainage', null, false]);
    expect(d.revisions.map((x) => x.revision)).toEqual(['E']);
    // The earlier revision rows stay stored (KPI), the new one comes after them.
    const revs = await db.select().from(documentRevisions).where(eq(documentRevisions.documentId, (await db.select().from(documents).where(eq(documents.number, 'PID-HLT-026')))[0].id));
    expect(revs.map((x) => [x.revision, x.position]).sort()).toEqual([['A', 0], ['B', 1], ['C', 2], ['D', 3], ['E', 4]]);
    // Integration review: the new revision is audited too (both lines at the read's instant).
    const lines = (await listAudit({ projectCode: 'HLT-026' })).filter((a) => a.who === 'Codex' && a.object === 'PID-HLT-026').map((a) => a.change);
    expect(lines.sort()).toEqual(['revision D → E · synced from Codex', 'status: Released → Draft · synced from Codex']);
  });

  it('skips and logs unknown projects and types and malformed records — never a phantom QMS record; a QMS record is QMS', async () => {
    const db = await getDb();
    const r = await db.transaction((tx) => applyCodexIndex(tx, [
      rec({ number: 'RPT-XYZ-001', project: 'XYZ-999' }),
      rec({ number: 'ZZZ-HLT-001', type: 'ZZZ' }),
      { number: 'BAD-HLT-001', title: 'no id' },
      null,
      rec({ number: 'PRO-QMS-099', type: 'PRO', project: 'QMS', service: 'quality', status: 'released', confidentiality: 'internal', recipients: [], url: 'javascript:alert(1)',
        approvals: [{ step: 0, signedOn: '2026-10-01' }] }),
    ]));
    expect(r.applied).toBe(1);
    // Integration review: a record waiting for a project or type of Keystone carries its codes (`codex_index_awaiting`).
    expect(r.skipped).toEqual([
      { number: 'RPT-XYZ-001', reason: 'unknown project XYZ-999', project: 'XYZ-999', type: 'RPT' },
      { number: 'ZZZ-HLT-001', reason: 'unknown document type ZZZ', project: 'HLT-026', type: 'ZZZ' },
      { number: 'BAD-HLT-001', reason: 'malformed record' }, { number: '?', reason: 'malformed record' },
    ]);
    const numbers = (await listVaultDocuments()).map((d) => d.number);
    expect(numbers).not.toContain('RPT-XYZ-001');
    expect(numbers).not.toContain('ZZZ-HLT-001');
    const qms = (await getDocumentRecord('PRO-QMS-099'))!;
    // An unsafe link from the payload is never stored.
    expect([qms.project, qms.codexUrl]).toEqual(['QMS', null]);
  });
});

describe('HTTP connector: the index read, the Codex row and "Sync now"', () => {
  it('mock (no CODEX_API_URL): the Codex row stays "Mock", no last sync; the job reads nothing; deposits are recorded as before', async () => {
    const codex = (await listAdminConnectors()).find((c) => c.name === 'Codex')!;
    expect([codex.mode, codex.link, codex.state, codex.lastSyncAt, codex.canSync]).toEqual(['mock', 'mock', 'mock', null, true]);
    expect(await jobDefinition('codex-index').run()).toEqual({ summary: 'Codex mock connector · index not read', counts: { applied: 0 } });
    expect(await getCodexSyncState()).toMatchObject({ time: '08:02' });
  });

  it('reads the whole index the first time, then what changed since the last read; the read is the banner’s last sync', async () => {
    vi.stubEnv('CODEX_API_URL', 'http://codex.test');
    // Before any read of Codex: no sync line (the seeded 08:02 sync was never an exchange with Codex).
    expect(await getCodexSyncState()).toBeNull();
    expect(await nextCodexIndexSince()).toBeNull();
    const calls = stubCodex(() => Response.json([rec({ id: 'CDX-2', number: 'RPT-HLT-098', title: 'Bolt torque report' })]));
    const first = await refreshCodexIndex('Marie Lefebvre', new Date('2026-10-02T08:00:00Z'));
    const count = (await listVaultDocuments()).length;
    expect(first).toEqual({ read: true, records: count, applied: 1, created: 1, skipped: 0 });
    const second = await refreshCodexIndex(null, new Date('2026-10-02T09:00:00Z'));
    expect(second).toMatchObject({ read: true, applied: 1, created: 0 });
    expect(calls).toEqual(['GET http://codex.test/api/documents', 'GET http://codex.test/api/documents?since=2026-10-02T08%3A00%3A00.000Z']);
    expect(await getCodexSyncState()).toEqual({ time: '11:00', syncedAt: '2026-10-02T09:00:00.000Z', records: count });
    const db = await getDb();
    expect((await db.select().from(documentIndexSyncs).where(eq(documentIndexSyncs.source, 'codex'))).length).toBe(2);
  });

  it('Codex unreachable or answering badly: the read throws and nothing is recorded', async () => {
    vi.stubEnv('CODEX_API_URL', 'http://codex.test');
    const before = await nextCodexIndexSince();
    stubCodex(() => new Response('down', { status: 503 }));
    await expect(refreshCodexIndex(null)).rejects.toThrow('Codex GET /api/documents?since=');
    stubCodex(() => Response.json({ not: 'an array' }));
    await expect(refreshCodexIndex(null)).rejects.toThrow('Codex: unexpected index payload');
    expect(await nextCodexIndexSince()).toEqual(before);
  });

  it('Activity & integrations: the Codex row is live (last read, outbox counts); "Sync now" delivers then reads; a failure marks the row', async () => {
    vi.stubEnv('CODEX_API_URL', 'http://codex.test');
    let codex = (await listAdminConnectors()).find((c) => c.name === 'Codex')!;
    // L9-X3: the demo's three shipping-document deposits wait for Codex; closed here so "Sync now" has nothing to deliver.
    expect(codex.pending).toBe(3);
    await closeCodexEntries(await getDb(), (await openCodexEntries(await getDb())).filter((e) => e.kind === 'deposit').map((e) => e.id));
    codex = (await listAdminConnectors()).find((c) => c.name === 'Codex')!;
    expect([codex.mode, codex.link, codex.state, codex.canSync, codex.pending, codex.failed]).toEqual(['http', 'live', 'ok', true, 0, 0]);
    expect(codex.lastSyncAt).toBe('2026-10-02T09:00:00.000Z');
    const calls = stubCodex(() => Response.json([]));
    const r = await syncAdminConnector('Codex', DIRECTOR);
    expect(r).toEqual({ ok: true, volume: '0 sent · 0 pending · 0 refreshed', error: null, simulated: false });
    expect(calls).toEqual([expect.stringMatching(/^GET http:\/\/codex\.test\/api\/documents\?since=/)]);
    codex = (await listAdminConnectors()).find((c) => c.name === 'Codex')!;
    expect([codex.state, new Date(codex.lastSyncAt!).getTime() > Date.parse('2026-10-02T09:00:00Z')]).toEqual(['ok', true]);
    // Codex down: the run fails, the row needs attention (warning) until a run succeeds.
    stubCodex(() => new Response('down', { status: 503 }));
    const failed = await syncAdminConnector('Codex', DIRECTOR);
    expect([failed.ok, failed.simulated, failed.error]).toEqual([false, false, expect.stringContaining('503')]);
    codex = (await listAdminConnectors()).find((c) => c.name === 'Codex')!;
    expect(codex.state).toBe('warning');
    stubCodex(() => Response.json([]));
    expect((await syncAdminConnector('Codex', DIRECTOR)).ok).toBe(true);
    expect((await listAdminConnectors()).find((c) => c.name === 'Codex')!.state).toBe('ok');
    // Outside the workspace: refused before anything runs (R-021, unchanged).
    await expect(syncAdminConnector('Codex', { name: 'Gabriel Comte', role: 'quality' })).rejects.toThrow(/outside your workspace/);
  });

  it('the hourly job reads the index with the HTTP connector', async () => {
    vi.stubEnv('CODEX_API_URL', 'http://codex.test');
    stubCodex(() => Response.json([rec({ id: 'CDX-3', number: 'RPT-HLT-097' }), rec({ number: 'RPT-XYZ-002', project: 'XYZ-999' })]));
    const out = await jobDefinition('codex-index').run();
    expect(out).toMatchObject({ counts: { applied: 1, created: 1, skipped: 1 }, warn: true });
    expect(out.summary).toMatch(/^Codex index read · 1 records applied · 1 new · 1 skipped · \d+ in the index$/);
    stubCodex(() => new Response('down', { status: 503 }));
    await expect(jobDefinition('codex-index').run()).rejects.toThrow(/503/);
  });

  it('A-15: with Codex connected, the local deposit is refused (no Keystone-numbered draft Codex never receives)', async () => {
    vi.stubEnv('CODEX_API_URL', 'http://codex.test');
    const before = (await listVaultDocuments()).length;
    await expect(depositInCodex({ typeCode: 'CER', project: 'HLT-026' }, 'Romain Aubert')).rejects.toBeInstanceOf(DepositInCodexOnlyError);
    await expect(depositInCodex({ typeCode: 'PID', project: 'HLT-026', revisionOf: 'PID-HLT-026' }, 'Romain Aubert')).rejects.toBeInstanceOf(DepositInCodexOnlyError);
    expect((await listVaultDocuments()).length).toBe(before);
    vi.unstubAllEnvs();
    expect((await depositInCodex({ typeCode: 'CER', project: 'HLT-026' }, 'Romain Aubert')).created).toBe(true);
  });

  it('approval proof written for the current revision only', async () => {
    const db = await getDb();
    const [d] = await db.select().from(documents).where(eq(documents.number, 'RPT-HLT-099'));
    const rows = await db.select().from(documentApprovals).where(and(eq(documentApprovals.documentId, d.id), eq(documentApprovals.revision, 'A')));
    expect(rows.map((r) => r.stepPosition).sort()).toEqual([0, 1, 2]);
  });
});
