// Planning scenarios of delivery 6 (S-1, S-3, S-5) on HLT-026 with a fresh database: Reschedule twice (the second changes
// nothing), relationships (cycle and duplicate refused, one added then removed), removal with Undo (plan CSV identical) and
// Recently deleted › Restore, and a new baseline through a change request approved by its whole chain.
import { expect, test, type Page } from '@playwright/test';
import { toast, viewAs, watch } from './helpers';

test.describe.configure({ mode: 'serial' });

const PLAN = '/projects/HLT-026/plan';
const planCsv = async (page: Page) => {
  const res = await page.request.get('/api/export/plan?format=csv&code=HLT-026', { headers: { 'sec-fetch-site': 'same-origin' } });
  expect(res.status()).toBe(200);
  return (await res.body()).toString('utf8');
};
const dialog = (page: Page, name: string) => page.getByRole('dialog', { name });

test('Reschedule twice: the CPM moves 11 activities, the second run changes nothing', async ({ page, context }) => {
  await viewAs(context, 'pm');
  const w = watch(page);
  await page.goto(PLAN);
  await page.getByRole('button', { name: 'Reschedule' }).click();
  await expect(toast(page)).toContainText(/Rescheduled at .+ · finish .+ · 11 activities changed/);
  await page.getByRole('button', { name: 'Reschedule' }).click();
  await expect(toast(page)).toContainText(/Rescheduled at .+ · finish .+ · no change/);
  w.check();
});

test('relationships: a loop and a duplicate are refused, a link is added then removed', async ({ page, context }) => {
  await viewAs(context, 'pm');
  const w = watch(page);
  const addLink = async (act: string, dir: 'pred' | 'succ', other: string, lag = '0') => {
    await page.goto(`${PLAN}?act=${act}`);
    await page.getByRole('button', { name: 'Add relationship' }).click();
    const d = dialog(page, 'Add relationship');
    await d.getByLabel('Relationship').selectOption(dir);
    const activity = d.getByLabel('Activity');
    const value = await activity.locator('option').filter({ hasText: new RegExp(`^${other} · `) }).first().getAttribute('value');
    await activity.selectOption(value!);
    await d.getByLabel('Lag (working days)').fill(lag);
    await d.getByRole('button', { name: 'Add relationship' }).click();
    return d;
  };
  let d = await addLink('A1010', 'pred', 'A1620');
  await expect(d.getByRole('alert')).toContainText(/^This relationship would create a logic loop: A1010 → (A\d{4} → )+A1620 → A1010$/);
  d = await addLink('A1520', 'pred', 'A1510');
  await expect(d.getByRole('alert')).toContainText('This relationship already exists');
  await addLink('A1520', 'pred', 'A1330', '5');
  await expect(toast(page)).toContainText('Relationship added · A1330 FS+5 → A1520');
  await page.getByRole('button', { name: 'Remove relationship · A1330 → A1520' }).click();
  await expect(toast(page)).toContainText('Relationship removed · A1330 → A1520');
  w.check();
});

test('remove a work package, Undo: the plan is back as it was; remove an activity, Recently deleted › Restore', async ({ page, context }) => {
  await viewAs(context, 'pm');
  const w = watch(page);
  const before = await planCsv(page);
  await page.goto(`${PLAN}?view=structure`);
  const wp = page.getByRole('row').filter({ has: page.getByRole('cell').filter({ hasText: /^1\.7$/ }) }).first();
  await wp.getByRole('button', { name: 'Remove', exact: true }).click();
  await dialog(page, 'Remove').getByRole('button', { name: 'Remove' }).click();
  await expect(toast(page)).toContainText('Work package 1.7 removed');
  await toast(page).getByRole('button', { name: 'Undo' }).click();
  await expect(toast(page)).toContainText(/Work package 1\.7 restored · \d+ activit/);
  expect(await planCsv(page)).toBe(before);

  await page.goto(`${PLAN}?view=structure`);
  const a1520 = page.getByRole('row').filter({ has: page.getByRole('link', { name: 'A1520', exact: true }) });
  await a1520.getByRole('button', { name: 'Remove', exact: true }).click();
  await dialog(page, 'Remove').getByRole('button', { name: 'Remove' }).click();
  await expect(toast(page)).toContainText('A1520 removed');
  await page.reload();
  const trash = page.getByRole('region', { name: 'Recently deleted' });
  await expect(trash).toContainText('A1520');
  await trash.getByRole('button', { name: /^Restore · A1520/ }).click();
  await expect(toast(page)).toContainText('A1520 restored');
  expect(await planCsv(page)).toBe(before);
  w.check();
});

test('a new baseline after BL1 goes through a change request; approved by the chain, BL3 becomes current with 21 activities', async ({ page, context }) => {
  await viewAs(context, 'pm');
  const w = watch(page);
  await page.goto(PLAN);
  await page.getByRole('link', { name: 'Set baseline' }).click();
  await expect(page).toHaveURL(/\/projects\/HLT-026\/changes\?new=1&baseline=1/);
  const form = dialog(page, 'New baseline · change request');
  await expect(form.getByLabel('Title')).toHaveValue('New baseline BL3');
  await form.getByLabel('Justification').fill('Recovery plan agreed with the client');
  // Delivery 8 (R-069, P-6c): the contractual impact is required — a re-baseline moving the contractual dates.
  await form.getByLabel('Contractual impact').selectOption('dates');
  await form.getByRole('button', { name: 'Submit for review' }).click();
  await expect(toast(page)).toContainText(/(CR-\d+) · Change request submitted for review · BL3 proposed/);
  const number = /(CR-\d+)/.exec((await toast(page).textContent()) ?? '')![1];

  const approve = async (role: 'pm' | 'client' | 'director', step: string) => {
    await viewAs(context, role);
    await page.goto(`/projects/HLT-026/changes?cr=${number}`);
    await page.getByRole('button', { name: `Approve · ${step}` }).click();
    await expect(page.getByRole('button', { name: `Approve · ${step}` })).toHaveCount(0);
  };
  // R-069 (P-6b): the chain is decided in order; 0 k€ is not above the board threshold (50 k€), so no board step (P-6c).
  await approve('pm', 'Project manager');
  await approve('director', 'Portfolio director');
  await approve('client', 'Client / sponsor');
  await page.goto('/projects/HLT-026/changes');
  await expect(page.getByRole('row', { name: new RegExp(`^${number} New baseline BL3 .* Approved$`) })).toBeVisible();
  await expect(page.getByRole('row', { name: /^BL3 BL3 — CR-\d+ .* Current$/ })).toBeVisible();
  await expect(page.getByRole('row', { name: /^BL1 .* Superseded$/ })).toBeVisible();
  // The Plan's Baseline tile: BL3 with its 21-activity snapshot — seen by the PM (the client, last in the chain since P-6b, is
  // sent home from the Plan, R-042).
  await viewAs(context, 'pm');
  await page.goto(`${PLAN}?view=structure`);
  await expect(page.locator('main')).toContainText(/Set .+ · 21 activities/);
  w.check();
});
