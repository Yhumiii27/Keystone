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
    expect(Object.keys(p)).toEqual(['PageHeader', 'FleetBody']);
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

  it('primary action only for the roles whose workspace has the screen (prototype hasPrimary)', async () => {
    for (const role of ROLES) {
      session.role = role;
      expect(!!(await fleetPage()).PageHeader.props.primary, role).toBe(EDITORS.includes(role));
    }
  });

  it('no Vigie link for the client (Vigie is internal); staff and other outside viewers keep it', async () => {
    const vigieLinks = async () => ((await fleetPage()).FleetBody.props.view as FleetView).rows.filter((r) => r.config?.vigieHref).length;
    expect(await vigieLinks()).toBe(5);
    session.role = 'client';
    expect(await vigieLinks()).toBe(0);
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
      expect(!!(await savPage()).PageHeader.props.primary, role).toBe(EDITORS.includes(role));
    }
    session.zone = 'apac';
    const v = (await savPage({ view: 'interventions' })).SavBody.props.view as SavScreenView;
    expect([v.interventions, v.zoneEmpty]).toEqual([[], 'No project in this zone for this view']);
    // WC-013's design ECO (not reported by Vigie): a Vigie link for staff, a plain tag for the client.
    Object.assign(session, { zone: null, role: 'quality' });
    const ecoOf = async () => ((await savPage()).SavBody.props.view as SavScreenView).claims!.find((c) => c.number === 'WC-013')!.eco!.href;
    expect(await ecoOf()).toMatch(/^http:\/\/localhost:3200\//);
    session.role = 'client';
    expect(await ecoOf()).toBeNull();
  });
});
