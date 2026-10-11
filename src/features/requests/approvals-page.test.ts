// Page wiring of /resources/approvals/[dept] (R-048, P-8a) over the seeded in-memory database (session mocked): a department
// head sees and decides only the departments they head (another department's page sends them to theirs, the chips list theirs
// only); the director decides for every department; the other internal viewers read; the client is sent home (R-042).
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

import { isValidElement, type ReactElement, type ReactNode } from 'react';
import ApprovalsPage from '@/app/(app)/resources/approvals/[dept]/page';
import { setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';

type El = ReactElement<Record<string, unknown> & { children?: ReactNode }>;
function parts(tree: unknown): Record<string, El> {
  const out: Record<string, El> = {};
  const kids = (tree as El).props.children;
  for (const k of (Array.isArray(kids) ? kids : [kids]) as unknown[]) {
    if (isValidElement(k) && typeof k.type === 'function') out[(k.type as { name: string }).name] = k as El;
  }
  return out;
}
const page = async (dept: string) => parts(await ApprovalsPage({ params: Promise.resolve({ dept }) }));
const screen = async (dept: string) => {
  const p = (await page(dept)).ApprovalsScreen.props as { canDecide: boolean; departments: { name: string }[]; department: string };
  return [p.department, p.canDecide, p.departments.map((d) => d.name)] as const;
};

beforeAll(async () => {
  setDb(await openDatabase());
}, 60_000);
beforeEach(() => Object.assign(session, { role: 'director', lang: 'en' }));

describe('/resources/approvals/[dept] (R-048)', () => {
  it('the director decides for every department and sees every chip', async () => {
    const [dept, canDecide, chips] = await screen('quality');
    expect([dept, canDecide, chips.length > 2, chips.includes('Engineering')]).toEqual(['Quality', true, true, true]);
  });

  it('a department head: their department only — another one sends them to theirs', async () => {
    session.role = 'depthead'; // heads Engineering
    expect(await screen('engineering')).toEqual(['Engineering', true, ['Engineering']]);
    await expect(page('quality')).rejects.toThrow('REDIRECT /resources/approvals/engineering');
    session.role = 'quality'; // heads Quality
    expect(await screen('quality')).toEqual(['Quality', true, ['Quality']]);
    await expect(page('engineering')).rejects.toThrow('REDIRECT /resources/approvals/quality');
  });

  it('internal viewers who head no department read every department; the client is sent home; unknown slug → 404', async () => {
    session.role = 'pm';
    const [, canDecide, chips] = await screen('engineering');
    expect([canDecide, chips.length > 2]).toEqual([false, true]);
    session.role = 'client';
    await expect(page('engineering')).rejects.toThrow(/^REDIRECT \/$/);
    session.role = 'director';
    await expect(page('nope')).rejects.toThrow('NOT_FOUND');
  });
});
