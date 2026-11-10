// Integration review of delivery 8 (P-10b, R-043): a record of a client-deliverable type is shared with the client only when
// it is released AND of Client confidentiality. The minutes of an internal meeting (MIN, Released, Internal) are never shared
// with the client, while an external meeting's minutes (Client confidentiality) are. D9-06 (owner, 10 Nov 2026): clients never
// see Keystone — the client portal, its document categories and the client's acknowledgement are gone; every persona exports
// the register with both records.
import { beforeAll, describe, expect, it } from 'vitest';
import { PERSONAS } from '@/config/personas';
import { setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { buildExportContext, runExport } from '@/server/export/run';
import { readXlsx } from '@/server/export/xlsx';
import '@/server/export/providers';
import { getDocumentRecord, listSharedDocuments } from './documents';
import { addMeetingLine, createMeeting, sendMinutes } from './meetings';

const NOW = new Date('2026-10-09T08:00:00Z');
let internalMin = '';
let externalMin = '';

beforeAll(async () => {
  setDb(await openDatabase());
}, 60_000);

describe('P-10b: minutes of an internal meeting are never shared with the client', () => {
  it('internal minutes (MTG-118): Internal, not shared, no client distribution row', async () => {
    internalMin = (await sendMinutes('MTG-118', 'Romain Aubert')).minutesNumber;
    const d = (await getDocumentRecord(internalMin))!;
    expect([d.type, d.status, d.confidentiality, d.shared, d.acknowledged]).toEqual(['MIN', 'released', 'internal', false, false]);
    expect(d.distribution.filter((r) => r.kind === 'client')).toEqual([]);
    expect((await listSharedDocuments('HLT-026')).map((x) => x.number)).not.toContain(internalMin);
  });

  it('external minutes: Client confidentiality, shared with the client (sent outside Keystone)', async () => {
    const ext = await createMeeting('HLT-026', {
      title: 'Client progress review', type: 'external', series: 'one_off', date: '2026-09-28', invitees: ['R. Aubert', 'N. Bensaïd'], agenda: ['Progress'],
      clientPresent: true,
    }, 'Romain Aubert');
    await addMeetingLine(ext, 0, { type: 'info', text: 'Progress shown to the client' }, 'Romain Aubert');
    externalMin = (await sendMinutes(ext, 'Romain Aubert')).minutesNumber;
    const d = (await getDocumentRecord(externalMin))!;
    expect([d.confidentiality, d.shared]).toEqual(['client', true]);
    expect((await listSharedDocuments('HLT-026')).map((x) => x.number)).toContain(externalMin);
  });

  it.each(PERSONAS.map((p) => [p.role, p] as const))('%s: the documents register export holds both minutes', async (_role, persona) => {
    const ctx = await buildExportContext({ screen: 'docs', viewer: persona, lang: 'en', params: new URLSearchParams('code=HLT-026'), now: NOW });
    const [reg] = await readXlsx((await runExport(ctx, 'xlsx')).body);
    const i = reg.rows[0].indexOf('Document');
    const numbers = reg.rows.slice(1).map((r) => r[i]);
    expect(numbers).toEqual(expect.arrayContaining([internalMin, externalMin]));
  }, 30_000);
});
