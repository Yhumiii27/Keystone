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

  it('S-08: the activity Gantt of a multi-equipment project filters by equipment line (`?equipment=`); hidden with one line', async () => {
    type Card = ReactElement<{ equipment?: { value: string; options: { value: string; label: string; href: string }[] }; network: { activities: { id: string; wbs: string; equipment?: string | null }[] } | null; zoomHref: (z: string) => string }>;
    const card = async (code: string, sp: Record<string, string>) => (await page(code, sp)).body.props as unknown as { activityGantt: Card };
    const { activityGantt: c } = await card('HLT-026', { gantt: 'activities', zoom: 'day', equipment: 'EQ-02' });
    expect(c.props.equipment?.value).toBe('EQ-02');
    expect(c.props.equipment?.options.map((o) => [o.value, o.href])).toEqual([
      ['all', '/projects/HLT-026/schedule?gantt=activities&zoom=day'],
      ['EQ-01', '/projects/HLT-026/schedule?gantt=activities&zoom=day&equipment=EQ-01'],
      ['EQ-02', '/projects/HLT-026/schedule?gantt=activities&zoom=day&equipment=EQ-02'],
      ['common', '/projects/HLT-026/schedule?gantt=activities&zoom=day&equipment=common'],
    ]);
    expect(c.props.equipment?.options[2].label).toBe('EQ-02 · 3 × MEMU');
    // The zoom keeps the filter.
    expect(c.props.zoomHref('week')).toBe('/projects/HLT-026/schedule?gantt=activities&zoom=week&equipment=EQ-02');
    // The activities of lot 1.6 (EQ-02's) take their lot's line; lot 1.5's EQ-01; the others are common.
    const acts = c.props.network!.activities.filter((a) => !a.id.includes('/'));
    expect(new Set(acts.filter((a) => a.wbs === '1.6').map((a) => a.equipment))).toEqual(new Set(['EQ-02']));
    expect(new Set(acts.filter((a) => a.wbs === '1.5').map((a) => a.equipment))).toEqual(new Set(['EQ-01']));
    expect(acts.some((a) => a.equipment == null)).toBe(true);
    // Unknown value → all.
    expect((await card('HLT-026', { gantt: 'activities', equipment: 'EQ-99' })).activityGantt.props.equipment?.value).toBe('all');
    // A project with one line: no filter.
    expect((await card('NDC-031', { gantt: 'activities' })).activityGantt.props.equipment).toBeUndefined();
  });

  it('unknown project → notFound', async () => {
    await expect(page('NOPE-1')).rejects.toThrow('NOT_FOUND');
  });
});
