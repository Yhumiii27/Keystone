// Integration review of delivery 8 (R-033, Codex index read), on a seeded in-memory database with a stub Codex over HTTP:
// - a record skipped because Keystone does not know its project or document type yet is not lost: the read mark does not move
//   past it, so the next read — once the project or the type exists — asks again from the same point (the whole index when
//   the skipping read was the first) and applies it; the read's time stays the banner's "Last sync";
// - a new revision of an indexed record released over a released one (both between two reads) withdraws the previous
//   revision (KPI "Obsolete revisions withdrawn", the record's withdrawal line) and is audited.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { vaultKpis } from '@/domain/documents';
import { getDb, setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { documentIndexSyncs, documentRevisions, documentTypes, documents } from '@/server/db/schema';
import { getCodexSyncState, getDocumentRecord, listProjectDocuments, nextCodexIndexSince, refreshCodexIndex } from '@/server/dal/documents';
import { listAudit } from '@/server/dal/notifications';
import { clientCodeOf, createProject, nextProjectNumber } from '@/server/dal/projects';
import { applyCodexIndex, awaitsKeystoneData, type CodexIndexRecord } from './mirror';

const rec = (o: Partial<CodexIndexRecord> = {}): CodexIndexRecord => ({
  id: 'CDX-1', url: null, number: 'RPT-HLT-099', type: 'RPT', project: 'HLT-026', title: 'Crane rail weld inspection', service: 'quality', status: 'draft',
  confidentiality: 'internal', author: 'G. Comte', tags: [], recipients: [], revision: { letter: 'A', issuedOn: '2026-10-01' }, approvals: [{ step: 0, signedOn: '2026-10-01' }],
  ...o,
});

/** Stub Codex answering `answer()` to every index read; returns the calls made. */
const stubCodex = (answer: () => unknown[]) => {
  const calls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    calls.push(decodeURIComponent(url.replace('http://codex.test', '')));
    return Response.json(answer());
  }));
  return calls;
};

const indexed = async (number: string) => (await (await getDb()).select({ id: documents.id }).from(documents).where(eq(documents.number, number))).length;
const at = (hhmm: string, day = '2026-10-02') => new Date(`${day}T${hhmm}:00.000Z`);

beforeAll(async () => {
  setDb(await openDatabase());
}, 60_000);
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('records skipped for an unknown project or type come back once Keystone knows it', () => {
  it('only an unknown project or document type holds the mark — a malformed record is dropped', () => {
    expect([
      awaitsKeystoneData({ reason: 'unknown project XYZ-999' }), awaitsKeystoneData({ reason: 'unknown document type ZZZ' }), awaitsKeystoneData({ reason: 'malformed record' }),
    ]).toEqual([true, true, false]);
  });

  it('first read skipped a record of an unknown type: the next read asks for the whole index again and applies it once the type exists', async () => {
    vi.stubEnv('CODEX_API_URL', 'http://codex.test');
    const calls = stubCodex(() => [rec({ id: 'CDX-Z', number: 'ZZZ-HLT-001', type: 'ZZZ' })]);
    expect(await refreshCodexIndex(null, at('08:00'))).toMatchObject({ read: true, applied: 0, skipped: 1 });
    expect(await indexed('ZZZ-HLT-001')).toBe(0);
    // The read is recorded (banner "Last sync"), but the mark stays at the whole index.
    expect(await getCodexSyncState()).toMatchObject({ syncedAt: '2026-10-02T08:00:00.000Z' });
    expect(await nextCodexIndexSince()).toBeNull();
    // IT adds the type to the register; Codex does not send the record again unless it changes — the read asks from the mark.
    await (await getDb()).insert(documentTypes).values({ code: 'ZZZ', label: 'Test type', family: 'quality', retention: '10 years', isoClause: '7.5', isClientDeliverable: false, position: 99 });
    expect(await refreshCodexIndex(null, at('09:00'))).toMatchObject({ read: true, applied: 1, created: 1, skipped: 0 });
    expect(await indexed('ZZZ-HLT-001')).toBe(1);
    // Nothing waits any more: the mark moves to the read's time.
    expect(await nextCodexIndexSince()).toEqual(at('09:00'));
    await refreshCodexIndex(null, at('10:00'));
    expect(calls).toEqual(['/api/documents', '/api/documents', '/api/documents?since=2026-10-02T09:00:00.000Z']);
  });

  it('a later read skipped a record of an unknown project: the mark stays at the previous read until the project exists', async () => {
    vi.stubEnv('CODEX_API_URL', 'http://codex.test');
    const code = `${(await clientCodeOf('Port authority')).code3}-${(await nextProjectNumber()).slice(1)}`;
    const calls = stubCodex(() => [rec({ id: 'CDX-P', number: `RPT-${code}`, project: code })]);
    expect(await refreshCodexIndex(null, at('11:00'))).toMatchObject({ applied: 0, skipped: 1 });
    expect(await refreshCodexIndex(null, at('12:00'))).toMatchObject({ applied: 0, skipped: 1 });
    // Both reads asked from 10:00 (the last read that skipped nothing); the banner shows the last read.
    expect(await nextCodexIndexSince()).toEqual(at('10:00'));
    expect(await getCodexSyncState()).toMatchObject({ syncedAt: '2026-10-02T12:00:00.000Z' });
    const created = await createProject({
      name: 'Codex index check', client: 'Port authority', das: '2', machineType: 'EMP', currency: 'EUR', templateCode: 'EMP',
      categories: [{ name: 'Labor', type: 'labor', budget: 100 }], contingencyPct: 0, calendar: 'standard_5x8',
    });
    expect(created).toBe(code);
    expect(await refreshCodexIndex(null, at('13:00'))).toMatchObject({ applied: 1, created: 1, skipped: 0 });
    expect(await indexed(`RPT-${code}`)).toBe(1);
    expect(calls).toEqual(Array(3).fill('/api/documents?since=2026-10-02T10:00:00.000Z'));
    expect(await nextCodexIndexSince()).toEqual(at('13:00'));
    const db = await getDb();
    expect((await db.select().from(documentIndexSyncs).where(eq(documentIndexSyncs.source, 'codex'))).length).toBe(6);
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
