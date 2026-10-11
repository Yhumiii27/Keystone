// Page wiring of /projects/[code]/engineering and /projects/[code]/engineering/[discipline] (seeded in-memory database,
// mocked session): the primary action "Import a list" and its presets, `?import=` opening the wizard (unknown target →
// none), `?status=` chips, the empty state of a project without a register, the outside-workspace rule per persona
// (no primary, no wizard, no row action), "Validate release (PM)" for the PM / director only, the unknown discipline
// segment (404), and the rendered markup in EN and FR. The pages are called as functions and their element trees
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
  usePathname: () => '/projects/HLT-026/engineering',
  useRouter: () => ({ push() {}, replace() {}, refresh() {} }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('./actions', () => ({
  confirmInputAction: vi.fn(), closeCheckAction: vi.fn(), deliverableStepAction: vi.fn(), generateOutputAction: vi.fn(), importListAction: vi.fn(),
}));
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
import DisciplinePage from '@/app/(app)/projects/[code]/engineering/[discipline]/page';
import SynthesisPage from '@/app/(app)/projects/[code]/engineering/page';
import { I18nProvider } from '@/i18n/client';
import { setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import type { DisciplineScreenView, SynthesisScreenView } from './model';
import type { ImportWizardProps } from './import-wizard';

type El = ReactElement<Record<string, unknown> & { children?: ReactNode }>;
function parts(tree: unknown): Record<string, El> {
  const out: Record<string, El> = {};
  const kids = (tree as El).props.children;
  for (const k of (Array.isArray(kids) ? kids : [kids]) as unknown[]) {
    if (isValidElement(k) && typeof k.type === 'function') out[(k.type as { name: string }).name] = k as El;
  }
  return out;
}
const syn = async (sp: Record<string, string> = {}, code = 'HLT-026') =>
  parts(await SynthesisPage({ params: Promise.resolve({ code }), searchParams: Promise.resolve(sp) }));
const dis = async (discipline: string, sp: Record<string, string> = {}, code = 'HLT-026') =>
  parts(await DisciplinePage({ params: Promise.resolve({ code, discipline }), searchParams: Promise.resolve(sp) }));
const html = (el: ReactElement) => renderToStaticMarkup(createElement(I18nProvider, { lang: session.lang } as ComponentProps<typeof I18nProvider>, el));
const primaryHref = (p: Record<string, El>) => (p.PageHeader.props.primary as El | undefined)?.props.href;

beforeAll(async () => {
  setDb(await openDatabase());
}, 60_000);
beforeEach(() => {
  session.role = 'director';
  session.lang = 'en';
});

describe('/projects/[code]/engineering', () => {
  it('default: header with "Import a list" (Electrical, instrument list, SeeElectrical), the synthesis, no wizard', async () => {
    const p = await syn();
    expect(Object.keys(p)).toEqual(['PageHeader', 'SynthesisBody']);
    expect(p.PageHeader.props).toMatchObject({ screen: 'eng', projectCode: 'HLT-026' });
    expect(primaryHref(p)).toBe('/projects/HLT-026/engineering?import=elec&doc=LST-INS-026&tool=2');
    const v = p.SynthesisBody.props.view as SynthesisScreenView;
    expect([v.kpis.map((k) => k.value), v.gate.text, v.discCards.map((d) => d.href)]).toEqual([
      // E-5 = a (R-105): 3 outdated inputs — LST-IO-026 rev B (Frozen) is up to date (prototype 4).
      ['4', '3', '5 / 13', '2 / 6'],
      'Blocked by 4 blocking inconsistencies',
      ['/projects/HLT-026/engineering/process', '/projects/HLT-026/engineering/mechanical', '/projects/HLT-026/engineering/electrical', '/projects/HLT-026/engineering/automation'],
    ]);
    expect(v.gate.items.map((c) => [c.number, c.href])).toEqual([
      ['C-01', '/projects/HLT-026/engineering/electrical'], ['C-02', '/projects/HLT-026/engineering/automation'],
      ['C-03', '/projects/HLT-026/engineering/electrical'], ['C-04', '/projects/HLT-026/engineering/automation'],
    ]);
  });

  it('?import= opens the wizard on a known target; an unknown one opens nothing', async () => {
    const p = await syn({ import: 'elec', doc: 'LST-INS-026', tool: '2' });
    const w = p.ImportWizard.props as unknown as ImportWizardProps;
    expect([w.from, w.target, w.closeHref, w.model.target, w.model.file]).toEqual([
      'eng', { disc: 'elec', doc: 'LST-INS-026', tool: 2 }, '/projects/HLT-026/engineering', 'Instrument list · rev D → Electrical', 'LST-INS-026_revD.xlsx · 27 rows',
    ]);
    const unknown: Record<string, string>[] = [{ import: 'client', doc: 'LST-INS-026' }, { import: 'elec', doc: 'BOD-CLI-026' }, { import: 'elec' }];
    for (const sp of unknown) expect((await syn(sp)).ImportWizard).toBeUndefined();
  });

  it('a project without a register: the empty state, no primary action', async () => {
    const p = await syn({ import: 'elec', doc: 'LST-INS-026' }, 'NDC-031');
    expect(Object.keys(p)).toEqual(['PageHeader', 'EngEmpty']);
    expect(p.PageHeader.props.primary).toBeUndefined();
    session.lang = 'fr';
    expect(html((await syn({}, 'NDC-031')).EngEmpty)).toContain('Pas encore de registre ingénierie pour ce projet — importez une première liste pour démarrer.');
  });

  it('R-042 (P-1): engineering is outside the client’s workspace — the client is sent home', async () => {
    session.role = 'client';
    await expect(syn({})).rejects.toThrow('REDIRECT /');
    await expect(dis('mechanical', {})).rejects.toThrow('REDIRECT /');
  });

  it('R-041 (P-2): the engineering lead and the quality manager edit Harbor Line (referents), not NDC-031', async () => {
    for (const role of ['englead', 'quality']) {
      session.role = role;
      expect(!!(await syn({}, 'HLT-026')).PageHeader.props.primary, role).toBe(true);
      expect((await syn({}, 'NDC-031')).PageHeader.props.primary, role).toBeUndefined();
    }
  });

  it.each(['depthead', 'member', 'procurement'])('outside the workspace (%s): read-only, no primary, no wizard', async (role) => {
    session.role = role;
    const p = await syn({ import: 'elec', doc: 'LST-INS-026', tool: '2' });
    expect([p.PageHeader.props.primary, p.ImportWizard, !!p.SynthesisBody]).toEqual([undefined, undefined, true]);
  });

  it('renders in English and French', async () => {
    const en = html((await syn()).SynthesisBody);
    expect(en).toContain('Who is waiting for what');
    expect(en).toContain('Gate · Plans &amp; BOM frozen');
    expect(en).toContain('PID · rev C → D');
    session.lang = 'fr';
    const fr = html((await syn()).SynthesisBody);
    expect(fr).toContain('Qui attend quoi de qui');
    expect(fr).toContain('Bloqué par 4 incohérences bloquantes');
    expect(fr).toContain('Impacte Électricité · Automatisme');
  });
});

describe('/projects/[code]/engineering/[discipline]', () => {
  it('each discipline: its screen id, preset and view; unknown segment → 404', async () => {
    const expected: [string, string, string][] = [
      ['process', 'eng-process', '/projects/HLT-026/engineering/process?import=process&doc=GA-HLT-026&tool=1'],
      ['mechanical', 'eng-meca', '/projects/HLT-026/engineering/mechanical?import=meca&doc=LST-INS-026&tool=0'],
      ['electrical', 'eng-elec', '/projects/HLT-026/engineering/electrical?import=elec&doc=LST-INS-026&tool=0'],
      ['automation', 'eng-auto', '/projects/HLT-026/engineering/automation?import=auto&doc=LST-INS-026&tool=0'],
    ];
    for (const [seg, screen, href] of expected) {
      const p = await dis(seg);
      expect([p.PageHeader.props.screen, primaryHref(p)]).toEqual([screen, href]);
    }
    await expect(dis('meca')).rejects.toThrow('NOT_FOUND');
    await expect(dis('electrical', {}, 'XXX-999')).rejects.toThrow('NOT_FOUND');
  });

  it('inputs, deliverables, outputs, checks and links of the Electrical screen (director)', async () => {
    const v = (await dis('electrical')).DisciplineBody.props.view as DisciplineScreenView;
    expect(v.importHref).toBe('/projects/HLT-026/engineering/electrical?import=elec&doc=LST-INS-026&tool=0');
    expect(v.inputs.map((r) => [r.doc, r.docHref, r.canConfirm, r.importHref])).toEqual([
      ['PID-HLT-026', '/projects/HLT-026/documents?doc=PID-HLT-026', false, '/projects/HLT-026/engineering/electrical?import=elec&doc=PID-HLT-026&tool=0'],
      ['LST-INS-026', '/projects/HLT-026/documents?doc=LST-INS-026', false, '/projects/HLT-026/engineering/electrical?import=elec&doc=LST-INS-026&tool=0'],
      ['LST-MOT-026', '/projects/HLT-026/documents?doc=LST-MOT-026', false, null],
      ['GA-HLT-026', '/projects/HLT-026/documents?doc=GA-HLT-026', false, null],
    ]);
    expect(v.docs.map((d) => [d.id, d.canFreeze, d.proposeBlocked, d.blockedText])).toEqual([
      ['SCH-ELE-026', true, false, '2 blocking'], ['BOM-ELE-026', true, false, '2 blocking'], ['LST-IO-026', false, true, '2 blocking'], ['LST-CAB-026', true, false, '2 blocking'],
    ]);
    expect(v.outputs.map((o) => [o.id, o.stateText, o.canGen])).toEqual([['O-03', 'Blocked · 2 blocking', false], ['O-05', 'Blocked · 2 blocking', false]]);
    expect(v.chips.map((c) => [c.label, c.count, c.href])).toEqual([
      ['All', 6, '/projects/HLT-026/engineering/electrical'], ['Open', 5, '/projects/HLT-026/engineering/electrical?status=open'],
      ['Resolved', 1, '/projects/HLT-026/engineering/electrical?status=resolved'],
    ]);
    // The process screen: the client's basis of design is not a Codex record (no link), the input is up to date.
    const pv = (await dis('process')).DisciplineBody.props.view as DisciplineScreenView;
    expect(pv.inputs.map((r) => [r.doc, r.docHref])).toEqual([['BOD-CLI-026', null], ['GA-HLT-026', '/projects/HLT-026/documents?doc=GA-HLT-026']]);
  });

  it('?status= filters the checks (unknown → All) and is kept by the wizard links', async () => {
    const open = (await dis('electrical', { status: 'open' })).DisciplineBody.props.view as DisciplineScreenView;
    expect([open.filter, open.checks.map((c) => c.id), open.importHref]).toEqual([
      'open', ['C-01', 'C-03', 'C-04', 'C-05', 'C-08'], '/projects/HLT-026/engineering/electrical?status=open&import=elec&doc=LST-INS-026&tool=0',
    ]);
    const bad = (await dis('electrical', { status: 'Resolved' })).DisciplineBody.props.view as DisciplineScreenView;
    expect([bad.filter, bad.checks.length]).toEqual(['all', 6]);
    const w = (await dis('electrical', { status: 'open', import: 'elec', doc: 'PID-HLT-026', tool: '0' })).ImportWizard.props as unknown as ImportWizardProps;
    expect([w.from, w.target, w.closeHref]).toEqual(['elec', { disc: 'elec', doc: 'PID-HLT-026', tool: 0 }, '/projects/HLT-026/engineering/electrical?status=open']);
  });

  it.each(['depthead', 'member', 'procurement'])('outside the workspace (%s): no primary, no wizard, no row action', async (role) => {
    session.role = role;
    const p = await dis('mechanical', { import: 'meca', doc: 'LST-INS-026', tool: '0' });
    const v = p.DisciplineBody.props.view as DisciplineScreenView;
    expect([p.PageHeader.props.primary, p.ImportWizard, v.importHref]).toEqual([undefined, undefined, null]);
    expect([
      v.inputs.some((r) => r.canConfirm || r.importHref), v.docs.some((d) => d.canFreeze || d.canPropose || d.canValidate),
      v.outputs.some((o) => o.canGen), v.checks.some((c) => c.canAct),
    ]).toEqual([false, false, false, false]);
    // Information stays: the release gate text.
    expect(v.docs.find((d) => d.id === 'BOM-MEC-026')).toMatchObject({ proposeBlocked: false, status: 'Frozen' });
  });

  it.each(['pm', 'englead', 'quality'])('in the workspace (%s): row actions', async (role) => {
    session.role = role;
    const v = (await dis('mechanical')).DisciplineBody.props.view as DisciplineScreenView;
    expect([v.inputs.filter((r) => r.canConfirm).map((r) => r.doc), v.docs.filter((d) => d.canPropose).map((d) => d.id), v.outputs.filter((o) => o.canGen).map((o) => o.id)]).toEqual([
      ['PID-HLT-026', 'LST-INS-026'], ['BOM-MEC-026'], ['O-02', 'O-04'],
    ]);
  });

  it('renders in English and French, with the row actions', async () => {
    const en = html((await dis('electrical')).DisciplineBody);
    expect(en).toContain('aria-label="Import new rev PID-HLT-026"');
    expect(en).toContain('aria-label="Freeze SCH-ELE-026"');
    expect(en).toContain('aria-label="Resolve here C-01"');
    expect(en).toContain('Release blocked · 2 blocking');
    session.lang = 'fr';
    const fr = html((await dis('mechanical')).DisciplineBody);
    expect(fr).toContain('Référent');
    expect(fr).toContain('1 gelé');
    expect(fr).toContain('Proposer la diffusion');
    expect(fr).toContain('Générer xlsx');
  });
});
