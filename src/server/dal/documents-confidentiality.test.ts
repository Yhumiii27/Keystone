// Integration review of delivery 8 (P-10b, R-043): a record of a client-deliverable type is shared with the client only when
// it is released AND of Client confidentiality. The minutes of an internal meeting (MIN, Released, Internal) never reach the
// client — portal Documents, the R-138 categories, the client's vault list, the register export, the acknowledgement —
// while an external meeting's minutes (Client confidentiality) still do. Every persona exports the register: the client
// never gets the internal minutes, the internal personas get both records.
import { beforeAll, describe, expect, it } from 'vitest';
import { PERSONAS } from '@/config/personas';
import { setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { buildExportContext, runExport } from '@/server/export/run';
import { readXlsx } from '@/server/export/xlsx';
import '@/server/export/providers';
import { getClientPortal } from './client';
import { acknowledgeDocument, getDocumentRecord, listSharedDocuments, listVaultDocuments } from './documents';
import { addMeetingLine, createMeeting, sendMinutes } from './meetings';

const NOW = new Date('2026-10-09T08:00:00Z');
let internalMin = '';
let externalMin = '';

const minutesFiles = async () => (await getClientPortal('HLT-026')).documentCategories.find((c) => c.key === 'minutes')?.fileCount ?? 0;

beforeAll(async () => {
  setDb(await openDatabase());
}, 60_000);

describe('P-10b: minutes of an internal meeting are never shared with the client', () => {
  it('internal minutes (MTG-118): Internal, not shared — absent from the client portal, its categories and the shared list; no acknowledgement', async () => {
    const before = await minutesFiles();
    internalMin = (await sendMinutes('MTG-118', 'Romain Aubert')).minutesNumber;
    const d = (await getDocumentRecord(internalMin))!;
    expect([d.type, d.status, d.confidentiality, d.shared, d.acknowledged]).toEqual(['MIN', 'released', 'internal', false, false]);
    // No client distribution row on the drawer either.
    expect(d.distribution.filter((r) => r.kind === 'client')).toEqual([]);
    const portal = await getClientPortal('HLT-026');
    expect(portal.documents.map((x) => x.number)).not.toContain(internalMin);
    expect(await minutesFiles()).toBe(before);
    expect(portal.documentCategories.reduce((s, c) => s + c.fileCount, 0)).toBe(portal.documents.length);
    expect((await listSharedDocuments('HLT-026')).map((x) => x.number)).not.toContain(internalMin);
    // The client's vault keeps the shared records of their projects only (documents/page.tsx filters on `shared`).
    expect((await listVaultDocuments()).find((x) => x.number === internalMin)?.shared).toBe(false);
    await expect(acknowledgeDocument(internalMin, 'Nadia Bensaïd')).rejects.toThrow(/not shared with the client/);
  });

  it('external minutes: Client confidentiality, shared — in the portal, counted under "Meeting minutes", acknowledged by the client', async () => {
    const before = await minutesFiles();
    const ext = await createMeeting('HLT-026', {
      title: 'Client progress review', type: 'external', series: 'one_off', date: '2026-09-28', invitees: ['R. Aubert', 'N. Bensaïd'], agenda: ['Progress'],
    }, 'Romain Aubert');
    await addMeetingLine(ext, 0, { type: 'info', text: 'Progress shown to the client' }, 'Romain Aubert');
    externalMin = (await sendMinutes(ext, 'Romain Aubert')).minutesNumber;
    const d = (await getDocumentRecord(externalMin))!;
    expect([d.confidentiality, d.shared]).toEqual(['client', true]);
    expect((await getClientPortal('HLT-026')).documents.map((x) => x.number)).toContain(externalMin);
    expect(await minutesFiles()).toBe(before + 1);
    await acknowledgeDocument(externalMin, 'Nadia Bensaïd');
    expect((await getDocumentRecord(externalMin))!.acknowledged).toBe(true);
  });

  it.each(PERSONAS.map((p) => [p.role, p] as const))('%s: the documents register export holds the internal minutes for the internal team only', async (role, persona) => {
    const ctx = await buildExportContext({ screen: 'docs', viewer: persona, lang: 'en', params: new URLSearchParams('code=HLT-026'), now: NOW }).catch(() => null);
    if (!ctx) {
      // Refused outright (a client outside their workspace): nothing exported at all.
      expect(role).toBe('client');
      return;
    }
    const [reg] = await readXlsx((await runExport(ctx, 'xlsx')).body);
    const i = reg.rows[0].indexOf('Document');
    const numbers = reg.rows.slice(1).map((r) => r[i]);
    if (role === 'client') {
      expect(numbers).toContain(externalMin);
      expect(numbers).not.toContain(internalMin);
    } else {
      expect(numbers).toEqual(expect.arrayContaining([internalMin, externalMin]));
    }
  }, 30_000);
});
