// Page wiring of /projects/[code]/site (seeded in-memory database, mocked session): URL state (`?tab=`), the header
// primary "Daily report" and the edit rights per persona — compared with the prototype's `hasPrimary` (site.golden.json
// header: outside roles and a PM on another PM's project get none). Deliberate: a project without a site sheet gets no
// primary (the prototype showed "Daily report" there too, with nothing to report on). The page is called as a function
// and its element tree inspected (no Next runtime).
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
import SitePage from '@/app/(app)/projects/[code]/site/page';
import GOLDEN from '@/domain/site.golden.json';
import { setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import type { SiteView } from './model';

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
const page = async (sp: Record<string, string> = {}, code = 'HLT-026') => parts(await SitePage({ params: Promise.resolve({ code }), searchParams: Promise.resolve(sp) }));
const ROLES = ['director', 'pm', 'depthead', 'member', 'englead', 'quality', 'procurement', 'client'];
/** R-041 (P-2): workspace personas not on the project's named team. */
const OFF_TEAM: Record<string, string[]> = { 'HLT-026': ['depthead'], 'NDC-031': ['depthead', 'englead', 'quality'] };

beforeAll(async () => {
  setDb(await openDatabase());
}, 60_000);
beforeEach(() => {
  session.role = 'director';
  session.lang = 'en';
});

describe('/projects/[code]/site', () => {
  it('default state: header with "Daily report", the Readiness tab', async () => {
    const p = await page();
    expect(Object.keys(p)).toEqual(['PageHeader', 'SiteBody']);
    expect(p.PageHeader.props).toMatchObject({ screen: 'site', projectCode: 'HLT-026' });
    const primary = p.PageHeader.props.primary as El;
    expect(primary.props).toMatchObject({ code: 'HLT-026', context: '#026 · Harbor Line Terminal Expansion', execHref: '/projects/HLT-026/site?tab=exec' });
    expect((primary.props.form as any).title).toBe('Daily report');
    const body = p.SiteBody.props as { view: SiteView; canEdit: boolean; code: string };
    expect([body.code, body.view.tab, body.canEdit, body.view.empty]).toEqual(['HLT-026', 'ready', true, null]);
    expect(body.view.segs.map((s) => [s.value, s.href])).toEqual([
      ['ready', '/projects/HLT-026/site'], ['team', '/projects/HLT-026/site?tab=team'], ['exec', '/projects/HLT-026/site?tab=exec'],
    ]);
  });

  it('?tab= selects the tab (unknown → Readiness & go); FR labels', async () => {
    const tab = async (sp: Record<string, string>) => (await page(sp)).SiteBody.props.view as SiteView;
    expect((await tab({ tab: 'team' })).tab).toBe('team');
    expect((await tab({ tab: 'exec' })).tab).toBe('exec');
    expect((await tab({ tab: 'Team' })).tab).toBe('ready');
    session.lang = 'fr';
    expect((await tab({})).segs.map((s) => s.label)).toEqual((GOLDEN as any).seed.fr.seg);
    expect(((await page()).PageHeader.props.primary as El).props.form).toMatchObject({ title: 'Rapport journalier', submit: 'Enregistrer le rapport' });
  });

  it.each(['HLT-026', 'NDC-031'])('%s: primary and edit rights per persona (prototype hasPrimary; none without a site sheet)', async (code) => {
    for (const role of ROLES) {
      session.role = role;
      if (role === 'client') {
        await expect(page({}, code)).rejects.toThrow('REDIRECT /'); // R-042 (P-1): Site is outside the client's workspace
        continue;
      }
      const p = await page({}, code);
      const g = (GOLDEN as any).header[code][role];
      const hasSheet = code === 'HLT-026';
      // R-041 (P-2): write rights follow the named team — off-team personas read (was: every workspace role edited).
      const has = g.hasPrimary && hasSheet && !OFF_TEAM[code].includes(role);
      expect([role, !!p.PageHeader.props.primary, p.SiteBody.props.canEdit]).toEqual([role, has, has]);
    }
  });

  it('a project without a site sheet: empty state; an unknown project → not found', async () => {
    const v = (await page({}, 'EWA-051')).SiteBody.props.view as SiteView;
    expect([v.empty, v.ready]).toEqual(['The site module opens when the project reaches the Expédition stage — no site sheet yet for this project.', null]);
    await expect(page({}, 'XXX-999')).rejects.toThrow('NOT_FOUND');
  });
});
