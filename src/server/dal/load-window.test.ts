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
import ResourcesPage from '@/app/(app)/resources/page';
import ProjectResourcesPage from '@/app/(app)/projects/[code]/resources/page';
import { eq } from 'drizzle-orm';
import { LeaveWeekView } from '@/features/hr/leave-view';
import type { ResourcesView as View } from '@/features/resources/model';
import { getDb } from '@/server/db/client';
import { activities, activityAssignments, persons, projects } from '@/server/db/schema';
import { DEMO_TODAY_ISO } from '@/domain/clock';
import { LeaveView } from '@/features/hr/leave-view';
import { I18nProvider } from '@/i18n/client';
import { setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { COOKIE } from '@/server/session';
import { PERSONA_BY_ROLE } from '@/config/personas';
import { buildExportContext, runExport } from '@/server/export/run';
import '@/server/export/providers';
import { getLeaveCalendar, getLeaveWeek } from './hr';
import { getLoadWindow, getProjectTeam, getResourcePool, getWeekProjectSplit } from './resources';

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
type Body = ReactElement<{ view: View; children?: ReactNode }>;
const bodyOf = (el: unknown) => ((el as ReactElement<{ children?: ReactNode }>).props.children as ReactElement[]).filter(isValidElement)[1] as Body;
const resourcesPage = async (sp: Record<string, string>) => bodyOf(await ResourcesPage({ searchParams: Promise.resolve(sp) }));
const projectPage = async (code: string, sp: Record<string, string>) => bodyOf(await ProjectResourcesPage({ params: Promise.resolve({ code }), searchParams: Promise.resolve(sp) }));
const csv = async (screen: string, query: string) => {
  const ctx = await buildExportContext({ screen, viewer: PERSONA_BY_ROLE.director, lang: 'en', params: new URLSearchParams(query), now: new Date('2026-09-25T08:00:00Z') });
  return new TextDecoder().decode((await runExport(ctx, 'csv')).body).replace(/^\uFEFF/, '');
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
  it('the pool over the default window: the loads of the schedules (R-084)', async () => {
    const pool = await getResourcePool((await getLoadWindow()).weeks);
    expect(pool.weeks.map((w) => w.label)).toEqual(['Sep 21', 'Sep 28', 'Oct 5', 'Oct 12', 'Oct 19', 'Oct 26', 'Nov 2', 'Nov 9']);
    const julien = pool.people.find((p) => p.name === 'Julien Wagner')!;
    // R-084 (owner answer 17 Oct 2026, third round): the hours the schedules assign — Julien Wagner on HLT-026 A1250 (40 h/wk
    // until Fri 9 Oct) and, since the named demo assignments (owner answer 18 Oct 2026), on A1260 / A1320 / A1330, RCF-019 A2440
    // and MSR-012 A6540 — no longer the seeded allocation rows ([0, 90, 100, 130, 125, 110, 100, 80], avg 91.875, max 130).
    // R-084 (absences): his seeded RTT day in the week of 9 Nov leaves 32 h — 26 h is 81 % (65 % of the 40 h week before).
    expect(julien.loads).toEqual([100, 100, 106, 125, 125, 108, 88, 81]);
    expect(julien.hours).toEqual([40, 40, 42.5, 50, 50, 43, 35, 26]);
    expect(julien.capacityH).toEqual([40, 40, 40, 40, 40, 40, 40, 32]);
    expect([julien.avg, julien.max]).toEqual([104.125, 125]);
    // The eight people of the pool are named on the demo schedules.
    expect(pool.people.filter((p) => p.max > 0)).toHaveLength(8);
  });

  it('without weeks, the current window (R-084: the readers outside the load plans read the seeded allocation weeks before)', async () => {
    const all = await getResourcePool();
    expect(all).toEqual(await getResourcePool((await getLoadWindow()).weeks));
    expect(all.weeks.map((w) => w.start)).toEqual(['2026-09-21', ...PROTO_WEEKS.slice(0, 7)]);
    expect((await getResourcePool(PROTO_WEEKS)).people.find((p) => p.name === 'Julien Wagner')!.loads).toEqual([100, 106, 125, 125, 108, 88, 81, 81]); // R-084 (absences): RTT 9 Nov (65 % before)
  });

  it('a window without allocations: the pool with zero loads; the project team follows the window', async () => {
    // (The demo schedules assign people until mid-December 2026.)
    const later = (await getLoadWindow('2027-03-01')).weeks;
    const pool = await getResourcePool(later);
    expect(pool.people).toHaveLength(8);
    expect(pool.people.every((p) => p.loads.length === 8 && p.loads.every((l) => l === 0) && p.avg === 0 && p.max === 0)).toBe(true);
    expect((await getProjectTeam('HLT-026', later)).every((p) => p.loads.every((l) => l === 0))).toBe(true);
    // R-084: the schedule's hours (the seeded rows gave [90, 100, 130, 125, 110, 100, 80, 60]).
    // R-084 (absences): his RTT day of 9 Nov lowers that week's capacity to 32 h (65 % → 81 %).
    expect((await getProjectTeam('HLT-026', PROTO_WEEKS)).find((p) => p.name === 'Julien Wagner')!.loads).toEqual([100, 106, 125, 125, 108, 88, 81, 81]);
    expect(await getResourcePool([])).toEqual({ weeks: [], people: expect.any(Array) });
  });
});

describe('Leave & working calendar over the window (R-085)', () => {
  it('the prototype window keeps the seeded grid; the default window shifts it by one week', async () => {
    const proto = await getLeaveCalendar('FR', PROTO_WEEKS);
    const def = await getLeaveCalendar('FR', (await getLoadWindow()).weeks);
    // R-084: without weeks, the current window (it was the seeded allocation weeks, i.e. the prototype window).
    expect(await getLeaveCalendar()).toEqual(def);
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

// Owner answers 17 Oct 2026: "Il faut les deux : une vision à la semaine et une vision à 8 semaines" — `?view=week` on
// Resources, Project resources and Leave; the 8-week view also steps by full pages.
describe('week view and 8-week pages (owner answers 17 Oct 2026)', () => {
  it('getLoadWindow reads ?view= (validated): one week, snapped to its Monday; anything else is the 8-week view', async () => {
    expect(await getLoadWindow('2026-11-11', 'week')).toMatchObject({ view: 'week', start: '2026-11-09', weeks: ['2026-11-09'], prev: '2026-11-02', next: '2026-11-16', prevPage: null });
    expect(await getLoadWindow(undefined, 'week')).toMatchObject({ view: 'week', weeks: ['2026-09-21'], isCurrent: true });
    for (const bad of ['month', '', ['x'], 3]) expect((await getLoadWindow(undefined, bad)).view).toBe('8w');
    expect(await getLoadWindow()).toMatchObject({ view: '8w', prevPage: '2026-07-27', nextPage: '2026-11-16' });
  });

  it('Leave by day: the leave rows carry their dates; the public holidays of the week by day', async () => {
    const w = await getLeaveWeek('FR', '2026-11-09');
    expect(w.days.map((d) => [d.date, d.holiday?.name ?? null])).toEqual([
      ['2026-11-09', null], ['2026-11-10', null], ['2026-11-11', 'Armistice'], ['2026-11-12', null], ['2026-11-13', null],
    ]);
    const off = w.people.filter((p) => p.days.some((k) => k === 'leave' || k === 'absence')).map((p) => [p.name, p.days.join(' '), p.daysOff, p.availH]);
    // R-084 (absences), demo leave shifted (owner 22 Oct 2026): Julien Wagner's RTT only (Fabien Bertrand's CP of that week — 4 days, the Armistice a holiday — moved to January).
    expect(off).toEqual([['Julien Wagner', 'leave worked holiday worked worked', 1, 21]]);
    expect(w.people.find((p) => p.name === 'Damien Roux')).toMatchObject({ days: ['worked', 'worked', 'holiday', 'worked', 'worked'], daysOff: 0, availH: 28 });
    const sep = await getLeaveWeek('FR', '2026-09-28');
    // R-084 (absences), demo leave shifted (owner 22 Oct 2026): Hélène Sauvage's 2 sick days on 28 Sep; Pauline Noguès's 3 training days in the week of 11 Jan 2027.
    expect(sep.people.find((p) => p.name === 'Hélène Sauvage')).toMatchObject({ days: ['absence', 'absence', 'worked', 'worked', 'worked'], daysOff: 2, availH: 21 });
    expect((await getLeaveWeek('FR', '2027-01-11')).people.find((p) => p.name === 'Pauline Noguès')).toMatchObject({ days: ['absence', 'absence', 'absence', 'worked', 'worked'], daysOff: 3, availH: 14 });
    expect((await getLeaveWeek('FR', '2027-03-01')).people.every((p) => p.daysOff === 0 && p.availH === 35)).toBe(true);
  });

  it('the Leave page in the week view: day columns, holiday by name, view switch and one-week links (EN / FR)', async () => {
    const el = await leavePage({ view: 'week', week: '2026-11-11' });
    expect(el.type).toBe(LeaveWeekView);
    const out = renderToStaticMarkup(createElement(Provider, { lang: 'en' }, el));
    for (const s of [
      'Availability — week', 'Week shown · 35 h basis', 'Mon 9', 'Wed 11', 'Fri 13', 'Armistice', 'Week 46 · Nov 9, 2026',
      'aria-current="page" href="/resources/leave?view=week&amp;week=2026-11-09"', 'href="/resources/leave?week=2026-11-09"',
      'href="/resources/leave?view=week&amp;week=2026-11-02"', 'href="/resources/leave?view=week&amp;week=2026-11-16"', 'href="/resources/leave?view=week"',
    ]) expect(out).toContain(s);
    expect(out).not.toContain('Previous 8 weeks');
    as('director', 'fr');
    const fr = renderToStaticMarkup(createElement(Provider, { lang: 'fr' }, await leavePage({ view: 'week', week: '2026-11-11' })));
    for (const s of ['Disponibilité — semaine', 'lun. 9', 'mer. 11', 'Semaine 46 · 9 nov. 2026', 'Semaine affichée · base 35 h', 'Congés']) expect(fr).toContain(s);
  });

  it('the 8-week view steps one week or a full 8-week page', async () => {
    const out = renderToStaticMarkup(createElement(Provider, { lang: 'en' }, await leavePage({ week: '2026-09-28' })));
    for (const s of [
      'Previous 8 weeks', 'Next 8 weeks', 'href="/resources/leave?week=2026-08-03"', 'href="/resources/leave?week=2026-11-23"', 'href="/resources/leave"',
      'href="/resources/leave?week=2026-10-05"', 'href="/resources/leave?view=week&amp;week=2026-09-28"', 'aria-current="page" href="/resources/leave?week=2026-09-28"',
    ]) expect(out).toContain(s);
    expect((await leavePage({ week: '2026-11-16' })).props.data.weeks.map((w) => w.start)).toEqual(['2026-11-16', '2026-11-23', '2026-11-30', '2026-12-07', '2026-12-14', '2026-12-21', '2026-12-28', '2027-01-04']);
  });

  it('Resources in the week view: load, hours on the 40 h week, hours above capacity; no schedule assignment that week', async () => {
    const body = await resourcesPage({ view: 'week', week: '2026-10-14' });
    const v = body.props.view;
    expect(v.weeks).toEqual(['Oct 12']);
    const julien = v.weekRows!.find((r) => r.name === 'Julien Wagner')!;
    // R-084: the load is the schedules' hours — with the named demo assignments (18 Oct 2026) 125 % · 50 h · +10 h (the seeded
    // row gave 130 % · 52 h · +12 h).
    expect(julien).toMatchObject({ cell: { v: 125 }, hoursText: '50 h / 40 h', overText: '+10 h', overAllocated: true, projectsText: 'HLT-026 40 h · RCF-019 7.5 h · MSR-012 2.5 h' });
    expect(v.weekHasSplit).toBe(true);
    const out = renderToStaticMarkup(createElement(Provider, { lang: 'en' }, body));
    for (const s of ['Allocation — week', 'Above capacity', 'By project', 'Week 42 · Oct 12, 2026', 'aria-current="page" href="/resources?view=week&amp;week=2026-10-12"'])
      expect(out).toContain(s);
    // A week no schedule assigns anyone.
    expect(renderToStaticMarkup(createElement(Provider, { lang: 'en' }, await resourcesPage({ view: 'week', week: '2027-03-01' })))).toContain('The projects’ schedules assign no one in this table this week');
    // The 8-week view keeps its heatmap (no week rows).
    expect((await resourcesPage({ week: '2026-10-12' })).props.view.weekRows).toBeNull();
  }, 30_000);

  it('Project resources in the week view: the team that week, the bars on a 40 h week per person', async () => {
    const v = (await projectPage('HLT-026', { view: 'week', week: '2026-10-12' })).props.view;
    expect(v.weeks).toEqual(['Oct 12']);
    expect(v.kpis[2].sub).toBe('Week shown, by department');
    expect(v.rolesSub).toBe('Hours by role, week shown');
    // R-084 (absences): a person on leave all the week brings no capacity; R-084 (absences), demo leave shifted (owner 22 Oct 2026): nobody of the team on leave that week
    // (Amélie Ollivier's CP of 12 Oct with the prototype's LEAVE).
    expect(v.roles.reduce((a, r) => a + r.capacityH, 0)).toBe(40 * v.people.length);
  }, 30_000);

  it('the exports follow the view: one week (with hours and hours above capacity), Leave day by day', async () => {
    const res = (await csv('resources', 'view=week&week=2026-10-12')).split('\r\n')[0];
    expect(res).toContain('Week of 2026-10-12');
    expect(res).toContain('Above capacity');
    expect(res).not.toContain('Week of 2026-10-19');
    const leave = (await csv('leave', 'view=week&week=2026-11-09')).split('\r\n');
    expect(leave[0]).toContain('2026-11-09');
    expect(leave[0]).toContain('2026-11-13');
    expect(leave.find((l) => l.includes('Fabien Bertrand'))).toContain('Public holiday');
  }, 60_000);

  it('the split by project is drawn from the schedules\' activity assignments (owner answer 17 Oct 2026, second round)', async () => {
    // Demo data: Julien Wagner on HLT-026 A1250 (17 Aug – 9 Oct 2026, "40 h/wk" = 1 × 8 h/d, Standard 5d · 8h) and, since the
    // named demo assignments (owner answer 18 Oct 2026), on A1260 from 5 Oct, A1320 / RCF-019 A2440 / MSR-012 A6540 from 12 Oct.
    // R-084 (third round): his load IS those hours, so the split covers it exactly (the seeded rows gave 21 Sep 0 %, 28 Sep 90 %,
    // 12 Oct 130 % — "beyond the load").
    const jw = async (w: string) => (await getWeekProjectSplit(w))['Julien Wagner'];
    expect(await jw('2026-08-10')).toBeUndefined();
    for (const w of ['2026-08-17', '2026-09-21', '2026-09-28']) expect(await jw(w)).toEqual([{ code: 'HLT-026', hours: 40 }]);
    expect(await jw('2026-10-05')).toEqual([{ code: 'HLT-026', hours: 42.5 }]);
    expect(await jw('2026-10-12')).toEqual([{ code: 'HLT-026', hours: 40 }, { code: 'RCF-019', hours: 7.5 }, { code: 'MSR-012', hours: 2.5 }]);
    const row = async (sp: Record<string, string>) => {
      const v = (await resourcesPage({ view: 'week', ...sp })).props.view;
      return { julien: v.weekRows!.find((r) => r.name === 'Julien Wagner')!, others: v.weekRows!.filter((r) => r.name !== 'Julien Wagner'), has: v.weekHasSplit };
    };
    const current = await row({});
    expect(current.julien).toMatchObject({ hoursText: '40 h / 40 h', projectsText: 'HLT-026 40 h' });
    expect(current.others.every((r) => r.projectsText !== '')).toBe(true);
    expect(current.has).toBe(true);
    expect((await row({ week: '2026-09-28' })).julien.projectsText).toBe('HLT-026 40 h');
    expect((await row({ week: '2026-10-05' })).julien).toMatchObject({ hoursText: '42.5 h / 40 h', projectsText: 'HLT-026 42.5 h' });
    // An assignment on another project (an activity still to do).
    const db = await getDb();
    const [julien] = await db.select({ id: persons.id }).from(persons).where(eq(persons.fullName, 'Julien Wagner'));
    const [ndc] = await db.select({ id: projects.id }).from(projects).where(eq(projects.code, 'NDC-031'));
    const [{ id: _source, ...copy }] = await db.select().from(activities).where(eq(activities.projectId, ndc.id)).limit(1);
    void _source;
    await db.insert(activities).values({ ...copy, code: 'TST-SPLIT', position: 9999, startDate: '2026-10-14', finishDate: '2026-10-23', calendarCode: null, percentComplete: 0, durationDays: 8 });
    const [added] = await db.select({ id: activities.id }).from(activities).where(eq(activities.code, 'TST-SPLIT'));
    await db.insert(activityAssignments).values({ activityId: added.id, position: 0, resource: 'Julien Wagner', personId: julien.id, detail: '', units: '1 × 6 h/d', progressText: '', resourceCount: 1, hoursPerDay: 6 });
    // Week of 12 Oct: Wed–Fri on NDC-031 = 18 h more — R-084: his load that week (68 h, 170 %), all of it split (no "not
    // assigned" any more: the load and the split come from the same assignments).
    expect(await jw('2026-10-12')).toEqual([{ code: 'HLT-026', hours: 40 }, { code: 'NDC-031', hours: 18 }, { code: 'RCF-019', hours: 7.5 }, { code: 'MSR-012', hours: 2.5 }]);
    const SPLIT = 'HLT-026 40 h · NDC-031 18 h · RCF-019 7.5 h · MSR-012 2.5 h';
    const oct12 = await row({ week: '2026-10-12' });
    expect(oct12.julien).toMatchObject({ cell: { v: 170 }, hoursText: '68 h / 40 h', projectsText: SPLIT });
    expect(oct12.has).toBe(true);
    const out = renderToStaticMarkup(createElement(Provider, { lang: 'en' }, await resourcesPage({ view: 'week', week: '2026-10-12' })));
    expect(out).toContain(SPLIT);
    expect(out).not.toContain('The projects’ schedules assign no one');
    // Project resources: the person's whole week (every project), not only the project's own hours.
    const team = (await projectPage('HLT-026', { view: 'week', week: '2026-10-12' })).props.view;
    expect(team.weekRows!.find((r) => r.name === 'Julien Wagner')!.projectsText).toBe(SPLIT);
    // The week export carries the same text; French on screen.
    const lines = (await csv('resources', 'view=week&week=2026-10-12')).split('\r\n');
    expect(lines[0]).toContain('By project');
    expect(lines.find((l) => l.includes('Julien Wagner'))).toContain('NDC-031 18 h');
    // A complete activity puts no load (R-084: only work still to do counts).
    await db.update(activities).set({ percentComplete: 100 }).where(eq(activities.id, added.id));
    expect((await jw('2026-10-12')).map((x) => x.code)).not.toContain('NDC-031');
    await db.update(activities).set({ percentComplete: 0 }).where(eq(activities.id, added.id));
    as('director', 'fr');
    expect((await row({ week: '2026-10-12' })).julien.projectsText).toBe('HLT-026 40 h · NDC-031 18 h · RCF-019 7,5 h · MSR-012 2,5 h');
    await db.delete(activities).where(eq(activities.id, added.id));
  }, 60_000);
});
