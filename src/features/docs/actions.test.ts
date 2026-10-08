// Documents Server Functions against an in-memory database: access checks, the deposit hand-off (new document
// numbered CER-HLT-042, new revision back to Draft), the approval circuit (named approver / director, release,
// withdrawal of the previous revision, client acknowledgement pending again), downloads, "Sync now" and the client's
// acknowledgement — with the viewer as the actor. Session and project context are mocked.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const viewer = { name: 'Marie Lefebvre', short: 'M. Lefebvre', role: 'director', canEdit: true, isMine: true };
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/server/session', async () => {
  const { makeT } = await import('@/i18n/translate');
  return { getI18n: async () => ({ lang: 'en', t: makeT('en') }) };
});
vi.mock('@/server/project-context', () => ({
  getProjectContext: async (code: string) => ({
    project: { code },
    viewer: { name: viewer.name, short: viewer.short, role: viewer.role },
    canEdit: () => viewer.canEdit,
    isMine: viewer.isMine,
  }),
}));

import { setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { freezeDocument, getCodexSyncState, getDocumentRecord, listVaultDocuments, proposeDocumentRelease } from '@/server/dal/documents';
import { docsBadge } from '@/server/dal/docs-badge';
import { listAudit } from '@/server/dal/notifications';
import { acknowledgeDocumentAction, approveDocumentAction, depositInCodexAction, logDownloadAction, syncCodexAction } from './actions';

const as = (name: string, short: string, role: string, extra: Partial<typeof viewer> = {}) => Object.assign(viewer, { name, short, role, canEdit: true, isMine: true }, extra);

describe('documents Server Functions', () => {
  beforeAll(async () => {
    setDb(await openDatabase());
  }, 60_000);
  beforeEach(() => {
    as('Marie Lefebvre', 'M. Lefebvre', 'director');
  });

  it('validation and access: read-only viewers, unknown project, type, record, missing title', async () => {
    viewer.canEdit = false;
    expect(await depositInCodexAction({ project: 'HLT-026', type: 'CER', title: 'x' })).toEqual({ error: 'The document vault is read-only for you' });
    expect(await syncCodexAction('HLT-026')).toEqual({ error: 'The document vault is read-only for you' });
    viewer.canEdit = true;
    expect(await depositInCodexAction({ project: 'NOPE-000', type: 'CER', title: 'x' })).toEqual({ error: 'Unknown project' });
    expect(await depositInCodexAction({ project: 'HLT-026', type: 'PID', title: 'x' })).toEqual({ error: 'Unknown document type' });
    expect(await depositInCodexAction({ project: 'HLT-026', type: 'CER', title: ' ' })).toEqual({ error: 'Title is required' });
    expect(await depositInCodexAction({ project: 'HLT-026', revisionOf: 'NOPE-001' })).toEqual({ error: 'Unknown document' });
    expect(await depositInCodexAction('forged')).toEqual({ error: 'Invalid request' });
    expect(await approveDocumentAction('HLT-026', 'NOPE-001')).toEqual({ error: 'Unknown document' });
    expect(await approveDocumentAction('HLT-026', 'PID-HLT-026')).toEqual({ error: 'No approval step is pending on this document' });
    expect(await logDownloadAction('HLT-026', 'PID-HLT-026', 'DOCX' as 'PDF')).toEqual({ error: 'Invalid request' });
    expect(await logDownloadAction('', 'PID-HLT-026')).toEqual({ error: 'Invalid request' });
  });

  it('"Continue in Codex" (new document): CER-HLT-042, Draft rev A, the viewer as author, links, first in the vault', async () => {
    as('Romain Aubert', 'R. Aubert', 'pm');
    const r = await depositInCodexAction({ project: 'HLT-026', type: 'CER', title: ' Material certificate 3.1 — S355 · heat 7781 ', po: 'PO-2026-118', part: 'CR-RAIL-A100' });
    expect(r).toEqual({ ok: true, number: 'CER-HLT-042', created: true, toast: 'Codex · CER-HLT-042 recorded · synced to Keystone' });
    const first = (await listVaultDocuments())[0];
    expect(first).toMatchObject({
      number: 'CER-HLT-042', type: 'CER', project: 'HLT-026', status: 'draft', revision: 'A', isNew: true, author: 'R. Aubert', service: 'procurement',
      confidentiality: 'internal', title: 'Material certificate 3.1 — S355 · heat 7781', tags: ['PO-2026-118', 'CR-RAIL-A100'],
    });
    expect(first.links.map((l) => [l.kind, l.ref])).toEqual([['purchase_order', 'PO-2026-118'], ['article', 'CR-RAIL-A100']]);
    expect((await getCodexSyncState())!.records).toBe(413);
    expect((await listAudit())[0]).toMatchObject({ who: 'Romain Aubert', object: 'CER-HLT-042' });
    // The next certificate takes the next number.
    expect(await depositInCodexAction({ project: 'HLT-026', type: 'CER', title: 'Second certificate' })).toMatchObject({ number: 'CER-HLT-043', created: true });
  });

  it('"Continue in Codex" (new revision): the record goes back to Draft, its approvals are reset', async () => {
    const r = await depositInCodexAction({ project: 'HLT-026', revisionOf: 'GA-HLT-026', type: 'CER', po: 'x' });
    expect(r).toEqual({ ok: true, number: 'GA-HLT-026', created: false, toast: 'Codex · GA-HLT-026 recorded · synced to Keystone' });
    const d = (await getDocumentRecord('GA-HLT-026'))!;
    expect([d.status, d.revision, d.type]).toEqual(['draft', 'C', 'GA']);
    expect(d.approvals.map((a) => a.signed)).toEqual([true, false, false]);
  });

  it('"Approve in Codex": only the named approver (or the director); the last step releases the record', async () => {
    as('Romain Aubert', 'R. Aubert', 'pm');
    expect(await approveDocumentAction('HLT-026', 'RPT-HLT-014')).toEqual({ error: 'You are not the approver of this step' });
    as('Gabriel Comte', 'G. Comte', 'quality');
    expect(await approveDocumentAction('HLT-026', 'RPT-HLT-014')).toEqual({ ok: true });
    let d = (await getDocumentRecord('RPT-HLT-014'))!;
    expect([d.status, d.nextRoleLabel, d.nextApprover, d.approvalsGiven]).toEqual(['release_proposed', 'Project manager', 'R. Aubert', 1]);
    expect(d.approvals.map((a) => [a.roleLabel, a.signed, a.signedOn])).toEqual([['Author', true, '2026-09-26'], ['Quality manager', true, '2026-09-29'], ['Project manager', false, null]]);
    expect(await approveDocumentAction('HLT-026', 'RPT-HLT-014')).toEqual({ error: 'You are not the approver of this step' });
    as('Romain Aubert', 'R. Aubert', 'pm');
    expect(await approveDocumentAction('HLT-026', 'RPT-HLT-014')).toEqual({ ok: true });
    d = (await getDocumentRecord('RPT-HLT-014'))!;
    // Released client deliverable: shared with the client, acknowledgement pending; rev A withdraws nothing.
    expect([d.status, d.shared, d.acknowledged, d.withdrawal, d.canApprove]).toEqual(['released', true, false, null, false]);
    expect(await docsBadge()).toBe('');
  });

  it('a revision > A released by the director withdraws the previous one', async () => {
    // GA-HLT-026 (rev C) was handed back as Draft above: freeze, propose, two approvals.
    await freezeDocument('GA-HLT-026', 'Antoine Girard');
    await proposeDocumentRelease('GA-HLT-026', 'Antoine Girard');
    expect(await docsBadge()).toBe('1');
    expect(await approveDocumentAction('HLT-026', 'GA-HLT-026')).toEqual({ ok: true });
    expect(await approveDocumentAction('HLT-026', 'GA-HLT-026')).toEqual({ ok: true });
    const d = (await getDocumentRecord('GA-HLT-026'))!;
    expect([d.status, d.withdrawal]).toEqual(['released', { revision: 'B', on: '2026-09-29' }]);
    expect(d.approvals.map((a) => a.signed)).toEqual([true, true, true]);
    // The proof names who signed: the director, on behalf of the engineering lead and the project manager.
    expect(d.approvals.map((a) => a.who)).toEqual(['J. Wagner', 'M. Lefebvre', 'M. Lefebvre']);
  });

  it('downloads are logged for every viewer, with the format', async () => {
    as('Nadia Bensaïd', 'N. Bensaïd', 'client', { canEdit: false });
    expect(await logDownloadAction('HLT-026', 'PID-HLT-026')).toEqual({ ok: true });
    as('Julien Wagner', 'J. Wagner', 'member');
    expect(await logDownloadAction('HLT-026', 'PID-HLT-026', 'Native')).toEqual({ ok: true });
    const d = (await getDocumentRecord('PID-HLT-026'))!;
    expect(d.downloads.map((x) => x.text)).toEqual([
      'Nadia Bensaïd · rev D · 29 Sep · PDF', 'Julien Wagner · rev D · 29 Sep · Native', 'S. Haddad · rev D · 27 Sep · PDF', 'N. Bensaïd · rev D · 28 Sep · PDF',
    ]);
  });

  it('"Sync now": toast with the index record count', async () => {
    const r = await syncCodexAction('HLT-026');
    expect(r).toEqual({ ok: true, toast: 'Codex sync · index up to date · 414 records' });
  });

  it('client "Acknowledge receipt": the client of the project only, shared records only', async () => {
    as('Romain Aubert', 'R. Aubert', 'pm');
    expect(await acknowledgeDocumentAction('HLT-026', 'PID-HLT-026')).toEqual({ error: 'Only the client can acknowledge receipt' });
    as('Nadia Bensaïd', 'N. Bensaïd', 'client', { isMine: false });
    expect(await acknowledgeDocumentAction('NDC-031', 'PID-NDC-031')).toEqual({ error: 'Only the client can acknowledge receipt' });
    as('Nadia Bensaïd', 'N. Bensaïd', 'client');
    expect(await acknowledgeDocumentAction('HLT-026', 'LST-INS-026')).toEqual({ error: 'Unknown document' });
    expect(await acknowledgeDocumentAction('HLT-026', 'PID-HLT-026')).toEqual({ ok: true });
    const d = (await getDocumentRecord('PID-HLT-026'))!;
    expect(d.acknowledged).toBe(true);
    expect(d.distribution[0]).toMatchObject({ kind: 'client', acknowledgedOn: '2026-09-29' });
  });
});
