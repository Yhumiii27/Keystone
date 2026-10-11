// Delivery 7 scenarios: the client sent home outside their workspace and on another organisation's project (R-042); the
// tablet layout's drawer menu (R-146); an ITP result recorded by quality (R-112) and a punch-item photo stored by Keystone
// (R-126: added by the team, seen by the client on their own project's punch list, refused to them in writing); a
// contingency draw-down linked to a change request, validated by the portfolio director in My approvals (C-4, R-071).
import { expect, test } from '@playwright/test';
import { toast, viewAs, watch } from './helpers';

// A 1 × 1 PNG.
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082', 'hex');

test('client: sent home outside the workspace and from another organisation’s project (R-042)', async ({ page, context }) => {
  await viewAs(context, 'client');
  const w = watch(page);
  await page.goto('/projects/HLT-026/budget');
  await expect(page).toHaveURL(/\/$/);
  await page.goto('/projects/NDC-031/client');
  await expect(page).toHaveURL(/\/$/);
  // Their own project's portal stays open.
  await page.goto('/projects/HLT-026/client');
  await expect(page).toHaveURL(/\/projects\/HLT-026\/client/);
  w.check();
});

test('tablet: the sidebar is a drawer behind the Menu button; Escape closes it (R-146)', async ({ page, context }) => {
  await viewAs(context, 'pm');
  const w = watch(page);
  await page.setViewportSize({ width: 900, height: 1200 });
  await page.goto('/projects/HLT-026/site');
  const menu = page.getByRole('button', { name: 'Menu' });
  const sidebar = page.locator('#ks-sidebar');
  await expect(menu).toBeVisible();
  await expect(menu).toHaveAttribute('aria-expanded', 'false');
  await expect(sidebar).toBeHidden();
  await menu.click();
  await expect(sidebar).toBeVisible();
  await expect(menu).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Escape');
  await expect(sidebar).toBeHidden();
  await expect(menu).toBeFocused();
  // A navigation from the drawer closes it.
  await menu.click();
  await sidebar.getByRole('link', { name: 'Deliveries' }).first().click();
  await expect(page).toHaveURL(/\/deliveries/);
  await expect(sidebar).toBeHidden();
  w.check();
});

test('ITP: quality records an inspection result (R-112); a punch photo is stored, shown to the client, never added by them (R-126)', async ({ page, context }) => {
  await viewAs(context, 'quality');
  const w = watch(page);
  await page.goto('/projects/HLT-026/itp');
  const record = page.getByRole('button', { name: /^Record result · I-\d+$/ }).first();
  await expect(record).toBeVisible();
  const number = /I-\d+/.exec((await record.getAttribute('aria-label')) ?? '')![0];
  await record.click();
  const d = page.getByRole('dialog', { name: 'Record result' });
  await d.getByLabel('Comment').fill('E2E — welds and bolting checked');
  await d.getByRole('button', { name: 'Record result' }).click();
  await expect(toast(page)).toContainText(`${number} ·`);
  await expect(toast(page)).toContainText('Inspection result recorded');

  // Photo of a punch item of the ITP register, through the upload route.
  const upload = (headers: Record<string, string> = {}) =>
    page.request.post('/api/photos', {
      multipart: { kind: 'punch_item', code: 'HLT-026', ref: 'P-02', register: 'itp', file: { name: 'E2E punch.png', mimeType: 'image/png', buffer: PNG } },
      headers,
    });
  const added = await upload();
  expect(added.status()).toBe(200);
  const { id } = (await added.json()) as { id: string };
  expect((await upload({ origin: 'https://evil.example' })).status()).toBe(403);
  const img = await page.request.get(`/api/photos/${id}`);
  expect([img.status(), img.headers()['content-type']]).toEqual([200, 'image/png']);
  expect(Buffer.compare(await img.body(), PNG)).toBe(0);

  await viewAs(context, 'client');
  expect((await page.request.get(`/api/photos/${id}`)).status()).toBe(200);
  expect((await upload()).status()).toBe(403);
  w.check();
});

test('contingency: a draw-down linked to a change request waits for the director, who validates it in My approvals (C-4)', async ({ page, context }) => {
  await viewAs(context, 'pm');
  const w = watch(page);
  await page.goto('/projects/HLT-026/contingency');
  await page.getByRole('button', { name: 'Draw-down' }).click();
  const d = page.getByRole('dialog', { name: 'Contingency draw-down' });
  const reason = `E2E draw-down ${Date.now()}`;
  await d.getByLabel('Amount (k€)').fill('12');
  await d.getByLabel('Reason').fill(reason);
  const link = d.getByLabel('Linked to');
  const firstLink = await link.locator('option').nth(1).getAttribute('value');
  await link.selectOption(firstLink!);
  await d.getByRole('button', { name: 'Record draw-down' }).click();
  await expect(toast(page)).toContainText('Awaiting the director’s validation');

  await viewAs(context, 'director');
  await page.goto('/my/approvals');
  const row = page.locator('main').getByText(reason).locator('xpath=ancestor::*[.//button[starts-with(@aria-label, "Approve")]][1]');
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: /^Approve / }).click();
  await expect(toast(page)).toContainText('HLT-026 · Draw-down validated');
  await expect(page.locator('main').getByText(reason)).toHaveCount(0);
  w.check();
});
