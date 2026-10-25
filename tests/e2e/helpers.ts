// Shared helpers of the end-to-end scenarios (R-016): the "View as" persona and language cookies, a watcher that fails a
// test on any browser error (console error, uncaught exception, CSP violation, 5xx answer), the toast, and file exports
// fetched with the persona's cookies.
import { expect, type APIRequestContext, type BrowserContext, type Page } from '@playwright/test';

export type Role = 'director' | 'pm' | 'depthead' | 'member' | 'englead' | 'quality' | 'procurement' | 'finance' | 'logistics' | 'client';

export const BASE = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3315';

/** Persona ("View as") and language of the following requests. */
export async function viewAs(context: BrowserContext, role: Role, lang: 'en' | 'fr' = 'en'): Promise<void> {
  const url = new URL(BASE);
  await context.addCookies([
    { name: 'ks-role', value: role, domain: url.hostname, path: '/' },
    { name: 'ks-lang', value: lang, domain: url.hostname, path: '/' },
  ]);
}

/** Collects what must never happen on a page; `check()` asserts it stayed clean. */
export function watch(page: Page): { check: () => void; problems: string[] } {
  const problems: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(`console: ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('response', (r) => {
    if (r.status() >= 500) problems.push(`${r.status()} ${r.url()}`);
  });
  return { problems, check: () => expect(problems, problems.join('\n')).toEqual([]) };
}

/** The toast viewport (bottom right). */
export const toast = (page: Page) => page.locator('[role="status"][aria-live="polite"]');

/** A file export as the browser gets it: status, type, size and bytes. */
export async function exportFile(request: APIRequestContext, href: string): Promise<{ status: number; type: string; disposition: string; body: Buffer }> {
  const res = await request.get(href, { headers: { 'sec-fetch-site': 'same-origin' } });
  return { status: res.status(), type: res.headers()['content-type'] ?? '', disposition: res.headers()['content-disposition'] ?? '', body: await res.body() };
}

/** Cookie header of a persona for API calls made outside the page. */
export const cookieOf = (role: Role, lang: 'en' | 'fr' = 'en') => `ks-role=${role}; ks-lang=${lang}`;
