// Page wiring of /after-sales/fleet and /after-sales/claims (seeded in-memory database, mocked session): the header's
// primary action per persona (outside-workspace rule: director, pm, quality, procurement only), the dialog sub-line (the
// current project, as every add-form of the prototype), the zone preference passed to the screen, and the `?view=`
// parameter of the claims screen (unknown → Claims).
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const session = { role: 'director' as string, lang: 'en' as 'en' | 'fr', project: 'HLT-026', zone: null as null | 'euna' | 'afr' | 'apac' };
vi.mock('./actions', () => ({ addMachineAction: vi.fn(), openClaimAction: vi.fn() }));
vi.mock('@/server/session', async () => {
  const { makeT } = await import('@/i18n/translate');
  const { PERSONA_BY_ROLE } = await import('@/config/personas');
  return {
    getViewer: async () => PERSONA_BY_ROLE[session.role as keyof typeof PERSONA_BY_ROLE],
    getI18n: async () => ({ lang: session.lang, t: makeT(session.lang) }),
    getLang: async () => session.lang,
    getLastProject: async () => session.project,
    getZone: async () => session.zone,
    getNavOpen: async () => ({}),
  };
});

import { isValidElement, type ReactElement, type ReactNode } from 'react';
import InstalledBasePage from '@/app/(app)/after-sales/fleet/page';
import WarrantyClaimsPage from '@/app/(app)/after-sales/claims/page';
import { setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import type { FleetView, SavScreenView } from './model';

type El = ReactElement<Record<string, unknown> & { children?: ReactNode }>;
function parts(tree: unknown): Record<string, El> {
  const out: Record<string, El> = {};
  const kids = (tree as El).props.children;
  for (const k of (Array.isArray(kids) ? kids : [kids]) as unknown[]) {
    if (isValidElement(k) && typeof k.type === 'function') out[(k.type as { name: string }).name] = k as El;
  }
  return out;
}
const fleetPage = async () => parts(await InstalledBasePage());
const savPage = async (sp: Record<string, string> = {}) => parts(await WarrantyClaimsPage({ searchParams: Promise.resolve(sp) }));
const ROLES = ['director', 'pm', 'depthead', 'member', 'englead', 'quality', 'procurement', 'client'];
const EDITORS = ['director', 'pm', 'quality', 'procurement'];

beforeAll(async () => {
  setDb(await openDatabase());
}, 60_000);
beforeEach(() => Object.assign(session, { role: 'director', lang: 'en', project: 'HLT-026', zone: null }));

describe('/after-sales/fleet', () => {
  it('header "Add machine" with the current project as the dialog sub-line, then the register', async () => {
    const p = await fleetPage();
    // R-144: the "Delivered projects" card follows the register (it renders nothing without a delivered project).
    expect(Object.keys(p)).toEqual(['PageHeader', 'FleetBody', 'DeliveredCard']);
    expect(p.PageHeader.props).toMatchObject({ screen: 'fleet' });
    const primary = p.PageHeader.props.primary as El;
    expect((primary.type as { name: string }).name).toBe('AddMachineButton');
    expect(primary.props).toMatchObject({ label: 'Add machine', context: '#026 · Harbor Line Terminal Expansion' });
    session.lang = 'fr';
    session.project = 'NDC-031';
    const fr = ((await fleetPage()).PageHeader.props.primary as El).props;
    expect([fr.label, (fr.form as { title: string }).title]).toEqual(['Ajouter une machine', 'Ajouter une machine']);
    expect(fr.context).toMatch(/^#031 · /);
  });

  it('primary action only for the roles whose workspace has the screen (prototype hasPrimary); the client is refused (R-042, P-1)', async () => {
    for (const role of ROLES) {
      session.role = role;
      if (role === 'client') await expect(fleetPage()).rejects.toThrow('NEXT_REDIRECT');
      else expect(!!(await fleetPage()).PageHeader.props.primary, role).toBe(EDITORS.includes(role));
    }
  });

  it('Vigie links for staff and other outside viewers; the client never reaches the register (R-042, P-1)', async () => {
    const vigieLinks = async () => ((await fleetPage()).FleetBody.props.view as FleetView).rows.filter((r) => r.config?.vigieHref).length;
    expect(await vigieLinks()).toBe(5);
    session.role = 'client';
    await expect(vigieLinks()).rejects.toThrow('NEXT_REDIRECT');
    session.role = 'englead';
    expect(await vigieLinks()).toBe(5);
  });

  it('the zone preference filters the machines', async () => {
    session.zone = 'afr';
    const v = (await fleetPage()).FleetBody.props.view as FleetView;
    expect(v.rows.map((r) => r.number)).toEqual(['MCH-044']);
    expect(v.zoneEmpty).toBeNull();
  });
});

describe('/after-sales/claims', () => {
  it('header "New claim", `?view=` parsed (unknown → Claims)', async () => {
    const p = await savPage();
    expect(Object.keys(p)).toEqual(['PageHeader', 'SavBody']);
    expect(p.PageHeader.props).toMatchObject({ screen: 'sav' });
    const primary = p.PageHeader.props.primary as El;
    expect((primary.type as { name: string }).name).toBe('NewClaimButton');
    expect(primary.props).toMatchObject({ label: 'New claim' });
    expect(((primary.props.form as { fields: { id: string; options?: unknown[] }[] }).fields[0].options ?? []).length).toBe(8);
    for (const [view, expected] of [['interventions', 'interventions'], ['costs', 'costs'], ['claims', 'claims'], ['nope', 'claims']] as const) {
      const v = (await savPage({ view })).SavBody.props.view as SavScreenView;
      expect(v.view).toBe(expected);
      expect([!!v.claims, !!v.interventions, !!v.costs]).toEqual([expected === 'claims', expected === 'interventions', expected === 'costs']);
    }
  });

  it('primary action only for the roles whose workspace has the screen; the zone preference applies', async () => {
    for (const role of ROLES) {
      session.role = role;
      // R-042 (P-1): the client is refused outside its workspace (was: read-only page without a primary).
      if (role === 'client') await expect(savPage()).rejects.toThrow('NEXT_REDIRECT');
      else expect(!!(await savPage()).PageHeader.props.primary, role).toBe(EDITORS.includes(role));
    }
    Object.assign(session, { zone: 'apac', role: 'director' });
    const v = (await savPage({ view: 'interventions' })).SavBody.props.view as SavScreenView;
    // R-155 (X-16 + 07 A.1): the zone has a machine, so the notice names the empty list (was the project screens' text).
    expect([v.interventions, v.zoneEmpty]).toEqual([[], 'No intervention in this zone']);
    // WC-013's design ECO (not reported by Vigie): a Vigie link for staff; the client is refused the screen (R-042, P-1).
    Object.assign(session, { zone: null, role: 'quality' });
    const ecoOf = async () => ((await savPage()).SavBody.props.view as SavScreenView).claims!.find((c) => c.number === 'WC-013')!.eco!.href;
    expect(await ecoOf()).toMatch(/^http:\/\/localhost:3200\//);
    session.role = 'client';
    await expect(ecoOf()).rejects.toThrow('NEXT_REDIRECT');
  });
});
