// Portfolio scenarios: the New project wizard (L-3b: name, client, PM, type, start and site required — Next disabled without a
// location) creating a project that opens on its plan; the Settings health threshold driving the health everywhere (A-13:
// "At risk below" 0.99 → NDC-031 At risk on Projects and in its CSV, then restored); a forced stage change approved and
// another rejected (reverted) from My approvals (L-1); R-152: the forced move and the created project are confirmed by a toast.
import { expect, test, type Page } from '@playwright/test';
import { exportFile, toast, viewAs, watch } from './helpers';

test.describe.configure({ mode: 'serial' });

test('New project wizard: location required, the template is instantiated, the project opens on its plan', async ({ page, context }) => {
  await viewAs(context, 'director');
  const w = watch(page);
  await page.goto('/portfolio/projects');
  await page.getByRole('button', { name: 'New project' }).click();
  const d = page.getByRole('dialog', { name: /New project/ });
  await d.getByLabel(/^Project name/).fill('E2E Harbour Automation');
  await d.getByLabel(/^Client \/ sponsor/).fill('Port of Le Havre');
  await d.getByLabel(/^Planned start/).fill('2026-11-02');
  const next = d.getByRole('button', { name: 'Next' });
  await expect(next).toBeDisabled();
  await d.getByLabel(/^Site city/).fill('Le Havre');
  await d.getByLabel(/^Site country/).selectOption({ label: 'France' });
  await expect(next).toBeEnabled();
  await next.click();
  await next.click();
  await next.click();
  await d.getByRole('button', { name: 'Create project' }).click();
  // R-152 (X-9): the confirmation carries the typed name as typed.
  await expect(toast(page)).toContainText('· E2E Harbour Automation · Project created');
  await expect(page).toHaveURL(/\/projects\/[A-Z]{3}-\d{3}\/plan/, { timeout: 30_000 });
  await expect(page.locator('main')).toContainText('E2E Harbour Automation');
  await expect(page.getByRole('row').filter({ has: page.getByRole('link', { name: /^A\d{4}$/ }) }).first()).toBeVisible();
  w.check();
});

/** Health cell (Project · Status · Health · SPI …) of a project's row in the Projects register. */
const health = (page: Page, code: string) => page.getByRole('row').filter({ has: page.locator(`a[href="/projects/${code}/plan"]`) }).first().getByRole('cell').nth(2);

// R-073 (delivery 7): SPI and CPI are computed from Keystone's data — NDC-031 (SPI 0.96) is At risk at the default 0.97, so the
// threshold is shown on MSR-012 (SPI 0.99, CPI 1.04): On track at 0.97, At risk below 1.
test('health threshold: "At risk below" 1 puts MSR-012 At risk on Projects and in the export, then restored', async ({ page, context }) => {
  await viewAs(context, 'director');
  const w = watch(page);
  const setThreshold = async (value: string) => {
    await page.goto('/admin/settings');
    const field = page.getByLabel('At risk below', { exact: true });
    await field.fill(value);
    await field.press('Enter');
    await expect(field).not.toHaveAttribute('aria-busy', 'true');
    await page.reload();
    await expect(page.getByLabel('At risk below', { exact: true })).toHaveValue(value);
  };
  await page.goto('/portfolio/projects');
  await expect(health(page, 'MSR-012')).toHaveText('On track');
  await setThreshold('1');
  await page.goto('/portfolio/projects');
  await expect(health(page, 'MSR-012')).toHaveText('At risk');
  const csv = (await exportFile(page.request, '/api/export/projects?format=csv')).body.toString('utf8');
  expect(csv.split('\n').find((l) => l.includes('MSR-012'))).toContain('At risk');
  await setThreshold('0.97');
  await page.goto('/portfolio/projects');
  await expect(health(page, 'MSR-012')).toHaveText('On track');
  w.check();
});

test('forced stage changes: one approved (kept), one rejected (reverted) from My approvals', async ({ page, context }) => {
  await viewAs(context, 'director');
  const w = watch(page);
  // Status cell of the register: the stage tag is the "Move to" menu button; the next stages are the buttons it opens.
  const cell = (code: string) => page.getByRole('row').filter({ has: page.locator(`a[href="/projects/${code}/plan"]`) }).first().getByRole('cell').nth(1);
  const status = (code: string) => cell(code).locator('button[aria-haspopup]');
  const force = async (code: string) => {
    await page.goto('/portfolio/projects');
    const from = (await status(code).innerText()).trim();
    await status(code).click();
    await cell(code).getByRole('button').nth(1).click();
    const d = page.getByRole('dialog', { name: 'Force stage change' });
    await d.getByLabel(/^Reason for forcing/).fill('Agreed with the client — deliverable follows next week');
    await d.getByRole('button', { name: 'Confirm and request validation' }).click();
    await expect(d).toHaveCount(0);
    // R-152 (X-9, L-1): confirmed once the server accepted the forced move.
    await expect(toast(page)).toContainText(`${code} · Validation requested from the portfolio director`);
    await expect(status(code)).not.toHaveText(from);
    return { from, to: (await status(code).innerText()).trim() };
  };
  const kept = await force('WSA-044');
  const reverted = await force('RCF-019');

  await page.goto('/my/approvals');
  await page.getByRole('button', { name: /^Approve WSA-044/ }).click();
  await expect(toast(page)).toContainText('WSA-044 · Stage change approved');
  await page.getByRole('button', { name: /^Reject RCF-019/ }).click();
  const reject = page.getByRole('dialog', { name: /^Reject RCF-019/ });
  await reject.getByLabel(/^Comment — the project manager sees this/).fill('Deliverables first');
  await reject.getByRole('button', { name: 'Confirm reject' }).click();
  await expect(toast(page)).toContainText('RCF-019 · Stage change rejected · Reverted to the previous stage');

  await page.goto('/portfolio/projects');
  await expect(status('WSA-044')).toHaveText(kept.to);
  await expect(status('RCF-019')).toHaveText(reverted.from);
  w.check();
});
