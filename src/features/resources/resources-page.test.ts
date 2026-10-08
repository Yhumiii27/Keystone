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
    expect(v.kpis.map((k) => k.value)).toEqual(['83%', '3 people', '240 h', '€1.42M', '4']);
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
      'Recovers ~12 days float · +€18k',
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
      ['Over-allocated', '3 people', 'Peak weeks 41–43'],
      ['Unmet demand', '0 h', 'Next 8 weeks, by department'],
      ['Labor cost to date', '€1.42M', '77% of labor budget'],
      ['Open requests', '4', 'Awaiting department approval'],
    ]);
    expect(v.suggestions).toHaveLength(3);
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
  it('director: HLT-026 levelling with the DAL base figures, New scenario primary', async () => {
    const { header, body } = await whatif();
    expect(body.type).toBe(WhatIfBoard);
    const d = body.props.data!;
    expect(d.projectCode).toBe('HLT-026');
    expect(d.base).toEqual({ floatDays: -27, forecastFinish: '2027-01-14', peakPct: 130, overPeople: 3, baseLoad: [100, 110, 130, 125, 110, 100, 80, 60] });
    expect(d.baseline).toEqual({ code: 'BL1', finish: '2026-12-18' });
    expect(d.peak).toEqual({ pct: 130, person: 'Julien Wagner', weekStart: '2026-10-12' });
    expect(d.scenarios.map((s) => [s.name, s.priority, s.selected, Object.keys(s.levers).filter((k) => s.levers[k])])).toEqual([
      ['A', 'date', false, ['contractor', 'overtime']],
      ['B', 'people', false, ['delay', 'move']],
    ]);
    expect(body.props.canEdit).toBe(true);
    const primary = header.props.primary as ReactElement<Props>;
    expect(primary.type).toBe(NewScenarioButton);
  });

  it('renders KPI tiles, two scenario cards and the side-by-side table (EN)', async () => {
    const out = html((await whatif()).body);
    for (const s of [
      'Forecast finish', '14 Jan 2027', 'BL1 18 Dec 2026 · float −27 d', 'Julien Wagner · week of 12 Oct', 'Scenario A', 'Scenario B',
      'Priority (set by the PM)', 'Protect date', 'Auto-level for this priority', '+12 d · +€18k · peak −20 pts', 'Peak load by week',
      '25 Dec 2026', '8 Jan 2027', '−7 days', '−21 days', '+€27k', 'Westfield SPI −0.02', 'Select scenario → create requests', 'Side by side', 'Indicator',
    ])
      expect(out).toContain(s);
    expect(out).not.toContain('Baseline finish');
    expect(out.match(/aria-pressed="true"/g)?.length).toBe(2 + 4); // selected priority × 2 + enabled levers × 4
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
    expect(out).toContain('role="checkbox" aria-checked="true"');
  });

  it('a project without levelling context shows an empty state', async () => {
    const { header, body } = await whatif({ project: 'EWA-051' });
    expect(header.props.primary).toBeUndefined();
    expect(html(body)).toContain('No levelling scenario for this project');
    expect(html((await whatif({ project: 'nope' })).body)).toContain('No levelling scenario for this project');
  });
});
