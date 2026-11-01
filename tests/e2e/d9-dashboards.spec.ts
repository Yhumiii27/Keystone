// R-203 (K-203) — My dashboards: the director starts a dashboard from the suggested widgets, reorders a widget from the keyboard
// (R-183: the focus stays on the moved widget's control), adds a widget, shares the dashboard with the team member; the member
// reads it with their own rights (the portfolio widgets stay empty for them) and copies it. Axe checks the screen in edit mode.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { toast, viewAs, watch } from './helpers';

test.describe.configure({ mode: 'serial' });

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const serious = async (page: Page) =>
  (await new AxeBuilder({ page }).withTags(TAGS).analyze()).violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id} · ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`);
const titles = (page: Page) => page.locator('[data-widget] h3').allInnerTexts();

test('the director starts a dashboard, reorders a widget from the keyboard and adds one', async ({ page, context }) => {
  await viewAs(context, 'director');
  const w = watch(page);
  await page.goto('/my/dashboards');
  await page.getByRole('button', { name: 'Start with suggested widgets' }).click();
  await expect(toast(page)).toContainText('Dashboard created');
  await expect(page.locator('[data-widget]').first()).toBeVisible();
  expect(await serious(page)).toEqual([]);

  await page.getByRole('button', { name: 'Edit the layout' }).click();
  const before = await titles(page);
  const first = page.locator('[data-widget]').first();
  await first.locator('[data-control="later"]').focus();
  await page.keyboard.press('Enter');
  await expect.poll(() => titles(page)).toEqual([before[1], before[0], ...before.slice(2)]);
  // The focus followed the moved widget (now second) and stayed on its "Move later" button.
  await expect.poll(() => page.evaluate(() => document.activeElement?.closest('[data-widget]')?.querySelector('h3')?.innerText ?? '')).toBe(before[0]);
  expect(await serious(page)).toEqual([]);

  await page.getByRole('button', { name: 'Add a widget' }).click();
  const d = page.getByRole('dialog');
  await d.getByLabel('Widget').selectOption({ label: 'Top risks' });
  await d.getByLabel('Project').selectOption('HLT-026');
  expect(await serious(page)).toEqual([]);
  await d.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.locator('[data-widget] h3').last()).toContainText('Top risks');
  w.check();
});

test('the director shares it with the team member, who reads it with their own rights and copies it', async ({ page, context }) => {
  await viewAs(context, 'director');
  let w = watch(page);
  await page.goto('/my/dashboards');
  await page.getByRole('button', { name: 'Sharing' }).click();
  const d = page.getByRole('dialog');
  await d.getByLabel(/Julien Wagner/).check();
  await d.getByRole('button', { name: 'Save' }).click();
  await expect(toast(page)).toContainText('Sharing saved');
  w.check();

  await context.clearCookies();
  await viewAs(context, 'member', 'fr');
  w = watch(page);
  await page.goto('/my/dashboards');
  await expect(page.getByRole('navigation', { name: 'Partagés avec moi' })).toContainText('Marie Lefebvre');
  await expect(page.getByText(/Partagé par Marie Lefebvre/)).toBeVisible();
  // The portfolio and risk widgets are empty for the member; their counters are their own.
  await expect(page.getByText('Non disponible pour votre rôle').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Modifier la disposition' })).toHaveCount(0);
  expect(await serious(page)).toEqual([]);
  await page.getByRole('button', { name: 'Copier dans mes tableaux de bord' }).click();
  await expect(toast(page)).toContainText('Tableau de bord copié');
  await expect(page.getByRole('button', { name: 'Modifier la disposition' })).toBeVisible();
  await expect(page.getByText('Non disponible pour votre rôle')).toHaveCount(0);
  w.check();
});

test('a client is sent home', async ({ page, context }) => {
  await viewAs(context, 'client');
  await page.goto('/my/dashboards');
  await expect(page).toHaveURL(/\/$/);
});
