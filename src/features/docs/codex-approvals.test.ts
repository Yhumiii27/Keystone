// P-7b = a, D-1b = a (Delivery 7, R-124): the named approver decides a Codex document's circuit step from My approvals
// (Approve, or Reject with the reason); the decision waits in the outbox "pending sync with Codex" and never changes the
// index record; the HTTP connector (CODEX_API_URL) delivers it and Codex's answer becomes the index state. Session and
// project context are mocked; fetch is stubbed (no network).
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const viewer = { name: 'Gabriel Comte', short: 'G. Comte', role: 'quality', canEdit: true };
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/server/session', async () => {
  const { makeT } = await import('@/i18n/translate');
  return { getI18n: async () => ({ lang: 'en', t: makeT('en') }) };
});
vi.mock('@/server/project-context', () => ({
  getProjectContext: async (code: string) => ({
    project: { code }, viewer: { name: viewer.name, short: viewer.short, role: viewer.role }, canEdit: () => viewer.canEdit, isMine: true,
  }),
  getScreenAccess: async () => ({ viewer: { name: viewer.name, short: viewer.short, role: viewer.role }, outside: !viewer.canEdit, canEdit: viewer.canEdit }),
}));

import { desc, eq } from 'drizzle-orm';
import { getDb, setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { codexDocumentOutbox } from '@/server/db/schema';
import { closeCodexEntries, openCodexEntries } from '@/server/integrations/codex/outbox';
import { getDocumentRecord } from '@/server/dal/documents';
import { listAudit } from '@/server/dal/notifications';
import { makeT } from '@/i18n/translate';
import { decideDocumentFromInboxAction, syncCodexAction } from './actions';
import { drawerView } from './model';

const as = (name: string, short: string, role: string, canEdit = true) => Object.assign(viewer, { name, short, role, canEdit });
const entries = async (number: string) =>
  (await getDb()).select().from(codexDocumentOutbox).where(eq(codexDocumentOutbox.documentNumber, number)).orderBy(desc(codexDocumentOutbox.recordedAt));

describe('Codex document decisions from My approvals (R-124)', () => {
  beforeAll(async () => {
    setDb(await openDatabase());
  }, 60_000);
  beforeEach(() => as('Gabriel Comte', 'G. Comte', 'quality'));
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('refuses viewers outside the inbox, malformed requests, other approvers and stale rows', async () => {
    as('Gabriel Comte', 'G. Comte', 'quality', false);
    expect(await decideDocumentFromInboxAction({ number: 'RPT-HLT-014', step: 1, decision: 'approved' })).toEqual({ ok: false, error: 'Read-only — you cannot decide from this inbox' });
    as('Gabriel Comte', 'G. Comte', 'quality');
    for (const bad of [
      { number: '<x>', step: 1, decision: 'approved' }, { number: 'RPT-HLT-014', step: 0, decision: 'approved' }, { number: 'RPT-HLT-014', step: 1.5, decision: 'approved' },
      { number: 'RPT-HLT-014', step: 1, decision: 'ok' }, null,
    ]) expect(await decideDocumentFromInboxAction(bad as never)).toEqual({ ok: false, error: 'Invalid request' });
    expect(await decideDocumentFromInboxAction({ number: 'NOPE-HLT-001', step: 1, decision: 'approved' })).toEqual({ ok: false, error: 'Unknown document' });
    // The row showed step 2 but step 1 is open: stale.
    expect(await decideDocumentFromInboxAction({ number: 'RPT-HLT-014', step: 2, decision: 'approved' })).toEqual({ ok: false, error: 'This decision is not waiting for you any more' });
    as('Romain Aubert', 'R. Aubert', 'pm');
    expect(await decideDocumentFromInboxAction({ number: 'RPT-HLT-014', step: 1, decision: 'approved' })).toEqual({ ok: false, error: 'You are not the approver of this step' });
    as('Nadia Bensaïd', 'N. Bensaïd', 'client');
    expect(await decideDocumentFromInboxAction({ number: 'RPT-HLT-014', step: 1, decision: 'rejected', comment: 'No' })).toEqual({ ok: false, error: 'You are not the approver of this step' });
    expect(await entries('RPT-HLT-014')).toEqual([]);
  });

  it('Reject needs the reason; the rejection waits for Codex and stops the circuit, the record is unchanged', async () => {
    expect(await decideDocumentFromInboxAction({ number: 'RPT-HLT-014', step: 1, decision: 'rejected', comment: '  ' })).toEqual({ ok: false, error: 'Give the reason for the rejection' });
    expect(await decideDocumentFromInboxAction({ number: 'RPT-HLT-014', step: 1, decision: 'rejected', comment: 'x'.repeat(1001) })).toEqual({ ok: false, error: 'The reason is too long' });
    expect(await decideDocumentFromInboxAction({ number: 'RPT-HLT-014', step: 1, decision: 'rejected', comment: ' Missing the torque table ' })).toEqual({
      ok: true, toast: 'RPT-HLT-014 · Rejected · Pending sync with Codex',
    });
    const [e] = await entries('RPT-HLT-014');
    expect(e).toMatchObject({ kind: 'approval', stepPosition: 1, role: 'quality_manager', decision: 'rejected', comment: 'Missing the torque table', actorName: 'Gabriel Comte', syncStatus: 'pending', closedAt: null });
    const r = (await getDocumentRecord('RPT-HLT-014'))!;
    expect([r.status, r.canApprove, r.nextApprover, r.circuitNote, r.approvals.map((a) => [a.signed, a.keystone?.decision ?? null])]).toEqual([
      'release_proposed', false, null, 'Rejected · Pending sync with Codex', [[true, null], [false, 'rejected'], [false, null]],
    ]);
    expect((await listAudit({ limit: 1 }))[0]).toMatchObject({ who: 'Gabriel Comte', object: 'RPT-HLT-014', change: 'rejected · Quality manager · Pending sync with Codex' });
    // The drawer shows the decision over Codex's proof, in French too; no Approve button.
    const view = drawerView({ project: 'HLT-026', record: r, state: { scope: 'proj', view: 'all', family: null, status: null, q: '', doc: 'RPT-HLT-014' }, viewer, canEdit: true }, makeT('fr'), 'fr');
    expect([view.circuitNote, view.approveLabel, view.approvals[1].label, view.approvals[1].pendingSync]).toEqual([
      'Refusé · En attente de synchronisation avec Codex', null, 'Responsable qualité · G. Comte', true,
    ]);
    expect(view.approvals[1].state).toMatch(/^Refusé · \d{1,2} \S+ · En attente de synchronisation avec Codex$/);
    // Nobody can decide any more until Codex answers.
    as('Romain Aubert', 'R. Aubert', 'pm');
    expect(await decideDocumentFromInboxAction({ number: 'RPT-HLT-014', step: 2, decision: 'approved' })).toEqual({ ok: false, error: 'This decision is not waiting for you any more' });
  });

  it('HTTP connector: a failed delivery stays in the outbox; the next sync delivers it and Codex’s answer becomes the index state', async () => {
    as('Marie Lefebvre', 'M. Lefebvre', 'director');
    // L9-X3: the demo's three shipping-document deposits wait in the outbox too; closed here so the sync follows RPT-HLT-014 alone.
    await closeCodexEntries(await getDb(), (await openCodexEntries(await getDb())).filter((e) => e.kind === 'deposit').map((e) => e.id));
    vi.stubEnv('CODEX_API_URL', 'http://codex.test/');
    const calls: { url: string; method: string; body: unknown }[] = [];
    let up = false;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : null });
      if (!up) return new Response('down', { status: 503 });
      if (init?.method === 'POST') return Response.json({ id: 'CDX-APR-1' });
      // Codex applied the rejection: the record went back to Draft.
      return Response.json([{ number: 'RPT-HLT-014', revision: 'A', status: 'draft', approvals: [{ step: 1, signedOn: null }, { step: 2, signedOn: null }] }, { bogus: true }]);
    }));
    let r = await syncCodexAction('HLT-026');
    // R-033: Codex unreachable — the index was not read, so the toast never says "index up to date" (Delivery 7 did).
    expect(r).toEqual({ error: 'Codex sync · index not read · 0 sent · 1 pending · 0 refreshed' });
    expect((await entries('RPT-HLT-014'))[0]).toMatchObject({ syncStatus: 'failed', attempts: 1, lastError: 'Codex POST /api/documents/RPT-HLT-014/approvals → 503' });
    expect((await getDocumentRecord('RPT-HLT-014'))!.circuitNote).toBe('Rejected · Sync with Codex failed');
    up = true;
    calls.length = 0;
    r = await syncCodexAction('HLT-026');
    // R-033: the outbox is delivered, the records concerned refreshed, then Codex's index read (the stub's records are not
    // index records: skipped and logged); the count is Keystone's index (42 records), not the mock's 412.
    // L9-X3: 45 = 42 + the demo's three shipping documents.
    expect(r).toEqual({ ok: true, toast: 'Codex sync · index up to date · 45 records · 1 sent · 0 pending · 1 refreshed' });
    expect(calls.map((c) => [c.method, c.url])).toEqual([
      ['POST', 'http://codex.test/api/documents/RPT-HLT-014/approvals'], ['GET', 'http://codex.test/api/documents/state?numbers=RPT-HLT-014'],
      ['GET', 'http://codex.test/api/documents'],
    ]);
    expect(calls[0].body).toMatchObject({ revision: 'A', step: 1, role: 'quality_manager', decision: 'rejected', comment: 'Missing the torque table', actor: { name: 'Gabriel Comte', role: 'quality' } });
    const [e] = await entries('RPT-HLT-014');
    expect([e.syncStatus, e.codexRef, e.closedAt instanceof Date]).toEqual(['sent', 'CDX-APR-1', true]);
    const d = (await getDocumentRecord('RPT-HLT-014'))!;
    expect([d.status, d.circuitNote, d.canApprove]).toEqual(['draft', null, false]);
    expect((await listAudit({ limit: 1 }))[0]).toMatchObject({ who: 'Codex', object: 'RPT-HLT-014', change: 'status: Release proposed → Draft · synced from Codex' });
  });
});
