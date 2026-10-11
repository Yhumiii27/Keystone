// Platform (delivery 7): security headers and Content-Security-Policy on real responses with no CSP violation while the
// screens run (R-008), the translated "page not found" (R-176), the connectors' real state (R-021).
import { expect, test } from '@playwright/test';
import { viewAs, watch } from './helpers';

test('security headers and a nonce CSP on every page; screens run without any CSP violation or browser error', async ({ page, context }) => {
  await viewAs(context, 'director');
  const w = watch(page);
  const res = await page.goto('/');
  const h = res!.headers();
  expect(h['x-frame-options']).toBe('DENY');
  expect(h['x-content-type-options']).toBe('nosniff');
  expect(h['referrer-policy']).toBe('strict-origin-when-cross-origin');
  expect(h['permissions-policy']).toContain('microphone=()');
  expect(h['strict-transport-security']).toBe('max-age=31536000');
  expect(h['x-powered-by']).toBeUndefined();
  const csp = h['content-security-policy'];
  expect(csp).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).not.toContain('unsafe-eval');
  // Next puts the nonce on its scripts: the page is interactive (a client island reacts).
  const nonce = /'nonce-([^']+)'/.exec(csp)![1];
  expect(await page.locator(`script[nonce]`).count()).toBeGreaterThan(0);
  expect(await page.evaluate(() => [...document.scripts].filter((s) => !s.src && !s.nonce).length)).toBe(0);
  expect(nonce.length).toBeGreaterThan(10);
  for (const path of ['/projects/HLT-026/plan', '/projects/HLT-026/schedule', '/portfolio/overview', '/resources/what-if?project=HLT-026', '/admin/integrations?view=connectors']) {
    const r = await page.goto(path);
    expect(r!.status(), path).toBe(200);
    await expect(page.locator('main')).toBeVisible();
  }
  w.check();
});

// Every screen of src/config/screens.ts (project screens on HLT-026): under the CSP, none may log a violation or an error.
const GLOBAL = [
  '/', '/my/projects', '/my/tasks', '/my/tasks/T-2314', '/my/approvals', '/portfolio/overview', '/portfolio/projects', '/portfolio/schedule', '/portfolio/map',
  '/portfolio/prioritisation', '/portfolio/cash', '/reference/parts', '/reference/eco', '/reference/drawings', '/purchasing/sourcing', '/purchasing/stock',
  '/after-sales/fleet', '/after-sales/claims', '/resources', '/resources/requests', '/resources/approvals', '/resources/what-if?project=HLT-026',
  '/resources/skills', '/resources/leave', '/resources/rates', '/admin/settings', '/admin/machine-types', '/admin/document-types', '/admin/integrations',
];
const PROJECT = [
  'client', 'documents', 'contract', 'billing', 'plan', 'schedule', 'budget', 'hours', 'contingency', 'resources', 'meetings', 'stakeholders', 'interfaces',
  'engineering', 'engineering/process', 'engineering/mechanical', 'engineering/electrical', 'engineering/automation', 'pid', 'bom', 'risks', 'changes',
  'quality', 'itp', 'site', 'commissioning', 'trends', 'closure', 'orders', 'deliveries',
];

test('every screen renders under the CSP without a violation or a browser error', async ({ page, context }) => {
  test.setTimeout(300_000);
  await viewAs(context, 'director');
  const w = watch(page);
  for (const path of [...GLOBAL, ...PROJECT.map((p) => `/projects/HLT-026/${p}`)]) {
    const r = await page.goto(path);
    expect(r!.status(), path).toBe(200);
    await page.waitForLoadState('load');
    expect(w.problems, path).toEqual([]);
  }
});

test('unknown address: the 404 page in French by default, inside the shell', async ({ page, context }) => {
  await viewAs(context, 'pm', 'fr');
  const w = watch(page);
  page.removeAllListeners('console');
  const res = await page.goto('/projects/HLT-026/nope');
  expect(res!.status()).toBe(404);
  await expect(page.getByRole('heading', { name: 'Page introuvable' })).toBeVisible();
  await expect(page.getByText('Erreur 404')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Retour à l’accueil' })).toHaveAttribute('href', '/');
  // The shell (sidebar) stays usable.
  await expect(page.locator('aside, nav').first()).toBeVisible();
  expect(w.problems.filter((p) => !p.startsWith('console'))).toEqual([]);
});

test('connectors: what is not connected says so; mocks are mocks; no seeded warning', async ({ page, context }) => {
  await viewAs(context, 'director');
  const w = watch(page);
  await page.goto('/admin/integrations?view=connectors');
  const row = (name: string) => page.getByRole('row').filter({ has: page.getByRole('cell', { name, exact: false }) }).first();
  await expect(row('Sage X3')).toContainText('Not connected');
  await expect(row('Outlook / Exchange')).toContainText('Not connected');
  await expect(row('Outlook / Exchange')).not.toContainText('Token expires');
  await expect(row('Vigie')).toContainText('Mock');
  await expect(page.getByRole('cell', { name: 'Lucca' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Sync now · Sage X3' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Sync now · Vigie' }).click();
  await expect(page.locator('[role="status"][aria-live="polite"]')).toContainText('Vigie · simulated sync (mock connector)');
  w.check();
});
