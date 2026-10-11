// Exports (X-3, S-9a) as the browser downloads them: CSV and Excel of 12 screens, the 8 PDF reports, document PDFs (purchase
// order, goods receipt, account statement, client planning, spares list), MS Project XML; client refusals (P-1); and the R-008
// guards on the export route (a request from another site refused). Stays under the export rate limit (60 a minute).
import { expect, test } from '@playwright/test';
import { exportFile, viewAs } from './helpers';

const SCREENS: [string, string | null][] = [
  ['budget', 'HLT-026'], ['risks', 'HLT-026'], ['plan', 'HLT-026'], ['schedule', 'HLT-026'], ['meetings', 'HLT-026'], ['changes', 'HLT-026'],
  ['quality', 'HLT-026'], ['orders', 'HLT-026'], ['projects', null], ['overview', null], ['requests', null], ['plumbing', null],
];
const PDF = ['budget', 'billing', 'meetings', 'risks', 'trends', 'client', 'plan', 'schedule'];
const MAGIC = { csv: null, xlsx: 'PK', pdf: '%PDF' } as const;

test('CSV and Excel of 12 screens, the 8 PDF reports, document PDFs and MS Project XML', async ({ page, context }) => {
  await viewAs(context, 'director');
  const q = (screen: string, format: string, code: string | null, extra = '') => `/api/export/${screen}?format=${format}${code ? `&code=${code}` : ''}${extra}`;
  for (const [screen, code] of SCREENS) {
    for (const format of ['csv', 'xlsx'] as const) {
      const f = await exportFile(page.request, q(screen, format, code));
      expect(f.status, `${screen} ${format}`).toBe(200);
      expect(f.disposition, `${screen} ${format}`).toMatch(/^attachment; filename=/);
      expect(f.body.length, `${screen} ${format}`).toBeGreaterThan(50);
      if (MAGIC[format]) expect(f.body.subarray(0, 2).toString('latin1'), `${screen} ${format}`).toBe(MAGIC[format]);
      else expect(f.body.toString('utf8').charCodeAt(0), `${screen} csv BOM`).toBe(0xfeff);
    }
  }
  for (const screen of PDF) {
    const f = await exportFile(page.request, q(screen, 'pdf', 'HLT-026'));
    expect([screen, f.status, f.type, f.body.subarray(0, 4).toString('latin1')]).toEqual([screen, 200, 'application/pdf', '%PDF']);
  }
  for (const href of [
    q('orders', 'pdf', 'HLT-026', '&variant=po&id=PO-1082'),
    q('client', 'pdf', 'HLT-026', '&variant=planning'),
    q('client', 'pdf', 'HLT-026', '&variant=statement'),
    q('bom', 'pdf', 'HLT-026', '&variant=spares'),
  ]) {
    const f = await exportFile(page.request, href);
    expect([href, f.status, f.body.subarray(0, 4).toString('latin1')]).toEqual([href, 200, '%PDF']);
  }
  const xml = await exportFile(page.request, '/api/interchange/mspdi/HLT-026');
  expect([xml.status, xml.type, xml.body.toString('utf8').includes('<Project')]).toEqual([200, 'application/xml; charset=utf-8', true]);
});

test('rate limit: the 61st export of a viewer within a minute is refused with Retry-After (R-008)', async ({ page, context }) => {
  // Quality engineer: a persona no other scenario exports with, so its window is empty.
  await viewAs(context, 'quality');
  for (let i = 0; i < 60; i++) expect((await exportFile(page.request, '/api/export/quality?format=csv&code=HLT-026')).status, `export ${i + 1}`).toBe(200);
  const refused = await page.request.get('/api/export/quality?format=csv&code=HLT-026', { headers: { 'sec-fetch-site': 'same-origin' } });
  expect(refused.status()).toBe(429);
  expect(Number(refused.headers()['retry-after'])).toBeGreaterThan(0);
  expect(await refused.text()).toBe('Too many requests — please wait a minute and try again');
});

test('a client exports only its own workspace; another site cannot trigger an export', async ({ page, context }) => {
  await viewAs(context, 'client');
  expect((await exportFile(page.request, '/api/export/budget?format=csv&code=HLT-026')).status).toBe(403);
  expect((await exportFile(page.request, '/api/interchange/mspdi/HLT-026')).status).toBe(403);
  expect((await exportFile(page.request, '/api/export/trends?format=pdf&code=HLT-026')).status).toBe(200);
  await viewAs(context, 'director');
  const cross = await page.request.get('/api/export/risks?format=csv&code=HLT-026', { headers: { 'sec-fetch-site': 'cross-site' } });
  expect(cross.status()).toBe(403);
});
