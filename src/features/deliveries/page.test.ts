// Page wiring of /projects/[code]/deliveries (seeded in-memory database, mocked session): URL state (`?status=`,
// `?receipt=`), the header primary "Announce a delivery" and the edit / QC rights per persona — compared with the
// prototype's `hasPrimary` (deliveries.golden.json header: outside roles and a PM on another PM's project get none).
// The page is called as a function and its element tree inspected (no Next runtime).
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
import DeliveriesPage from '@/app/(app)/projects/[code]/deliveries/page';
import GOLDEN from '@/domain/deliveries.golden.json';
import { setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import type { DeliveriesView } from './model';

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
const page = async (sp: Record<string, string> = {}, code = 'HLT-026') => parts(await DeliveriesPage({ params: Promise.resolve({ code }), searchParams: Promise.resolve(sp) }));
const ROLES = ['director', 'pm', 'depthead', 'member', 'englead', 'quality', 'procurement', 'client'];

beforeAll(async () => {
  setDb(await openDatabase());
}, 60_000);
beforeEach(() => {
  session.role = 'director';
  session.lang = 'en';
});

describe('/projects/[code]/deliveries', () => {
  it('default state: header with "Announce a delivery", the register, no drawer', async () => {
    const p = await page();
    expect(Object.keys(p)).toEqual(['PageHeader', 'DeliveriesBody']);
    expect(p.PageHeader.props).toMatchObject({ screen: 'deliveries', projectCode: 'HLT-026' });
    const primary = p.PageHeader.props.primary as El;
    expect(primary.props).toMatchObject({ code: 'HLT-026', context: '#026 · Harbor Line Terminal Expansion', path: '/projects/HLT-026/deliveries', status: null });
    expect((primary.props.form as any).fields[0].options.map((o: any) => o.value)).toEqual(['PO-1052', 'PO-1063', 'PO-1071']);
    const body = p.DeliveriesBody.props as { view: DeliveriesView; canEdit: boolean; canQc: boolean; registerForms: Record<string, unknown> };
    expect([body.view.rows.length, body.view.drawer, body.canEdit, body.canQc, Object.keys(body.registerForms)]).toEqual([5, null, true, true, ['BL-2026-0540']]);
  });

  it('?status= filters (unknown → All); ?receipt= (alias ?deliv=) opens the drawer (case-insensitive, unknown → none)', async () => {
    const v = async (sp: Record<string, string>) => (await page(sp)).DeliveriesBody.props.view as DeliveriesView;
    expect((await v({ status: 'accepted' })).rows.map((r) => r.id)).toEqual(['BL-2026-0412', 'BL-2026-0498']);
    expect((await v({ status: 'Accepted' })).rows).toHaveLength(5);
    expect((await v({ receipt: 'bl-2026-0533' })).drawer?.id).toBe('BL-2026-0533');
    expect((await v({ receipt: 'BL-2026-9999' })).drawer).toBeNull();
    // `?deliv=` (the prototype's state key) is an alias; the drawer then closes to the plain register.
    const alias = await v({ deliv: 'BL-2026-0521' });
    expect([alias.drawer?.id, alias.drawer?.closeHref]).toEqual(['BL-2026-0521', '/projects/HLT-026/deliveries']);
    expect((await v({ receipt: ' ' })).drawer).toBeNull();
    session.lang = 'fr';
    expect((await v({ status: 'rejected' })).empty).toBe(true);
  });

  it.each(['HLT-026', 'NDC-031'])('%s: primary, edit and QC rights per persona (prototype hasPrimary; QC for quality, procurement, director)', async (code) => {
    for (const role of ROLES) {
      session.role = role;
      // R-042 (P-1): Deliveries is outside the client's workspace — the client is sent home.
      if (role === 'client') {
        await expect(page({}, code)).rejects.toThrow('REDIRECT /');
        continue;
      }
      const p = await page({}, code);
      const body = p.DeliveriesBody.props as { canEdit: boolean; canQc: boolean };
      // R-041 (P-2): the prototype's rights, on the projects whose named team the persona is on — the quality manager is a referent
      // of Harbor Line, not of NDC-031 (read-only there).
      const g = { hasPrimary: (GOLDEN as any).header[code][role].hasPrimary && !(role === 'quality' && code === 'NDC-031') };
      expect([role, !!p.PageHeader.props.primary, body.canEdit]).toEqual([role, g.hasPrimary, g.hasPrimary]);
      expect([role, body.canQc]).toEqual([role, g.hasPrimary && ['director', 'quality', 'procurement'].includes(role)]);
    }
  });

  it('a project without receipts: empty register, the form says no order is waiting', async () => {
    const p = await page({}, 'EWA-051');
    expect((p.DeliveriesBody.props.view as DeliveriesView).empty).toBe(true);
    expect((p.PageHeader.props.primary as El).props.form).toBeNull();
  });
});
