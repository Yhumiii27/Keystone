// Page wiring of /reference/eco and /reference/drawings (seeded in-memory database, mocked session): URL state, the
// primary actions ("New ECO" opens Vigie, "Sync vault"), the drawers, the outside-workspace rules per persona, and the
// rendered markup of the register (Vigie links open outside Keystone; no progress button for outside viewers). The
// pages are called as functions and their element trees inspected (no Next runtime).
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const session = { role: 'director' as string, lang: 'en' as 'en' | 'fr' };
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NOT_FOUND');
  },
  usePathname: () => '/reference/eco',
  useRouter: () => ({ push() {}, replace() {}, refresh() {} }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('./actions', () => ({ decideEcoApprovalAction: vi.fn(), requestEcoStepAction: vi.fn(), syncVaultAction: vi.fn() }));
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
import DrawingsPage from '@/app/(app)/reference/drawings/page';
import EcoPage from '@/app/(app)/reference/eco/page';
import { I18nProvider } from '@/i18n/client';
import { setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import type { DrawingDrawerView, DrawingsView } from './drawings/model';
import type { EcoDrawerView, EcoScreenView } from './model';

type El = ReactElement<Record<string, unknown> & { children?: ReactNode }>;
function parts(tree: unknown): Record<string, El> {
  const out: Record<string, El> = {};
  const kids = (tree as El).props.children;
  for (const k of (Array.isArray(kids) ? kids : [kids]) as unknown[]) {
    if (isValidElement(k) && typeof k.type === 'function') out[(k.type as { name: string }).name] = k as El;
  }
  return out;
}
const eco = async (sp: Record<string, string> = {}) => parts(await EcoPage({ searchParams: Promise.resolve(sp) }));
const dwg = async (sp: Record<string, string> = {}) => parts(await DrawingsPage({ searchParams: Promise.resolve(sp) }));
const html = (el: ReactElement) => renderToStaticMarkup(createElement(I18nProvider, { lang: session.lang } as ComponentProps<typeof I18nProvider>, el));

beforeAll(async () => {
  setDb(await openDatabase());
}, 60_000);
beforeEach(() => {
  session.role = 'director';
  session.lang = 'en';
});

describe('/reference/eco', () => {
  it('default state: header with "New ECO" opening Vigie, the register, no drawer', async () => {
    const p = await eco();
    expect(Object.keys(p)).toEqual(['PageHeader', 'EcoRegister']);
    expect(p.PageHeader.props).toMatchObject({ screen: 'eco' });
    const primary = p.PageHeader.props.primary as El;
    expect(primary.props).toMatchObject({ href: 'http://localhost:3200/modifications-techniques/nouvelle?source=keystone', variant: 'primary', plus: true });
    const view = p.EcoRegister.props.view as EcoScreenView;
    expect([view.rows.length, view.filter, p.EcoRegister.props.canEdit]).toEqual([6, 'all', true]);
  });

  it('URL state: status filter, drawer, unknown values', async () => {
    const p = await eco({ status: 'released', eco: 'ECO-2026-015' });
    expect((p.EcoRegister.props.view as EcoScreenView).rows.map((r) => r.number)).toEqual(['ECO-2026-014', 'ECO-2026-012']);
    const d = p.EcoDrawer.props.view as EcoDrawerView;
    expect([d.number, d.closeHref]).toEqual(['ECO-2026-015', '/reference/eco?status=released']);
    const bad = await eco({ status: 'Released', eco: 'ECO-0000-000' });
    expect([(bad.EcoRegister.props.view as EcoScreenView).rows.length, bad.EcoDrawer]).toEqual([6, undefined]);
    // An unknown ECO is dropped from the chip and row links; a lower-case deep link opens the ECO as Vigie writes it.
    expect((bad.EcoRegister.props.view as EcoScreenView).chips[0].href).toBe('/reference/eco');
    const lower = await eco({ eco: ' eco-2026-015 ' });
    const lv = lower.EcoRegister.props.view as EcoScreenView;
    expect([(lower.EcoDrawer.props.view as EcoDrawerView).number, lv.rows.filter((r) => r.selected).map((r) => r.number)]).toEqual(['ECO-2026-015', ['ECO-2026-015']]);
  });

  it('markup: Vigie links open outside Keystone; editors get the step button, outside viewers none', async () => {
    const markup = html((await eco()).EcoRegister);
    expect(markup).toContain('href="http://localhost:3200/modifications-techniques/ECO-2026-015" target="_blank" rel="noopener noreferrer"');
    expect(markup).toContain('aria-label="Open in Vigie ECO-2026-017"');
    expect(markup).toContain('>Start impact analysis</button>');
    expect(markup).toContain('>Set interchangeability</span>');
    session.role = 'member';
    const out = await eco({ eco: 'ECO-2026-015' });
    expect([out.EcoRegister.props.canEdit, out.EcoDrawer.props.canEdit]).toEqual([false, false]);
    expect(html(out.EcoRegister)).not.toContain('Start impact analysis</button>');
  });

  it('drawer per persona: "Manage in Vigie" replaces the prototype controls; only the PM gets Approve on ECO-2026-015', async () => {
    const d = async (role: string, n = 'ECO-2026-015') => {
      session.role = role;
      return (await eco({ eco: n })).EcoDrawer.props.view as EcoDrawerView;
    };
    const pm = await d('pm');
    expect([pm.approvals.map((a) => a.canAct), pm.projects.map((x) => x.manage), pm.machines.map((x) => x.manage), pm.interch.manage]).toEqual([[false, false, true], [true, true], [false, false, false], false]);
    const dir = await d('director');
    expect([dir.approvals.some((a) => a.canAct), dir.projects.every((x) => x.manage), dir.machines.every((x) => x.manage), dir.hint]).toEqual([false, true, true, 'Switch to Engineering lead, Quality or Project manager (bottom-left) to approve.']);
    const ql = await d('quality', 'ECO-2026-016');
    expect([ql.interch.manage, ql.approvals.some((a) => a.canAct), ql.hint]).toEqual([true, false, 'Approvals open once the impact analysis is submitted.']);
    session.lang = 'fr';
    const proc = await d('procurement');
    expect(proc.hint).toBe('Passez en Responsable ingénierie, Qualité ou Chef de projet (en bas à gauche) pour approuver.');
    session.role = 'pm';
    session.lang = 'en';
    // The Drawer itself renders through a portal on the client: render the panel's content.
    const el = (await eco({ eco: 'ECO-2026-015' })).EcoDrawer;
    const panel = (el.type as (p: unknown) => El)(el.props);
    const markup = html(createElement('div', null, panel.props.children));
    expect(markup).toContain('aria-label="Approve ECO-2026-015"');
    expect(markup).toContain('aria-label="Reject ECO-2026-015"');
    expect(markup.match(/>Manage in Vigie</g)?.length).toBe(2); // the two project dispositions (PM)
    expect(markup).toContain('href="http://localhost:3200/modifications-techniques/ECO-2026-015" target="_blank" rel="noopener noreferrer" aria-label="Open in Vigie ECO-2026-015"');
    expect(markup).toContain('href="/reference/parts?part=FD-DET-OPT"');
    expect(markup).toContain('href="/projects/RCF-019/bom"');
    session.role = 'member';
    const outEl = (await eco({ eco: 'ECO-2026-015' })).EcoDrawer;
    const outMarkup = html(createElement('div', null, ((outEl.type as (p: unknown) => El)(outEl.props)).props.children));
    expect([outMarkup.includes('Approve ECO-2026-015'), outMarkup.includes('Manage in Vigie')]).toEqual([false, false]);
  });
});

describe('/reference/drawings', () => {
  it('editors get "Sync vault" (codes as values); outside viewers no primary; URL state and drawer', async () => {
    session.role = 'englead';
    const p = await dwg({ state: 'released', q: 'bracket', dwg: 'DWG-MC-0031-2' });
    const primary = p.PageHeader.props.primary as El;
    // R-153 (X-10): no project sub-line; the project a "Current project" run is attached to is named in that option.
    expect(primary.props).toMatchObject({ label: 'Sync vault' });
    expect(primary.props.context).toBeUndefined();
    const form = primary.props.form as { title: string; submit: string; kind: string; fields: { id: string; options: { value: string; label: string }[] }[] };
    expect([form.title, form.submit, form.kind, form.fields.map((f) => f.options.map((o) => `${o.value}=${o.label}`))]).toEqual([
      'Sync vault', 'Synchronise', 'run',
      [['solidworks_3dx=SolidWorks 3DX vault', 'see_electrical=SeeElectrical', 'both=Both'], ['current_project=Current project · #026 · Harbor Line Terminal Expansion', 'all_projects=All projects']],
    ]);
    const view = p.DrawingsRegister.props.view as DrawingsView;
    expect([view.filter, view.q, view.rows.map((r) => r.number)]).toEqual(['released', 'bracket', ['DWG-MC-0031-2']]);
    const d = p.DrawingDrawer.props.view as DrawingDrawerView;
    expect([d.number, d.closeHref, d.ecoHref, d.partHref, d.pdmUrl]).toEqual(['DWG-MC-0031-2', '/reference/drawings?state=released&q=bracket', '/reference/eco?eco=ECO-2026-012', '/reference/parts?part=SG-BRK-SS2', null]);
    const lower = await dwg({ dwg: 'dwg-mc-0031-2' });
    expect([(lower.DrawingDrawer.props.view as DrawingDrawerView).number, (lower.DrawingsRegister.props.view as DrawingsView).rows.filter((r) => r.selected).map((r) => r.number)])
      .toEqual(['DWG-MC-0031-2', ['DWG-MC-0031-2']]);
    session.role = 'procurement';
    const out = await dwg({ state: 'nope' });
    expect([out.PageHeader.props.primary, (out.DrawingsRegister.props.view as DrawingsView).filter, out.DrawingDrawer]).toEqual([undefined, 'all', undefined]);
  });
});
