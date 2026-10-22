// R-084 (owner answers 17 Oct 2026, third round) on the demo database (business date Fri 25 Sep 2026): the planning load — the
// ONE source of the people's load and of the demand by trade, from the schedules' assignments — and the alert for activities
// that declare no resource at all (Project resources card, morning bell notice to the PM of record, deduplicated). Owner answers
// 18 Oct 2026 (fourth round): the named demo assignments, external crews out of the load, the J-15 alert on activities without an
// assignment.
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
import { removeCursusAbsence, replaceCursusAbsence } from './hr';
import { capacityModel, loadNextWeeks } from './kpis';
import { listNotifications } from './notifications';
import { getPlanningLoad, listUnassignedActivities, listUndeclaredActivities } from './planning-load';
import { getCapacityDemand, getProjectTradeDemand, getResourcePool, listDepartments } from './resources';
import { UNASSIGNED_ALERT_TITLE, UNDECLARED_ALERT_TITLE, alertUndeclaredActivities } from './undeclared-alerts';

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
  // Owner answer 18 Oct 2026 (fourth round): named demo assignments (src/server/db/seed/demo-assignments.ts) — the eight people of
  // the pool on the six scheduled projects, fitted to the prototype's PEOPLE profile.
  it('people: the named assignments of every project — the eight people of the pool', async () => {
    const l = await getPlanningLoad(WINDOW);
    const byName = Object.fromEntries(Object.entries(l.people).map(([id, h]) => [l.names[id], h]));
    expect(Object.keys(byName).sort()).toEqual(['Amélie Ollivier', 'Damien Roux', 'Fabien Bertrand', 'Hélène Sauvage', 'Julien Wagner', 'Léa Marchand', 'Pauline Noguès', 'Thomas Kerbrat']);
    // A1250 "40 h/wk" until 9 Oct (the prototype's assignment), then crane delivery & rigging, load tests, roof decking.
    expect(byName['Julien Wagner']).toEqual([40, 40, 42.5, 50, 50, 43, 35, 26]);
    const julien = Object.entries(l.personProjects).find(([id]) => l.names[id] === 'Julien Wagner')![1];
    expect(julien).toEqual({ 'HLT-026': [40, 40, 42.5, 40, 40, 40, 35, 26], 'RCF-019': [0, 0, 0, 7.5, 7.5, 3, 0, 0], 'MSR-012': [0, 0, 0, 2.5, 2.5, 0, 0, 0] });
  });

  it('trades: external crews left out (18 Oct); the one owner-only activity on its owner\'s department at 2 h per working day', async () => {
    const l = await getPlanningLoad(WINDOW);
    // « Les équipes externes ne rentrent pas dans le plan de charge »: the steel erection crew (A1250, 6 × 10 h/d, no department)
    // puts no demand anywhere. HLT-026 A1410 (Pauline Noguès, MEP) is left without an assignment in the demo: 2 h/d until 23 Oct.
    expect(l.trades.map((t) => [t.trade, t.kind, t.hours, t.unnamedH, t.ownersH])).toEqual([
      ['MEP', 'department', [10, 10, 10, 10, 10, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0], [10, 10, 10, 10, 10, 0, 0, 0]],
    ]);
    expect(l.trades[0].byProject).toEqual({ 'HLT-026': [10, 10, 10, 10, 10, 0, 0, 0] });
  });

  it('the pool, the departments, the project demand and the capacity model read the same source', async () => {
    const pool = await getResourcePool(WINDOW);
    // R-084 (absences): each week against the person's capacity — 40 h less 8 h per day of the seeded leave. R-084 (absences), demo
    // leave shifted (owner 22 Oct 2026, src/server/db/seed/demo-leave.ts): in this window only Hélène Sauvage's 2 sick days (28 Sep,
    // 18 h on 24 h: 44 → 73 %), Léa Marchand's RTT (5 Oct, 71 → 89 %) and Julien Wagner's RTT (9 Nov, Wed 11 Nov a holiday: 65 →
    // 81 %); the full weeks of CP fall on weeks without assigned hours (23 Nov – 15 Jan). The prototype's LEAVE (Amélie Ollivier
    // CP 12 and 19 Oct…) read 231 % and six people above 110 %.
    expect(pool.people.map((p) => [p.name, p.loads])).toEqual([
      ['Amélie Ollivier', [106, 100, 100, 131, 106, 106, 106, 85]],
      ['Julien Wagner', [100, 100, 106, 125, 125, 108, 88, 81]],
      ['Pauline Noguès', [69, 79, 108, 81, 113, 113, 102, 105]],
      ['Thomas Kerbrat', [56, 56, 88, 110, 75, 75, 56, 20]],
      ['Léa Marchand', [69, 73, 89, 75, 75, 75, 81, 65]],
      ['Damien Roux', [88, 99, 86, 96, 90, 81, 94, 66]],
      ['Hélène Sauvage', [44, 73, 48, 64, 76, 90, 101, 76]],
      ['Fabien Bertrand', [100, 99, 95, 81, 56, 56, 49, 35]],
    ]);
    expect(pool.people.find((p) => p.name === 'Hélène Sauvage')!.capacityH).toEqual([40, 24, 40, 40, 40, 40, 40, 40]);
    expect(pool.people.find((p) => p.name === 'Amélie Ollivier')!.capacityH).toEqual([40, 40, 40, 40, 40, 40, 40, 40]);
    expect((await getResourcePool(['2026-12-07', '2026-12-14'])).people.find((p) => p.name === 'Amélie Ollivier')).toMatchObject({ capacityH: [0, 0], loads: [0, 0] });
    expect(pool.people.find((p) => p.name === 'Damien Roux')!.capacityH).toEqual([40, 40, 40, 40, 40, 40, 40, 40]);
    expect(pool.people.find((p) => p.name === 'Julien Wagner')!.hours).toEqual([40, 40, 42.5, 50, 50, 43, 35, 26]);
    const depts = await listDepartments(WINDOW);
    const mep = depts.find((d) => d.name === 'MEP')!;
    // Pauline Noguès's 308 h + A1410 carried by its owner alone (50 h).
    expect([mep.capacityH, mep.demandH, mep.unnamedH]).toEqual([480, 358, 50]);
    const rows = await getCapacityDemand(WINDOW);
    expect(rows.map((r) => [r.name, r.kind, r.demandH, r.capacityH])).toEqual([
      ['Engineering', 'department', 327, 960], ['Site operations', 'department', 551, 640], ['MEP', 'department', 358, 480],
      ['Controls & planning', 'department', 742, 640], ['Quality', 'department', 217, 320],
    ]);
    expect(await getProjectTradeDemand('HLT-026', WINDOW)).toEqual([{ trade: 'MEP', kind: 'department', hours: 50 }]);
    const cap = await capacityModel([], {});
    expect(cap.map((c) => [c.department, c.committedH])).toEqual([
      ['Engineering', 327], ['Site operations', 551], ['MEP', 358], ['Controls & planning', 742], ['Quality', 217],
    ]);
    // "Load next 2 wks": the weeks of 28 Sep and 5 Oct.
    // R-084 (absences), demo leave shifted (owner 22 Oct 2026): Hélène Sauvage's 2 sick days in the week of 28 Sep — 73 · 48 → 61 %.
    expect([await loadNextWeeks('Julien Wagner'), await loadNextWeeks('Hélène Sauvage'), await loadNextWeeks('Marie Lefebvre')]).toEqual([103, 61, null]);
  });
});

describe('R-084 (absences): an absence received from Cursus lowers the person\'s capacity', () => {
  it('Damien Roux, 2 days off in the week of 19 Oct: 36 h on 24 h → 150 %; cancelled → 90 % again', async () => {
    const db = await getDb();
    const [damien] = await db.select({ id: persons.id }).from(persons).where(eq(persons.fullName, 'Damien Roux'));
    const week = ['2026-10-19'];
    const before = (await getResourcePool(week)).people.find((p) => p.name === 'Damien Roux')!;
    expect([before.hours, before.capacityH, before.loads]).toEqual([[36], [40], [90]]);
    await db.transaction((tx) => replaceCursusAbsence(tx, { personId: damien.id, type: 'absence', start: '2026-10-19', end: '2026-10-20', key: 'cursus:probe-1' }));
    const during = (await getResourcePool(['2026-10-19', '2026-10-26'])).people.find((p) => p.name === 'Damien Roux')!;
    expect([during.hours, during.capacityH, during.loads]).toEqual([[36, 32.5], [24, 40], [150, 81]]);
    expect((await getPlanningLoad(['2026-10-19', '2026-10-26'])).capacity[damien.id]).toEqual([24, 40]);
    await db.transaction((tx) => removeCursusAbsence(tx, 'cursus:probe-1'));
    expect((await getResourcePool(['2026-10-19', '2026-11-02'])).people.find((p) => p.name === 'Damien Roux')!.loads[0]).toBe(90);
  });
});

describe('activities without an assignment at J-15 (owner answer 18 Oct 2026, fourth round)', () => {
  it('HLT-026 A1410 (owner only, started): the Project resources card, one notice to the PM, once', async () => {
    expect((await listUnassignedActivities('2026-09-25')).map((a) => [a.projectCode, a.code, a.start])).toEqual([['HLT-026', 'A1410', '2026-08-17']]);
    expect(await listUnassignedActivities('2026-09-25', 'NDC-031')).toEqual([]);
    const body = await projectPage('HLT-026');
    expect(body.props.view.unassigned).toEqual([{ code: 'A1410', name: 'HV connection & switchgear', start: '17 Aug', href: '/projects/HLT-026/plan?act=A1410' }]);
    const out = renderToStaticMarkup(createElement(Provider, { lang: 'en' }, body));
    for (const s of ['Activities without an assignment', 'Starting within 15 days or started, owner only: assign the people who will do the work', 'href="/projects/HLT-026/plan?act=A1410"'])
      expect(out).toContain(s);
    as('director', 'fr');
    const fr = renderToStaticMarkup(createElement(Provider, { lang: 'fr' }, await projectPage('HLT-026')));
    for (const s of ['Activités sans affectation', 'Début sous 15 jours ou déjà commencées', '17 août']) expect(fr).toContain(s);
    as('director');

    const before = (await listNotifications('pm')).length;
    expect(await jobDefinition('undeclared-resource-alerts').run()).toMatchObject({
      counts: { undeclared: 0, unassigned: 1, alerted: 1, already: 0, unaddressed: 0 }, warn: false,
    });
    const mine = await listNotifications('pm');
    expect(mine).toHaveLength(before + 1);
    expect(mine[0]).toMatchObject({
      kind: 'alert', title: UNASSIGNED_ALERT_TITLE, sub: 'A1410 · HV connection & switchgear · 17 Aug', screen: 'plan', params: { sel: 'A1410' }, projectCode: 'HLT-026',
    });
    expect(await alertUndeclaredActivities()).toEqual({ today: '2026-09-25', undeclared: 0, unassigned: 1, alerted: 0, already: 1, unaddressed: 0 });
    expect(await listNotifications('pm')).toHaveLength(before + 1);
  }, 60_000);

  it('the J-15 horizon moves with the business date: an owner-only activity starting on 26 Oct is warned from 11 Oct', async () => {
    await addActivity('TST-J15', { percentComplete: 0, durationDays: 5, startDate: '2026-10-26', finishDate: '2026-10-30' });
    expect((await listUnassignedActivities('2026-10-10')).map((a) => a.code)).not.toContain('TST-J15');
    expect((await listUnassignedActivities('2026-10-11')).map((a) => a.code)).toContain('TST-J15');
    expect(await alertUndeclaredActivities('2026-10-11')).toMatchObject({ unassigned: 2, alerted: 1, already: 1 });
    const db = await getDb();
    await db.delete(activities).where(eq(activities.code, 'TST-J15'));
  }, 60_000);
});

describe('activities without any declared resource (owner answer B: an alert)', () => {
  it('none on the demo data set: every activity has an owner', async () => {
    expect(await listUndeclaredActivities()).toEqual([]);
    expect(await alertUndeclaredActivities()).toMatchObject({ today: '2026-09-25', undeclared: 0, alerted: 0 });
  });

  it('listed when it needs work and has neither assignment nor owner; the Project resources card; one notice to the PM, once', async () => {
    await addActivity('TST-NONE', { ownerPersonId: null, percentComplete: 0, durationDays: 5, startDate: '2026-10-05', finishDate: '2026-10-09' });
    // Not listed: a milestone, a complete activity, one with an owner.
    await addActivity('TST-MS', { ownerPersonId: null, percentComplete: 0, durationDays: 0 });
    await addActivity('TST-DONE', { ownerPersonId: null, percentComplete: 100, durationDays: 5 });
    // (Starting after the J-15 horizon: no "without an assignment" notice either.)
    await addActivity('TST-OWNED', { percentComplete: 0, durationDays: 5, startDate: '2027-01-04', finishDate: '2027-01-08' });
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
    // (A1410's J-15 notice went out in the block above: already alerted.)
    expect(await jobDefinition('undeclared-resource-alerts').run()).toMatchObject({
      counts: { undeclared: 1, unassigned: 1, alerted: 1, already: 1, unaddressed: 0 }, warn: false,
    });
    const mine = await listNotifications('pm');
    expect(mine).toHaveLength(before + 1);
    expect(mine[0]).toMatchObject({ kind: 'alert', title: UNDECLARED_ALERT_TITLE, sub: 'TST-NONE · Test TST-NONE', screen: 'plan', params: { sel: 'TST-NONE' }, projectCode: 'HLT-026' });
    // A second run (a restart, another worker the same day, the next morning) sends nothing more.
    expect(await alertUndeclaredActivities()).toMatchObject({ undeclared: 1, alerted: 0, already: 2 });
    expect(await listNotifications('pm')).toHaveLength(before + 1);
    // Declared (an owner): no longer listed, no card — but now an owner-only activity starting on 5 Oct, within J-15.
    const db = await getDb();
    const [julien] = await db.select({ id: persons.id }).from(persons).where(eq(persons.fullName, 'Julien Wagner'));
    await db.update(activities).set({ ownerPersonId: julien.id }).where(eq(activities.code, 'TST-NONE'));
    expect(await listUndeclaredActivities()).toEqual([]);
    as('director');
    expect((await projectPage('HLT-026')).props.view.undeclared).toEqual([]);
    expect((await listUnassignedActivities('2026-09-25')).map((a) => a.code)).toEqual(['A1410', 'TST-NONE']);
  }, 60_000);

  it('a PM without an active account: counted without recipient (a warning), tried again the next run', async () => {
    const db = await getDb();
    await addActivity('TST-NONE2', { ownerPersonId: null, percentComplete: 10, durationDays: 3 });
    const [hlt] = await db.select({ pm: projects.pmPersonId }).from(projects).where(eq(projects.code, 'HLT-026'));
    await db.update(users).set({ active: false }).where(eq(users.personId, hlt.pm!));
    try {
      // TST-NONE2 (undeclared) and TST-NONE (owner only since the test above, J-15) find nobody.
      expect(await alertUndeclaredActivities()).toMatchObject({ undeclared: 1, unassigned: 2, alerted: 0, already: 1, unaddressed: 2 });
      expect(await db.select().from(notifications).where(and(eq(notifications.title, UNDECLARED_ALERT_TITLE)))).toHaveLength(1); // the first test's
    } finally {
      await db.update(users).set({ active: true }).where(eq(users.personId, hlt.pm!));
    }
    expect(await alertUndeclaredActivities()).toMatchObject({ undeclared: 1, alerted: 2, unaddressed: 0 });
  }, 60_000);
});
