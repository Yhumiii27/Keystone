// R-084 (owner answers 17 Oct 2026, third round) on the demo database (business date Fri 25 Sep 2026): the planning load — the
// ONE source of the people's load and of the demand by trade, from the schedules' assignments — and the alert for activities
// that declare no resource at all (Project resources card, morning bell notice to the PM of record, deduplicated).
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
const jar = new Map<string, string>();
vi.mock('next/headers', () => ({ cookies: async () => ({ get: (k: string) => (jar.has(k) ? { name: k, value: jar.get(k)! } : undefined) }) }));
vi.mock('next/navigation', () => ({
  usePathname: () => '/projects/HLT-026/resources', useRouter: () => ({ push() {}, refresh() {} }), redirect: (u: string) => { throw new Error(`REDIRECT ${u}`); },
  notFound: () => { throw new Error('NOT_FOUND'); },
}));
vi.mock('next/cache', () => ({ revalidatePath() {} }));
import { and, eq } from 'drizzle-orm';
import { createElement, isValidElement, type ComponentType, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ProjectResourcesPage from '@/app/(app)/projects/[code]/resources/page';
import type { ResourcesView as View } from '@/features/resources/model';
import { I18nProvider } from '@/i18n/client';
import { getDb, setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { activities, notifications, persons, projects, users } from '@/server/db/schema';
import { jobDefinition } from '@/server/jobs/definitions';
import { COOKIE } from '@/server/session';
import { capacityModel, loadNextWeeks } from './kpis';
import { listNotifications } from './notifications';
import { getPlanningLoad, listUndeclaredActivities } from './planning-load';
import { getCapacityDemand, getProjectTradeDemand, getResourcePool, listDepartments } from './resources';
import { UNDECLARED_ALERT_TITLE, alertUndeclaredActivities } from './undeclared-alerts';

const WINDOW = ['2026-09-21', '2026-09-28', '2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26', '2026-11-02', '2026-11-09'];
const as = (role: string, lang = 'en') => {
  jar.clear();
  jar.set(COOKIE.role, role);
  jar.set(COOKIE.lang, lang);
};
const Provider = I18nProvider as ComponentType<{ lang: 'en' | 'fr'; children?: ReactNode }>;
type Body = ReactElement<{ view: View; children?: ReactNode }>;
const projectPage = async (code: string, sp: Record<string, string> = {}) => {
  const el = (await ProjectResourcesPage({ params: Promise.resolve({ code }), searchParams: Promise.resolve(sp) })) as ReactElement<{ children?: ReactNode }>;
  return ((el.props.children as ReactElement[]).filter(isValidElement)[1]) as Body;
};

/** An HLT-026 activity copied from A1250, with the fields given (no assignment). */
async function addActivity(code: string, over: Partial<typeof activities.$inferInsert>) {
  const db = await getDb();
  const [src] = await db.select().from(activities).where(eq(activities.code, 'A1250'));
  const { id: _id, ...copy } = src;
  void _id;
  await db.insert(activities).values({ ...copy, code, name: `Test ${code}`, position: 9000 + code.length, ...over });
}

beforeAll(async () => {
  setDb(await openDatabase());
}, 60_000);
beforeEach(() => as('director'));

describe('getPlanningLoad on the demo data set', () => {
  it('people: the named assignments only — Julien Wagner on HLT-026 A1250, 40 h a week until Fri 9 Oct', async () => {
    const l = await getPlanningLoad(WINDOW);
    const names = Object.entries(l.people).map(([id, h]) => [l.names[id], h]);
    expect(names).toEqual([['Julien Wagner', [40, 40, 40, 0, 0, 0, 0, 0]]]);
    expect(Object.values(l.personProjects)).toEqual([{ 'HLT-026': [40, 40, 40, 0, 0, 0, 0, 0] }]);
  });

  it('trades: the unnamed crew under its own name; owner-only activities on their owner\'s department at 2 h per working day', async () => {
    const l = await getPlanningLoad(WINDOW);
    const crew = l.trades.find((t) => t.trade === 'Steel erection crew')!;
    // 6 × 10 h/d on A1250 until 9 Oct: 300 h a week; the crane (no hours) and the steel (tonnes) add nothing.
    expect([crew.kind, crew.hours, crew.ownersH]).toEqual(['resource', [300, 300, 300, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0]]);
    expect(Object.keys(crew.byProject)).toEqual(['HLT-026']);
    expect(l.trades.filter((t) => t.kind === 'department').map((t) => t.trade).sort()).toEqual(['Controls & planning', 'Engineering', 'MEP', 'Quality', 'Site operations']);
    // Every department trade comes from owner-only activities (no unnamed assignment carries a department in the demo data).
    for (const t of l.trades.filter((x) => x.kind === 'department')) expect(t.unnamedH.every((h) => h === 0)).toBe(true);
    // R. Aubert owns HLT-026 activities and has no department: "Other".
    expect(l.trades.some((t) => t.kind === 'other')).toBe(l.trades.some((t) => t.trade === 'Other'));
  });

  it('the pool, the departments, the project demand and the capacity model read the same source', async () => {
    const pool = await getResourcePool(WINDOW);
    expect(pool.people.find((p) => p.name === 'Julien Wagner')).toMatchObject({ loads: [100, 100, 100, 0, 0, 0, 0, 0], hours: [40, 40, 40, 0, 0, 0, 0, 0] });
    const depts = await listDepartments(WINDOW);
    const eng = depts.find((d) => d.name === 'Engineering')!;
    // Julien Wagner's 120 h + the engineering activities their owner carries alone (J. Wagner owns 2 open ones: 50 h).
    expect([eng.capacityH, eng.demandH, eng.unnamedH]).toEqual([960, 170, 50]);
    const rows = await getCapacityDemand(WINDOW);
    expect(rows.map((r) => [r.name, r.kind, r.demandH, r.capacityH])).toEqual([
      ['Engineering', 'department', 170, 960], ['Site operations', 'department', 214, 640], ['MEP', 'department', 300, 480],
      ['Controls & planning', 'department', 574, 640], ['Quality', 'department', 106, 320], ['Steel erection crew', 'resource', 900, 0],
    ]);
    expect(await getProjectTradeDemand('HLT-026', WINDOW)).toEqual([
      { trade: 'Steel erection crew', kind: 'resource', hours: 900 }, { trade: 'Site operations', kind: 'department', hours: 106 },
      { trade: 'Engineering', kind: 'department', hours: 50 }, { trade: 'MEP', kind: 'department', hours: 96 },
    ]);
    const cap = await capacityModel([], {});
    expect(cap.map((c) => [c.department, c.committedH])).toEqual([
      ['Engineering', 170], ['Site operations', 214], ['MEP', 300], ['Controls & planning', 574], ['Quality', 106],
    ]);
    // "Load next 2 wks": the weeks of 28 Sep and 5 Oct.
    expect([await loadNextWeeks('Julien Wagner'), await loadNextWeeks('Hélène Sauvage'), await loadNextWeeks('Marie Lefebvre')]).toEqual([100, 0, null]);
  });
});

describe('activities without any declared resource (owner answer B: an alert)', () => {
  it('none on the demo data set: every activity has an owner', async () => {
    expect(await listUndeclaredActivities()).toEqual([]);
    expect(await alertUndeclaredActivities()).toEqual({ today: '2026-09-25', undeclared: 0, alerted: 0, already: 0, unaddressed: 0 });
  });

  it('listed when it needs work and has neither assignment nor owner; the Project resources card; one notice to the PM, once', async () => {
    await addActivity('TST-NONE', { ownerPersonId: null, percentComplete: 0, durationDays: 5, startDate: '2026-10-05', finishDate: '2026-10-09' });
    // Not listed: a milestone, a complete activity, one with an owner.
    await addActivity('TST-MS', { ownerPersonId: null, percentComplete: 0, durationDays: 0 });
    await addActivity('TST-DONE', { ownerPersonId: null, percentComplete: 100, durationDays: 5 });
    await addActivity('TST-OWNED', { percentComplete: 0, durationDays: 5 });
    expect((await listUndeclaredActivities()).map((a) => [a.projectCode, a.code, a.name])).toEqual([['HLT-026', 'TST-NONE', 'Test TST-NONE']]);
    expect((await listUndeclaredActivities('NDC-031'))).toEqual([]);

    // Project resources: a card with the link to the activity on the Plan.
    const body = await projectPage('HLT-026');
    expect(body.props.view.undeclared).toEqual([{ code: 'TST-NONE', name: 'Test TST-NONE', href: '/projects/HLT-026/plan?act=TST-NONE' }]);
    const out = renderToStaticMarkup(createElement(Provider, { lang: 'en' }, body));
    for (const s of ['Activities without a declared resource', 'No assignment and no owner: their load counts nowhere', 'href="/projects/HLT-026/plan?act=TST-NONE"', 'TST-NONE · Test TST-NONE'])
      expect(out).toContain(s);
    as('director', 'fr');
    const fr = renderToStaticMarkup(createElement(Provider, { lang: 'fr' }, await projectPage('HLT-026')));
    expect(fr).toContain('Activités sans ressource déclarée');
    expect(fr).toContain('Ni affectation ni responsable : leur charge n’est comptée nulle part');

    // The morning job: Romain Aubert (PM of record of HLT-026) is told once.
    const before = (await listNotifications('pm')).length;
    expect(await jobDefinition('undeclared-resource-alerts').run()).toMatchObject({
      counts: { undeclared: 1, alerted: 1, already: 0, unaddressed: 0 }, warn: false,
    });
    const mine = await listNotifications('pm');
    expect(mine).toHaveLength(before + 1);
    expect(mine[0]).toMatchObject({ kind: 'alert', title: UNDECLARED_ALERT_TITLE, sub: 'TST-NONE · Test TST-NONE', screen: 'plan', params: { sel: 'TST-NONE' }, projectCode: 'HLT-026' });
    // A second run (a restart, another worker the same day, the next morning) sends nothing more.
    expect(await alertUndeclaredActivities()).toMatchObject({ undeclared: 1, alerted: 0, already: 1 });
    expect(await listNotifications('pm')).toHaveLength(before + 1);
    // Declared (an owner): no longer listed, no card.
    const db = await getDb();
    const [julien] = await db.select({ id: persons.id }).from(persons).where(eq(persons.fullName, 'Julien Wagner'));
    await db.update(activities).set({ ownerPersonId: julien.id }).where(eq(activities.code, 'TST-NONE'));
    expect(await listUndeclaredActivities()).toEqual([]);
    as('director');
    expect((await projectPage('HLT-026')).props.view.undeclared).toEqual([]);
  }, 60_000);

  it('a PM without an active account: counted without recipient (a warning), tried again the next run', async () => {
    const db = await getDb();
    await addActivity('TST-NONE2', { ownerPersonId: null, percentComplete: 10, durationDays: 3 });
    const [hlt] = await db.select({ pm: projects.pmPersonId }).from(projects).where(eq(projects.code, 'HLT-026'));
    await db.update(users).set({ active: false }).where(eq(users.personId, hlt.pm!));
    try {
      expect(await alertUndeclaredActivities()).toMatchObject({ undeclared: 1, alerted: 0, unaddressed: 1 });
      expect(await db.select().from(notifications).where(and(eq(notifications.title, UNDECLARED_ALERT_TITLE)))).toHaveLength(1); // the first test's
    } finally {
      await db.update(users).set({ active: true }).where(eq(users.personId, hlt.pm!));
    }
    expect(await alertUndeclaredActivities()).toMatchObject({ undeclared: 1, alerted: 1, unaddressed: 0 });
  }, 60_000);
});
