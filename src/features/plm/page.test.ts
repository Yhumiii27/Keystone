// Page wiring of /reference/parts and of the shared <PartDrawer/> (seeded in-memory database, mocked session): URL
// state parsing, the primary action and "Register equivalent" per persona (outside-workspace rule), the drawer opened
// by `?part=` (unknown references render nothing), and a static render of the catalogue and of the drawer body in EN
// and FR (the client Drawer is replaced by a plain container, it renders through a portal after hydration).
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const session = { role: 'director' as string, lang: 'en' as 'en' | 'fr', project: 'HLT-026' };
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT ${url}`);
  },
  notFound: () => {
    throw new Error('NOT_FOUND');
  },
  usePathname: () => '/reference/parts',
  useRouter: () => ({ push() {}, replace() {}, refresh() {} }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('./actions', () => ({ createPartAction: vi.fn(), registerEquivalentAction: vi.fn() }));
vi.mock('@/server/session', async () => {
  const { makeT } = await import('@/i18n/translate');
  const { PERSONA_BY_ROLE } = await import('@/config/personas');
  return {
    getViewer: async () => PERSONA_BY_ROLE[session.role as keyof typeof PERSONA_BY_ROLE],
    getI18n: async () => ({ lang: session.lang, t: makeT(session.lang) }),
    getLang: async () => session.lang,
    getLastProject: async () => session.project,
    getZone: async () => null,
    getNavOpen: async () => ({}),
  };
});
vi.mock('@/components/ds/Drawer', async () => {
  const { createElement } = await import('react');
  return {
    Drawer: ({ id, title, meta, children }: { id?: unknown; title?: unknown; meta?: unknown; children?: unknown }) =>
      createElement('div', { 'data-drawer': '' }, createElement('header', null, id as never, meta as never), createElement('h3', null, title as never), children as never),
  };
});

import { createElement, isValidElement, type ComponentProps, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import PartsCataloguePage from '@/app/(app)/reference/parts/page';
import { I18nProvider } from '@/i18n/client';
import { setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { PlmCatalogue } from './catalogue';
import type { CatalogueView, PartDrawerView } from './model';
import { PartDrawer, PartDrawerPanel, type PartDrawerPanelProps } from './part-drawer';

type El = ReactElement<Record<string, unknown> & { children?: ReactNode }>;
/** Direct children of the page's fragment, by component name. */
function parts(tree: unknown): Record<string, El> {
  const out: Record<string, El> = {};
  const kids = (tree as El).props.children;
  for (const k of (Array.isArray(kids) ? kids : [kids]) as unknown[]) {
    if (isValidElement(k) && typeof k.type === 'function') out[(k.type as { name: string }).name] = k as El;
  }
  return out;
}
const page = async (sp: Record<string, string> = {}) => parts(await PartsCataloguePage({ searchParams: Promise.resolve(sp) }));
const drawer = async (partRef: string, extra: { projectCode?: string; closeHref?: string } = {}) =>
  (await PartDrawer({ partRef, closeHref: extra.closeHref ?? '/reference/parts', projectCode: extra.projectCode })) as ReactElement<PartDrawerPanelProps> | null;
const withI18n = (lang: 'en' | 'fr', el: ReactElement) => createElement(I18nProvider, { lang } as ComponentProps<typeof I18nProvider>, el);

beforeAll(async () => {
  setDb(await openDatabase());
}, 60_000);
beforeEach(() => {
  session.role = 'director';
  session.lang = 'en';
  session.project = 'HLT-026';
});

describe('/reference/parts', () => {
  it('default state: header with "New part", the catalogue, no drawer', async () => {
    const p = await page();
    expect(Object.keys(p)).toEqual(['PageHeader', 'PlmCatalogue']);
    expect(p.PageHeader.props).toMatchObject({ screen: 'plm' });
    const primary = p.PageHeader.props.primary as El;
    expect((primary.type as { name: string }).name).toBe('NewPartButton');
    // Sub-line of the dialog: the current project, as every add-form of the prototype (`projectName`, 09 §0.3).
    expect(primary.props).toMatchObject({ label: 'New part', context: '#026 · Harbor Line Terminal Expansion' });
    expect((primary.props.form as { title: string; submit: string; fields: { label: string }[] }).fields.map((f) => f.label)).toEqual([
      'Reference', 'Designation', 'Family', 'Preferred supplier', 'Unit price (€)', 'Unit',
    ]);
    const view = p.PlmCatalogue.props.view as CatalogueView;
    expect([view.rows.length, view.count, view.kpis[0].value]).toEqual([54, '54 of 54 parts', '54']);
  });

  it('URL state: filters, sort, unknown values fall back; ?part= opens the drawer with the page as close target', async () => {
    const p = await page({ type: 'electrical', status: 'validated', restr: '1', sort: 'price', dir: 'desc', part: 'EL-VFD-200' });
    const view = p.PlmCatalogue.props.view as CatalogueView;
    expect(view.rows.map((r) => r.ref)).toEqual(['EL-UPS-500', 'EL-SWG-11KV', 'EL-VFD-200', 'PV-MOD-550']);
    expect(view.headers.find((h) => h.key === 'price')!.sort).toMatchObject({ icon: 'down', active: true });
    expect(p.PartDrawer.props).toMatchObject({ partRef: 'EL-VFD-200', closeHref: '/reference/parts?type=electrical&status=validated&restr=1&sort=price&dir=desc' });
    const bad = (await page({ type: 'Electrical', pu: 'x', sort: 'mfr', restr: 'yes' })).PlmCatalogue.props.view as CatalogueView;
    expect([bad.rows.length, bad.clear]).toEqual([54, null]);
  });

  it('?part= is case-insensitive; an unknown reference opens nothing and leaves the links clean', async () => {
    const p = await page({ part: ' el-vfd-200 ', type: 'electrical' });
    expect(p.PartDrawer.props).toMatchObject({ partRef: 'EL-VFD-200', closeHref: '/reference/parts?type=electrical' });
    const view = p.PlmCatalogue.props.view as CatalogueView;
    expect(view.rows.find((r) => r.ref === 'EL-VFD-200')).toMatchObject({ selected: true, href: '/reference/parts?type=electrical' });
    const unknown = await page({ part: 'NOPE-1', type: 'electrical' });
    expect(unknown.PartDrawer).toBeUndefined();
    expect((unknown.PlmCatalogue.props.view as CatalogueView).clear!.href).toBe('/reference/parts');
    expect(((await drawer('el-vfd-200'))!.props.view as PartDrawerView).ref).toBe('EL-VFD-200');
  });

  it('"New part" for director, PM, engineering lead, quality and procurement; the others are outside their workspace', async () => {
    for (const role of ['director', 'pm', 'englead', 'quality', 'procurement']) {
      session.role = role;
      expect((await page()).PageHeader.props.primary, role).toBeTruthy();
    }
    for (const role of ['depthead', 'member']) {
      session.role = role;
      expect((await page()).PageHeader.props.primary, role).toBeUndefined();
    }
    // R-042 (P-1): outside their workspace the client is sent home.
    session.role = 'client';
    await expect(page()).rejects.toThrow('REDIRECT /');
  });

  it('R-046 (NEW-D2-1): catalogue prices for the director, the PMs and procurement only; masked prices are not sortable', async () => {
    for (const [role, masked] of [['director', false], ['pm', false], ['procurement', false], ['englead', true], ['quality', true], ['member', true]] as const) {
      session.role = role;
      const v = (await page()).PlmCatalogue.props.view as { rows: { price: string }[]; headers: { key: string; sort: unknown }[] };
      expect(v.rows.every((r) => r.price === '•••'), role).toBe(masked);
      expect(!!v.headers.find((h) => h.key === 'price')!.sort, role).toBe(!masked);
    }
  });

  it('French: header label, form labels (Unit → Unité), catalogue count', async () => {
    session.lang = 'fr';
    const p = await page();
    const primary = p.PageHeader.props.primary as El;
    expect(primary.props).toMatchObject({ label: 'Nouvel article', context: '#026 · Extension du terminal Harbor Line' });
    const form = primary.props.form as { title: string; submit: string; fields: { id: string; label: string; options?: { value: string; label: string }[] }[] };
    expect([form.title, form.submit]).toEqual(['Nouvel article', 'Créer l’article']);
    expect(form.fields.map((f) => f.label)).toEqual(['Référence', 'Désignation', 'Famille', 'Fournisseur préférentiel', 'Prix unitaire (€)', 'Unité']);
    expect(form.fields[2].options).toEqual([
      { value: 'structure', label: 'Structure' }, { value: 'mechanical', label: 'Mécanique' }, { value: 'electrical', label: 'Électricité' },
      { value: 'automation', label: 'Automatisme' }, { value: 'consumable', label: 'Consommable' },
    ]);
    expect((p.PlmCatalogue.props.view as CatalogueView).count).toBe('54 sur 54 articles');
  });
});

describe('<PartDrawer/>', () => {
  it('unknown or blank reference → nothing', async () => {
    expect(await drawer('NOPE-1')).toBeNull();
    expect(await drawer('  ')).toBeNull();
  });

  it('Register equivalent for the catalogue roles only, with the other parts as candidates', async () => {
    const d = (await drawer('KS-STL-0450'))!;
    const v = d.props.view as PartDrawerView;
    expect(v.equivalents.register!.candidates.map((c) => c.ref)).not.toContain('KS-STL-0450B');
    expect(v.equivalents.register!.candidates).toHaveLength(52);
    expect(d.props.register!.form.fields[0].options).toHaveLength(52);
    expect(d.props.register!.context).toBe('KS-STL-0450 · Structural steel column HEB 450');
    session.lang = 'fr';
    const fr = (await drawer('KS-STL-0450'))!.props.register!.form.fields[0].options as { value: string; label: string }[];
    expect(fr.find((o) => o.value === 'EL-PLC-S7')!.label).toBe('EL-PLC-S7 · Automate sécurité');
    session.lang = 'en';
    session.role = 'member';
    const m = (await drawer('KS-STL-0450'))!;
    expect([m.props.view.equivalents.register, m.props.register, m.props.view.ecos]).toEqual([null, null, null]);
  });

  it('project screens: Raise ECO and the Codex deposit use the page project; the last project otherwise', async () => {
    const bom = (await drawer('EL-VFD-200', { projectCode: 'NDC-031', closeHref: '/projects/NDC-031/bom' }))!.props.view as PartDrawerView;
    expect(bom.ecos!.raise!.href).toBe('http://localhost:3200/modifications-techniques/nouvelle?part=EL-VFD-200&project=NDC-031&source=keystone');
    expect(bom.documents.deposit.href).toBe('/projects/NDC-031/documents?deposit=new&dtype=CER&part=EL-VFD-200');
    expect(bom.openPlm.href).toBe('/reference/parts?part=EL-VFD-200');
    session.project = 'RCF-019';
    const plm = (await drawer('EL-VFD-200'))!.props.view as PartDrawerView;
    expect(plm.ecos!.raise!.href).toBe('http://localhost:3200/modifications-techniques/nouvelle?part=EL-VFD-200&source=keystone');
    expect(plm.documents.deposit.href).toBe('/projects/RCF-019/documents?deposit=new&dtype=CER&part=EL-VFD-200');
  });
});

describe('static render', () => {
  it('catalogue (EN): KPI tiles, filter card, sortable headers, rows with the ECO tag', async () => {
    const view = (await page({ sort: 'price', dir: 'desc' })).PlmCatalogue.props.view as CatalogueView;
    const html = renderToStaticMarkup(withI18n('en', createElement(PlmCatalogue, { view })));
    for (const s of ['Parts in catalogue', '87%', 'FD-DET-OPT · SG-BRK-SS', 'Search reference, name, manufacturer, manufacturer ref', 'All types · 54', 'Export-restricted only', 'Parts catalogue', '54 of 54 parts', 'Lead time', '€1,850,000', 'ECO-2026-015'])
      expect(html, s).toContain(s);
    expect(html).not.toContain('Discipline lead');
    expect(html).toContain('aria-sort="descending"');
    expect(html.indexOf('ASM-RMG-250')).toBeLessThan(html.indexOf('ASM-SPR-500'));
  });

  it('drawer body (FR): sections, banner, Vigie links open outside Keystone', async () => {
    session.lang = 'fr';
    const el = (await drawer('FD-DET-OPT'))!;
    const html = renderToStaticMarkup(withI18n('fr', createElement(PartDrawerPanel, el.props)));
    for (const s of [
      'Remplacé — à remplacer dans les études ouvertes avant tout achat.', 'Documents', 'Proposer la diffusion', 'Identification', 'Commercial et export',
      'Articles équivalents', 'FD-DET-OPT2', 'Stock par emplacement', '210 en stock', 'Projets équipés', 'HLT · 180 unités', 'Parc installé', 'Révisions', 'Plans',
      'Modifications techniques', 'ECO-2026-015', 'En approbation', 'Créer un ECO', 'Ouvrir dans le PLM', 'Enregistrer un équivalent',
    ])
      expect(html, s).toContain(s);
    expect(html).toContain('href="http://localhost:3200/modifications-techniques/ECO-2026-015" target="_blank" rel="noopener noreferrer"');
    expect(html).toContain('href="http://localhost:3200/modifications-techniques/nouvelle?part=FD-DET-OPT&amp;source=keystone" target="_blank"');
  });
});
