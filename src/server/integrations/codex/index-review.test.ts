// Integration review of delivery 8 (R-033, Codex index read), on a seeded in-memory database with a stub Codex over HTTP that
// honours `since` and `project`:
// - a record skipped because Keystone does not know its project or document type yet waits in `codex_index_awaiting`; the read
//   mark still moves to the read's time, so an unchanged record is never applied again over Keystone's own state (a local
//   Freeze, a Release proposed with a decision Codex has not received) — the earlier fix held the mark back, and every read then
//   re-applied the whole index; once the project or the type exists, the next read asks Codex again for that project from the
//   skipping read's mark and creates only the records that waited (a failure of that re-read is retried by the next read);
// - a new revision of an indexed record released over a released one (both between two reads) withdraws the previous
//   revision (KPI "Obsolete revisions withdrawn", the record's withdrawal line) and is audited.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { vaultKpis } from '@/domain/documents';
import { getDb, setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { codexIndexAwaiting, documentIndexSyncs, documentRevisions, documentTypes, documents } from '@/server/db/schema';
import {
  freezeDocument, getCodexSyncState, getDocumentRecord, listProjectDocuments, nextCodexIndexSince, proposeDocumentRelease, recordDocumentDecision, refreshCodexIndex,
} from '@/server/dal/documents';
import { listAudit } from '@/server/dal/notifications';
import { clientCodeOf, createProject, nextProjectNumber } from '@/server/dal/projects';
import { applyCodexIndex, awaitsKeystoneData, type CodexIndexRecord } from './mirror';
import { undeliveredCodexEntries } from './outbox';

const DIRECTOR = { name: 'Marie Lefebvre', role: 'director' };

const rec = (o: Partial<CodexIndexRecord> = {}): CodexIndexRecord => ({
  id: 'CDX-1', url: null, number: 'RPT-HLT-099', type: 'RPT', project: 'HLT-026', title: 'Crane rail weld inspection', service: 'quality', status: 'draft',
  confidentiality: 'internal', author: 'G. Comte', tags: [], recipients: [], revision: { letter: 'A', issuedOn: '2026-10-01' }, approvals: [{ step: 0, signedOn: '2026-10-01' }],
  ...o,
});

const at = (hhmm: string, day = '2026-10-02') => new Date(`${day}T${hhmm}:00.000Z`);

/**
 * Stub Codex: an index read gets the records changed after `since` (all of them without it), of `project` when given; a read
 * `failing` returns 503, as does any other call. Returns the reads asked (path and query, decoded).
 */
const stubCodex = (index: () => { rec: CodexIndexRecord; changed: Date }[], failing: (u: URL) => boolean = () => false) => {
  const calls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const u = new URL(url);
    calls.push(decodeURIComponent(`${u.pathname}${u.search}`));
    if (u.pathname !== '/api/documents' || failing(u)) return new Response('down', { status: 503 });
    const since = u.searchParams.get('since');
    const project = u.searchParams.get('project');
    return Response.json(index().filter((x) => (!since || x.changed > new Date(since)) && (!project || x.rec.project === project)).map((x) => x.rec));
  }));
  return calls;
};

const indexed = async (number: string) => (await (await getDb()).select({ id: documents.id }).from(documents).where(eq(documents.number, number))).length;
const statusOf = async (number: string) => (await getDocumentRecord(number))?.status;
const waiting = async () => (await (await getDb()).select({ number: codexIndexAwaiting.number }).from(codexIndexAwaiting)).map((x) => x.number).sort();

beforeAll(async () => {
  setDb(await openDatabase());
}, 60_000);
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('records skipped for an unknown project or type wait without holding the read mark', () => {
  it('only an unknown project or document type makes a record wait — a malformed record is dropped', () => {
    expect([
      awaitsKeystoneData({ reason: 'unknown project XYZ-999' }), awaitsKeystoneData({ reason: 'unknown document type ZZZ' }), awaitsKeystoneData({ reason: 'malformed record' }),
    ]).toEqual([true, true, false]);
  });

  it('a record waits for its type: a local Freeze and a decision Codex has not received survive the next reads; once the type exists only that record is created', async () => {
    vi.stubEnv('CODEX_API_URL', 'http://codex.test');
    const calls = stubCodex(() => [
      { rec: rec(), changed: at('07:00') },
      { rec: rec({ id: 'CDX-Z', number: 'ZZZ-HLT-001', type: 'ZZZ' }), changed: at('07:00') },
      // A project Keystone will never have (a historical Codex project).
      { rec: rec({ id: 'CDX-X', number: 'RPT-XYZ-001', project: 'XYZ-999' }), changed: at('07:00') },
    ]);
    expect(await refreshCodexIndex(null, at('08:00'))).toMatchObject({ read: true, applied: 1, created: 1, skipped: 2 });
    expect([await statusOf('RPT-HLT-099'), await nextCodexIndexSince(), await waiting()]).toEqual(['draft', at('08:00'), ['RPT-XYZ-001', 'ZZZ-HLT-001']]);
    // Keystone's own transition (no outbox entry; Codex still says Draft): the next read does not bring Codex's record back.
    await freezeDocument('RPT-HLT-099', 'Gabriel Comte');
    expect(await refreshCodexIndex(null, at('09:00'))).toMatchObject({ read: true, applied: 0, created: 0, skipped: 0 });
    expect(await statusOf('RPT-HLT-099')).toBe('frozen');
    // Release proposed, and a decision recorded for Codex that Codex has not received yet.
    await proposeDocumentRelease('RPT-HLT-099', 'Gabriel Comte');
    const { entryId } = await recordDocumentDecision('RPT-HLT-099', { decision: 'approved' }, DIRECTOR, at('09:30'));
    // IT adds the type to the register: the next read asks Codex again for HLT-026 from the skipping read's mark (the whole
    // index: it was the first read) and creates ZZZ-HLT-001 only — RPT-HLT-099, in the same answer, is left as Keystone has it.
    await (await getDb()).insert(documentTypes).values({ code: 'ZZZ', label: 'Test type', family: 'quality', retention: '10 years', isoClause: '7.5', isClientDeliverable: false, position: 99 });
    expect(await refreshCodexIndex(null, at('10:00'))).toMatchObject({ read: true, applied: 1, created: 1, skipped: 0 });
    expect(await indexed('ZZZ-HLT-001')).toBe(1);
    expect(await statusOf('RPT-HLT-099')).toBe('release_proposed');
    expect((await undeliveredCodexEntries(await getDb())).map((e) => e.id)).toContain(entryId);
    expect(await waiting()).toEqual(['RPT-XYZ-001']);
    await refreshCodexIndex(null, at('11:00'));
    expect(calls).toEqual([
      '/api/documents', '/api/documents?since=2026-10-02T08:00:00.000Z', '/api/documents?since=2026-10-02T09:00:00.000Z', '/api/documents?project=HLT-026',
      '/api/documents?since=2026-10-02T10:00:00.000Z',
    ]);
    // Codex's unchanged Draft was never written again over the record.
    const lines = (await listAudit({ projectCode: 'HLT-026' })).filter((a) => a.object === 'RPT-HLT-099' && a.who === 'Codex').map((a) => a.change);
    expect(lines).toEqual(['indexed from Codex · Draft rev A']);
  });

  it('a record waits for its project: asked again with the project from the skipping read’s mark once it exists; a failed re-read is retried', async () => {
    vi.stubEnv('CODEX_API_URL', 'http://codex.test');
    const code = `${(await clientCodeOf('Port authority')).code3}-${(await nextProjectNumber()).slice(1)}`;
    let failing = false;
    const calls = stubCodex(() => [{ rec: rec({ id: 'CDX-P', number: `RPT-${code}`, project: code }), changed: at('11:30') }], (u) => failing && u.searchParams.has('project'));
    expect(await refreshCodexIndex(null, at('12:00'))).toMatchObject({ applied: 0, skipped: 1 });
    // Unchanged in Codex, the record is not sent again: no skip reported every hour, the mark moves on.
    expect(await refreshCodexIndex(null, at('13:00'))).toMatchObject({ applied: 0, skipped: 0 });
    expect(await nextCodexIndexSince()).toEqual(at('13:00'));
    const created = await createProject({
      name: 'Codex index check', client: 'Port authority', das: '2', machineType: 'EMP', currency: 'EUR', templateCode: 'EMP',
      categories: [{ name: 'Labor', type: 'labor', budget: 100 }], contingencyPct: 0, calendar: 'standard_5x8',
    });
    expect(created).toBe(code);
    // Codex fails on the re-read: the read is recorded all the same (the mark moves), the record keeps waiting.
    failing = true;
    expect(await refreshCodexIndex(null, at('14:00'))).toMatchObject({ read: true, applied: 0, skipped: 0 });
    expect([await nextCodexIndexSince(), await indexed(`RPT-${code}`), await waiting()]).toEqual([at('14:00'), 0, [`RPT-${code}`, 'RPT-XYZ-001'].sort()]);
    failing = false;
    expect(await refreshCodexIndex(null, at('15:00'))).toMatchObject({ read: true, applied: 1, created: 1, skipped: 0 });
    expect([await indexed(`RPT-${code}`), await waiting()]).toEqual([1, ['RPT-XYZ-001']]);
    const reread = `/api/documents?since=2026-10-02T11:00:00.000Z&project=${code}`;
    expect(calls).toEqual([
      '/api/documents?since=2026-10-02T11:00:00.000Z', '/api/documents?since=2026-10-02T12:00:00.000Z', '/api/documents?since=2026-10-02T13:00:00.000Z', reread,
      '/api/documents?since=2026-10-02T14:00:00.000Z', reread,
    ]);
    // The banner shows the last read; every read is recorded.
    expect(await getCodexSyncState()).toMatchObject({ syncedAt: '2026-10-02T15:00:00.000Z' });
    const db = await getDb();
    expect((await db.select().from(documentIndexSyncs).where(eq(documentIndexSyncs.source, 'codex'))).length).toBe(8);
  });
});

describe('a new revision released over a released one (between two reads)', () => {
  it('PFD-HLT-026 B → C, both Released: rev B withdrawn, the KPI counts it, the record shows the withdrawal, the audit has the revision line', async () => {
    const kpi = async () => vaultKpis(await listProjectDocuments('HLT-026')).find((k) => k.label === 'Obsolete revisions withdrawn')!.value;
    const before = (await getDocumentRecord('PFD-HLT-026'))!;
    expect([before.status, before.revision, before.withdrawal, before.withdrawnRevisions]).toEqual(['released', 'B', null, 1]);
    const kpiBefore = await kpi();
    const db = await getDb();
    const r = await db.transaction((tx) => applyCodexIndex(tx, [rec({
      id: 'CDX-PFD', number: 'PFD-HLT-026', type: 'PFD', title: before.title, service: before.service, status: 'released', confidentiality: before.confidentiality,
      author: before.author, revision: { letter: 'C', issuedOn: '2026-10-05' },
      approvals: before.circuit.map((_, step) => ({ step, signedOn: step === 0 ? '2026-10-03' : '2026-10-05' })), withdrawnRevision: 'B', withdrawnOn: '2026-10-05',
    })], at('14:00')));
    expect(r).toEqual({ applied: 1, created: 0, skipped: [] });
    const d = (await getDocumentRecord('PFD-HLT-026'))!;
    expect([d.status, d.revision, d.withdrawal, d.withdrawnRevisions]).toEqual(['released', 'C', { revision: 'B', on: '2026-10-05' }, 2]);
    expect(await kpi()).toBe(kpiBefore + 1);
    const [{ id }] = await db.select({ id: documents.id }).from(documents).where(eq(documents.number, 'PFD-HLT-026'));
    const revs = await db.select({ revision: documentRevisions.revision, withdrawnOn: documentRevisions.withdrawnOn }).from(documentRevisions).where(eq(documentRevisions.documentId, id));
    expect(revs.sort((a, b) => a.revision.localeCompare(b.revision)).map((x) => [x.revision, x.withdrawnOn !== null])).toEqual([['A', true], ['B', true], ['C', false]]);
    const lines = (await listAudit({ projectCode: 'HLT-026' })).filter((a) => a.object === 'PFD-HLT-026' && a.who === 'Codex').map((a) => a.change);
    expect(lines).toEqual(['revision B → C · synced from Codex']);
    // Read again unchanged: nothing more is withdrawn or audited.
    await db.transaction((tx) => applyCodexIndex(tx, [rec({
      id: 'CDX-PFD', number: 'PFD-HLT-026', type: 'PFD', title: before.title, service: before.service, status: 'released', confidentiality: before.confidentiality,
      author: before.author, revision: { letter: 'C', issuedOn: '2026-10-05' }, approvals: [], withdrawnRevision: 'B', withdrawnOn: '2026-10-05',
    })], at('15:00')));
    expect(await kpi()).toBe(kpiBefore + 1);
    expect((await listAudit({ projectCode: 'HLT-026' })).filter((a) => a.object === 'PFD-HLT-026' && a.who === 'Codex')).toHaveLength(1);
  });
});
