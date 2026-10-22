// Owner answers 17 Oct 2026 ("What-if : OUI"): the what-if levelling has the load plans' previous / current / next
// navigation, and its horizon (`?week=`, the 8-week window) is carried through every action — lever toggles, auto-level, new
// scenario, Select → drafted requests — validated on the server; a horizon entirely in the past is read-only. Demo database
// (business date Fri 25 Sep 2026; current horizon 21 Sep – 15 Nov 2026).
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
const jar = new Map<string, string>();
vi.mock('next/headers', () => ({ cookies: async () => ({ get: (k: string) => (jar.has(k) ? { name: k, value: jar.get(k)! } : undefined) }) }));
vi.mock('next/navigation', () => ({
  usePathname: () => '/resources/what-if', useRouter: () => ({ push() {}, refresh() {} }), redirect: (u: string) => { throw new Error(`REDIRECT ${u}`); },
  notFound: () => { throw new Error('NOT_FOUND'); },
}));
vi.mock('next/cache', () => ({ revalidatePath() {} }));
import { and, eq } from 'drizzle-orm';
import { createElement, isValidElement, type ComponentType, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import WhatIfPage from '@/app/(app)/resources/what-if/page';
import { PERSONA_BY_ROLE } from '@/config/personas';
import { I18nProvider } from '@/i18n/client';
import { getDb, setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { projects, whatIfScenarios } from '@/server/db/schema';
import { listResourceRequests } from '@/server/dal/requests';
import { getWhatIf } from '@/server/dal/resources';
import { buildExportContext } from '@/server/export/run';
import { getExportProvider } from '@/server/export/registry';
import '@/server/export/providers';
import { COOKIE } from '@/server/session';
import { autoLevelWhatIf, createWhatIfScenario, selectWhatIfScenario, setWhatIfPriority, toggleWhatIfLever } from './actions';
import { WhatIfBoard } from './whatif-board';
import { WHATIF_PAST_HORIZON, type WhatIfData } from './whatif-model';

const RELIEF = 'extra_resource:A1250:julien-wagner';
const OVERTIME = 'overtime:A1250:steel-erection-crew';
const CREW = 'extra_resource:A1250:steel-erection-crew';
const PROTO_WEEKS = ['2026-09-28', '2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26', '2026-11-02', '2026-11-09', '2026-11-16'];

const as = (role: string, lang = 'en') => {
  jar.clear();
  jar.set(COOKIE.role, role);
  jar.set(COOKIE.lang, lang);
};
type Props = { primary?: ReactNode; children?: ReactNode; data?: WhatIfData; canEdit?: boolean; nav?: ReactNode; readOnlyReason?: string | null; horizon?: string };
const page = async (sp: Record<string, string>) => {
  const el = (await WhatIfPage({ searchParams: Promise.resolve(sp) })) as ReactElement<Props>;
  const [header, body] = (el.props.children as ReactElement<Props>[]).filter(isValidElement);
  return { header, body };
};
const Provider = I18nProvider as ComponentType<{ lang: 'en' | 'fr'; children?: ReactNode }>;
const html = (el: ReactElement, lang: 'en' | 'fr' = 'en') => renderToStaticMarkup(createElement(Provider, { lang }, el));
const on = (levers: Record<string, boolean>) => Object.keys(levers).filter((k) => levers[k]);
const scenario = async (name: string, horizon?: string) => (await getWhatIf('HLT-026', horizon))!.scenarios.find((s) => s.name === name)!;
const storedHorizon = async (name: string) => {
  const db = await getDb();
  const [row] = await db
    .select({ result: whatIfScenarios.result })
    .from(whatIfScenarios)
    .innerJoin(projects, eq(projects.id, whatIfScenarios.projectId))
    .where(and(eq(projects.code, 'HLT-026'), eq(whatIfScenarios.name, name)));
  return (row?.result as { horizonStart?: string } | null)?.horizonStart ?? null;
};

/** "Protect people" on the current horizon (named demo assignments, 18 Oct 2026): the reliefs and shifts of the overloaded people. */
/** "Meet the date": the overtime and extra units of the critical activities' driving assignments. */
const DATE = [OVERTIME, CREW, 'overtime:A1260:thomas-kerbrat', 'extra_resource:A1260:thomas-kerbrat', 'overtime:A1430:helene-sauvage', 'extra_resource:A1430:helene-sauvage'];
const PROTECT = [
  RELIEF, 'extra_resource:A1260:julien-wagner', 'extra_resource:A1320:amelie-ollivier', 'extra_resource:A1320:julien-wagner', 'extra_resource:A1320:thomas-kerbrat',
  'shift:A1320', 'extra_resource:A1330:julien-wagner', 'extra_resource:A1330:thomas-kerbrat', 'extra_resource:A1330:helene-sauvage', 'shift:A1330',
  'extra_resource:A1420:pauline-nogues', 'extra_resource:A1430:pauline-nogues', 'extra_resource:A1510:amelie-ollivier', 'extra_resource:A1510:thomas-kerbrat', 'extra_resource:A1520:amelie-ollivier', 'shift:A1520', // R-084 (absences): + A1520 relief
];

beforeAll(async () => {
  setDb(await openDatabase());
  // R-084: the loads come from the schedules — the named demo assignments (owner answer 18 Oct 2026).
}, 60_000);
beforeEach(() => as('director'));

describe('what-if horizon navigation (owner answers 17 Oct 2026)', () => {
  it('the page reads ?week= (validated): current horizon by default, the prototype horizon on ?week=2026-09-28, links kept on the project', async () => {
    const def = (await page({ project: 'HLT-026' })).body;
    expect(def.type).toBe(WhatIfBoard);
    expect([def.props.data!.horizon, def.props.data!.weekStarts[0], def.props.canEdit, def.props.readOnlyReason]).toEqual(['2026-09-21', '2026-09-21', true, null]);
    // R-084 (owner answer 17 Oct 2026, third round): the loads are the schedules' — with the named demo assignments (owner
    // answer 18 Oct 2026) the HLT-026 team above 100 % week by week. The seeded allocation rows gave [0, 0, 1, 2, 3, 2, 0, 1].
    // R-084 (absences): the seeded leave weeks lower capacity ([1, 0, 2, 3, 3, 3, 3, 1] before).
    expect(def.props.data!.overByWeek).toEqual([1, 1, 2, 3, 4, 4, 4, 2]);
    // The prototype's horizon (`?week=2026-09-28`) shifts the same profile by one week (its golden [0, 1, 2, 3, 2, 0, 1, 0] read
    // the seeded allocation rows, no longer read — R-084).
    const proto = (await page({ project: 'HLT-026', week: '2026-09-28' })).body;
    expect([proto.props.data!.horizon, proto.props.data!.weekStarts]).toEqual(['2026-09-28', PROTO_WEEKS]);
    expect(proto.props.data!.overByWeek).toEqual([1, 2, 3, 4, 4, 4, 2, 2]); // R-084 (absences): [0, 2, 3, 3, 3, 3, 1, 0] before
    expect((await page({ project: 'HLT-026', week: 'soon' })).body.props.data!.horizon).toBe('2026-09-21');
    const out = html(proto);
    for (const s of [
      'href="/resources/what-if?project=HLT-026"', 'href="/resources/what-if?project=HLT-026&amp;week=2026-10-05"', 'href="/resources/what-if?project=HLT-026&amp;week=2026-08-03"',
      'href="/resources/what-if?project=HLT-026&amp;week=2026-11-23"', 'Previous 8 weeks', 'Next 8 weeks', 'Sep 28 – Nov 16, 2026',
    ]) expect(out).toContain(s);
    // No view switch on the what-if: its horizon is always 8 weeks.
    expect(out).not.toContain('view=week');
    const { header } = await page({ project: 'HLT-026', week: '2026-11-16' });
    expect((header.props.primary as ReactElement<Props>).props.horizon).toBe('2026-11-16');
  });

  it('a horizon entirely in the past is read-only, with its reason; one that ends this week is not', async () => {
    const { header, body } = await page({ project: 'HLT-026', week: '2026-07-27' });
    expect([body.props.canEdit, body.props.readOnlyReason, header.props.primary]).toEqual([false, WHATIF_PAST_HORIZON, undefined]);
    expect(html(body)).toContain('These weeks are past');
    as('director', 'fr');
    expect(html((await page({ project: 'HLT-026', week: '2026-07-27' })).body, 'fr')).toContain('Ces semaines sont passées');
    as('director');
    expect((await page({ project: 'HLT-026', week: '2026-08-03' })).body.props.canEdit).toBe(true);
    // The actions refuse it too, and an invalid horizon (never a silent fallback to another one).
    expect(await toggleWhatIfLever('HLT-026', 'A', OVERTIME, '2026-07-27')).toEqual({ error: WHATIF_PAST_HORIZON });
    expect(await selectWhatIfScenario('HLT-026', 'A', '2026-07-27')).toEqual({ error: WHATIF_PAST_HORIZON });
    expect(await createWhatIfScenario('HLT-026', { name: 'Past' }, '2026-07-27')).toEqual({ error: WHATIF_PAST_HORIZON });
    for (const bad of ['2026-02-30', 'next', '2030-01-07']) expect(await autoLevelWhatIf('HLT-026', 'A', bad)).toEqual({ error: 'Invalid request' });
    expect(await storedHorizon('A')).toBeNull();
  });

  it('auto-level and lever toggles follow the horizon shown; another horizon\'s levers are kept', async () => {
    as('pm');
    // Priority "Protect people": the current horizon relieves Julien Wagner; from 16 Nov he is no longer overloaded — R-084 with
    // the named demo assignments (18 Oct 2026): nobody is, so nothing to protect.
    await setWhatIfPriority('HLT-026', 'B', 'people', '2026-11-16');
    expect(await autoLevelWhatIf('HLT-026', 'B', '2026-11-16')).toEqual({ ok: true });
    expect(on((await scenario('B', '2026-11-16')).levers)).toEqual([]);
    expect(await storedHorizon('B')).toBe('2026-11-16');
    expect(await autoLevelWhatIf('HLT-026', 'B')).toEqual({ ok: true });
    // The current horizon: the reliefs and shifts of the overloaded people (R-084, named demo assignments).
    expect(on((await scenario('B')).levers)).toEqual(PROTECT);
    expect(await storedHorizon('B')).toBe('2026-09-21');
    // A lever the horizon does not derive cannot be toggled there.
    expect(await toggleWhatIfLever('HLT-026', 'B', RELIEF, '2026-11-16')).toEqual({ error: 'The change could not be saved' });
    // Levelling on 16 Nov replaced that horizon's levers only: the relief chosen on the current horizon stays.
    await setWhatIfPriority('HLT-026', 'B', 'date', '2026-11-16');
    expect(await autoLevelWhatIf('HLT-026', 'B', '2026-11-16')).toEqual({ ok: true });
    expect(on((await scenario('B', '2026-11-16')).levers)).toEqual(DATE);
    // The current horizon keeps what only it derives (the relief of Julien Wagner on A1250, the shifts…) and gains the date levers.
    expect(on((await scenario('B')).levers)).toEqual(expect.arrayContaining([RELIEF, 'shift:A1320', 'shift:A1330', ...DATE]));
  });

  it('Select → drafted requests: the levers of the horizon shown (no relief request from 16 Nov)', async () => {
    as('pm');
    const r = await selectWhatIfScenario('HLT-026', 'A', '2026-11-16');
    expect(r).toMatchObject({ ok: true });
    const drafts = (await listResourceRequests({ projectCode: 'HLT-026', status: 'draft' })).map((q) => q.title).sort();
    // The contractor and overtime levers derived on that horizon (named demo assignments, 18 Oct 2026) — no relief of Julien Wagner.
    expect(drafts).toEqual([
      'Contract MEP lead — A1420 Lighting & power distribution', 'Contract crane operations — A1260 Roof decking', 'Extra resource 6 → 7 — Steel erection crew',
      'Overtime 10 → 12 h/d — Steel erection crew', 'Overtime 2.5 → 10 h/d — Pauline Noguès', 'Overtime 2.5 → 10 h/d — Thomas Kerbrat', 'Overtime 5 → 10 h/d — Hélène Sauvage',
    ]);
    expect(await storedHorizon('A')).toBe('2026-11-16');
  });

  it('the export follows the horizon of the page', async () => {
    const book = async (query: string) => {
      const ctx = await buildExportContext({ screen: 'whatif', viewer: PERSONA_BY_ROLE.director, lang: 'en', params: new URLSearchParams(query), now: new Date('2026-09-25T08:00:00Z') });
      return (await getExportProvider('whatif')!.table!(ctx))!;
    };
    const profile = async (query: string) => (await book(query)).sheets.find((x) => x.name === 'Peak load profile')!.rows.map((r) => r.week);
    expect(await profile('project=HLT-026&week=2026-09-28')).toEqual(PROTO_WEEKS);
    expect((await profile('project=HLT-026'))[0]).toBe('2026-09-21');
    expect((await profile('project=HLT-026&week=bogus'))[0]).toBe('2026-09-21');
  }, 60_000);
});
