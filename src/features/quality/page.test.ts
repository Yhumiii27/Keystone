// Page wiring of /projects/[code]/quality (seeded in-memory database, mocked session): URL state (tab, filters, drawers,
// case-insensitive and unknown values), "New NCR" opening Vigie's report form, the outside-workspace and read-only rules
// per persona, the client's view (no Vigie link, decides its organisation's deliverables), projects without data, and
// the rendered markup of both registers and both drawers in EN and FR. The page is called as a function and its element
// tree inspected (no Next runtime).
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const session = { role: 'director' as string, lang: 'en' as 'en' | 'fr' };
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT ${url}`);
  },
  notFound: () => {
    throw new Error('NOT_FOUND');
  },
  usePathname: () => '/projects/HLT-026/quality',
  useRouter: () => ({ push() {}, replace() {}, refresh() {} }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('./actions', () => ({
  advanceNcrAction: vi.fn(), verifyNcrAction: vi.fn(), moveDeliverableAction: vi.fn(), decideDeliverableAction: vi.fn(),
  rejectDeliverableWithCommentsAction: vi.fn(), linkDeliverableDocumentAction: vi.fn(), createDeliverableAction: vi.fn(),
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
import QualityPage from '@/app/(app)/projects/[code]/quality/page';
import { I18nProvider } from '@/i18n/client';
import { setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import type { QualityViewProps } from './quality-view';

type El = ReactElement<Record<string, unknown> & { children?: ReactNode }>;
function parts(tree: unknown): Record<string, El> {
  const out: Record<string, El> = {};
  const kids = (tree as El).props.children;
  for (const k of (Array.isArray(kids) ? kids : [kids]) as unknown[]) {
    if (isValidElement(k) && typeof k.type === 'function') out[(k.type as { name: string }).name] = k as El;
  }
  return out;
}
const page = async (sp: Record<string, string> = {}, code = 'HLT-026') => parts(await QualityPage({ params: Promise.resolve({ code }), searchParams: Promise.resolve(sp) }));
const props = (p: Record<string, El>) => p.QualityView.props as unknown as QualityViewProps;
const html = (el: ReactElement) => renderToStaticMarkup(createElement(I18nProvider, { lang: session.lang } as ComponentProps<typeof I18nProvider>, el));
/** The Drawer renders through a portal on the client: render the panel's content. */
const drawerHtml = (el: ReactElement) => {
  const drawer = (el.type as (p: unknown) => El)(el.props);
  return html(createElement('div', null, drawer.props.children));
};

beforeAll(async () => {
  setDb(await openDatabase());
}, 60_000);
beforeEach(() => {
  session.role = 'director';
  session.lang = 'en';
});

describe('/projects/[code]/quality', () => {
  it('default: NCR log, "New NCR" opens Vigie’s report form for the project, no drawer', async () => {
    const p = await page();
    expect(Object.keys(p)).toEqual(['PageHeader', 'QualityView']);
    expect(p.PageHeader.props).toMatchObject({ screen: 'quality', projectCode: 'HLT-026' });
    const primary = p.PageHeader.props.primary as El;
    expect(primary.props).toMatchObject({ href: 'http://localhost:3200/signaler?type=NC&projet=HLT-026&source=keystone', variant: 'primary', plus: true, label: 'New NCR · Report in Vigie' });
    const v = props(p);
    expect([v.tab, v.ncr?.rows.length, v.dlv, v.ncrDrawer, v.dlvDrawer, v.seg.map((o) => o.href)]).toEqual([
      'ncr', 5, null, null, null, ['/projects/HLT-026/quality', '/projects/HLT-026/quality?tab=dlv'],
    ]);
  });

  it('URL state: tabs, severity / status filters, drawers (case-insensitive), unknown values', async () => {
    const a = props(await page({ filter: 'major', ncr: ' ncr-026 ' }));
    expect([a.ncr?.filter, a.ncr?.rows.map((r) => r.number), a.ncrDrawer?.number, a.ncrDrawer?.closeHref]).toEqual(['major', ['NCR-026', 'NCR-030'], 'NCR-026', '/projects/HLT-026/quality?filter=major']);
    const b = props(await page({ tab: 'dlv', status: 'submitted', dlv: 'd-014' }));
    expect([b.tab, b.ncr, b.dlv?.rows.map((r) => r.number), b.dlvDrawer?.number, b.dlvDrawer?.closeHref]).toEqual(['dlv', null, ['D-014', 'D-016'], 'D-014', '/projects/HLT-026/quality?tab=dlv&status=submitted']);
    // `?dlv=` alone opens the deliverables register; `?tab=ncr` ignores a deliverable; unknown values fall back.
    expect([props(await page({ dlv: 'D-015' })).tab, props(await page({ dlv: 'D-015' })).dlvDrawer?.number]).toEqual(['dlv', 'D-015']);
    expect(props(await page({ tab: 'ncr', dlv: 'D-015' })).dlvDrawer).toBeNull();
    const bad = props(await page({ tab: 'x', filter: 'Critical', status: 'nope', ncr: 'NCR-999' }));
    expect([bad.tab, bad.ncr?.filter, bad.ncr?.rows.length, bad.ncrDrawer, bad.ncr?.chips[0].href]).toEqual(['ncr', 'all', 5, null, '/projects/HLT-026/quality']);
    const unknownDlv = props(await page({ tab: 'dlv', dlv: 'D-999', status: 'Accepted' }));
    expect([unknownDlv.dlvDrawer, unknownDlv.dlv?.filter, unknownDlv.dlv?.rows.length]).toEqual([null, 'all', 10]);
  });

  it('personas: outside viewers and read-only projects get no buttons; the client gets no Vigie link and decides its deliverables', async () => {
    for (const role of ['depthead', 'member', 'procurement']) {
      session.role = role;
      const v = props(await page({}));
      expect(v.ncr!.rows.every((r) => r.action === null), role).toBe(true);
      const d = props(await page({ tab: 'dlv' }));
      expect(d.dlv!.rows.every((r) => r.action === null), role).toBe(true);
    }
    session.role = 'pm';
    const ro = props(await page({ tab: 'dlv' }, 'NDC-031'));
    expect([ro.dlv!.rows.length, ro.dlv!.rows.every((r) => r.action === null)]).toEqual([4, true]);
    const own = props(await page({}));
    expect(own.ncr!.rows.map((r) => r.action?.label ?? null)).toEqual(['→ Verification', null, '→ Root cause', '→ Corrective action', '→ Containment']);
    session.role = 'client';
    const c = await page({ tab: 'dlv', dlv: 'D-014' });
    expect(c.PageHeader.props.primary).toBeUndefined();
    const cv = props(c);
    expect(cv.dlv!.rows.filter((r) => r.action?.kind === 'decide').map((r) => r.number)).toEqual(['D-014', 'D-016']);
    expect([cv.dlvDrawer!.canDecide, cv.dlvDrawer!.canLinkDocument, cv.dlvDrawer!.hint]).toEqual([true, false, '']);
    // P-10b (R-043): no NCR for the client — the screen is the deliverables register (no NCR tab, no NCR drawer, no linked NCR).
    const cn = props(await page({ ncr: 'NCR-030', tab: 'ncr' }));
    expect([cn.tab, cn.ncr, cn.ncrDrawer, cn.seg.map((x) => x.value)]).toEqual(['dlv', null, null, ['dlv']]);
    expect(JSON.stringify(cn.dlv)).not.toContain('NCR-');
    // R-042 (P-10a): another organisation's project is refused (sent home).
    await expect(page({ tab: 'dlv' }, 'NDC-031')).rejects.toThrow('REDIRECT /');
  });

  it('R-115 (Q-3b): on the deliverables register the primary is "New deliverable" for the project’s PM and the director, "New NCR" otherwise', async () => {
    const primaryOf = async (role: string, code = 'HLT-026') => {
      session.role = role;
      const pr = (await page({ tab: 'dlv' }, code)).PageHeader.props.primary as El | undefined;
      return pr ? ((pr.type as { name: string }).name === 'NewDeliverableButton' ? 'new-deliverable' : 'new-ncr') : null;
    };
    const out: Record<string, string | null> = {};
    for (const role of ['director', 'pm', 'depthead', 'member', 'englead', 'quality', 'procurement', 'client']) out[role] = await primaryOf(role);
    expect(out).toEqual({
      director: 'new-deliverable', pm: 'new-deliverable', depthead: 'new-ncr', member: 'new-ncr', englead: 'new-ncr', quality: 'new-ncr', procurement: 'new-ncr', client: null,
    });
    // Another PM's project (read-only for him) and the NCR tab: "New NCR".
    expect(await primaryOf('pm', 'NDC-031')).toBe('new-ncr');
    session.role = 'pm';
    expect(((await page({})).PageHeader.props.primary as El).props).toMatchObject({ label: 'New NCR · Report in Vigie' });
    session.role = 'director';
    const form = ((await page({ tab: 'dlv' })).PageHeader.props.primary as El).props.form as { fields: { id: string; options?: unknown[] }[] };
    expect(form.fields.map((f) => f.id)).toEqual(['type', 'title', 'due', 'wbs', 'r', 'b']);
    expect(form.fields[0].options!.length).toBeGreaterThan(5);
  });

  it('projects without data: empty registers (no Harbor Line fallback)', async () => {
    const v = props(await page({}, 'EWA-051'));
    expect([v.ncr!.rows, v.ncr!.empty, v.ncr!.kpis.map((k) => k.value)]).toEqual([[], 'No non-conformance reported for this project', ['0', '0', '€0k', '0', '0']]);
    const d = props(await page({ tab: 'dlv', dlv: 'D-110' }, 'EWA-051'));
    expect([d.dlv!.rows, d.dlv!.empty, d.dlvDrawer]).toEqual([[], 'No deliverable registered for this project', null]);
    await expect(page({}, 'XXX-999')).rejects.toThrow('NOT_FOUND');
  });

  it('markup (EN): NCR log with Vigie links opening outside Keystone, step buttons, segments; register with avatars and actions', async () => {
    const p = await page({});
    const log = html(p.QualityView);
    expect(log).toContain('href="http://localhost:3200/evenements?etat=tous&amp;type=NC&amp;q=NCR-029" target="_blank" rel="noopener noreferrer" aria-label="Open in Vigie NCR-029"');
    expect(log).toContain('>→ Containment</button>');
    expect(log).toContain('Mirrored from Vigie — NCRs are managed in Vigie');
    expect(log).toContain('Non-conformance log');
    expect(log).toContain('Open → containment → root cause → corrective action → verification → closed · ISO 9001 §8.7');
    expect(log).toContain('aria-current="true"'); // the selected NCR chip "All"
    session.role = 'client';
    const reg = html((await page({ tab: 'dlv' })).QualityView);
    expect(reg).toContain('aria-label="Accept D-014"');
    expect(reg).toContain('aria-label="Reject D-016"');
    expect(reg).toContain('title="Julien Wagner"');
    expect(reg).not.toContain('localhost:3200');
    expect(reg).not.toContain('>Start</button>');
  });

  it('markup: NCR drawer (Vigie links, severity managed in Vigie, record links) and deliverable drawer (FR)', async () => {
    const p = await page({ ncr: 'NCR-030' });
    const nd = (await import('./ncr-drawer')).NcrDrawer;
    const v = props(p);
    const n = drawerHtml(createElement(nd, { code: 'HLT-026', view: v.ncrDrawer!, t: (s: string) => s }) as El);
    expect(n).toContain('>Move to Containment</button>');
    expect(n).toContain('>Manage in Vigie<');
    expect(n).toContain('8D report');
    expect(n).toContain('href="/reference/parts?part=FD-DET-OPT"');
    expect(n).toContain('href="/reference/eco?eco=ECO-2026-015"');
    expect(n).toContain('href="/projects/HLT-026/plan?act=A1430"');
    expect(n).toContain('Hold in quarantine · exchange for CD-210');
    session.lang = 'fr';
    session.role = 'pm';
    const q = await page({ tab: 'dlv', dlv: 'D-016' });
    const dd = (await import('./dlv-drawer')).DeliverableDrawer;
    const { makeT } = await import('@/i18n/translate');
    const d = drawerHtml(createElement(dd, { code: 'HLT-026', view: props(q).dlvDrawer!, context: 'x', t: makeT('fr') }) as El);
    expect(d).toContain('Passez sur le rôle Client (en bas à gauche) pour accepter ou refuser.');
    expect(d).toContain('Déposer le document émis (aperçu PDF)');
    expect(d).toContain('Déposer dans Codex');
    expect(d).toContain('Lier un document Codex');
    expect(d).toContain('Responsable — le produit');
    expect(d).toContain('href="/projects/HLT-026/plan"');
  });
});
