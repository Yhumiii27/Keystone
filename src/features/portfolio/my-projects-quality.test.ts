// S-32 — My projects shows the register's "Schedule quality" cell (S-23) on the viewer's own live projects: same counter and hint,
// linked to the project's Schedule when the viewer sees it; not on the fallback wall (the whole portfolio); the card stays one
// clickable surface without nested links.
import { beforeAll, describe, expect, it, vi } from 'vitest';
const jar = new Map<string, string>();
vi.mock('next/headers', () => ({ cookies: async () => ({ get: (k: string) => (jar.has(k) ? { name: k, value: jar.get(k)! } : undefined) }) }));
vi.mock('next/navigation', () => ({ usePathname: () => '/my/projects', useRouter: () => ({ push() {}, refresh() {} }), redirect: (u: string) => { throw new Error(`REDIRECT ${u}`); }, notFound: () => { throw new Error('NOT_FOUND'); } }));
import { createElement as h, isValidElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import MyProjectsPage from '@/app/(app)/my/projects/page';
import { canSee } from '@/config/role-screens';
import { PERSONAS } from '@/config/personas';
import { I18nProvider } from '@/i18n/client';
import { setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { COOKIE } from '@/server/session';
import type { RegisterRow } from '@/features/projects/register-model';
import { MyProjectsBody } from './my-projects';

type BodyProps = Parameters<typeof MyProjectsBody>[0];
const as = (role: string, lang = 'en') => {
  jar.clear();
  jar.set(COOKIE.role, role);
  jar.set(COOKIE.lang, lang);
};
const body = async () => {
  const el = (await MyProjectsPage()) as ReactElement<{ children: ReactElement[] }>;
  return el.props.children.filter(isValidElement).find((c) => c.type === MyProjectsBody) as ReactElement<BodyProps>;
};
const html = (b: ReactElement<BodyProps>, lang: 'en' | 'fr' = 'en') => renderToStaticMarkup(h(I18nProvider, { lang, children: h(MyProjectsBody, b.props) }));

describe('My projects · schedule quality (S-32)', () => {
  beforeAll(async () => {
    setDb(await openDatabase());
  }, 60_000);

  it('the project manager: his live projects, the register’s cell linked to the Schedule', async () => {
    as('pm');
    const b = await body();
    expect(b.props.data.fallback).toBe(false);
    const q = b.props.quality!;
    const codes = b.props.data.cards.map((c) => c.project.code);
    expect(Object.keys(q).length).toBeGreaterThan(0);
    expect(Object.keys(q).every((c) => codes.includes(c))).toBe(true);
    const hlt = q['HLT-026'] as NonNullable<RegisterRow['quality']>;
    expect(hlt).toMatchObject({ href: '/projects/HLT-026/schedule' });
    expect(hlt.text).toMatch(/^Fail · \d+$/);
    expect(hlt.title).toMatch(/^Non-compliant DCMA checks · \d+ \/ \d+ applicable/);
    const out = html(b);
    expect(out).toContain('Schedule quality');
    expect(out).toContain('href="/projects/HLT-026/schedule"');
    // The card still opens the Plan, and no link is nested in another.
    expect(out).toContain('href="/projects/HLT-026/plan"');
    expect(/<a\b[^>]*>(?:(?!<\/a>)[\s\S])*<a\b/.test(out)).toBe(false);
    as('pm', 'fr');
    const fr = html(await body(), 'fr');
    expect(fr).toContain('Qualité du planning');
    expect(fr).toContain('Contrôles DCMA non conformes');
  }, 120_000);

  it('every persona: the link follows the Schedule screen; the fallback wall has no cell; the client is refused', async () => {
    for (const p of PERSONAS) {
      as(p.role);
      const b = await body();
      if (b.props.data.fallback) {
        expect([p.role, b.props.quality]).toEqual([p.role, undefined]);
        expect(html(b)).not.toContain('Schedule quality');
        continue;
      }
      for (const cell of Object.values(b.props.quality ?? {})) if (cell) expect([p.role, cell.href !== null]).toEqual([p.role, canSee(p.role, 'schedule')]);
    }
  }, 240_000);
});
