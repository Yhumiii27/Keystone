// Page wiring of R-108 (the tag drawer's catalogue search in the URL: `?cq=`, `?ctype=`) and R-109 (A-9 = a: the banner when
// Codex's reference revision of the P&ID is ahead of the tags' — on the seed, tags rev C, Codex rev D Released — with "Import
// P&ID tags" suggesting rev D for the P&ID editors only, the header button suggesting the same revision). Seeded in-memory
// database, mocked session; the page is called as a function and its element tree inspected.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const session = { role: 'englead' as string, lang: 'en' as 'en' | 'fr' };
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT ${url}`);
  },
  notFound: () => {
    throw new Error('NOT_FOUND');
  },
  usePathname: () => '/projects/HLT-026/pid',
  useRouter: () => ({ push() {}, replace() {}, refresh() {} }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('./actions', () => ({ mapPidTagAction: vi.fn(), unlinkPidTagAction: vi.fn(), stagePidImportAction: vi.fn(), applyPidImportAction: vi.fn() }));
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

import { createElement, isValidElement, type ComponentProps, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import PidPage from '@/app/(app)/projects/[code]/pid/page';
import { I18nProvider } from '@/i18n/client';
import { setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { pidHref } from './links';
import type { PidScreenView, PidTagDrawerView } from './model';
import { PidBody } from './pid-view';

type El = ReactElement<Record<string, unknown> & { children?: ReactNode }>;
function parts(tree: unknown): Record<string, El> {
  const out: Record<string, El> = {};
  const kids = (tree as El).props.children;
  for (const k of (Array.isArray(kids) ? kids : [kids]) as unknown[]) if (isValidElement(k) && typeof k.type === 'function') out[(k.type as { name: string }).name] = k as El;
  return out;
}
const page = async (sp: Record<string, string> = {}) => parts(await PidPage({ params: Promise.resolve({ code: 'HLT-026' }), searchParams: Promise.resolve(sp) }));
const html = (el: ReactElement) => renderToStaticMarkup(createElement(I18nProvider, { lang: session.lang } as ComponentProps<typeof I18nProvider>, el));
const propsOf = (el: unknown) => (el as El).props as Record<string, unknown>;

beforeAll(async () => {
  setDb(await openDatabase());
}, 60_000);
beforeEach(() => {
  session.role = 'englead';
  session.lang = 'en';
});

describe('R-109 revision banner', () => {
  it('shown to everyone who sees the screen; "Import P&ID tags" suggesting rev D for the P&ID editors only', async () => {
    const p = await page();
    const view = p.PidBody.props.view as PidScreenView;
    expect(view.drawing.gap).toEqual({ ahead: true, suggestedRevision: 'D', text: 'Codex has rev D of this P&ID (Released) — the tags come from rev C. Re-import the tags of rev D.' });
    expect(propsOf(p.PidBody.props.gapAction)).toMatchObject({ code: 'HLT-026', currentRevision: 'C', suggestedRevision: 'D', variant: 'secondary' });
    expect(propsOf(p.PageHeader.props.primary)).toMatchObject({ currentRevision: 'C', suggestedRevision: 'D', variant: 'primary' });
    expect(html(p.PidBody as ReactElement)).toContain('Re-import the tags of rev D.');
    for (const role of ['pm', 'procurement', 'member', 'director']) {
      session.role = role;
      const q = await page();
      expect((q.PidBody.props.view as PidScreenView).drawing.gap?.ahead, role).toBe(true);
      // The director edits every project's P&ID (D5 workspace); the others are outside it.
      expect(!!q.PidBody.props.gapAction, role).toBe(role === 'director');
    }
    session.role = 'quality';
    session.lang = 'fr';
    const fr = await page();
    expect((fr.PidBody.props.view as PidScreenView).drawing.gap!.text).toBe('Codex a la rév. D de ce PID (Diffusé) — les tags viennent de la rév. C. Réimportez les tags de la rév. D.');
  });

  it('a neutral banner without action when the revisions cannot be ordered', () => {
    const view = { kpis: [], drawing: { title: '', documentNumber: 'PID', rev: '', docHref: null, docTitle: null, placeholder: '', gap: { ahead: false, suggestedRevision: '3', text: 'differs' } }, steps: [], chips: [], filter: 'all', scopes: [], scope: 'all', rows: [], empty: null, overlay: [], overlayExportHref: '' } as unknown as PidScreenView;
    const out = html(createElement(PidBody, { view, t: (s: string) => s, gapAction: createElement('button', null, 'IMPORT') }));
    expect(out).toContain('differs');
    expect(out).not.toContain('IMPORT');
  });
});

describe('R-108 catalogue search in the URL', () => {
  it('?cq / ?ctype search the whole catalogue from the tag drawer; the search belongs to the open tag', async () => {
    const p = await page({ tag: 'TT-102', cq: 'ks-stl', ctype: 'all' });
    const d = p.PidTagDrawer.props.view as PidTagDrawerView;
    expect(d.candidates!.map((c) => c.ref)).toContain('KS-STL-0450');
    expect(d.candidates!.every((c) => !c.inBom || c.status === 'In the BOM')).toBe(true);
    expect([d.search!.q, d.search!.type, d.search!.more]).toEqual(['ks-stl', 'all', null]);
    expect(p.PidTagDrawer.props.canEditBom).toBe(true);
    // Default search: 20 results and the refine note; the compatible types first in the select.
    const def = (await page({ tag: 'TT-102' })).PidTagDrawer.props.view as PidTagDrawerView;
    expect([def.candidates!.length, def.search!.more, def.search!.types[0].value]).toEqual([20, 'First 20 results · refine the search', 'compatible']);
    const none = (await page({ tag: 'TT-102', cq: 'zzz-nothing' })).PidTagDrawer.props.view as PidTagDrawerView;
    expect([none.candidates, none.search!.empty]).toEqual([[], 'No catalogue article matches']);
    expect(pidHref('HLT-026', { tag: 'TT-102', cq: 'ks', ctype: 'all' })).toBe('/projects/HLT-026/pid?tag=TT-102&cq=ks&ctype=all');
    expect(pidHref('HLT-026', { cq: 'ks', ctype: 'all' })).toBe('/projects/HLT-026/pid');
    session.lang = 'fr';
    const fr = (await page({ tag: 'TT-102' })).PidTagDrawer.props.view as PidTagDrawerView;
    expect([fr.search!.more, fr.search!.types.slice(0, 2).map((x) => x.label), fr.candidates![0].status]).toEqual(['20 premiers résultats · affinez la recherche', ['Types compatibles', 'Tous types'], 'Dans la nomenclature']);
  });
});
