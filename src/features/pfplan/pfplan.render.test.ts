// Portfolio schedule (docs/spec/05 §3) on a seeded in-memory database: the DAL rows (`getPortfolioSchedule`) through
// the domain model must reproduce the prototype's own render values (src/domain/pfplan.golden.json, EN and FR, every
// zone); then the page and its body are rendered to static markup (filter links, zone notice, row links, today line,
// read-only for every persona).
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
const jar = new Map<string, string>();
vi.mock('next/headers', () => ({ cookies: async () => ({ get: (k: string) => (jar.has(k) ? { name: k, value: jar.get(k)! } : undefined) }) }));
vi.mock('next/navigation', () => ({ usePathname: () => '/portfolio/schedule', useRouter: () => ({ push() {}, prefetch() {}, refresh() {} }), redirect() {}, notFound() {} }));
import { createElement as h, isValidElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import PortfolioSchedulePage from '@/app/(app)/portfolio/schedule/page';
import { canSee, type RoleKey } from '@/config/screens';
import { portfolioScheduleModel, type PgFilter, type PgRow } from '@/domain/pfplan';
import golden from '@/domain/pfplan.golden.json';
import { makeT, type Lang } from '@/i18n/translate';
import { setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { getPortfolioSchedule } from '@/server/dal/pipeline';
import { COOKIE, type ZoneKey } from '@/server/session';
import { PfPlanBody } from './view';

/* eslint-disable @typescript-eslint/no-explicit-any */
const G = golden as any;
const ZONES: (ZoneKey | null)[] = [null, 'euna', 'afr', 'apac'];
const TINT = { lo: 'var(--color-accent-300)', n400: 'var(--color-neutral-400)' };
const KPI_TINT = { ok: 'var(--color-text)', n200: 'var(--color-neutral-200)', lo: 'var(--color-accent-300)' };
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/\s+/g, ' ');

/** Prototype row fields that the DAL data drives (geometry, gates, labels, titles), rebuilt from the model. */
const rowView = (r: PgRow, t: (s: string) => string) => ({
  code: r.code, name: t(`${r.displayId} · ${r.name}`), pm: t(r.pmLine), status: t(r.status), pipe: r.pipeline,
  segs: r.segments.map((s) => (s.kind === 'diamond' ? { left: s.left, title: t(s.title), diamond: true } : { left: s.left, width: s.width, title: t(s.title), label: s.kind === 'stage' ? t(s.label) : '' })),
  hasExec: !!r.exec, exL: r.exec?.left ?? '0', exW: r.exec?.width ?? '0', exFill: r.exec?.fill, hasBase: !!r.baseline, ...(r.baseline ? { bL: r.baseline.left, bW: r.baseline.width } : {}),
  clipText: t(r.clipText), gate: t(r.gate), gateSub: t(r.gateSub), gateColor: TINT[r.gateTint],
});
const goldenView = (g: any) => ({
  code: g.code, name: g.name, pm: g.pm, status: g.status, pipe: g.pipe,
  segs: g.segs.map((s: any) => (s.diamond ? { left: s.left, title: s.title, diamond: true } : { left: s.left, width: s.width, title: s.title, label: s.label })),
  hasExec: g.hasExec, exL: g.exL, exW: g.exW, exFill: g.exFill, hasBase: g.hasBase, ...(g.hasBase ? { bL: g.bL, bW: g.bW } : {}),
  clipText: g.clipText, gate: g.gate, gateSub: g.gateSub, gateColor: g.gateColor,
});

beforeAll(async () => {
  setDb(await openDatabase());
}, 60_000);

describe.each(['en', 'fr'] as Lang[])('portfolio schedule on the database vs prototype (%s)', (lang) => {
  const t = makeT(lang);
  it.each(ZONES)('zone %s: KPI tiles, groups, filters and rows', async (zone) => {
    const gz = G[lang].zones[String(zone)];
    const data = await getPortfolioSchedule(zone);
    const model = portfolioScheduleModel(data, { filter: 'all', lang });
    expect(model.kpis.map((k) => ({ label: t(k.label), value: t(k.value), sub: t(k.sub), color: KPI_TINT[k.tint] }))).toEqual(
      gz.kpis.map((k: any) => ({ ...k, value: String(k.value) })),
    );
    expect(model.groups.map((g) => ({ key: g.key, label: t(g.label), count: g.count, codes: g.rows.map((r) => r.code) }))).toEqual(gz.groups);
    for (const f of ['all', 'exec', 'pipe'] as PgFilter[]) expect(portfolioScheduleModel(data, { filter: f, lang }).groups.map((g) => g.key)).toEqual(gz.filters[f]);
    for (const r of model.groups.flatMap((g) => g.rows)) expect(rowView(r, t)).toEqual(goldenView(G[lang].rows[r.code]));
    expect([model.empty, gz.zoneEmpty]).toEqual([false, false]);
  });
});

describe('portfolio schedule body', () => {
  it('French: header, legend, KPI tiles, groups, row links, gates, clip and today line', async () => {
    const t = makeT('fr');
    const model = portfolioScheduleModel(await getPortfolioSchedule(null), { filter: 'all', lang: 'fr' });
    const html = renderToStaticMarkup(h(PfPlanBody, { model, filter: 'all', zoneSelected: false, t }));
    const txt = text(html);
    for (const s of [
      'Étape', 'Tous', 'En cours', 'Pipeline', 'Projets en cours', '14,35 M€', 'Projets dans le pipe', '13,08 M€', 'Décisions groupe en attente', 'EWA-051',
      'Attente moyenne du board', '28 j', 'cible 3 semaines', 'Planning du portefeuille',
      'Une ligne par projet · exécution en couleur, pipe (Initiative → APS → APD) en gris, hachuré pendant la décision du groupe',
      'Décision groupe en attente', 'Board groupe', 'Exécution si validé', 'Fin de référence', 'Projet', 'Statut', 'Prochaine décision / Fin',
      'janv.', '2026', '2027', '#026 · Extension du terminal Harbor Line', 'R. Aubert · Autorité portuaire', 'Fabrication & Assemblage',
      '14 janv. 2027', '−27 j', 'Mise en service & SAT', 'fin non planifiée', 'Board groupe → APS', 'Décision en attente · 8 j', 'Board groupe → Exécution',
      '12 nov.', '→ août 2028', 'sept. 2026', '+4 j',
      // Deliberate deviation (Delivery 1): the project name is translated on its own, so "ERP Migration — Phase 2" is French.
      '#032 · Migration ERP — Phase 2',
    ])
      expect(txt).toContain(s);
    expect(txt).not.toContain('Aucun projet dans cette zone');
    // Projects with planning data open their Plan; the others open the Projects register searched by code.
    for (const c of ['HLT-026', 'NDC-031', 'RCF-019', 'ERP-202', 'MSR-012', 'WSA-044']) expect(html).toContain(`href="/projects/${c}/plan"`);
    for (const c of ['PRS-038', 'ALP-021', 'EWA-051', 'FTU-052', 'RBR-048', 'CER-047']) expect(html).toContain(`href="/portfolio/projects?q=${c}"`);
    expect(html).toContain('href="/portfolio/schedule?filter=exec"');
    expect(html).toContain('href="/portfolio/schedule?filter=pipe"');
    expect(html).toContain('href="/portfolio/schedule"');
    expect(html.match(/left:37\.38%/g)?.length).toBe(12);
    expect(html).toContain('title="Board groupe · Décision en attente"');
    expect(html).toContain('title="Board groupe · Approuvé"');
    expect(html).toContain('title="Board groupe · Planifié"');
    expect(html).toContain('>INI<');
  });

  it('pipeline filter keeps the KPI tiles over every row and shows the Pipeline group only', async () => {
    const t = makeT('en');
    const model = portfolioScheduleModel(await getPortfolioSchedule(null), { filter: 'pipe', lang: 'en' });
    const txt = text(renderToStaticMarkup(h(PfPlanBody, { model, filter: 'pipe', zoneSelected: false, t })));
    expect(txt).toContain('Projects in progress 7 €14.35M');
    expect(txt).toContain('Pipeline 5');
    expect(txt).not.toContain('Harbor Line Terminal Expansion');
    expect(txt).toContain('Ridgeway Bridge Rehabilitation');
  });

  it('a zone without live project shows the notice (empty tiles, no rows)', async () => {
    const data = { rows: [], averageBoardWaitDays: 28 };
    const txt = text(renderToStaticMarkup(h(PfPlanBody, { model: portfolioScheduleModel(data, { filter: 'all', lang: 'en' }), filter: 'all', zoneSelected: true, t: makeT('en') })));
    expect(txt).toContain('No project in this zone for this view');
    expect(txt).toContain('Projects in progress 0 €0k');
    expect(txt).toContain('Group decisions pending 0 —');
  });
});

describe('portfolio schedule page', () => {
  const as = (role: string, lang = 'en', zone?: string) => {
    jar.clear();
    jar.set(COOKIE.role, role);
    jar.set(COOKIE.lang, lang);
    if (zone) jar.set(COOKIE.zone, zone);
  };
  type Props = { model: ReturnType<typeof portfolioScheduleModel>; filter: PgFilter; zoneSelected: boolean; primary?: unknown; screen?: string };
  const page = async (sp: Record<string, string> = {}) => {
    const el = (await PortfolioSchedulePage({ searchParams: Promise.resolve(sp) })) as ReactElement<{ children: ReactElement<Props>[] }>;
    const [header, body] = el.props.children.filter(isValidElement);
    return { header, body };
  };
  beforeEach(() => as('director'));

  it('no primary action for anyone; the zone cookie filters the rows; ?filter= picks the groups', async () => {
    const { header, body } = await page();
    expect(header.props.screen).toBe('pfplan');
    expect(header.props.primary).toBeUndefined();
    expect(body.type).toBe(PfPlanBody);
    expect([body.props.filter, body.props.zoneSelected, body.props.model.groups.map((g) => g.count)]).toEqual(['all', false, [7, 5]]);
    as('pm', 'fr', 'afr');
    const afr = await page({ filter: 'exec' });
    expect([afr.body.props.filter, afr.body.props.zoneSelected, afr.body.props.model.groups.map((g) => g.rows.map((r) => r.code))]).toEqual(['exec', true, [['NDC-031']]]);
    expect(afr.body.props.model.kpis[1].sub).toBe('2,20 M€');
  });

  it('unknown ?filter= falls back to All; outside personas render the same read-only screen', async () => {
    as('quality');
    const { header, body } = await page({ filter: 'bogus' });
    expect(body.props.filter).toBe('all');
    expect(header.props.primary).toBeUndefined();
    expect(body.props.model.groups.map((g) => g.key)).toEqual(['exec', 'pipe']);
  });

  it('outside-my-workspace banner for every persona but the director and the PM (prototype `outside`, ROLE_SCREENS)', () => {
    const roles: RoleKey[] = ['director', 'pm', 'depthead', 'member', 'englead', 'quality', 'procurement', 'client'];
    expect(Object.fromEntries(roles.map((r) => [r, !canSee(r, 'pfplan')]))).toEqual({
      director: false, pm: false, depthead: true, member: true, englead: true, quality: true, procurement: true, client: true,
    });
  });
});
