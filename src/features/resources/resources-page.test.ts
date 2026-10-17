// Resources, Project resources and What-if pages (docs/spec/06 §0.1–§1, 05 §4): data loading from the seeded
// database, primary action and edit-control gating (outside the workspace, read-only project), empty states for
// projects without a team or a levelling context, and the rendered markup (EN/FR).
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
const jar = new Map<string, string>();
vi.mock('next/headers', () => ({ cookies: async () => ({ get: (k: string) => (jar.has(k) ? { name: k, value: jar.get(k)! } : undefined) }) }));
const redirected: string[] = [];
vi.mock('next/navigation', () => ({
  usePathname: () => '/resources', useRouter: () => ({ push() {}, refresh() {} }), redirect: (u: string) => void redirected.push(u), notFound: () => { throw new Error('NOT_FOUND'); },
}));
vi.mock('next/cache', () => ({ revalidatePath() {} }));
import { createElement, isValidElement, type ComponentType, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ProjectResourcesPage from '@/app/(app)/projects/[code]/resources/page';
import ResourcesPage from '@/app/(app)/resources/page';
import SkillsPage from '@/app/(app)/resources/skills/page';
import WhatIfPage from '@/app/(app)/resources/what-if/page';
import { NewRequestButton } from '@/features/requests/new-request-button';
import { I18nProvider } from '@/i18n/client';
import { setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { COOKIE } from '@/server/session';
import type { ResourcesView as View } from './model';
import { NewScenarioButton } from './new-scenario-button';
import { ResourcesView } from './resources-view';
import { WhatIfBoard } from './whatif-board';
import type { WhatIfData } from './whatif-model';

type Props = { projectParam?: string; primary?: ReactNode; children?: ReactNode; view?: View; canEdit?: boolean; projectName?: string; data?: WhatIfData; projectCode?: string; label?: string };
const parts = (el: unknown) => {
  const [header, body] = ((el as ReactElement<Props>).props.children as ReactElement<Props>[]).filter(isValidElement);
  return { header, body };
};
const as = (role: string, lang = 'en', project?: string) => {
  jar.clear();
  jar.set(COOKIE.role, role);
  jar.set(COOKIE.lang, lang);
  if (project) jar.set(COOKIE.project, project);
};
// Children passed as the third argument (react/no-children-prop); the provider's props type requires them.
const Provider = I18nProvider as ComponentType<{ lang: 'en' | 'fr'; children?: ReactNode }>;
const html = (body: ReactElement, lang: 'en' | 'fr' = 'en') => renderToStaticMarkup(createElement(Provider, { lang }, body));
const resources = async (sp: Record<string, string> = {}) => parts(await ResourcesPage({ searchParams: Promise.resolve(sp) }));
const presources = async (code: string, sp: Record<string, string> = {}) => parts(await ProjectResourcesPage({ params: Promise.resolve({ code }), searchParams: Promise.resolve(sp) }));
// R-085 (R-7 a): the screens show 8 weeks from the Monday of the business date's week (21 Sep 2026 on the demo date). The
// prototype's window — the seeded allocation weeks, 28 Sep – 16 Nov 2026 — is `?week=2026-09-28`: the tests that compare
// with the prototype's values pass it explicitly.
const PROTO = { week: '2026-09-28' };
const whatif = async (sp: Record<string, string> = {}) => parts(await WhatIfPage({ searchParams: Promise.resolve(sp) }));

beforeAll(async () => {
  setDb(await openDatabase());
}, 60_000);
beforeEach(() => as('director'));

describe('Resources page', () => {
  it('director: pool of 8, ROLES bars, open requests across projects, Request resource primary', async () => {
    const { header, body } = await resources(PROTO);
    expect(body.type).toBe(ResourcesView);
    const v = body.props.view!;
    expect(v.people.map((p) => p.name)).toEqual([
      'Amélie Ollivier', 'Julien Wagner', 'Pauline Noguès', 'Thomas Kerbrat', 'Léa Marchand', 'Damien Roux', 'Hélène Sauvage', 'Fabien Bertrand',
    ]);
    // A-12: unmet demand computed from the ROLES bars (prototype constant 240 h). R-086 (R-2 a): the labour cost of the
    // portfolio's projects in execution (A-3) of the displayed zone — all zones: 2 512 of 3 590 k€ (was the current project's €1.42M).
    expect(v.kpis.map((k) => k.value)).toEqual(['83%', '3 people', '280 h', '€2.51M', '4']);
    expect(v.kpis[3].sub).toBe('70% of labor budget · All zones');
    expect(v.roles.map((r) => r.text)).toEqual(['1110 / 960 h', '690 / 640 h', '510 / 480 h', '560 / 640 h', '370 / 320 h']);
    expect(body.props.canEdit).toBe(true);
    expect(body.props.projectName).toBeUndefined();
    const primary = header.props.primary as ReactElement<Props>;
    expect(primary.type).toBe(NewRequestButton);
    expect(primary.props.label).toBe('Request resource');
  });

  it('R-086 (R-2 a): labour cost of the displayed zone, whatever the last project used (no longer 06 OQ2)', async () => {
    as('director', 'en', 'NDC-031');
    expect((await resources()).body.props.view!.kpis[3]).toMatchObject({ value: '€2.51M', sub: '70% of labor budget · All zones' });
    // The zone chosen on the zone screens (ks-zone): EU/NA = HLT-026, RCF-019, ERP-202, MSR-012, PRS-038; Africa = NDC-031.
    jar.set(COOKIE.zone, 'euna');
    expect((await resources()).body.props.view!.kpis[3]).toMatchObject({ value: '€2.17M', sub: '75% of labor budget · Europe & North America' });
    jar.set(COOKIE.zone, 'afr');
    expect((await resources()).body.props.view!.kpis[3]).toMatchObject({ value: '€340k', sub: '49% of labor budget · Africa' });
    // No project in execution in the zone: no figure.
    jar.set(COOKIE.zone, 'apac');
    expect((await resources()).body.props.view!.kpis[3]).toMatchObject({ value: '—', sub: 'Asia Pacific' });
  });

  it('procurement and department head are in the workspace; the PM is outside (no primary, no Apply)', async () => {
    for (const role of ['procurement', 'depthead']) {
      as(role);
      const { header, body } = await resources();
      expect([role, body.props.canEdit, !!header.props.primary]).toEqual([role, true, true]);
    }
    as('pm');
    const { header, body } = await resources();
    expect(body.props.canEdit).toBe(false);
    expect(header.props.primary).toBeUndefined();
    expect(html(body)).not.toContain('>Apply<');
  });

  it('renders the heatmap, legend, capacity bars and suggestions (EN)', async () => {
    const out = html((await resources(PROTO)).body);
    for (const s of [
      // R-085: the prototype's window is not the current one — "8 weeks" and the window navigation.
      'Allocation — 8 weeks', 'Sep 28 – Nov 16, 2026', 'href="/resources?week=2026-10-05"',
      '% of available hours per person', 'Under', 'Over', 'Person', 'Avg', 'Sep 28', 'Nov 16', 'Open their work',
      'href="/my/tasks?person=Julien%20Wagner"', '--cell-bg:var(--color-accent-400);--cell-fg:var(--color-bg)', '>130<', '>101%<',
      'Capacity vs demand', 'Hours by role, next 8 weeks', 'Tick marks available capacity', '1110 / 960 h', 'Suggested rebalancing', '>Apply<',
      // R-3 / S-7: the suggestions are the portfolio's what-if levers (the prototype's three static sentences are gone).
      'Extra resource A1250 · Steel erection crew 6 → 7', 'Harbor Line · +1 d · +€2k', 'Contract structural engineer relieves Julien Wagner on A1250',
      'title="A1250 · Steel erection — Bays 3–4"',
    ])
      expect(out).toContain(s);
    expect(out.match(/role="row"/g)?.length).toBe(9);
    expect(out).not.toContain('Only people assigned to');
  });

  it('renders in French', async () => {
    as('director', 'fr');
    const out = html((await resources()).body, 'fr');
    // R-086: the portfolio's labour cost (all zones), named in French.
    for (const s of ['Affectation — 8 prochaines semaines', 'Taux d’occupation', '28 sept.', 'Moy.', 'Capacité vs demande', 'Ingénierie', 'Rééquilibrage suggéré', 'Appliquer', '2,51 M€', '70 % du budget main-d’œuvre · Toutes zones'])
      expect(out).toContain(s);
  });
});

describe('R-085 (R-7 a): load window of Resources and Project resources', () => {
  it('default: 8 weeks from the Monday of the business date week (21 Sep 2026), zero load where nothing is allocated', async () => {
    const v = (await resources()).body.props.view!;
    expect(v.weeks).toEqual(['Sep 21', 'Sep 28', 'Oct 5', 'Oct 12', 'Oct 19', 'Oct 26', 'Nov 2', 'Nov 9']);
    // The seeded allocations start on 28 Sep: the week of 21 Sep is empty; 16 Nov is one week further (Following week).
    expect(v.people.find((p) => p.name === 'Julien Wagner')!.cells.map((c) => c.v)).toEqual([0, 90, 100, 130, 125, 110, 100, 80]);
    // Team utilisation is the mean over the window: 75 % (83 % on the prototype's 28 Sep – 16 Nov); the rest is unchanged.
    expect(v.kpis.map((k) => [k.value, k.sub])).toEqual([
      ['75%', 'Target 85–95%'], ['3 people', 'Peak weeks 42–44'], ['280 h', 'Mostly engineering'], ['€2.51M', '70% of labor budget · All zones'], ['4', 'Across all projects'],
    ]);
  });

  it('renders the navigation: Current week is the bare screen, Previous / Following week slide one week', async () => {
    const out = html((await resources()).body);
    for (const s of [
      'Allocation — next 8 weeks', 'aria-label="Weeks shown"', 'href="/resources?week=2026-09-14"', 'aria-current="page" href="/resources"',
      'href="/resources?week=2026-09-28"', 'Sep 21 – Nov 9, 2026', '>Sep 21<', '>Nov 9<',
    ])
      expect(out).toContain(s);
    expect(out).not.toContain('>Nov 16<');
    as('director', 'fr');
    const fr = html((await resources()).body, 'fr');
    for (const s of ['Semaine précédente', 'Semaine en cours', 'Semaine suivante', '21 sept. – 9 nov. 2026', 'Affectation — 8 prochaines semaines']) expect(fr).toContain(s);
    as('director', 'fr');
    expect(html((await resources(PROTO)).body, 'fr')).toContain('Affectation — 8 semaines');
  });

  it('?week= is validated on the server: read as its Monday, malformed or out-of-bounds = the current window', async () => {
    const weeks = async (sp: Record<string, string>) => (await resources(sp)).body.props.view!.weeks;
    expect((await weeks({ week: '2026-10-01' }))[0]).toBe('Sep 28');
    for (const bad of ['2026-02-30', 'next', '2031-01-06', '<script>']) expect((await weeks({ week: bad }))[0]).toBe('Sep 21');
    // A window with no allocation at all: every load is 0 (no seeded week is invented).
    const far = (await resources({ week: '2027-03-01' })).body.props.view!;
    expect(far.weeks).toEqual(['Mar 1', 'Mar 8', 'Mar 15', 'Mar 22', 'Mar 29', 'Apr 5', 'Apr 12', 'Apr 19']);
    expect(far.people.every((p) => p.cells.every((c) => c.v === 0))).toBe(true);
  }, 30_000);

  it('Project resources: the team over the window, links on the project screen', async () => {
    const def = (await presources('HLT-026')).body;
    expect(def.props.view!.weeks[0]).toBe('Sep 21');
    expect(def.props.view!.kpis[2].sub).toBe('Next 8 weeks, by department');
    const out = html(def);
    expect(out).toContain('href="/projects/HLT-026/resources?week=2026-09-28"');
    expect(out).toContain('aria-current="page" href="/projects/HLT-026/resources"');
    expect((await presources('HLT-026', { week: '2026-11-16' })).body.props.view!.weeks).toEqual(['Nov 16', 'Nov 23', 'Nov 30', 'Dec 7', 'Dec 14', 'Dec 21', 'Dec 28', 'Jan 4']);
  });
});

describe('Project resources page', () => {
  it('HLT-026 (director): banner, team of 8, open requests 4, suggestions, primary for the project', async () => {
    const { header, body } = await presources('HLT-026', PROTO);
    const v = body.props.view!;
    expect(body.props.projectName).toBe('#026 · Harbor Line Terminal Expansion');
    expect(v.kpis.map((k) => [k.label, k.value, k.sub])).toEqual([
      ['Project team load', '83%', '8 people assigned'],
      ['Over-allocated', '3 people', 'Peak weeks 42–44'],
      ['Unmet demand', '0 h', '8 weeks, by department'], // R-085: not the current window
      ['Labor cost to date', '€1.42M', '77% of labor budget'],
      ['Open requests', '4', 'Awaiting department approval'],
    ]);
    // The project's own levers that become a request (S-7); no project label on Project resources.
    expect(v.suggestions!.map((g) => [g.leverCode, g.impact, g.canApply])).toEqual([
      ['extra_resource:A1250:steel-erection-crew', '+1 d · +€2k', true],
      ['overtime:A1250:steel-erection-crew', '+1 d · +€5k', true],
      // 44 h × (118 − 85) € = 1.5 k€ → +€2k. R-085: the suggestions use the what-if horizon, the current window (21 Sep –
      // 15 Nov, whatever `?week=`): all 44 h of the relief fall inside it (−40 h on the seeded 28 Sep – 22 Nov window).
      ['extra_resource:A1250:julien-wagner', '+€2k · load −44 h', true],
    ]);
    const primary = header.props.primary as ReactElement<Props>;
    expect([primary.type, primary.props.projectCode]).toEqual([NewRequestButton, 'HLT-026']);
    const out = html(body);
    expect(out).toContain('Only people assigned to <span');
    expect(out).toContain('— the whole pool is under Resource management.');
  });

  it('NDC-031: PEOPLE order, derived department bars, no suggestions, no open request', async () => {
    const v = (await presources('NDC-031', PROTO)).body.props.view!;
    expect(v.people.map((p) => p.name)).toEqual(['Pauline Noguès', 'Léa Marchand', 'Damien Roux', 'Fabien Bertrand']);
    expect(v.roles.map((r) => [r.name, r.text])).toEqual([['MEP', '314 / 320 h'], ['Controls & planning', '717 / 960 h']]);
    expect(v.kpis.map((k) => k.value)).toEqual(['80%', '1 person', '0 h', '€340k', '0']);
    expect(v.suggestions).toBeNull();
  });

  it('RCF-019: 3 h unmet demand (Site operations 323 / 320 h)', async () => {
    const v = (await presources('RCF-019', PROTO)).body.props.view!;
    expect(v.kpis[2].value).toBe('3 h');
    expect(v.roles[0]).toMatchObject({ name: 'Site operations', text: '323 / 320 h' });
  });

  it('project without a team: empty heatmap, zero KPIs (never Harbor Line data)', async () => {
    const { body } = await presources('EWA-051');
    const v = body.props.view!;
    expect(v.people).toEqual([]);
    expect(v.kpis.map((k) => k.value)).toEqual(['0%', '0 people', '0 h', '—', '0']);
    const out = html(body);
    expect(out).toContain('No one is assigned to this project yet');
    expect(out).toContain('No department to compare yet');
    expect(out).not.toContain('Tick marks available capacity');
  });

  it('PM: own project editable; another PM’s project read-only (no primary, no Apply)', async () => {
    as('pm');
    const own = await presources('HLT-026');
    expect([own.body.props.canEdit, !!own.header.props.primary]).toEqual([true, true]);
    const other = await presources('NDC-031');
    expect([other.body.props.canEdit, other.header.props.primary]).toEqual([false, undefined]);
  });

  it('department head is outside Project resources: read-only', async () => {
    as('depthead');
    const { header, body } = await presources('HLT-026');
    expect([body.props.canEdit, header.props.primary]).toEqual([false, undefined]);
    expect(html(body)).not.toContain('>Apply<');
  });

  it('unknown project → 404', async () => {
    await expect(presources('XXX-000')).rejects.toThrow('NOT_FOUND');
  });
});

describe('What-if page', () => {
  it('without ?project= it redirects to the viewer\'s current project; the header shows that project with its switcher', async () => {
    redirected.length = 0;
    await whatif();
    as('director', 'en', 'NDC-031');
    await whatif();
    expect(redirected).toEqual(['/resources/what-if?project=HLT-026', '/resources/what-if?project=NDC-031']);
    redirected.length = 0;
    const { header, body } = await whatif({ project: 'NDC-031' });
    expect([redirected, header.props.projectParam, body.props.data!.projectCode]).toEqual([[], 'NDC-031', 'NDC-031']);
    // A project without a plan keeps the switcher so the viewer can pick another one.
    expect((await whatif({ project: 'EWA-051' })).header.props.projectParam).toBe('EWA-051');
  });

  it('director: HLT-026 levelling with levers derived from the data and engine results (S-7), New scenario primary', async () => {
    const { header, body } = await whatif();
    expect(body.type).toBe(WhatIfBoard);
    const d = body.props.data!;
    // R-085 (R-7 a): the horizon starts on the Monday of the business date's week (was the seeded 28 Sep).
    expect([d.projectCode, d.dataDate, d.weekStarts[0], d.weeks[0]]).toEqual(['HLT-026', '2026-09-25', '2026-09-21', 'Sep 21']);
    expect(d.plan).toEqual({ forecastFinish: '2027-01-14', floatDays: -27 });
    expect(d.baseline).toEqual({ code: 'BL1', finish: '2026-12-18' });
    expect(d.peak).toEqual({ pct: 130, person: 'Julien Wagner', weekStart: '2026-10-12' });
    expect(d.overByWeek).toEqual([0, 0, 1, 2, 3, 2, 0, 1]); // R-085: one week earlier (21 Sep has no allocation)
    expect(d.levers.map((l) => [l.code, l.from, l.to, l.helper, l.effect.daysGained, l.effect.costKeur])).toEqual([
      ['extra_resource:A1250:julien-wagner', 1, 2, { kind: 'external', name: 'Contract structural engineer' }, 0, 1.5],
      ['overtime:A1250:steel-erection-crew', 10, 12, null, 1, 4.5],
      ['extra_resource:A1250:steel-erection-crew', 6, 7, { kind: 'same', name: 'Steel erection crew' }, 1, 1.8],
    ]);
    // The current plan rescheduled on a copy: finish 18 Jan 2027, float −19 working days (S-1, S-8).
    // R-085: the peak bars follow the horizon (21 Sep – 9 Nov): 0 for the week of 21 Sep, the week of 16 Nov (100) leaves it.
    expect([d.current.finish, d.current.floatDays, d.current.peakPct, d.current.bars]).toEqual(['2027-01-18', -19, 130, [0, 100, 110, 130, 125, 115, 100, 110]]);
    expect(d.scenarios.map((s) => [s.name, s.priority, s.selected, Object.keys(s.levers).filter((k) => s.levers[k])])).toEqual([
      ['A', 'date', false, ['extra_resource:A1250:julien-wagner', 'overtime:A1250:steel-erection-crew', 'extra_resource:A1250:steel-erection-crew']],
      ['B', 'people', false, []],
    ]);
    expect(d.auto).toEqual({ date: ['overtime:A1250:steel-erection-crew', 'extra_resource:A1250:steel-erection-crew'], budget: [], people: ['extra_resource:A1250:julien-wagner'] });
    expect(body.props.canEdit).toBe(true);
    const primary = header.props.primary as ReactElement<Props>;
    expect(primary.type).toBe(NewScenarioButton);
  });

  it('renders KPI tiles, scenario cards and the side-by-side table with the current plan (EN)', async () => {
    const out = html((await whatif()).body);
    for (const s of [
      'Baseline finish', '18 Dec 2026', 'BL1 · forecast 14 Jan 2027 · float −27 d', 'Julien Wagner · week of 12 Oct', 'Week 43', 'Scenario A', 'Scenario B',
      'Priority (set by the PM)', 'Protect date', 'Auto-level for this priority', 'Overtime A1250 · Steel erection crew 10 → 12 h/d', '+1 d · +€5k',
      'Contract structural engineer relieves Julien Wagner on A1250', 'Peak load by week', 'Current plan', '18 Jan 2027', '13 Jan 2027', '−19 days', '−16 days',
      'Pauline Noguès above 100% · week of 12 Oct', 'Select scenario → create requests', 'Side by side', 'Indicator', 'copy of the plan at the data date (25 Sep 2026)',
      'Rename scenario — Scenario A', 'Delete scenario — Scenario B',
    ])
      expect(out).toContain(s);
    expect(out.match(/aria-pressed="true"/g)?.length).toBe(2 + 3); // selected priority × 2 + enabled levers of A × 3
  });

  it('renders in French', async () => {
    as('director', 'fr');
    const out = html((await whatif()).body, 'fr');
    for (const s of ['Fin de référence', 'BL1 · prévision 14 janv. 2027 · marge −27 j', 'Semaine 43', 'Heures sup. A1250 · Steel erection crew 10 → 12 h/j', 'Plan actuel', '−19 jours'])
      expect(out).toContain(s);
  });

  it('PM owns HLT-026: editable; the member is outside: read-only cards without controls', async () => {
    as('pm');
    expect((await whatif()).body.props.canEdit).toBe(true);
    as('member');
    const { header, body } = await whatif();
    expect([body.props.canEdit, header.props.primary]).toEqual([false, undefined]);
    const out = html(body);
    expect(out).not.toContain('Auto-level for this priority');
    expect(out).not.toContain('Select scenario → create requests');
    expect(out).not.toContain('Rename scenario');
    expect(out).toContain('role="checkbox" aria-checked="true"');
  });

  it('any project with a plan has a what-if (S-7); a project without activities shows an empty state', async () => {
    const ndc = (await whatif({ project: 'NDC-031' })).body.props.data!;
    expect([ndc.projectCode, ndc.levers, ndc.scenarios, ndc.current.finish]).toEqual(['NDC-031', [], [], '2027-04-09']);
    expect(html((await whatif({ project: 'NDC-031' })).body)).toContain('No scenario yet — create one with New scenario.');
    const { header, body } = await whatif({ project: 'EWA-051' });
    expect(header.props.primary).toBeUndefined();
    expect(html(body)).toContain('No levelling scenario for this project');
    expect(html((await whatif({ project: 'nope' })).body)).toContain('No levelling scenario for this project');
  });
});

describe('Skills page — "Open requests needing level ≥4" computed (A-12)', () => {
  it('pending requests naming an expert: RQ-041 (Structural), RQ-042 (Quality), RQ-044 (Procurement); the prototype showed "2 · Structural · Quality"', async () => {
    const { body } = parts(await SkillsPage({ searchParams: Promise.resolve({}) }));
    const view = (body.props.children as ReactElement<{ expertRequests?: unknown }>);
    expect(view.props.expertRequests).toEqual({ count: 3, skills: ['Structural', 'Procurement', 'Quality / QA-QC'] });
    expect(html(body)).toContain('Structural · Procurement · Quality / QA-QC');
    as('director', 'fr');
    const fr = parts(await SkillsPage({ searchParams: Promise.resolve({}) })).body;
    expect(html(fr, 'fr')).toContain('Structure · Achats · Qualité / QA-QC');
  });
});
