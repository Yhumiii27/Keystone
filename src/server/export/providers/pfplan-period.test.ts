// Portfolio schedule export (Delivery 8, L-8 = a, R-136): the filter lines name the window of the screen (`?from=`, the
// default window otherwise); the sheets list every live row whatever the window.
import { beforeAll, describe, expect, it } from 'vitest';
import { PERSONA_BY_ROLE } from '@/config/personas';
import { setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { getExportProvider } from '../registry';
import { buildExportContext } from '../run';
import '.';

const workbook = async (query: string, lang: 'en' | 'fr' = 'en') => {
  const ctx = await buildExportContext({ screen: 'pfplan', viewer: PERSONA_BY_ROLE.director, lang, params: new URLSearchParams(query), now: new Date('2026-10-09T08:00:00Z') });
  return getExportProvider('pfplan')!.table!(ctx);
};

beforeAll(async () => {
  setDb(await openDatabase());
}, 60_000);

describe('portfolio schedule export: period line', () => {
  it('default window, ?from= window, malformed ?from= (default); rows never filtered', async () => {
    const def = await workbook('');
    expect(def.filters).toContain('Period: Oct 2025 – Sep 2027');
    const later = await workbook('from=2027-04&filter=pipe');
    expect(later.filters).toEqual(expect.arrayContaining(['Display: Pipeline', 'Period: Apr 2027 – Mar 2029']));
    expect((await workbook('from=2027-05')).filters).toContain('Period: Oct 2025 – Sep 2027');
    expect(later.sheets[0].rows.length).toBe((await workbook('filter=pipe')).sheets[0].rows.length);
    expect((await workbook('', 'fr')).filters).toContain('Période: oct. 2025 – sept. 2027');
  });
});
