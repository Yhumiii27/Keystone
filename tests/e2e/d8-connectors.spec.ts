// Delivery 8, lot connectors (R-029, NEW-CURSUS-7 "a"): Cursus posts an event to Keystone's events endpoint on the real
// server — no session, its own key (CURSUS_EVENTS_KEY, set by tests/e2e/run.ts), a repeated event id answered as a
// duplicate, a wrong key refused; the Cursus row of Activity & integrations then says when the last event arrived. The Leave
// screen says Cursus, not Lucca, and keeps no reason of an absence (R-031, R-173).
import { expect, test } from '@playwright/test';
import { viewAs, watch } from './helpers';

const KEY = process.env.CURSUS_EVENTS_KEY;
const PATH = '/api/integrations/cursus/events';

test('Cursus pushes an event: stored once, duplicates answered, a wrong key refused; Activity & integrations shows it', async ({ request, page, context }) => {
  test.skip(!KEY, 'CURSUS_EVENTS_KEY is set by tests/e2e/run.ts');
  const event = { id: `e2e-${Date.now()}`, type: 'heures.validees', emis_le: '2026-10-05T08:30:00Z', data: { matricule: 'EMP-E2E', semaine: '2026-W40', projets: { 'HLT-026': 32 } } };
  // Server to server: no cookie, no same-origin header.
  const first = await request.post(PATH, { data: event, headers: { 'x-api-key': KEY! } });
  expect(first.status()).toBe(200);
  expect(await first.json()).toEqual({ ok: true, id: event.id, status: 'received' });
  const again = await request.post(PATH, { data: event, headers: { 'x-api-key': KEY! } });
  expect(await again.json()).toEqual({ ok: true, id: event.id, duplicate: true });
  const wrong = await request.post(PATH, { data: { ...event, id: `${event.id}-x` }, headers: { 'x-api-key': 'demo-cursus-events' } });
  expect(wrong.status()).toBe(401);
  const invalid = await request.post(PATH, { data: { id: 'x', type: 'absence.validee', emis_le: 'yesterday', data: {} }, headers: { 'x-api-key': KEY! } });
  expect(invalid.status()).toBe(400);
  expect(invalid.headers()['cache-control']).toBe('no-store');

  await viewAs(context, 'director');
  const w = watch(page);
  await page.goto('/admin/integrations?view=connectors');
  const cursus = page.getByRole('row').filter({ has: page.getByRole('cell', { name: 'Cursus', exact: false }) }).first();
  await expect(cursus).toContainText('Last Cursus event');
  await page.goto('/resources/leave');
  await expect(page.locator('main')).toContainText('Cursus');
  await expect(page.locator('main')).not.toContainText(/Lucca|Sick|Sync Lucca/);
  w.check();
});
