// R-085 (owner decision R-7 a) on the demo database (business date Fri 25 Sep 2026): the load window of the load plans —
// 8 weeks from Mon 21 Sep 2026 by default, `?week=` validated by `getLoadWindow`, loads and leave read for any week — and
// the Leave & working calendar page with its navigation.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
const jar = new Map<string, string>();
vi.mock('next/headers', () => ({ cookies: async () => ({ get: (k: string) => (jar.has(k) ? { name: k, value: jar.get(k)! } : undefined) }) }));
vi.mock('next/navigation', () => ({
  usePathname: () => '/resources/leave', useRouter: () => ({ push() {}, refresh() {} }), redirect: (u: string) => { throw new Error(`REDIRECT ${u}`); }, notFound: () => { throw new Error('NOT_FOUND'); },
}));
vi.mock('next/cache', () => ({ revalidatePath() {} }));
import { createElement, isValidElement, type ComponentType, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import LeavePage from '@/app/(app)/resources/leave/page';
import { DEMO_TODAY_ISO } from '@/domain/clock';
import { LeaveView } from '@/features/hr/leave-view';
import { I18nProvider } from '@/i18n/client';
import { setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { COOKIE } from '@/server/session';
import { PERSONA_BY_ROLE } from '@/config/personas';
import { buildExportContext, runExport } from '@/server/export/run';
import '@/server/export/providers';
import { getLeaveCalendar } from './hr';
import { getLoadWindow, getProjectTeam, getResourcePool } from './resources';

const csvHead = async (screen: string, query: string) => {
  const ctx = await buildExportContext({ screen, viewer: PERSONA_BY_ROLE.director, lang: 'en', params: new URLSearchParams(query), now: new Date('2026-09-25T08:00:00Z') });
  return new TextDecoder().decode((await runExport(ctx, 'csv')).body).replace(/^\uFEFF/, '').split('\r\n')[0];
};
const PROTO_WEEKS = ['2026-09-28', '2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26', '2026-11-02', '2026-11-09', '2026-11-16'];
const as = (role: string, lang = 'en') => {
  jar.clear();
  jar.set(COOKIE.role, role);
  jar.set(COOKIE.lang, lang);
};
const Provider = I18nProvider as ComponentType<{ lang: 'en' | 'fr'; children?: ReactNode }>;
const leavePage = async (sp: Record<string, string> = {}) => {
  const el = (await LeavePage({ searchParams: Promise.resolve(sp) })) as ReactElement<{ children?: ReactNode }>;
  const stack = (el.props.children as ReactElement<{ children?: ReactNode }>[]).filter(isValidElement)[1];
  return stack.props.children as ReactElement<{ data: Awaited<ReturnType<typeof getLeaveCalendar>>; windowIsCurrent?: boolean }>;
};

beforeAll(async () => {
  setDb(await openDatabase());
}, 60_000);
beforeEach(() => as('director'));

describe('getLoadWindow (R-085)', () => {
  it('defaults to 8 weeks from the Monday of the business date week', async () => {
    const w = await getLoadWindow();
    expect(DEMO_TODAY_ISO).toBe('2026-09-25');
    expect(w).toMatchObject({ start: '2026-09-21', current: '2026-09-21', isCurrent: true, prev: '2026-09-14', next: '2026-09-28' });
    expect(w.weeks).toEqual(['2026-09-21', ...PROTO_WEEKS.slice(0, 7)]);
  });

  it('previous / next windows; a malformed or out-of-bounds ?week= gives the current window', async () => {
    expect(await getLoadWindow('2026-09-28')).toMatchObject({ start: '2026-09-28', isCurrent: false, prev: '2026-09-21', next: '2026-10-05', weeks: PROTO_WEEKS });
    expect(await getLoadWindow(['2026-09-14'])).toMatchObject({ start: '2026-09-14', weeks: expect.arrayContaining(['2026-09-14', '2026-11-02']) });
    for (const bad of ['2026-09-31', 'last', '', '2028-01-03', '2024-12-30', 7]) expect(await getLoadWindow(bad)).toMatchObject({ start: '2026-09-21', isCurrent: true });
  });
});

describe('loads over any window (R-085)', () => {
  it('the pool over the default window: zero for the week of 21 Sep (no allocation), seeded loads after', async () => {
    const pool = await getResourcePool((await getLoadWindow()).weeks);
    expect(pool.weeks.map((w) => w.label)).toEqual(['Sep 21', 'Sep 28', 'Oct 5', 'Oct 12', 'Oct 19', 'Oct 26', 'Nov 2', 'Nov 9']);
    const julien = pool.people.find((p) => p.name === 'Julien Wagner')!;
    expect(julien.loads).toEqual([0, 90, 100, 130, 125, 110, 100, 80]);
    expect([julien.avg, julien.max]).toEqual([91.875, 130]);
  });

  it('the prototype window reproduces the seeded loads; without weeks, every allocation week (former rule)', async () => {
    const proto = await getResourcePool(PROTO_WEEKS);
    const all = await getResourcePool();
    expect(proto).toEqual(all);
    expect(all.weeks.map((w) => w.start)).toEqual(PROTO_WEEKS);
  });

  it('a window without allocations: the pool with zero loads; the project team follows the window', async () => {
    const later = (await getLoadWindow('2026-11-23')).weeks;
    const pool = await getResourcePool(later);
    expect(pool.people).toHaveLength(8);
    expect(pool.people.every((p) => p.loads.length === 8 && p.loads.every((l) => l === 0) && p.avg === 0 && p.max === 0)).toBe(true);
    expect((await getProjectTeam('HLT-026', later)).every((p) => p.loads.every((l) => l === 0))).toBe(true);
    expect((await getProjectTeam('HLT-026', PROTO_WEEKS)).find((p) => p.name === 'Julien Wagner')!.loads).toEqual([90, 100, 130, 125, 110, 100, 80, 60]);
    expect(await getResourcePool([])).toEqual({ weeks: [], people: expect.any(Array) });
  });
});

describe('Leave & working calendar over the window (R-085)', () => {
  it('the prototype window keeps the seeded grid; the default window shifts it by one week', async () => {
    const proto = await getLeaveCalendar('FR', PROTO_WEEKS);
    expect(proto).toEqual(await getLeaveCalendar());
    const def = await getLeaveCalendar('FR', (await getLoadWindow()).weeks);
    expect(def.weeks.map((w) => w.start)).toEqual(['2026-09-21', ...PROTO_WEEKS.slice(0, 7)]);
    // Same absences one column to the right; the 16 Nov column leaves the window.
    for (const [i, p] of def.people.entries()) {
      expect(p.weeks[0]).toMatchObject({ type: null, days: 0, holidays: 0 });
      expect(p.weeks.slice(1)).toEqual(proto.people[i].weeks.slice(0, 7));
    }
    // 11 Nov (Armistice) is in the week of 9 Nov: column 6 of the prototype window, 7 of the default one.
    expect(proto.holidays.map((h) => [h.date, h.weekIndex])).toEqual([['2026-11-11', 6]]);
    expect(def.holidays.map((h) => [h.date, h.weekIndex])).toEqual([['2026-11-11', 7]]);
  });

  it('the page reads ?week= (validated) and renders the navigation', async () => {
    const def = await leavePage();
    expect(def.type).toBe(LeaveView);
    expect([def.props.data.weeks[0].start, def.props.windowIsCurrent]).toEqual(['2026-09-21', true]);
    const next = await leavePage({ week: '2026-09-30' });
    expect([next.props.data.weeks[0].start, next.props.windowIsCurrent]).toEqual(['2026-09-28', false]);
    expect((await leavePage({ week: 'nope' })).props.data.weeks[0].start).toBe('2026-09-21');
    const html = (el: ReactElement, lang: 'en' | 'fr' = 'en') => renderToStaticMarkup(createElement(Provider, { lang }, el));
    const out = html(def);
    for (const s of ['Availability — next 8 weeks', 'Next 8 weeks · 35 h basis', 'aria-current="page" href="/resources/leave"', 'href="/resources/leave?week=2026-09-14"', 'href="/resources/leave?week=2026-09-28"', 'Sep 21 – Nov 9, 2026'])
      expect(out).toContain(s);
    expect(html(next)).toContain('Availability — 8 weeks');
    expect(html(next)).toContain('8 weeks · 35 h basis');
    as('director', 'fr');
    const fr = html(await leavePage({ week: '2026-09-28' }), 'fr');
    for (const s of ['Disponibilité — 8 semaines', '8 semaines · base 35 h', 'Semaine en cours', '28 sept. – 16 nov. 2026', '28 sept.']) expect(fr).toContain(s);
  });
});

describe('exports follow the window shown (R-085)', () => {
  it('Resources, Project resources and Leave read the page ?week= (validated), default the current window', async () => {
    expect(await csvHead('resources', '')).toContain('Week of 2026-09-21');
    expect(await csvHead('resources', '')).not.toContain('Week of 2026-11-16');
    expect(await csvHead('resources', 'week=2026-09-28')).toContain('Week of 2026-11-16');
    expect(await csvHead('resources', 'week=bogus')).toContain('Week of 2026-09-21');
    expect(await csvHead('presources', 'code=HLT-026&week=2026-10-05')).toContain('Week of 2026-11-23');
    expect(await csvHead('leave', 'week=2026-09-14')).toContain('Week of 2026-09-14');
  }, 60_000);
});
