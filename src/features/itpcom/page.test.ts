// Page wiring of /projects/[code]/itp and /projects/[code]/commissioning (seeded in-memory database, mocked session):
// URL state (`?view=plan|punch`), the header primary per view ("Add inspection" / "Add punch item") and "Plan SAT", and
// the edit rights per persona — compared with the prototype's `hasPrimary` (itpcom.golden.json header: outside roles and
// a PM or client on another project get none). On a project without a commissioning plan "Plan SAT" offers the
// inspection template's systems, as the prototype's `ITPSYS`. The pages are called as functions and their element trees
// inspected (no Next runtime).
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
import CommissioningPage from '@/app/(app)/projects/[code]/commissioning/page';
import ItpPage from '@/app/(app)/projects/[code]/itp/page';
import GOLDEN from '@/domain/itpcom.golden.json';
import { setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import type { CommissioningScreenView, ItpScreenView } from './model';

/* eslint-disable @typescript-eslint/no-explicit-any */
type El = ReactElement<Record<string, unknown> & { children?: ReactNode }>;
function parts(tree: unknown): Record<string, El> {
  const out: Record<string, El> = {};
  const kids = (tree as El).props.children;
  for (const k of (Array.isArray(kids) ? kids : [kids]) as unknown[]) {
    if (isValidElement(k) && typeof k.type === 'function') out[(k.type as { name: string }).name] = k as El;
  }
  return out;
}
const itp = async (sp: Record<string, string> = {}, code = 'HLT-026') => parts(await ItpPage({ params: Promise.resolve({ code }), searchParams: Promise.resolve(sp) }));
const cm = async (code = 'HLT-026') => parts(await CommissioningPage({ params: Promise.resolve({ code }) }));
const ROLES = ['director', 'pm', 'depthead', 'member', 'englead', 'quality', 'procurement', 'client'];
/** R-041 (P-2): workspace personas not on the project's named team (Harbor Line has the seeded referents). */
const OFF_TEAM: Record<string, string[]> = { 'HLT-026': [], 'NDC-031': ['englead', 'quality'] };
const G = GOLDEN as any;

beforeAll(async () => {
  setDb(await openDatabase());
}, 60_000);
beforeEach(() => {
  session.role = 'director';
  session.lang = 'en';
});

describe('/projects/[code]/itp', () => {
  it('default view: plan, header with "Add inspection" (systems of the template), editable body', async () => {
    const p = await itp();
    expect(Object.keys(p)).toEqual(['PageHeader', 'ItpBody']);
    expect(p.PageHeader.props).toMatchObject({ screen: 'itp', projectCode: 'HLT-026' });
    const primary = p.PageHeader.props.primary as El;
    expect(primary.props).toMatchObject({ kind: 'inspection', code: 'HLT-026', label: 'Add inspection', context: '#026 · Harbor Line Terminal Expansion' });
    expect((primary.props.form as any).fields[1].options.map((o: any) => o.value)).toEqual(G.forms.en.itp.fields[1].options);
    const body = p.ItpBody.props as { view: ItpScreenView; canEdit: boolean };
    expect([body.view.view, !!body.view.plan, body.view.punch, body.canEdit]).toEqual(['plan', true, null, true]);
  });

  it('?view=punch: "Add punch item" with the TEAM owners; unknown view → plan', async () => {
    session.lang = 'fr';
    const p = await itp({ view: 'punch' });
    const primary = p.PageHeader.props.primary as El;
    expect(primary.props).toMatchObject({ kind: 'punch', label: 'Ajouter une réserve' });
    // R-041 (P-2): the seeded referents of Harbor Line (engineering lead, quality manager) are on its named team → owners too.
    expect((primary.props.form as any).fields.find((f: any) => f.id === 'owner').options).toEqual([...G.forms.fr.punch.fields.find((f: any) => f.id === 'owner').options, 'Antoine Girard', 'Gabriel Comte']);
    expect((p.ItpBody.props.view as ItpScreenView).punch!.rows.length).toBe(5);
    expect(((await itp({ view: 'gantt' })).ItpBody.props.view as ItpScreenView).view).toBe('plan');
  });

  it.each(['HLT-026', 'NDC-031'])('%s: primary and row steps per persona (prototype hasPrimary)', async (code) => {
    for (const role of ROLES) {
      session.role = role;
      // R-042 (P-10a): the client persona (Harbor Line's organisation) is sent home from another organisation's project.
      if (role === 'client' && code !== 'HLT-026') {
        await expect(itp({}, code)).rejects.toThrow('REDIRECT /');
        continue;
      }
      for (const view of ['plan', 'punch']) {
        const p = await itp({ view }, code);
        const g = G.header.itp[code][role];
        // R-041 (P-2): write rights follow the named team — off-team personas read (was: every workspace role edited).
        const has = g.hasPrimary && !OFF_TEAM[code].includes(role);
        expect([role, view, !!p.PageHeader.props.primary, p.ItpBody.props.canEdit]).toEqual([role, view, has, has]);
      }
    }
  });

  it('projects without a plan or data: empty plan, the primary still offered to editors', async () => {
    const p = await itp({}, 'EWA-051');
    expect((p.ItpBody.props.view as ItpScreenView).plan!.empty).toBe('No inspection plan for this project yet · pick a template when creating the project');
    expect(((p.PageHeader.props.primary as El).props.form as any).fields[1].options.map((o: any) => o.value)).toEqual(['General']);
    await expect(itp({}, 'XXX-999')).rejects.toThrow('NOT_FOUND');
  });
});

describe('/projects/[code]/commissioning', () => {
  it('HLT-026: header with "Plan SAT" (run form, defaults from the plan and the client contacts), the grid', async () => {
    const p = await cm();
    expect(Object.keys(p)).toEqual(['PageHeader', 'CommissioningBody']);
    expect(p.PageHeader.props).toMatchObject({ screen: 'commissioning', projectCode: 'HLT-026' });
    const primary = p.PageHeader.props.primary as El;
    expect(primary.props).toMatchObject({ kind: 'sat', code: 'HLT-026', label: 'Plan SAT' });
    const form = primary.props.form as any;
    expect([form.kind, form.fields.map((f: any) => f.defaultValue ?? f.options?.[0]?.value)]).toEqual(['run', G.forms.en.commissioning.fields.map((f: any) => f.value)]);
    expect((p.CommissioningBody.props.view as CommissioningScreenView).rows.length).toBe(6);
  });

  it.each(['HLT-026', 'NDC-031'])('%s: primary per persona (prototype hasPrimary)', async (code) => {
    for (const role of ROLES) {
      session.role = role;
      if (role === 'client' && code !== 'HLT-026') {
        await expect(cm(code)).rejects.toThrow('REDIRECT /'); // R-042 (P-10a)
        continue;
      }
      const p = await cm(code);
      const g = G.header.commissioning[code][role];
      expect([role, !!p.PageHeader.props.primary]).toEqual([role, g.hasPrimary && !OFF_TEAM[code].includes(role)]); // R-041 (P-2)
    }
  });

  it('projects without a commissioning plan: the empty panel; "Plan SAT" on the inspection template systems, no default date', async () => {
    const p = await cm('NDC-031');
    expect(p.CommissioningBody.props.view).toBeNull();
    const form = (p.PageHeader.props.primary as El).props.form as any;
    expect([form.fields[0].options.map((o: any) => o.value), form.fields[1].defaultValue]).toEqual([G.forms.en.itpNdc.fields[1].options, '']);
    expect((await cm('EWA-051')).CommissioningBody.props.view).toBeNull();
  });
});
