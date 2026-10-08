// Page wiring of /projects/[code]/documents and /admin/document-types (seeded in-memory database, mocked session):
// URL state parsing, the primary action, the drawer, the deposit hand-off and the read-only rules per persona. The
// pages are called as functions and their element trees inspected (no Next runtime).
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const session = { role: 'director' as string, lang: 'en' as 'en' | 'fr' };
vi.mock('next/navigation', () => ({
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
import DocumentTypesPage from '@/app/(app)/admin/document-types/page';
import DocumentsPage from '@/app/(app)/projects/[code]/documents/page';
import { setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import type { DepositView, DocDrawerView, VaultView } from './model';

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
const page = async (sp: Record<string, string> = {}, code = 'HLT-026') => parts(await DocumentsPage({ params: Promise.resolve({ code }), searchParams: Promise.resolve(sp) }));

beforeAll(async () => {
  setDb(await openDatabase());
}, 60_000);
beforeEach(() => {
  session.role = 'director';
  session.lang = 'en';
});

describe('/projects/[code]/documents', () => {
  it('default state: header with "Deposit in Codex", the vault, no drawer, no dialog', async () => {
    const p = await page();
    expect(Object.keys(p)).toEqual(['PageHeader', 'DocsVault']);
    expect(p.PageHeader.props).toMatchObject({ screen: 'docs', projectCode: 'HLT-026' });
    const primary = p.PageHeader.props.primary as El;
    expect(primary.props).toMatchObject({ href: '/projects/HLT-026/documents?deposit=new', variant: 'primary' });
    const view = p.DocsVault.props.view as VaultView;
    expect([view.rows.length, view.kpis[0].value, view.title]).toEqual([40, '40', 'Vault · 40 / 40 documents']);
    expect(p.DocsVault.props).toMatchObject({ canEdit: true, openToast: 'Opening Codex · project HLT-026' });
  });

  it('URL state: scope, view, family, status, search; unknown values fall back', async () => {
    const view = (await page({ scope: 'all', view: 'audit', fam: 'quality', status: 'released', q: 'iso' })).DocsVault.props.view as VaultView;
    expect(view.rows.map((r) => r.number)).toEqual(['PRO-QMS-001', 'PRO-QMS-014', 'FRM-QMS-022', 'AUD-QMS-003']);
    expect([view.scope.value, view.views.value, view.families.value, view.statuses.value, view.q]).toEqual(['all', 'audit', 'quality', 'released', 'iso']);
    const bad = (await page({ scope: 'x', view: 'folders', fam: 'Engineering', status: 'Released' })).DocsVault.props.view as VaultView;
    expect([bad.scope.value, bad.views.value, bad.families.value, bad.statuses.value, bad.rows.length]).toEqual(['proj', 'all', 'all', 'all', 40]);
  });

  it('?doc= opens the record drawer for any record (also another project\'s), an unknown one opens nothing', async () => {
    const p = await page({ doc: 'PID-NDC-031' });
    const d = p.DocumentDrawer.props.view as DocDrawerView;
    expect([d.number, d.head, d.closeHref]).toEqual(['PID-NDC-031', 'Document record · PID-NDC-031 · rev B', '/projects/HLT-026/documents']);
    expect((await page({ doc: 'NOPE-1' })).DocumentDrawer).toBeUndefined();
  });

  it('?deposit=new with context, ?deposit=<number> for a new revision', async () => {
    const dep = (await page({ deposit: 'new', dtype: 'PHO', part: 'P-01' })).DepositWizard.props.view as DepositView;
    expect([dep.mode, dep.page, dep.initial.type, dep.initial.part, dep.types.find((x) => x.code === 'PHO')!.number]).toEqual(['new', 'HLT-026', 'PHO', 'P-01', 'PHO-HLT-041']);
    session.lang = 'fr';
    const rev = (await page({ deposit: 'PID-HLT-026', doc: 'PID-HLT-026' })).DepositWizard.props.view as DepositView;
    expect(rev.revision).toMatchObject({ number: 'PID-HLT-026', context: 'PID-HLT-026 · nouvelle révision E', title: 'P&ID' });
    expect(rev.closeHref).toBe('/projects/HLT-026/documents?doc=PID-HLT-026');
    expect((await page({ deposit: 'NOPE-1' })).DepositWizard).toBeUndefined();
  });

  it('every persona has the screen; the project read-only rule does not apply to the vault (logic 5176)', async () => {
    for (const role of ['pm', 'depthead', 'member', 'englead', 'quality', 'procurement', 'client']) {
      session.role = role;
      const p = await page({ deposit: 'new' }, 'NDC-031');
      expect(p.PageHeader.props.primary, role).toBeTruthy();
      expect(p.DepositWizard, role).toBeDefined();
      expect(p.DocsVault.props.canEdit, role).toBe(true);
    }
  });

  it('the approve button follows the named approver (quality for RPT-HLT-014) or the director', async () => {
    const label = async (role: string) => {
      session.role = role;
      return ((await page({ doc: 'RPT-HLT-014' })).DocumentDrawer.props.view as DocDrawerView).approveLabel;
    };
    expect(await label('director')).toBe('Approve in Codex · Quality manager · G. Comte');
    expect(await label('quality')).toBe('Approve in Codex · Quality manager · G. Comte');
    expect(await label('pm')).toBeNull();
    expect(await label('client')).toBeNull();
  });

  it('unknown project → not found', async () => {
    await expect(page({}, 'NOPE-000')).rejects.toThrow('NOT_FOUND');
  });
});

describe('/admin/document-types', () => {
  it('rows, "Edit in Codex" for director / pm / quality only (others are outside their workspace)', async () => {
    const tree = async () => parts(await DocumentTypesPage());
    const p = await tree();
    expect(p.PageHeader.props).toMatchObject({ screen: 'doctypes' });
    expect((p.DocTypesRegister.props.rows as unknown[]).length).toBe(28);
    expect(p.DocTypesRegister.props.editToast).toBe('Opening Codex · project HLT-026');
    for (const [role, edit] of [['pm', true], ['quality', true], ['member', false], ['client', false], ['englead', false]] as const) {
      session.role = role;
      expect(!!(await tree()).DocTypesRegister.props.editToast, role).toBe(edit);
    }
  });
});
