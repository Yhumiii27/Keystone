// Portfolio schedule — sliding window on the screen (Delivery 8, L-8 = a, R-136): `?from=YYYY-MM` parsing and bounds,
// the "Period" links (previous quarter · today · next quarter) keeping the stage filter, the filter links keeping the
// window, the today line only when now is inside the window, and the default window on the seeded database.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
const jar = new Map<string, string>();
vi.mock('next/headers', () => ({ cookies: async () => ({ get: (k: string) => (jar.has(k) ? { name: k, value: jar.get(k)! } : undefined) }) }));
vi.mock('next/navigation', () => ({ usePathname: () => '/portfolio/schedule', useRouter: () => ({ push() {}, prefetch() {}, refresh() {} }), redirect() {}, notFound() {} }));
import { createElement as h, isValidElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import PortfolioSchedulePage from '@/app/(app)/portfolio/schedule/page';
import { pgTodayL, portfolioScheduleModel, type PgFilter } from '@/domain/pfplan';
import { makeT } from '@/i18n/translate';
import { setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { getPortfolioSchedule } from '@/server/dal/pipeline';
import { COOKIE } from '@/server/session';
import { PfPlanBody, filterHref, pfplanHref } from './view';

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/\s+/g, ' ');

beforeAll(async () => {
  setDb(await openDatabase());
}, 60_000);

describe('links', () => {
  it('the default window has no ?from=; other windows keep the stage filter and vice versa', () => {
    expect([pfplanHref('all', null, -3), pfplanHref('all', -3, -3), pfplanHref('exec', -3, -3)]).toEqual(['/portfolio/schedule', '/portfolio/schedule', '/portfolio/schedule?filter=exec']);
    expect([pfplanHref('all', 0, -3), pfplanHref('pipe', -6, -3), filterHref('exec', 3, -3), filterHref('all', 117, -3)]).toEqual([
      '/portfolio/schedule?from=2026-01', '/portfolio/schedule?filter=pipe&from=2025-07', '/portfolio/schedule?filter=exec&from=2026-04', '/portfolio/schedule?from=2035-10',
    ]);
  });
});

describe('body', () => {
  it('default window (EN): Period links, window label, month header from Oct 2025, today line on every row', async () => {
    const input = await getPortfolioSchedule(null);
    const model = portfolioScheduleModel(input, { filter: 'all', lang: 'en' });
    const html = renderToStaticMarkup(h(PfPlanBody, { model, filter: 'all', zoneSelected: false, t: makeT('en'), lang: 'en' }));
    const txt = text(html);
    for (const s of ['Period', 'Previous quarter', 'Today', 'Next quarter', 'Oct 2025 – Sep 2027', 'Oct 2025']) expect(txt).toContain(s);
    expect(html).toContain('href="/portfolio/schedule?from=2025-07"');
    expect(html).toContain('href="/portfolio/schedule?from=2026-01"');
    expect(html).toContain('aria-current="page"');
    // 12 live projects: one today line per row, at the window's middle (L-8: it was 37.38 % on the prototype's window).
    const today = pgTodayL(-3, input.now)!;
    expect(today).not.toBe('37.38%');
    expect(html.split(`left:${today}`).length - 1).toBe(12);
    expect(html).not.toContain('left:37.38%');
  });

  it('French: window label through the month dictionary; filter links keep the window', async () => {
    const model = portfolioScheduleModel(await getPortfolioSchedule(null), { filter: 'exec', lang: 'fr', from: 3 });
    const html = renderToStaticMarkup(h(PfPlanBody, { model, filter: 'exec', zoneSelected: false, t: makeT('fr'), lang: 'fr' }));
    const txt = text(html);
    for (const s of ['Période', 'Trimestre précédent', 'Aujourd’hui', 'Trimestre suivant', 'avr. 2026 – mars 2028']) expect(txt).toContain(s);
    expect(html).toContain('href="/portfolio/schedule?from=2026-04"'); // "Tous" keeps the window
    expect(html).toContain('href="/portfolio/schedule?filter=pipe&amp;from=2026-04"');
    expect(html).toContain('href="/portfolio/schedule?filter=exec"'); // "Aujourd’hui" drops ?from=
    expect(html).toContain('href="/portfolio/schedule?filter=exec&amp;from=2026-01"');
    expect(html).toContain('href="/portfolio/schedule?filter=exec&amp;from=2026-07"');
    expect(html).not.toContain('aria-current="page"');
  });

  it('a window without today: no today line; the step at the bound is disabled', async () => {
    const model = portfolioScheduleModel(await getPortfolioSchedule(null), { filter: 'all', lang: 'en', from: 117 });
    expect(model.todayL).toBeNull();
    const html = renderToStaticMarkup(h(PfPlanBody, { model, filter: 'all', zoneSelected: false, t: makeT('en'), lang: 'en' }));
    expect(text(html)).toContain('Oct 2035 – Sep 2037');
    expect(html).not.toMatch(/class="[^"]*today/);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>.*?Next quarter/);
    expect(html).toContain('href="/portfolio/schedule?from=2035-07"');
  });
});

describe('page', () => {
  const as = (role: string, lang = 'en') => {
    jar.clear();
    jar.set(COOKIE.role, role);
    jar.set(COOKIE.lang, lang);
  };
  type Props = { model: ReturnType<typeof portfolioScheduleModel>; filter: PgFilter; zoneSelected: boolean };
  const page = async (sp: Record<string, string | string[]> = {}) => {
    const el = (await PortfolioSchedulePage({ searchParams: Promise.resolve(sp) })) as ReactElement<{ children: ReactElement<Props>[] }>;
    return el.props.children.filter(isValidElement)[1];
  };
  beforeEach(() => as('director'));

  it('?from= picks the window (quarter month within Jan 2020 – Oct 2035), anything else the default', async () => {
    expect((await page()).props.model.window).toMatchObject({ from: -3, isDefault: true });
    expect((await page({ from: '2026-04', filter: 'pipe' })).props.model.window).toMatchObject({ from: 3, isDefault: false });
    expect((await page({ from: ['2020-01', '2026-04'] })).props.model.window.from).toBe(-72);
    for (const bad of ['2026-02', '2019-10', '2036-01', 'garbage', '2026-4'])
      expect((await page({ from: bad })).props.model.window, bad).toMatchObject({ from: -3, isDefault: true });
    // Rows are never filtered by the window.
    expect((await page({ from: '2035-10' })).props.model.groups.map((g) => g.count)).toEqual([7, 5]);
  });
});
