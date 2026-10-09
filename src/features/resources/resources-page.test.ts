// Resources, Project resources and What-if pages (docs/spec/06 §0.1–§1, 05 §4): data loading from the seeded
// database, primary action and edit-control gating (outside the workspace, read-only project), empty states for
// projects without a team or a levelling context, and the rendered markup (EN/FR).
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
const jar = new Map<string, string>();
vi.mock('next/headers', () => ({ cookies: async () => ({ get: (k: string) => (jar.has(k) ? { name: k, value: jar.get(k)! } : undefined) }) }));
vi.mock('next/navigation', () => ({ usePathname: () => '/resources', useRouter: () => ({ push() {}, refresh() {} }), redirect() {}, notFound: () => { throw new Error('NOT_FOUND'); } }));
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

type Props = { primary?: ReactNode; children?: ReactNode; view?: View; canEdit?: boolean; projectName?: string; data?: WhatIfData; projectCode?: string; label?: string };
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
const resources = async () => parts(await ResourcesPage());
const presources = async (code: string) => parts(await ProjectResourcesPage({ params: Promise.resolve({ code }) }));
const whatif = async (sp: Record<string, string> = {}) => parts(await WhatIfPage({ searchParams: Promise.resolve(sp) }));

beforeAll(async () => {
  setDb(await openDatabase());
}, 60_000);
beforeEach(() => as('director'));

describe('Resources page', () => {
  it('director: pool of 8, ROLES bars, open requests across projects, Request resource primary', async () => {
    const { header, body } = await resources();
    expect(body.type).toBe(ResourcesView);
    const v = body.props.view!;
    expect(v.people.map((p) => p.name)).toEqual([
      'Amélie Ollivier', 'Julien Wagner', 'Pauline Noguès', 'Thomas Kerbrat', 'Léa Marchand', 'Damien Roux', 'Hélène Sauvage', 'Fabien Bertrand',
    ]);
    // A-12: unmet demand computed from the ROLES bars (prototype constant 240 h).
    expect(v.kpis.map((k) => k.value)).toEqual(['83%', '3 people', '280 h', '€1.42M', '4']);
    expect(v.roles.map((r) => r.text)).toEqual(['1110 / 960 h', '690 / 640 h', '510 / 480 h', '560 / 640 h', '370 / 320 h']);
    expect(body.props.canEdit).toBe(true);
    expect(body.props.projectName).toBeUndefined();
    const primary = header.props.primary as ReactElement<Props>;
    expect(primary.type).toBe(NewRequestButton);
    expect(primary.props.label).toBe('Request resource');
  });

  it('labour cost follows the last project used (06 OQ2); none for a project without data', async () => {
    as('director', 'en', 'NDC-031');
    expect((await resources()).body.props.view!.kpis[3]).toMatchObject({ value: '€340k', sub: '49% of labor budget' });
    as('director', 'en', 'EWA-051');
    expect((await resources()).body.props.view!.kpis[3]).toMatchObject({ value: '—', sub: '' });
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
    const out = html((await resources()).body);
    for (const s of [
      'Allocation — next 8 weeks', '% of available hours per person', 'Under', 'Over', 'Person', 'Avg', 'Sep 28', 'Nov 16', 'Open their work',
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
    for (const s of ['Affectation — 8 prochaines semaines', 'Taux d’occupation', '28 sept.', 'Moy.', 'Capacité vs demande', 'Ingénierie', 'Rééquilibrage suggéré', 'Appliquer', '1,42 M€'])
      expect(out).toContain(s);
  });
});

describe('Project resources page', () => {
  it('HLT-026 (director): banner, team of 8, open requests 4, suggestions, primary for the project', async () => {
    const { header, body } = await presources('HLT-026');
    const v = body.props.view!;
    expect(body.props.projectName).toBe('#026 · Harbor Line Terminal Expansion');
    expect(v.kpis.map((k) => [k.label, k.value, k.sub])).toEqual([
      ['Project team load', '83%', '8 people assigned'],
      ['Over-allocated', '3 people', 'Peak weeks 42–44'],
      ['Unmet demand', '0 h', 'Next 8 weeks, by department'],
      ['Labor cost to date', '€1.42M', '77% of labor budget'],
      ['Open requests', '4', 'Awaiting department approval'],
    ]);
    // The project's own levers that become a request (S-7); no project label on Project resources.
    expect(v.suggestions!.map((g) => [g.leverCode, g.impact, g.canApply])).toEqual([
      ['extra_resource:A1250:steel-erection-crew', '+1 d · +€2k', true],
      ['overtime:A1250:steel-erection-crew', '+1 d · +€5k', true],
      ['extra_resource:A1250:julien-wagner', '+€2k · load −40 h', true], // 44 h × (118 − 85) € = 1.5 k€ → +€2k
    ]);
    const primary = header.props.primary as ReactElement<Props>;
    expect([primary.type, primary.props.projectCode]).toEqual([NewRequestButton, 'HLT-026']);
    const out = html(body);
    expect(out).toContain('Only people assigned to <span');
    expect(out).toContain('— the whole pool is under Resource management.');
  });

  it('NDC-031: PEOPLE order, derived department bars, no suggestions, no open request', async () => {
    const v = (await presources('NDC-031')).body.props.view!;
    expect(v.people.map((p) => p.name)).toEqual(['Pauline Noguès', 'Léa Marchand', 'Damien Roux', 'Fabien Bertrand']);
    expect(v.roles.map((r) => [r.name, r.text])).toEqual([['MEP', '314 / 320 h'], ['Controls & planning', '717 / 960 h']]);
    expect(v.kpis.map((k) => k.value)).toEqual(['80%', '1 person', '0 h', '€340k', '0']);
    expect(v.suggestions).toBeNull();
  });

  it('RCF-019: 3 h unmet demand (Site operations 323 / 320 h)', async () => {
    const v = (await presources('RCF-019')).body.props.view!;
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
  it('director: HLT-026 levelling with levers derived from the data and engine results (S-7), New scenario primary', async () => {
    const { header, body } = await whatif();
    expect(body.type).toBe(WhatIfBoard);
    const d = body.props.data!;
    expect([d.projectCode, d.dataDate, d.weekStarts[0], d.weeks[0]]).toEqual(['HLT-026', '2026-09-25', '2026-09-28', 'Sep 28']);
    expect(d.plan).toEqual({ forecastFinish: '2027-01-14', floatDays: -27 });
    expect(d.baseline).toEqual({ code: 'BL1', finish: '2026-12-18' });
    expect(d.peak).toEqual({ pct: 130, person: 'Julien Wagner', weekStart: '2026-10-12' });
    expect(d.overByWeek).toEqual([0, 1, 2, 3, 2, 0, 1, 0]);
    expect(d.levers.map((l) => [l.code, l.from, l.to, l.helper, l.effect.daysGained, l.effect.costKeur])).toEqual([
      ['extra_resource:A1250:julien-wagner', 1, 2, { kind: 'external', name: 'Contract structural engineer' }, 0, 1.5],
      ['overtime:A1250:steel-erection-crew', 10, 12, null, 1, 4.5],
      ['extra_resource:A1250:steel-erection-crew', 6, 7, { kind: 'same', name: 'Steel erection crew' }, 1, 1.8],
    ]);
    // The current plan rescheduled on a copy: finish 18 Jan 2027, float −19 working days (S-1, S-8).
    expect([d.current.finish, d.current.floatDays, d.current.peakPct, d.current.bars]).toEqual(['2027-01-18', -19, 130, [100, 110, 130, 125, 115, 100, 110, 100]]);
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
