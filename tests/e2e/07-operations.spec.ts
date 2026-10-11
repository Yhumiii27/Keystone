// Operations scenarios: a task attachment uploaded from the task sheet and downloaded byte for byte; a PM who is not the
// assignee refused (403), an executable refused (415), the upload guards of R-008 (another site → 403); and the BOM
// "Create spares purchase order" drafting a purchase order that opens on Purchase orders (E-3).
import { expect, test } from '@playwright/test';
import { toast, viewAs, watch } from './helpers';

const PDF = Buffer.from('%PDF-1.4\n% Keystone e2e torque report\n1 0 obj << >> endobj\n%%EOF\n', 'latin1');

test('task attachment: upload, list, download identical; refusals for another viewer, a forbidden type and another site', async ({ page, context }) => {
  await viewAs(context, 'director');
  const w = watch(page);
  await page.goto('/my/tasks/T-2314');
  await page.getByLabel('Attach', { exact: true }).setInputFiles({ name: 'Torque report e2e.pdf', mimeType: 'application/pdf', buffer: PDF });
  await expect(toast(page)).toContainText('Torque report e2e.pdf · Attached');
  const link = page.getByRole('link', { name: 'Download Torque report e2e.pdf' });
  await expect(link).toBeVisible();
  const href = (await link.getAttribute('href'))!;
  const got = await page.request.get(href);
  expect([got.status(), got.headers()['content-type'], got.headers()['x-content-type-options']]).toEqual([200, 'application/pdf', 'nosniff']);
  expect(Buffer.compare(await got.body(), PDF)).toBe(0);

  const upload = (name: string, mimeType: string, headers: Record<string, string> = {}) =>
    page.request.post('/api/tasks/T-2314/files', { multipart: { file: { name, mimeType, buffer: PDF } }, headers });
  expect((await upload('virus.exe', 'application/octet-stream')).status()).toBe(415);
  expect((await upload('Report.pdf', 'application/pdf', { origin: 'https://evil.example' })).status()).toBe(403);
  await viewAs(context, 'pm');
  const pm = await upload('Report.pdf', 'application/pdf');
  expect(pm.status()).toBe(403);
  w.check();
});

test('BOM › Create spares purchase order: a draft purchase order, opened on Purchase orders', async ({ page, context }) => {
  await viewAs(context, 'director');
  const w = watch(page);
  await page.goto('/projects/HLT-026/bom?view=spares');
  await page.getByRole('button', { name: 'Create spares purchase order' }).click();
  const d = page.getByRole('dialog', { name: 'Create spares purchase order' });
  const create = d.getByRole('button', { name: 'Create draft purchase orders' });
  await expect(create).toBeVisible();
  if (await create.isDisabled()) await d.getByRole('checkbox').first().click();
  await create.click();
  await expect(toast(page)).toContainText(/PO-\d+/);
  const po = /PO-\d+/.exec((await toast(page).textContent()) ?? '')![0];
  await expect(page).toHaveURL(/\/orders/);
  await expect(page.locator('main')).toContainText(po);
  await expect(page.locator('main')).toContainText('Draft');
  w.check();
});
