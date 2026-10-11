import { beforeAll, describe, it } from 'vitest';
import { PERSONA_BY_ROLE } from '@/config/personas';
import { setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { buildExportContext, runExport } from '@/server/export/run';
import { readXlsx } from '@/server/export/xlsx';
import '@/server/export/providers';

beforeAll(async () => {
  setDb(await openDatabase());
}, 60_000);

describe('P-10b ITP export', () => {
  it('client export of the ITP punch list', async () => {
    const ctx = await buildExportContext({ screen: 'itp', viewer: PERSONA_BY_ROLE.client, lang: 'en', params: new URLSearchParams('code=HLT-026&view=punch'), now: new Date('2026-10-09T08:00:00Z') });
    const wb = await readXlsx((await runExport(ctx, 'xlsx')).body);
    const punch = wb.find((s) => s.name === 'Punch list')!;
    console.log(JSON.stringify(punch.rows.slice(0, 12)));
  }, 60_000);
});
