// Page wiring of /projects/[code]/pid (seeded in-memory database, mocked session): the primary action per persona
// (outside the workspace → none), the URL state (filters, case-insensitive `?tag=`, unknown tag, `?part=`), the empty
// state of a project without a P&ID, the tag drawer (mapping only for editors) and the rendered markup in EN and FR.
// The page is called as a function and its element tree inspected (no Next runtime).
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const session = { role: 'director' as string, lang: 'en' as 'en' | 'fr' };
vi.mock('next/navigation', () => ({
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
import type { PidScreenView, PidTagDrawerView } from './model';

type El = ReactElement<Record<string, unknown> & { children?: ReactNode }>;
function parts(tree: unknown): Record<string, El> {
  const out: Record<string, El> = {};
  const kids = (tree as El).props.children;
  for (const k of (Array.isArray(kids) ? kids : [kids]) as unknown[]) {
    if (isValidElement(k) && typeof k.type === 'function') out[(k.type as { name: string }).name] = k as El;
  }
  return out;
}
const page = async (sp: Record<string, string> = {}, code = 'HLT-026') => parts(await PidPage({ params: Promise.resolve({ code }), searchParams: Promise.resolve(sp) }));
const html = (el: ReactElement) => renderToStaticMarkup(createElement(I18nProvider, { lang: session.lang } as ComponentProps<typeof I18nProvider>, el));
/** The Drawer renders through a portal on the client: render the drawer's content. */
const drawerHtml = (el: El) => {
  const panel = (el.type as (p: unknown) => El)(el.props);
  return html(createElement('div', null, panel.props.children));
};

beforeAll(async () => {
  setDb(await openDatabase());
}, 60_000);
beforeEach(() => {
  session.role = 'director';
  session.lang = 'en';
});

describe('/projects/[code]/pid', () => {
  it('default state: header "Import P&ID tags" (director), the screen body, no drawer', async () => {
    const p = await page();
    expect(Object.keys(p)).toEqual(['PageHeader', 'PidBody']);
    expect(p.PageHeader.props).toMatchObject({ screen: 'pid', projectCode: 'HLT-026' });
    const primary = p.PageHeader.props.primary as El;
    expect(primary.props).toMatchObject({ code: 'HLT-026', context: '#026 · Harbor Line Terminal Expansion', currentRevision: 'C' });
    const view = p.PidBody.props.view as PidScreenView;
    expect([view.kpis.map((k) => k.value), view.rows.length, view.overlay.length, view.filter, view.scope]).toEqual([['PID-HLT-026 rev C', '22', '59%', '6', '3'], 24, 7, 'all', 'all']);
  });

  it('roles: englead and quality edit; pm, procurement, client, member are outside (no primary, no mapping)', async () => {
    for (const role of ['englead', 'quality']) {
      session.role = role;
      const p = await page({ tag: 'TT-102' });
      expect([!!p.PageHeader.props.primary, p.PidTagDrawer.props.canEdit, (p.PidTagDrawer.props.view as PidTagDrawerView).candidates?.length], role).toEqual([true, true, 8]);
    }
    for (const role of ['pm', 'procurement', 'client', 'member']) {
      session.role = role;
      const p = await page({ tag: 'TT-102' });
      expect([p.PageHeader.props.primary, p.PidTagDrawer.props.canEdit, (p.PidTagDrawer.props.view as PidTagDrawerView).candidates], role).toEqual([undefined, false, []]);
      expect(drawerHtml(p.PidTagDrawer), role).not.toContain('Map to a BOM reference');
    }
  });

  it('URL state: filters, case-insensitive tag, unknown tag dropped, part drawer in place of the tag drawer', async () => {
    const p = await page({ status: 'unmapped', scope: 'overlay', q: 'transmitter', tag: 'tt-102' });
    const v = p.PidBody.props.view as PidScreenView;
    expect([v.filter, v.scope, v.rows.map((r) => [r.tag, r.selected])]).toEqual(['unmapped', 'overlay', [['TT-102', true], ['PT-201', false]]]);
    const d = p.PidTagDrawer.props.view as PidTagDrawerView;
    expect([d.tag, d.closeHref]).toEqual(['TT-102', '/projects/HLT-026/pid?status=unmapped&scope=overlay&q=transmitter']);
    const bad = await page({ status: 'Unmapped', scope: 'nope', tag: 'NOPE-1' });
    const bv = bad.PidBody.props.view as PidScreenView;
    expect([bv.filter, bv.scope, bv.rows.length, bad.PidTagDrawer]).toEqual(['all', 'all', 24, undefined]);
    expect(bv.chips[1].href).toBe('/projects/HLT-026/pid?status=linked');
    const part = await page({ tag: 'LT-101', part: 'EL-PLC-S7' });
    expect(Object.keys(part)).toEqual(['PageHeader', 'PidBody', 'PartDrawer']);
    expect(part.PartDrawer.props).toMatchObject({ partRef: 'EL-PLC-S7', projectCode: 'HLT-026', closeHref: '/projects/HLT-026/pid?tag=LT-101' });
  });

  it('a project without a P&ID: the empty state (the import registers one)', async () => {
    const p = await page({}, 'NDC-031');
    expect(Object.keys(p)).toEqual(['PageHeader', 'Stack']);
    expect(html(p.Stack)).toContain('No P&amp;ID registered for this project yet — import the tag list from the drawing to start the validation.');
    expect((p.PageHeader.props.primary as El).props).toMatchObject({ code: 'NDC-031', currentRevision: null });
    session.lang = 'fr';
    expect(html((await page({ tag: 'LT-101' }, 'EWA-051')).Stack)).toContain('Aucun PID enregistré pour ce projet');
    await expect(page({}, 'XXX-999')).rejects.toThrow('NOT_FOUND');
  });

  it.each(['en', 'fr'] as const)('%s markup: cards, filters, register, overlay, drawer', async (lang) => {
    session.lang = lang;
    const p = await page({ tag: 'XV-111' });
    const body = html(p.PidBody);
    const fr = lang === 'fr';
    expect(body).toMatch(fr ? /Schéma PID · <a [^>]*href="\/projects\/HLT-026\/documents\?doc=PID-HLT-026">PID-HLT-026<\/a> rév. C/ : /P&amp;ID drawing · <a [^>]*href="\/projects\/HLT-026\/documents\?doc=PID-HLT-026">PID-HLT-026<\/a> rev C/);
    expect(body).toContain(fr ? 'Validation du process' : 'Process validation');
    expect(body).toContain(fr ? 'Registre des tags — PID ↔ nomenclature' : 'Tag register — P&amp;ID ↔ BOM');
    expect(body).toContain(fr ? 'Exporter la liste surcouche' : 'Export overlay list');
    expect(body).toContain('aria-current="true">XV-111</td>');
    expect(body).toContain(fr ? '<span>Manquant</span>' : '<span>Missing</span>');
    expect(body).toContain('href="/projects/HLT-026/pid?status=part_outdated&amp;tag=XV-111"');
    const drawer = drawerHtml(p.PidTagDrawer);
    expect(drawer).toContain(fr ? 'Associer à une référence nomenclature' : 'Map to a BOM reference');
    expect(drawer).toContain(fr ? 'Actionneur raccordé à l&#x27;automate sans retour d&#x27;état' : 'Actuator wired to the PLC without state feedback');
    expect(drawer).toContain('href="/projects/HLT-026/plan?act=A1410"');
    expect(drawer).not.toContain(fr ? 'Délier' : 'Unlink');
    const linked = drawerHtml((await page({ tag: 'LT-101' })).PidTagDrawer);
    expect(linked).toContain('href="/projects/HLT-026/pid?tag=LT-101&amp;part=EL-PLC-S7"');
    expect(linked).toContain('href="/projects/HLT-026/bom?part=EL-PLC-S7"');
    expect(linked).toContain(fr ? '>Délier</button>' : '>Unlink</button>');
    const client = drawerHtml((await page({ tag: 'T-101' })).PidTagDrawer);
    expect(client).toContain(fr ? 'Équipement fourni par le client : aucune référence attendue.' : 'Client-supplied equipment: no BOM reference expected.');
    expect(client).not.toContain(fr ? 'Associer à une référence' : 'Map to a BOM reference');
  });
});
