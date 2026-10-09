// Chapter 4 (S-7): a DRAFT resource request (what-if "Apply") in the Resource requests and Project resources exports —
// status "Draft" / « Brouillon », no sent date (its stored date is when it was drafted), no response.
import { beforeAll, describe, expect, it } from 'vitest';
import { PERSONA_BY_ROLE } from '@/config/personas';
import type { RoleKey, ScreenId } from '@/config/screens';
import { setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { createResourceRequest } from '@/server/dal/requests';
import { buildExportContext, runExport } from '../run';
import { readXlsx } from '../xlsx';
import '.';

const NOW = new Date('2026-10-09T08:00:00Z');
const sheetsOf = async (screen: ScreenId, role: RoleKey, query: string, lang: 'fr' | 'en' = 'en') =>
  readXlsx((await runExport(await buildExportContext({ screen, viewer: PERSONA_BY_ROLE[role], lang, params: new URLSearchParams(query), now: NOW }), 'xlsx')).body);
const rowOf = (rows: (string | number | boolean | null)[][], id: string) => {
  const r = rows.find((x) => x[0] === id)!;
  return Object.fromEntries(rows[0].map((h, i) => [h, r[i]]));
};

beforeAll(async () => {
  setDb(await openDatabase());
}, 60_000);

describe('draft requests in the exports (S-7)', () => {
  it('status Draft, empty sent date and response; sent requests unchanged', async () => {
    const number = await createResourceRequest(
      { projectCode: 'HLT-026', title: 'Overtime crew', activityCode: 'A1250', person: 'Julien Wagner', hours: 40, priority: 'high', draft: true },
      'Romain Aubert',
    );
    const [en] = await sheetsOf('requests', 'pm', '');
    expect(rowOf(en.rows, number)).toMatchObject({ Status: 'Draft', 'Requested by': 'R. Aubert' });
    expect([rowOf(en.rows, number).Sent ?? '', rowOf(en.rows, number).Response ?? '']).toEqual(['', '']);
    expect(rowOf(en.rows, 'RQ-041')).toMatchObject({ Status: 'Pending review' });
    expect(rowOf(en.rows, 'RQ-041').Sent).toBeTruthy();
    const [fr] = await sheetsOf('requests', 'pm', '', 'fr');
    const d = fr.rows.find((x) => x[0] === number)!;
    expect(d[en.rows[0].indexOf('Status')]).toBe('Brouillon');
    expect(d[en.rows[0].indexOf('Sent')] ?? '').toBe('');
    const [, team] = await sheetsOf('presources', 'director', 'code=HLT-026');
    expect(rowOf(team.rows, number).Status).toBe('Draft');
    expect(rowOf(team.rows, number).Sent ?? '').toBe('');
  });
});
