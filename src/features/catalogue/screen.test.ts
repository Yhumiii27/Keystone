// Machine catalogue screen (owner, 25 Oct 2026: a sidebar section dedicated to managing the catalogue Keystone owns, AC-4):
// the registry (section placed after Technical reference, one global screen), who sees it per persona, the page wiring (URL
// filters, selected entry, primary action, edit rights: director and engineering lead), the body rendered in English and in
// French, and the export. Seeded in-memory demo database; the session is mocked, the access rule is the real one.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const session = { role: 'director' as string, lang: 'en' as 'en' | 'fr' };
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT ${url}`);
  },
  notFound: () => {
    throw new Error('NOT_FOUND');
  },
  usePathname: () => '/catalogue/machines',
  useRouter: () => ({ push() {}, replace() {}, refresh() {} }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/server/session', async () => {
  const { makeT } = await import('@/i18n/translate');
  const { PERSONA_BY_ROLE } = await import('@/config/personas');
  return {
    getViewer: async () => PERSONA_BY_ROLE[session.role as keyof typeof PERSONA_BY_ROLE],
    getI18n: async () => ({ lang: session.lang, t: makeT(session.lang) }),
    getLang: async () => session.lang,
    getLastProject: async () => 'HLT-026',
    getZone: async () => null,
    getNavOpen: async () => ({}),
  };
});

import { createElement as h, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import MachineCataloguePage from '@/app/(app)/catalogue/machines/page';
import MachineTypesPage from '@/app/(app)/admin/machine-types/page';
import { buildSidebar, crumbBase } from '@/components/app/shell/nav-model';
import { PERSONAS } from '@/config/personas';
import { ROLE_SCREENS, SCREEN_BY_ID, SECTIONS, canSee, screenHref, type RoleKey } from '@/config/screens';
import { SCREEN_ICONS } from '@/config/screen-icons';
import { I18nProvider } from '@/i18n/client';
import { makeT } from '@/i18n/translate';
import { setDb } from '@/server/db/client';
import { D5_SCREEN_ROLES } from '@/server/db/codes';
import { openDatabase } from '@/server/db/open';
import { MachineCatalogueBody } from './catalogue-view';
import { catalogueHref, catalogueStatusOf } from './links';
import type { CatalogueScreenView } from './model';

type El = ReactElement<Record<string, unknown> & { children?: ReactNode }>;
function parts(tree: unknown): Record<string, El> {
  const out: Record<string, El> = {};
  const kids = (tree as El).props.children;
  for (const k of (Array.isArray(kids) ? kids : [kids]) as unknown[]) {
    if (isValidElement(k) && typeof k.type === 'function') out[(k.type as { name: string }).name] = k as El;
  }
  return out;
}
const page = async (sp: Record<string, string> = {}) => parts(await MachineCataloguePage({ searchParams: Promise.resolve(sp) }));
const viewOf = async (sp: Record<string, string> = {}) => (await page(sp)).MachineCatalogueBody.props.view as CatalogueScreenView;

beforeAll(async () => {
  setDb(await openDatabase());
}, 60_000);
beforeEach(() => {
  session.role = 'director';
  session.lang = 'en';
});

describe('registry and navigation', () => {
  it('a "Machine catalogue" section right after Technical reference, with one global screen', () => {
    expect(SECTIONS.map((s) => s.key)).toEqual(['portfolio', 'project', 'tech', 'catalogue', 'stock', 'sav', 'res', 'admin']);
    expect(SECTIONS.find((s) => s.key === 'catalogue')!.label).toBe('Machine catalogue');
    expect(SCREEN_BY_ID.catalogue).toMatchObject({ title: 'Machine catalogue', navLabel: 'Machine catalogue', nav: 'catalogue', scope: 'global', slug: 'catalogue/machines', built: true });
    expect(screenHref('catalogue')).toBe('/catalogue/machines');
    expect(SCREEN_ICONS.catalogue).toBeDefined();
    expect(crumbBase('catalogue')).toBe('Machine catalogue');
    expect(makeT('fr')('Machine catalogue')).toBe('Catalogue machines');
  });

  it('seen by the roles of Machine types (director, PM, engineering lead, quality); never by the client', () => {
    const roles = PERSONAS.map((p) => p.role as RoleKey);
    expect(roles.filter((r) => canSee(r, 'catalogue'))).toEqual(roles.filter((r) => canSee(r, 'mtypes')));
    expect(roles.filter((r) => canSee(r, 'catalogue')).sort()).toEqual(['director', 'englead', 'pm', 'quality']);
    expect([...D5_SCREEN_ROLES.catalogue]).toEqual(['director', 'pm', 'englead', 'quality']);
    for (const r of ['finance', 'procurement', 'member', 'depthead', 'client'] as RoleKey[]) expect(ROLE_SCREENS[r], r).not.toContain('catalogue');
    for (const p of PERSONAS) {
      const sections = buildSidebar({ role: p.role as RoleKey, active: 'home', badges: {}, navOpen: { catalogue: true }, subs: {} }).sections;
      const sec = sections.find((s) => s.key === 'catalogue');
      if (canSee(p.role as RoleKey, 'catalogue')) {
        expect(sec?.rows, p.role).toEqual([{ kind: 'item', entry: { id: 'catalogue', label: 'Machine catalogue', badge: '', active: false } }]);
        const keys = sections.map((s) => s.key);
        if (keys.includes('tech')) expect(keys.indexOf('catalogue'), p.role).toBe(keys.indexOf('tech') + 1);
      } else expect(sec, p.role).toBeUndefined();
    }
  });
});

describe('/catalogue/machines', () => {
  it('lists every entry across the machine types; the first is selected; header and body', async () => {
    const p = await page();
    expect(Object.keys(p)).toEqual(['PageHeader', 'MachineCatalogueBody']);
    expect(p.PageHeader.props.screen).toBe('catalogue');
    const v = p.MachineCatalogueBody.props.view as CatalogueScreenView;
    expect(v.rows.map((r) => [r.code, r.typeLabel, r.current, r.statusText, r.draftNote, r.price, r.leadTime])).toEqual([
      ['EMP-40T', 'EMP', 'v1', 'Published', 'v2 · Draft', '€4.20M', '52 weeks'],
      ['MEMU-16', 'MEMU', 'v1', 'Published', null, expect.any(String), expect.any(String)],
      ['SPUR-2X', 'SPUR', 'v1', 'Retired', null, expect.any(String), expect.any(String)],
    ]);
    expect(v.kpis.map((k) => k.value)).toEqual(['3', '2', '1', '1', '0']);
    expect(v.typeChips.map((c) => [c.value, c.count])).toEqual([['all', 3], ['EMP', 1], ['MEMU', 1], ['SPUR', 1]]);
    expect(v.statusChips.map((c) => [c.value, c.count])).toEqual([['all', 3], ['published', 2], ['draft', 1], ['retired', 1]]);
    expect(v.detail!.code).toBe('EMP-40T');
    expect(v.detail!.entry.versions.map((x) => [x.version, x.status])).toEqual([[2, 'draft'], [1, 'published']]);
    // What Arche reads: the published version only (the draft is never shared).
    expect(v.detail!.publication.map((x) => [x.ref, x.statut])).toEqual([['EMP-40T v1', 'publie']]);
    expect(v.detail!.uses).toEqual([]);
  });

  it('filters by machine type (stored or display code, any case) and status; ?entry= selects; unknown values fall back', async () => {
    expect((await viewOf({ type: 'memu' })).rows.map((r) => r.code)).toEqual(['MEMU-16']);
    expect((await viewOf({ type: 'nope' })).typeValue).toBe('all');
    expect((await viewOf({ status: 'draft' })).rows.map((r) => r.code)).toEqual(['EMP-40T']);
    expect((await viewOf({ status: 'RETIRED' })).rows.map((r) => r.code)).toEqual(['SPUR-2X']);
    expect((await viewOf({ status: 'published', type: 'SPUR' })).rows).toEqual([]);
    expect((await viewOf({ status: 'published', type: 'SPUR' })).detail).toBeNull();
    const spur = await viewOf({ entry: 'spur-2x' });
    expect([spur.detail!.code, spur.detail!.publication.map((x) => x.statut)]).toEqual(['SPUR-2X', ['retire']]);
    expect(spur.rows.find((r) => r.selected)!.code).toBe('SPUR-2X');
    // An entry filtered out → the first listed.
    expect((await viewOf({ type: 'MEMU', entry: 'EMP-40T' })).detail!.code).toBe('MEMU-16');
    expect(catalogueHref({ type: 'EMP', status: 'draft', entry: 'EMP-40T' })).toBe('/catalogue/machines?type=EMP&status=draft&entry=EMP-40T');
    expect([catalogueStatusOf('Draft'), catalogueStatusOf('x'), catalogueStatusOf(null)]).toEqual(['draft', 'all', 'all']);
  });

  it('rights: the director and the engineering lead edit (New catalogue entry); PM and quality read; the others outside; the client is sent home', async () => {
    for (const [role, canEdit, primary, note] of [
      ['director', true, true, false], ['englead', true, true, false], ['pm', false, false, true], ['quality', false, false, true],
      ['finance', false, false, false], ['procurement', false, false, false], ['depthead', false, false, false], ['member', false, false, false],
    ] as const) {
      session.role = role;
      const p = await page();
      const v = p.MachineCatalogueBody.props.view as CatalogueScreenView;
      expect(v.canEdit, role).toBe(canEdit);
      expect(!!p.PageHeader.props.primary, role).toBe(primary);
      if (primary) expect(((p.PageHeader.props.primary as El).type as { name: string }).name).toBe('NewCatalogueEntryButton');
      expect(v.readNote, role).toBe(note ? 'Only the director and the engineering lead edit the machine catalogue' : null);
      expect(v.detail!.entry.versions.some((x) => x.canPublish || x.canRetire || x.canEdit || x.canDiscard), role).toBe(canEdit);
    }
    session.role = 'client';
    await expect(page()).rejects.toThrow('REDIRECT /');
  });

  it('the New catalogue entry form asks for the machine type (active types), preset by ?type=', async () => {
    const form = ((await page({ type: 'MEMU' })).PageHeader.props.primary as El).props.form as { fields: { id: string; options?: { value: string }[]; defaultValue?: string }[] };
    expect(form.fields.slice(0, 2).map((f) => f.id)).toEqual(['machineType', 'code']);
    expect(form.fields[0].options!.map((o) => o.value)).toEqual(expect.arrayContaining(['EMP', 'MEMU', 'SPUR']));
    expect(form.fields[0].defaultValue).toBe('MEMU');
  });

  it('renders in English and in French', async () => {
    const render = async (lang: 'en' | 'fr', role = 'director') => {
      session.role = role;
      session.lang = lang;
      const view = await viewOf();
      return renderToStaticMarkup(h(I18nProvider, { lang, children: h(MachineCatalogueBody, { view, t: makeT(lang) }) }));
    };
    const en = await render('en');
    for (const s of ['Catalogue entries', 'Offered to the subsidiaries', 'Drafts in progress', 'Machine type', 'EMP-40T', 'MEMU-16', 'SPUR-2X', 'Published', 'Retired', 'v2 · Draft', 'Published to the CAPEX application', 'Projects’ equipment lines', 'Publish EMP-40T v2', 'href="/catalogue/machines?type=MEMU"', 'href="/catalogue/machines?status=draft"'])
      expect(en, s).toContain(s);
    const fr = await render('fr');
    for (const s of ['Fiches catalogue', 'Proposées aux filiales', 'Brouillons en cours', 'Type de machine', 'Publiée', 'Retirée', 'v2 · Brouillon', 'Publié vers l’application CAPEX', 'Lignes d’équipement des projets', 'Prix indicatif', 'Délai type', '52 semaines', 'Publier EMP-40T v2'])
      expect(fr, s).toContain(s);
    for (const s of ['Offered to the subsidiaries', 'Drafts in progress', 'Published to the CAPEX application']) expect(fr, s).not.toContain(s);
    const pm = await render('fr', 'pm');
    expect(pm).toContain('Seuls le directeur et le responsable ingénierie modifient le catalogue machines');
    expect(pm).not.toContain('Publier EMP-40T v2');
  });
});

describe('Machine types screen: the catalogue moved out', () => {
  it('the editor links to the Machine catalogue filtered on the type, with its number of entries', async () => {
    const p = parts(await MachineTypesPage({ searchParams: Promise.resolve({ type: 'EMP' }) }));
    expect(p.MachineTypesBody.props.catalogue).toBeUndefined();
    expect(p.MachineTypesBody.props.catalogueLink).toEqual({ href: '/catalogue/machines?type=EMP', entries: 1 });
  });
});
