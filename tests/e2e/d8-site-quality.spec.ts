// Delivery 8, lot site-quality: the project's single punch list on Inspections & punch list — a document's "P-01" link reaches
// the row (R-117), the origin filter; the PM prepares the site sheet of PRS-038 from its empty state and adds then removes an
// equipment line (R-118, D-3 'a'); the Daily report form has no HSE field and links to Vigie instead (R-122, NEW-SITE-2 'a').
import { expect, test } from '@playwright/test';
import { toast, viewAs, watch } from './helpers';

test('punch list: one list per project, the P-01 anchor, the origin filter (R-117)', async ({ page, context }) => {
  await viewAs(context, 'pm');
  const w = watch(page);
  await page.goto('/projects/HLT-026/itp?view=punch#punch-P-01');
  const row = page.locator('#punch-P-01');
  await expect(row).toBeVisible();
  await expect(row).toContainText('Inspection');
  // The items raised on site follow the inspection ones in the same list.
  await expect(page.locator('#punch-P-06')).toContainText('Site');
  await page.goto('/projects/HLT-026/itp?view=punch&origin=site');
  await expect(page.locator('#punch-P-06')).toBeVisible();
  await expect(page.locator('#punch-P-01')).toHaveCount(0);
  w.check();
});

test('site sheet: the PM prepares it from the empty state, adds and removes an equipment line (R-118)', async ({ page, context }) => {
  await viewAs(context, 'pm');
  const w = watch(page);
  await page.goto('/projects/PRS-038/site');
  await expect(page.locator('main')).toContainText('No site sheet yet for this project');
  await page.getByRole('button', { name: 'Prepare the site', exact: true }).click();
  const d = page.getByRole('dialog', { name: 'Prepare the site' });
  // Prefilled from the project: its site and country.
  await expect(d.getByLabel('Site', { exact: false }).first()).toHaveValue('Le Havre');
  await d.getByLabel('Site start').fill('19 Oct 2026');
  await d.getByLabel('Site end').fill('18 Dec 2026');
  await d.getByRole('button', { name: 'Create the site sheet' }).click();
  await expect(toast(page)).toContainText('Site sheet prepared');
  const main = page.locator('main');
  await expect(main).toContainText('Not created yet');
  await expect(main).toContainText('No equipment yet');
  await page.getByRole('button', { name: 'Add equipment', exact: true }).click();
  const e = page.getByRole('dialog', { name: 'Add equipment' });
  await e.getByLabel('Equipment').fill('E2E — Nacelle 20 m');
  await e.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(toast(page)).toContainText('Equipment added · E2E — Nacelle 20 m');
  await expect(main).toContainText('E2E — Nacelle 20 m');
  await page.getByRole('button', { name: 'Remove — E2E — Nacelle 20 m' }).click();
  await page.getByRole('dialog', { name: 'Remove the line?' }).getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(toast(page)).toContainText('Line removed · E2E — Nacelle 20 m');
  await expect(main).toContainText('No equipment yet');
  w.check();
});

test('daily report: no HSE field, "Declare it in Vigie" instead (R-122)', async ({ page, context }) => {
  await viewAs(context, 'pm');
  const w = watch(page);
  await page.goto('/projects/HLT-026/site');
  await page.getByRole('button', { name: 'Daily report', exact: true }).click();
  const d = page.getByRole('dialog', { name: 'Daily report' });
  await expect(d.getByLabel('HSE incident')).toHaveCount(0);
  const link = d.getByRole('link', { name: /Declare it in Vigie/ });
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(link).toHaveAttribute('href', /signaler/);
  w.check();
});
