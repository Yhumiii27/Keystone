// Page wiring of /projects/[code]/bom (seeded in-memory database, mocked session): URL state, the primary action per
// persona (outside the workspace, project read-only), the shared part drawer (`?part=`), the node drawer and "Raise
// ECO" gating. The page is called as a function and its element tree inspected (no Next runtime).
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const session = { role: 'director' as string, lang: 'en' as 'en' | 'fr' };
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT ${url}`);
  },
  notFound: () => {
    throw new Error('NOT_FOUND');
  },
  usePathname: () => '/',
  useRouter: () => ({ push() {}, replace() {}, refresh() {} }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('./actions', () => ({}));
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

import { isValidElement, type ReactElement, type ReactNode } from 'react';
import BomPage from '@/app/(app)/projects/[code]/bom/page';
import { setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import type { BomScreenView } from './model';

type El = ReactElement<Record<string, unknown> & { children?: ReactNode }>;
function parts(tree: unknown): Record<string, El> {
  const out: Record<string, El> = {};
  const kids = (tree as El).props.children;
  for (const k of (Array.isArray(kids) ? kids : [kids]) as unknown[]) {
    if (isValidElement(k) && typeof k.type === 'function') out[(k.type as { name: string }).name] = k as El;
  }
  return out;
}
const page = async (sp: Record<string, string> = {}, code = 'HLT-026') => parts(await BomPage({ params: Promise.resolve({ code }), searchParams: Promise.resolve(sp) }));
const body = (p: Record<string, El>) => p.BomBody.props.view as BomScreenView;

beforeAll(async () => {
  setDb(await openDatabase());
}, 60_000);
beforeEach(() => {
  session.role = 'director';
  session.lang = 'en';
});

describe('/projects/[code]/bom', () => {
  it('default state: header "Add article" (director), KPI tiles, flat list, no drawer', async () => {
    const p = await page();
    expect(Object.keys(p)).toEqual(['PageHeader', 'BomBody']);
    expect(p.PageHeader.props).toMatchObject({ screen: 'bom', projectCode: 'HLT-026' });
    const primary = p.PageHeader.props.primary as El;
    expect((primary.type as { name: string }).name).toBe('AddArticleButton');
    expect(primary.props).toMatchObject({ code: 'HLT-026', context: '#026 · Harbor Line Terminal Expansion' });
    expect((primary.props.form as { title: string }).title).toBe('Add article');
    const v = body(p);
    expect([v.state.view, v.kpis[0].value, v.flat!.rows.length, v.tree, v.node]).toEqual(['flat', '35', 35, null, null]);
    expect(p.BomBody.props.canEdit).toBe(true);
  });

  // R-041 (P-2): only the project's named team edits — the quality manager is a referent of Harbor Line, not of NDC-031.
  it.each([
    ['pm', 'HLT-026', true], ['pm', 'NDC-031', false], ['englead', 'HLT-026', true], ['quality', 'HLT-026', true], ['quality', 'NDC-031', false],
    ['englead', 'NDC-031', false], ['procurement', 'HLT-026', true], ['member', 'HLT-026', false], ['depthead', 'HLT-026', false],
  ])('%s on %s: primary and edit controls %s', async (role, code, editable) => {
    session.role = role;
    const p = await page({ view: 'tree', node: 'ASM-BOG-300' }, code);
    expect(!!p.PageHeader.props.primary).toBe(editable);
    expect(p.BomBody.props.canEdit).toBe(editable);
    const v = body(p);
    if (code === 'HLT-026') expect(!!v.node!.raiseEco).toBe(editable);
  });

  it('R-042 (P-1): the BOM is outside the client’s workspace — the client is sent home', async () => {
    session.role = 'client';
    await expect(page({}, 'HLT-026')).rejects.toThrow('REDIRECT /');
  });

  it('R-046 (NEW-D2-1): prices and values are masked for the engineering lead and the quality manager', async () => {
    for (const [role, masked] of [['englead', true], ['quality', true], ['procurement', false], ['pm', false], ['director', false]] as const) {
      session.role = role;
      const v = body(await page({}, 'HLT-026'));
      expect(v.kpis[1].value === '•••', role).toBe(masked);
      expect(v.flat!.rows.every((r) => r.price === '•••' && r.total === '•••'), role).toBe(masked);
      const tree = body(await page({ view: 'tree', node: 'ASM-BOG-300' }, 'HLT-026'));
      // R-103 adds the row "Price basis" (a label, not a price) to the roll-up; every price row is masked.
      expect(tree.node!.cost.filter((c) => c.k !== 'Price basis').every((c) => c.v === '•••'), role).toBe(masked);
      expect(body(await page({ view: 'compare' }, 'HLT-026')).compare!.total === '•••', role).toBe(masked);
      const sp = body(await page({ view: 'spares' }, 'HLT-026')).spares!;
      expect(sp.rows.every((r) => r.price === '•••'), role).toBe(masked);
    }
  });

  it('?part= opens the shared part drawer over any display; closing keeps the other state', async () => {
    const p = await page({ view: 'spares', sys: 'ASM-BOG-300', part: 'CR-BRG-SKF' });
    expect(p.PartDrawer.props).toMatchObject({ partRef: 'CR-BRG-SKF', projectCode: 'HLT-026', closeHref: '/projects/HLT-026/bom?view=spares&sys=ASM-BOG-300' });
    expect(body(p).spares!.rows.find((r) => r.ref === 'CR-BRG-SKF')!.selected).toBe(true);
    expect((await page({ part: '<x>' })).PartDrawer).toBeUndefined();
  });

  it('displays: tree + node drawer, where-used search, compare, PU/PR; unknown values fall back', async () => {
    const tree = body(await page({ view: 'tree', node: 'CR-BRG-SKF' }));
    expect([tree.tree!.rows.length, tree.node!.ref, tree.node!.closeHref]).toEqual([29, 'CR-BRG-SKF', '/projects/HLT-026/bom?view=tree']);
    const used = body(await page({ view: 'used', used: 'vfd' }));
    expect([used.used!.part.ref, used.used!.q]).toEqual(['EL-VFD-200', 'vfd']);
    expect(body(await page({ view: 'compare' })).compare!.total).toBe('+€19,180 per crane');
    const sp = body(await page({ view: 'spares', kind: 'PU' })).spares!;
    expect([sp.rows.length, sp.kinds.find((k) => k.active)!.value]).toEqual([4, 'PU']);
    const bad = body(await page({ view: 'nope', sort: 'mfr', kind: 'X' }));
    expect([bad.state.view, bad.state.sort.key, bad.flat!.rows.length]).toEqual(['flat', 'ref', 35]);
  });

  it('projects without a BOM: empty list, notice on the other displays; unknown project → 404', async () => {
    const v = body(await page({}, 'EWA-051'));
    expect([v.flat!.rows.length, v.flat!.empty]).toEqual([0, 'No article is registered in this project’s BOM yet']);
    expect(body(await page({ view: 'tree' }, 'EWA-051')).noTree).toBe('No multi-level assembly is registered for this project — the flat list is the full BOM.');
    await expect(page({}, 'XXX-999')).rejects.toThrow('NOT_FOUND');
  });

  it('French: labels and figures through the dictionary', async () => {
    session.lang = 'fr';
    const v = body(await page());
    // E-2a (R-103): ordered, else last purchase, else catalogue price — 7,02 M€ (7,05 M€ at the catalogue price before Delivery 7).
    expect([v.kpis[1].label, v.kpis[1].value, v.views[0].label, v.flat!.count]).toEqual(['Valeur nomenclature', '7,02 M€', 'Liste à plat', '35 / 35 article(s)']);
  });
});
