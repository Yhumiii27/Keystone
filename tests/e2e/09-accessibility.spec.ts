// Accessibility (R-183): axe-core checks of WCAG 2.1 A / AA on the screens, per persona, inside the end-to-end run. A
// serious or critical violation fails the test (moderate and minor ones are listed in the test's annotations); keyboard
// checks cover the skip link and the focus kept after a row action removes its own button (R-157 "Mark paid").
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { viewAs, watch, type Role } from './helpers';

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

interface Finding {
  path: string;
  rule: string;
  impact: string;
  help: string;
  targets: string[];
  /** axe's explanation of the first node (contrast ratio and colours for color-contrast). */
  summary: string;
}

async function audit(page: Page, path: string): Promise<Finding[]> {
  const r = await page.goto(path);
  expect(r!.status(), path).toBe(200);
  await page.waitForLoadState('load');
  const result = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  return result.violations.map((v) => ({ path, rule: v.id, impact: v.impact ?? 'minor', help: v.help, targets: v.nodes.slice(0, 5).map((n) => n.target.join(' ')), summary: (v.nodes[0]?.failureSummary ?? '').replace(/\s+/g, ' ').slice(0, 300) }));
}

/** Runs axe on each path; fails on serious / critical findings, with one readable line per rule and page. */
async function auditAll(page: Page, paths: string[]): Promise<void> {
  const findings: Finding[] = [];
  for (const p of paths) findings.push(...(await audit(page, p)));
  const blocking = findings.filter((f) => f.impact === 'serious' || f.impact === 'critical');
  for (const f of findings.filter((x) => !blocking.includes(x))) test.info().annotations.push({ type: `axe ${f.impact}`, description: `${f.path} · ${f.rule} · ${f.targets.join(', ')}` });
  expect(blocking.map((f) => `${f.path} · ${f.rule} (${f.impact}) ${f.help} · ${f.targets.join(' | ')} · ${f.summary}`)).toEqual([]);
}

const GLOBAL = [
  '/', '/my/projects', '/my/tasks', '/my/tasks/T-2314', '/my/approvals', '/portfolio/overview', '/portfolio/projects', '/portfolio/schedule', '/portfolio/map',
  '/portfolio/prioritisation', '/portfolio/cash', '/reference/parts', '/reference/eco', '/reference/drawings', '/purchasing/sourcing', '/purchasing/stock',
  '/after-sales/fleet', '/after-sales/claims', '/resources', '/resources/requests', '/resources/approvals', '/resources/what-if?project=HLT-026',
  '/resources/skills', '/resources/leave', '/resources/rates', '/admin/settings', '/admin/machine-types', '/admin/document-types', '/admin/integrations', '/catalogue/machines',
];
const PROJECT = [
  'client', 'documents', 'contract', 'billing', 'plan', 'schedule', 'budget', 'budget?tab=setup', 'hours', 'contingency', 'resources', 'meetings', 'meetings?view=decisions',
  'meetings?view=actions', 'stakeholders', 'interfaces', 'engineering', 'engineering/process', 'engineering/mechanical', 'engineering/electrical',
  'engineering/automation', 'pid', 'bom', 'risks', 'changes', 'quality', 'itp', 'site', 'shipments', 'commissioning', 'trends', 'closure', 'orders', 'deliveries',
];

test('axe: every screen as the director (EN), no serious or critical WCAG 2.1 AA violation', async ({ page, context }) => {
  test.setTimeout(600_000);
  await viewAs(context, 'director');
  const w = watch(page);
  await auditAll(page, [...GLOBAL, ...PROJECT.map((p) => `/projects/HLT-026/${p}`)]);
  w.check();
});

/** The main screens of each other persona, in French (the default language). */
const PERSONA_SCREENS: Record<Exclude<Role, 'director'>, string[]> = {
  pm: ['/', '/my/projects', '/projects/HLT-026/plan', '/projects/HLT-026/budget', '/projects/HLT-026/changes', '/projects/HLT-026/billing'],
  depthead: ['/', '/resources', '/resources/requests', '/portfolio/prioritisation'],
  member: ['/', '/my/tasks', '/my/tasks/T-2314'],
  englead: ['/', '/projects/HLT-026/engineering', '/projects/HLT-026/bom', '/projects/HLT-026/itp'],
  quality: ['/', '/projects/HLT-026/quality', '/projects/HLT-026/itp', '/my/approvals'],
  procurement: ['/', '/projects/HLT-026/orders', '/purchasing/sourcing', '/purchasing/stock'],
  finance: ['/', '/portfolio/cash', '/resources/rates'],
  logistics: ['/', '/projects/HLT-026/shipments', '/projects/HLT-026/site'],
  client: ['/', '/projects/HLT-026/client'],
};

for (const [role, paths] of Object.entries(PERSONA_SCREENS) as [Exclude<Role, 'director'>, string[]][])
  test(`axe: main screens as ${role} (FR), no serious or critical violation`, async ({ page, context }) => {
    test.setTimeout(300_000);
    await viewAs(context, role, 'fr');
    const w = watch(page);
    await auditAll(page, paths);
    w.check();
  });

test('keyboard: the skip link is the first stop and moves the focus to the main region', async ({ page, context }) => {
  await viewAs(context, 'pm', 'fr');
  await page.goto('/projects/HLT-026/plan');
  await page.keyboard.press('Tab');
  const skip = page.locator('a.skip-link');
  await expect(skip).toBeFocused();
  await expect(skip).toHaveText('Aller au contenu principal');
  await expect(skip).toBeInViewport();
  await page.keyboard.press('Enter');
  await expect(page.locator('main#main-content')).toBeFocused();
});

test('keyboard: after "Mark paid" removes its own button, the focus stays in the billing table', async ({ page, context }) => {
  await viewAs(context, 'pm');
  const w = watch(page);
  await page.goto('/projects/HLT-026/billing');
  const button = page.getByRole('button', { name: /mark .* paid|mark paid/i }).first();
  await expect(button).toBeVisible();
  await button.focus();
  await page.keyboard.press('Enter');
  await expect(button).toHaveCount(0);
  // The focus went back into the same table (its row, or the row now in its place), not to the top of the page.
  await expect.poll(() => page.evaluate(() => !!document.activeElement && document.activeElement !== document.body && !!document.activeElement.closest('table'))).toBe(true);
  w.check();
});

test('axe: the bell panel and its "Notifications & reminders" dialog (EN and FR)', async ({ page, context }) => {
  for (const lang of ['en', 'fr'] as const) {
    await viewAs(context, 'pm', lang);
    const w = watch(page);
    await page.goto('/projects/HLT-026/schedule');
    await page.getByRole('button', { name: lang === 'en' ? 'Notifications' : /^Notifications$/ }).first().click();
    const findings = (await new AxeBuilder({ page }).withTags(TAGS).analyze()).violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(findings.map((v) => `${lang} bell · ${v.id} · ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([]);
    await page.getByRole('button', { name: lang === 'en' ? 'Notifications & reminders' : 'Notifications et rappels' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    const dialog = (await new AxeBuilder({ page }).withTags(TAGS).analyze()).violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(dialog.map((v) => `${lang} dialog · ${v.id} · ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([]);
    w.check();
  }
});
