// Schedule page (docs/spec/05 §1.1, §1.5, 0.4): data loading, empty state for a project without planning data,
// and "Re-baseline" gating (director / owning PM only; read-only project or persona outside the workspace → none).
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
const jar = new Map<string, string>();
vi.mock('next/headers', () => ({ cookies: async () => ({ get: (k: string) => (jar.has(k) ? { name: k, value: jar.get(k)! } : undefined) }) }));
vi.mock('next/navigation', () => ({ usePathname: () => '/projects/HLT-026/schedule', useRouter: () => ({ push() {}, refresh() {} }), redirect() {}, notFound: () => { throw new Error('NOT_FOUND'); } }));
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import SchedulePage from '@/app/(app)/projects/[code]/schedule/page';
import { setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { COOKIE } from '@/server/session';
import { RebaselineButton } from './rebaseline-button';
import { ScheduleView } from './schedule-view';

type Props = { primary?: ReactNode; children?: ReactNode; view?: unknown; showBaseline?: boolean };
const page = async (code: string, sp: Record<string, string> = {}) => {
  const el = (await SchedulePage({ params: Promise.resolve({ code }), searchParams: Promise.resolve(sp) })) as ReactElement<Props>;
  const [header, body] = (el.props.children as ReactElement<Props>[]).filter(isValidElement);
  return { header, body };
};
const as = (role: string, lang = 'en') => {
  jar.clear();
  jar.set(COOKIE.role, role);
  jar.set(COOKIE.lang, lang);
};

describe('Schedule page', () => {
  beforeAll(async () => {
    setDb(await openDatabase());
  }, 60_000);
  beforeEach(() => as('director'));

  it('director on HLT-026: body + Re-baseline primary', async () => {
    const { header, body } = await page('HLT-026');
    expect(body.type).toBe(ScheduleView);
    expect(body.props.showBaseline).toBe(true);
    expect((header.props.primary as ReactElement).type).toBe(RebaselineButton);
  });

  it('?baseline=0 hides the baseline geometry', async () => {
    const { body } = await page('HLT-026', { baseline: '0' });
    expect(body.props.showBaseline).toBe(false);
  });

  it('PM: own project editable, other projects read-only (no primary)', async () => {
    as('pm');
    expect((await page('HLT-026')).header.props.primary).toBeTruthy();
    expect((await page('NDC-031')).header.props.primary).toBeUndefined();
  });

  it('persona outside the workspace (quality): screen renders, no primary', async () => {
    as('quality');
    const { header, body } = await page('HLT-026');
    expect(body.type).toBe(ScheduleView);
    expect(header.props.primary).toBeUndefined();
  });

  it('project without planning data: empty state, no primary (no Harbor Line fallback)', async () => {
    as('director', 'fr');
    const { header, body } = await page('ALP-021');
    expect(header.props.primary).toBeUndefined();
    const html = renderToStaticMarkup(body);
    expect(html).toContain('Planning — référence vs prévision');
    expect(html).toContain('Aucun planning enregistré pour ce projet');
    expect(html).not.toContain('Harbor');
  });

  it('unknown project → notFound', async () => {
    await expect(page('NOPE-1')).rejects.toThrow('NOT_FOUND');
  });
});
