// Delivery 8, lot roles-rates-hr, against the seeded in-memory database with the real session (the "View as" cookie) and project
// context: the Finance persona's user and its backfill (R-044), the rights of the Server Functions for the 9 personas — rates
// (P-12 c), budget rate (C-9), Hours (Finance read-only), Settings' hours-variance threshold (R-088, A-14) — malformed input and
// stale states, the dated grid's valuations (R-083: hours KPI, task cost note, what-if, site premium) and the reference
// multipliers backfill (R-178).
import { beforeAll, describe, expect, it, vi } from 'vitest';

const jar = new Map<string, string>();
vi.mock('next/headers', () => ({ cookies: async () => ({ get: (k: string) => (jar.has(k) ? { name: k, value: jar.get(k)! } : undefined) }) }));
vi.mock('next/navigation', () => ({ redirect: (u: string) => { throw new Error(`REDIRECT ${u}`); }, notFound: () => { throw new Error('NOT_FOUND'); } }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { and, eq, sql } from 'drizzle-orm';
import { PERSONAS } from '@/config/personas';
import type { RoleKey } from '@/config/screens';
import { multiplierAt, rateAt } from '@/domain/hr';
import { setHoursVarianceAction } from '@/features/admin/actions';
import { setBudgetRateAction } from '@/features/contract/actions';
import { addRateRoleAction, assignHoursAction, importHoursAction, setBaseRateAction, setMultiplierAction } from '@/features/hr/actions';
import { setDb } from '@/server/db/client';
import { APP_SETTING_HOURS_VARIANCE } from '@/server/db/codes';
import { openDatabase } from '@/server/db/open';
import { appSettings, persons, rateMultiplierRates, rateMultipliers, rateRoleRates, rateRoles, users } from '@/server/db/schema';
import { seedIfEmpty } from '@/server/db/seed';
import { seedRateMultipliers } from '@/server/db/seed/resources';
import { seedFinanceUser } from '@/server/db/seed/users';
import type { DB } from '@/server/db/types';
import { getProjectContext } from '@/server/project-context';
import { COOKIE } from '@/server/session';
import { RATES_EDIT_REFUSED, addRateRole, getHoursReconciliation, getRateCard, getRateGrid, setBaseRate } from './hr';
import { readHoursVariance } from './hours-variance';
import { listActivity, listAudit } from './notifications';
import { listUsers } from './people';
import { getHomeView } from './home';
import { getWhatIf } from './resources';
import { HOURS_VARIANCE_RANGE, resetSettings, setHoursVariance } from './settings';
import { getSite } from './site';
import { getTask } from './tasks';

const ROLES = PERSONAS.map((p) => p.role);
const as = (role: RoleKey) => {
  jar.clear();
  jar.set(COOKIE.role, role);
  jar.set(COOKIE.lang, 'en');
};
const DIRECTOR = { name: 'Marie Lefebvre', role: 'director' };
let db: DB;

beforeAll(async () => {
  db = await openDatabase();
  setDb(db);
}, 60_000);

describe('R-044 · the Finance persona', () => {
  it('a 9th demo user: Léa Marchand, role finance, Controls & planning, sign-in e-mail on the person', async () => {
    const u = (await listUsers()).find((x) => x.role === 'finance');
    expect(u).toMatchObject({ name: 'Léa Marchand', roles: ['finance'], title: 'Cost controller', client: null });
    expect((await listUsers()).length).toBe(9);
    const [p] = await db.select({ email: persons.email }).from(persons).where(eq(persons.fullName, 'Léa Marchand'));
    expect(p.email).toBe('lea.marchand@epc2i.fr');
  });

  it('backfill of a database seeded before delivery 8: created once, then a no-op', async () => {
    expect(await db.transaction((tx) => seedFinanceUser(tx))).toBeNull();
    await db.delete(users).where(eq(users.personaRole, 'finance'));
    expect((await listUsers()).some((x) => x.role === 'finance')).toBe(false);
    expect(await seedIfEmpty(db)).toBe(false); // the demo backfills run
    expect((await listUsers()).filter((x) => x.role === 'finance').map((x) => x.name)).toEqual(['Léa Marchand']);
    const before = (await listUsers()).length;
    expect(await seedIfEmpty(db)).toBe(false);
    expect((await listUsers()).length).toBe(before);
  });

  it('Finance’s Home is the director’s (default branch): the portfolio KPIs, alerts and approvals, greeted by name', async () => {
    const view = (role: RoleKey) => getHomeView({ role, persona: PERSONAS.find((p) => p.role === role)!, projectCode: 'HLT-026', zone: null, lang: 'en' });
    const [finance, director] = await Promise.all([view('finance'), view('director')]);
    expect([finance.greeting, finance.sub]).toEqual(['Good morning, Léa', 'Cost controller · Friday 25 Sep 2026']);
    expect({ ...finance, greeting: null, sub: null }).toEqual({ ...director, greeting: null, sub: null });
  });

  it('project context: Finance edits the Contract everywhere, reads Budget, Hours and Billing even on its teams', async () => {
    as('finance');
    for (const code of ['HLT-026', 'NDC-031', 'RCF-019']) {
      const ctx = await getProjectContext(code);
      expect([code, ctx.canEdit('contract'), ctx.canEdit('budget'), ctx.canEdit('hours'), ctx.canEdit('billing')]).toEqual([code, true, false, false, false]);
    }
    // On its teams (Léa Marchand is on HLT-026, NDC-031 and ERP-202) its own work stays editable; off them (RCF-019), read-only.
    expect([(await getProjectContext('NDC-031')).canEdit('meetings'), (await getProjectContext('RCF-019')).canEdit('meetings')]).toEqual([true, false]);
  });
});

describe('Server Functions × 9 personas', () => {
  it('rates (P-12 c): only the director and Finance edit; malformed values and dates refused; nothing written otherwise', async () => {
    const audits = (await listAudit()).length;
    for (const role of ROLES) {
      as(role);
      if (role === 'client') {
        // R-042 (P-1): Rate cards are outside the client's workspace — sent home.
        await expect(setBaseRateAction('Planner', 74, '2026-09-25')).rejects.toThrow('REDIRECT /');
        await expect(addRateRoleAction({ role: 'X', rate: '1', from: '25 Sep 2026' })).rejects.toThrow('REDIRECT /');
        continue;
      }
      const ok = role === 'director' || role === 'finance';
      expect([role, await setBaseRateAction('Planner', 74, '2026-09-25')]).toEqual([role, ok ? { ok: true, value: 74 } : { error: RATES_EDIT_REFUSED }]);
      expect([role, await setMultiplierAction('ot', 1.25, '2026-09-25')]).toEqual([role, ok ? { ok: true, value: 1.25 } : { error: RATES_EDIT_REFUSED }]);
      expect([role, await addRateRoleAction({ role: 'Planner', rate: '70', from: '25 Sep 2026' })]).toEqual([role, { error: ok ? 'This role is already on the rate card' : RATES_EDIT_REFUSED }]);
    }
    // Unchanged values: no version, no audit row.
    expect((await listAudit()).length).toBe(audits);
    as('finance');
    for (const bad of [NaN, Infinity, -1, 10_001, 'abc' as unknown as number, {} as unknown as number])
      expect(await setBaseRateAction('Planner', bad, '2026-09-25')).toMatchObject({ error: expect.any(String) });
    for (const date of ['', '2026-13-01', '25/09/2026', null as unknown as string, '1999-12-31'])
      expect(await setBaseRateAction('Planner', 80, date)).toEqual({ error: 'Enter a valid effective date' });
    expect(await setBaseRateAction({ role: 'Planner' } as unknown as string, 80, '2026-09-25')).toEqual({ error: 'Invalid request' });
    expect(await setMultiplierAction('ot', 11, '2026-09-25')).toEqual({ error: 'Multiplier out of range' });
    expect(await addRateRoleAction(null as unknown as Record<string, string>)).toEqual({ error: 'Role is required' });
    expect((await listAudit()).length).toBe(audits);
  });

  it('rates: the DAL re-checks the role with the actor (a direct call by a PM is refused); a concurrent duplicate role is refused', async () => {
    await expect(setBaseRate('Planner', 90, '2026-09-25', { name: 'Romain Aubert', role: 'pm' })).rejects.toThrow(RATES_EDIT_REFUSED);
    await expect(setBaseRate('Planner', 90, 'tomorrow', DIRECTOR)).rejects.toThrow('Invalid effective date');
    // Stale form: the role was added since the dialog opened.
    await expect(addRateRole({ role: 'planner', rateEur: 70, effectiveFrom: '2026-09-25' }, DIRECTOR)).rejects.toThrow('This role is already on the rate card');
  });

  it('a dated edit is audited and traced; a backdated one says so; the earlier valuation follows it', async () => {
    as('finance');
    expect(await setBaseRateAction('Planner', 78, '2026-11-01')).toEqual({ ok: true, value: 78 });
    as('director');
    expect(await setBaseRateAction('Planner', 76, '2026-09-01')).toEqual({ ok: true, value: 76 });
    const changes = (await listAudit({ limit: 5 })).map((a) => a.change);
    expect(changes).toContain('Planner base: 74 → 78 €/h from 1 Nov 2026');
    expect(changes).toContain('Planner base: 74 → 76 €/h from 1 Sep 2026 (backdated)');
    expect((await listActivity()).some((a) => a.what === 'Rate card · Planner base: 74 → 78 €/h from 1 Nov 2026')).toBe(true);
    // R-083: Damien Roux (Planner) — his September hours are valued at the version in force on 1 Sep 2026.
    const h = (await getHoursReconciliation('HLT-026'))!;
    expect(h.lines.find((l) => l.person === 'Damien Roux')!.rateEur).toBe(76);
    const card = await getRateCard('2026-12-01');
    expect(card.roles.find((r) => r.role === 'Planner')!.versions.map((v) => [v.effectiveFrom, v.value])).toEqual([['2026-01-01', 74], ['2026-09-01', 76], ['2026-11-01', 78]]);
    // Restore the seed grid (versions removed directly: the screen has no "remove version").
    const [planner] = await db.select({ id: rateRoles.id }).from(rateRoles).where(eq(rateRoles.role, 'Planner'));
    await db.delete(rateRoleRates).where(and(eq(rateRoleRates.rateRoleId, planner.id), sql`${rateRoleRates.effectiveFrom} > '2026-01-01'`));
  });

  it('budget rate (C-9, R-044): the director and Finance; the others refused before any validation', async () => {
    for (const role of ROLES) {
      as(role);
      const r = role === 'client' ? await setBudgetRateAction('HLT-026', 'usd', '1').catch((e: Error) => e.message) : await setBudgetRateAction('HLT-026', 'usd', '1');
      const want = role === 'client' ? 'REDIRECT /' : role === 'director' || role === 'finance' ? { error: 'Unknown currency' } : { error: 'Only the portfolio director and Finance set the budget rate' };
      expect([role, r]).toEqual([role, want]);
    }
  });

  it('Hours (R-044): Finance reads — import and assign refused; the PM of record still imports', async () => {
    as('finance');
    expect(await importHoursAction('HLT-026', {})).toEqual({ error: 'Hours are read-only for you on this project' });
    expect(await importHoursAction('NDC-031', {})).toEqual({ error: 'Hours are read-only for you on this project' });
    expect(await assignHoursAction('HLT-026', 0, '1.3')).toEqual({ error: 'Hours are read-only for you on this project' });
    as('pm');
    expect(await importHoursAction('HLT-026', { code: 'NOPE01' })).toEqual({ error: 'This analytic code does not belong to the project' });
  });

  it('Settings › hours-variance threshold (R-088, A-14): the director only; range and format checked; audit and activity; Reset restores 10', async () => {
    for (const role of ROLES) {
      as(role);
      if (role === 'client') {
        await expect(setHoursVarianceAction('7')).rejects.toThrow('REDIRECT /');
        continue;
      }
      const r = await setHoursVarianceAction('7');
      const want = role === 'director' ? { ok: true } : { error: ['pm', 'depthead', 'englead', 'quality', 'procurement'].includes(role) ? 'Settings are edited by the portfolio director' : 'Settings are read-only for you' };
      expect([role, r]).toEqual([role, want]);
    }
    expect(await readHoursVariance()).toBe(7);
    as('director');
    for (const bad of ['0', '51', '7.5', 'ten', '', null, { pct: 8 }]) expect(await setHoursVarianceAction(bad)).toEqual({ error: HOURS_VARIANCE_RANGE });
    expect((await listAudit({ limit: 3 })).some((a) => a.change === '±10 % → ±7 %' && a.object === 'Hours variance threshold')).toBe(true);
    expect((await listActivity()).some((a) => a.what === 'Hours variance threshold ±10 % → ±7 %')).toBe(true);
    // Same value: nothing written.
    const audits = (await listAudit()).length;
    expect(await setHoursVarianceAction(7)).toEqual({ ok: true });
    expect((await listAudit()).length).toBe(audits);
    // The DAL re-checks the role and the range.
    await expect(setHoursVariance(12, { name: 'Romain Aubert', role: 'pm' })).rejects.toThrow('Settings are edited by the portfolio director');
    await expect(setHoursVariance(60, DIRECTOR)).rejects.toThrow(HOURS_VARIANCE_RANGE);
    await resetSettings(DIRECTOR);
    expect(await readHoursVariance()).toBe(10);
    // A database seeded before delivery 8 has no row: the default applies.
    await db.delete(appSettings).where(eq(appSettings.key, APP_SETTING_HOURS_VARIANCE));
    expect(await readHoursVariance()).toBe(10);
    await setHoursVariance(10, DIRECTOR);
    expect(await readHoursVariance()).toBe(10);
  });
});

describe('R-083 · one valuation of hours on the seed', () => {
  it('persons get the grid role named as their job title; the others are not valued', async () => {
    const rows = await db.select({ name: persons.fullName, role: rateRoles.role }).from(persons).leftJoin(rateRoles, eq(rateRoles.id, persons.rateRoleId)).where(sql`${persons.fullName} in ('Romain Aubert', 'Hélène Sauvage', 'Léa Marchand', 'Marie Lefebvre')`);
    expect(Object.fromEntries(rows.map((r) => [r.name, r.role]))).toEqual({
      'Romain Aubert': 'Project manager', 'Hélène Sauvage': 'QA / QC', 'Léa Marchand': 'Cost controller', 'Marie Lefebvre': null,
    });
  });

  it('task cost note: entries at the logger’s rate on the date; "rate missing" without a rate role', async () => {
    expect((await getTask('T-2305'))!.costNote).toEqual({ cost: 595, rate: 85, missing: false, todayRate: 85 }); // 7 h × Structural engineer 85
    const [helene] = await db.select({ id: persons.id, rr: persons.rateRoleId }).from(persons).where(eq(persons.fullName, 'Hélène Sauvage'));
    await db.update(persons).set({ rateRoleId: null }).where(eq(persons.id, helene.id));
    try {
      expect((await getTask('T-2314'))!.costNote).toEqual({ cost: null, rate: null, missing: true, todayRate: null });
      const h = (await getHoursReconciliation('HLT-026'))!;
      expect(h.lines.filter((l) => l.rateEur == null).map((l) => l.person)).toEqual(['Hélène Sauvage', 'Hélène Sauvage']);
    } finally {
      await db.update(persons).set({ rateRoleId: helene.rr }).where(eq(persons.id, helene.id));
    }
  });

  it('what-if: people through their role at the horizon start; the crew keeps the isolated 60 €/h placeholder', async () => {
    const w = (await getWhatIf('HLT-026'))!;
    const julien = w.levers.find((l) => l.code === 'extra_resource:A1250:julien-wagner')!;
    expect(julien.helper).toMatchObject({ kind: 'external', rateEur: 118 });
    expect(w.levers.find((l) => l.code === 'extra_resource:A1250:steel-erection-crew')!.helper).toMatchObject({ kind: 'same', rateEur: 60 });
  });

  it('site premium: the weekend multipliers in force on the business date', async () => {
    expect((await getSite('HLT-026'))!.premium).toEqual({ sat: 1.5, sun: 2 });
    await db.insert(rateMultiplierRates).values({ key: 'sat', effectiveFrom: '2026-10-01', factor: 1.6 });
    try {
      // A future version does not apply yet (business date 25 Sep 2026).
      expect((await getSite('HLT-026'))!.premium).toEqual({ sat: 1.5, sun: 2 });
      expect(multiplierAt(await getRateGrid(), 'sat', '2026-10-01')).toBe(1.6);
    } finally {
      await db.delete(rateMultiplierRates).where(and(eq(rateMultiplierRates.key, 'sat'), eq(rateMultiplierRates.effectiveFrom, '2026-10-01')));
    }
  });
});

describe('R-178 · reference multipliers', () => {
  it('the backfill is a no-op on a seeded demo database (never overwrites an edited factor)', async () => {
    const count = async () => (await db.select({ n: sql<number>`count(*)::int` }).from(rateMultiplierRates))[0].n;
    const before = await count();
    expect(await db.transaction((tx) => seedRateMultipliers(tx))).toBe(0);
    expect(await count()).toBe(before);
  });

  it('production database: the five multipliers seeded from 1 Jan 2026, no rate role; the backfill adds a missing key only', async () => {
    const prod = await openDatabase(undefined, undefined, { seed: 'production' });
    const rows = await prod.select({ key: rateMultiplierRates.key, from: rateMultiplierRates.effectiveFrom, f: rateMultiplierRates.factor }).from(rateMultiplierRates);
    expect(rows.map((r) => [r.key, r.from, r.f]).sort()).toEqual([['night', '2026-01-01', 1.3], ['oncall', '2026-01-01', 0.35], ['ot', '2026-01-01', 1.25], ['sat', '2026-01-01', 1.5], ['sun', '2026-01-01', 2]]);
    expect((await prod.select({ n: sql<number>`count(*)::int` }).from(rateRoles))[0].n).toBe(0);
    // What the site premium and the what-if overtime factor read.
    const { readRateGrid } = await import('./hr');
    const grid = await readRateGrid(prod);
    expect([multiplierAt(grid, 'sat', '2026-09-25'), multiplierAt(grid, 'sun', '2026-09-25'), multiplierAt(grid, 'ot', '2026-09-25'), rateAt(grid, 'Planner', '2026-09-25')]).toEqual([1.5, 2, 1.25, null]);
    // An edited factor is kept; a deleted key comes back on the next open (production backfill).
    await prod.update(rateMultiplierRates).set({ factor: 1.4 }).where(eq(rateMultiplierRates.key, 'sat'));
    await prod.delete(rateMultipliers).where(eq(rateMultipliers.key, 'oncall'));
    expect(await seedIfEmpty(prod)).toBe(false);
    const after = await readRateGrid(prod);
    expect([multiplierAt(after, 'sat', '2026-09-25'), multiplierAt(after, 'oncall', '2026-09-25'), after.multipliers.length]).toEqual([1.4, 0.35, 5]);
  }, 60_000);
});
