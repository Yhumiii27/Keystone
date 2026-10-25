// Page wiring of /admin/settings, /admin/machine-types and /admin/integrations (seeded in-memory database, mocked
// session): URL state parsing (`?type=`, `?view=`, `?source=`), the primary action given to PageHeader (which hides it
// outside the workspace) and the edit rights handed to the bodies per persona. The pages are called as functions and
// their element trees inspected (no Next runtime).
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
import IntegrationsPage from '@/app/(app)/admin/integrations/page';
import MachineTypesPage from '@/app/(app)/admin/machine-types/page';
import SettingsPage from '@/app/(app)/admin/settings/page';
import { setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import type { MachineTypesView, PlumbingView, SettingsView } from './model';

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
const primaryName = (p: Record<string, El>) => ((p.PageHeader.props.primary as El).type as { name: string }).name;

beforeAll(async () => {
  setDb(await openDatabase());
}, 60_000);
beforeEach(() => {
  session.role = 'director';
  session.lang = 'en';
});

describe('/admin/settings', () => {
  it('header with "Reset to defaults", the body editable by the portfolio director only (A-14)', async () => {
    // A-14: the director edits; the other workspace roles read (no Reset, a read-only note); member is outside; the client is sent home (R-042).
    for (const [role, canEdit, note] of [
      ['director', true, false], ['pm', false, true], ['depthead', false, true], ['englead', false, true], ['quality', false, true], ['procurement', false, true],
      ['member', false, false],
    ] as const) {
      session.role = role;
      const p = parts(await SettingsPage());
      // R-158: the Incoterms card under the lists.
      expect(Object.keys(p)).toEqual(['PageHeader', 'SettingsBody', 'IncotermsCard']);
      expect(p.PageHeader.props.screen).toBe('settings');
      if (canEdit) expect(primaryName(p)).toBe('ResetSettingsButton');
      else expect(p.PageHeader.props.primary, role).toBeUndefined();
      expect(p.SettingsBody.props.canEdit, role).toBe(canEdit);
      expect(p.SettingsBody.props.directorOnlyNote, role).toBe(note);
    }
    // R-042 (P-1): the client is sent home (was: the read-only page).
    session.role = 'client';
    await expect(SettingsPage()).rejects.toThrow('REDIRECT /');
    session.role = 'director';
    session.lang = 'fr';
    const view = parts(await SettingsPage()).SettingsBody.props.view as SettingsView;
    expect(view.cards[0].title).toBe('Emplacements de stock et ateliers');
  });
});

describe('/admin/machine-types', () => {
  const page = async (sp: Record<string, string> = {}) => parts(await MachineTypesPage({ searchParams: Promise.resolve(sp) }));

  it('`?type=` selects a type (stored or display code, any case; unknown → the first)', async () => {
    const p = await page();
    expect(Object.keys(p)).toEqual(['PageHeader', 'MachineTypesBody']);
    expect(p.PageHeader.props.screen).toBe('mtypes');
    expect(primaryName(p)).toBe('NewMachineTypeButton');
    // R-153 (X-10): a machine type is not a project's — no project sub-line (the prototype's `projectName`).
    expect((p.PageHeader.props.primary as El).props.context).toBeUndefined();
    const sel = async (type?: string) => ((await page(type ? { type } : {})).MachineTypesBody.props.view as MachineTypesView).mt!.displayCode;
    expect([await sel(), await sel('memu'), await sel('rnd'), await sel('R&D'), await sel('nope')]).toEqual(['EMP', 'MEMU', 'R&D', 'R&D', 'EMP']);
  });

  it('mtCanEdit: director, PM, engineering lead, quality', async () => {
    for (const [role, canEdit] of [['director', true], ['pm', true], ['englead', true], ['quality', true], ['depthead', false], ['member', false], ['procurement', false]] as const) {
      session.role = role;
      expect((await page()).MachineTypesBody.props.canEdit, role).toBe(canEdit);
    }
    session.role = 'client'; // R-042 (P-1): sent home
    await expect(page()).rejects.toThrow('REDIRECT /');
  });
});

describe('/admin/integrations', () => {
  const page = async (sp: Record<string, string> = {}) => parts(await IntegrationsPage({ searchParams: Promise.resolve(sp) }));

  it('`?view=` / `?source=`; no "Add connector" (D-7a, R-020: IT configures the connectors outside Keystone)', async () => {
    const p = await page();
    expect(Object.keys(p)).toEqual(['PageHeader', 'PlumbingBody']);
    expect(p.PageHeader.props.screen).toBe('plumbing');
    expect(p.PageHeader.props.primary).toBeUndefined();
    const v = (sp: Record<string, string>) => page(sp).then((x) => x.PlumbingBody.props.view as PlumbingView);
    expect((await v({})).view).toBe('activity');
    expect((await v({ view: 'audit' })).view).toBe('audit');
    expect((await v({ view: 'nope' })).view).toBe('activity');
    const stock = await v({ source: 'stock' });
    expect([stock.chipValue, stock.activity.length]).toEqual(['stock', 2]);
    expect((await v({ source: 'nope' })).activity).toHaveLength(12);
  });

  it('director and PM edit (Sync now, export); the others read; the unread KPI is the viewer’s', async () => {
    for (const [role, canEdit, unread] of [['director', true, '3'], ['pm', true, '4'], ['quality', false, null]] as const) {
      session.role = role;
      const p = await page();
      expect(p.PlumbingBody.props.canEdit, role).toBe(canEdit);
      if (unread) expect((p.PlumbingBody.props.view as PlumbingView).kpis[2].value).toBe(unread);
    }
    session.role = 'client'; // R-042 (P-1): sent home
    await expect(page()).rejects.toThrow('REDIRECT /');
  });
});
