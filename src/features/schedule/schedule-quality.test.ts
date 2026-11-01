// R-206 — Schedule quality on the demo data: the DAL (14 checks, reference baseline, forensic pair, reads only), the page (every
// persona who sees the schedule gets the cards; a client is sent home) and the French render (checks, offender links to the Plan,
// delay analysis with its baseline pickers).
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
const jar = new Map<string, string>();
vi.mock('next/headers', () => ({ cookies: async () => ({ get: (k: string) => (jar.has(k) ? { name: k, value: jar.get(k)! } : undefined) }) }));
vi.mock('next/navigation', () => ({
  usePathname: () => '/projects/HLT-026/schedule', useRouter: () => ({ push() {}, refresh() {} }),
  redirect: (to: string) => { throw new Error(`REDIRECT ${to}`); }, notFound: () => { throw new Error('NOT_FOUND'); },
}));
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { sql } from 'drizzle-orm';
import SchedulePage from '@/app/(app)/projects/[code]/schedule/page';
import { PERSONAS } from '@/config/personas';
import { DCMA_CHECK_IDS } from '@/domain/schedule-quality';
import { CURRENT_SCHEDULE, getScheduleQuality } from '@/server/dal/schedule-quality';
import { getDb, setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { COOKIE } from '@/server/session';
import { ScheduleQualityCards } from './schedule-quality-card';

const as = (role: string, lang = 'en') => {
  jar.clear();
  jar.set(COOKIE.role, role);
  jar.set(COOKIE.lang, lang);
};
type Props = { quality?: ReactNode; children?: ReactNode };
const pageBody = async (code: string, sp: Record<string, string> = {}) => {
  const el = (await SchedulePage({ params: Promise.resolve({ code }), searchParams: Promise.resolve(sp) })) as ReactElement<Props>;
  return (el.props.children as ReactElement<Props>[]).filter(isValidElement)[1];
};

describe('Schedule quality (R-206)', () => {
  beforeAll(async () => {
    setDb(await openDatabase());
  }, 60_000);
  beforeEach(() => as('director'));

  it('the 14 checks on HLT-026 against the displayed baseline (BL1)', async () => {
    const q = (await getScheduleQuality('HLT-026'))!;
    expect(q.report.checks.map((c) => c.id)).toEqual([...DCMA_CHECK_IDS]);
    expect(q.reference).toMatchObject({ code: 'BL1', displayed: true });
    expect(q.report.passed + q.report.failed + q.report.notApplicable).toBe(14);
    // The demo schedule has a lead (A1250 → A1260, −5 d) and the critical path test passes through A1250.
    const leads = q.report.checks.find((c) => c.id === 'leads')!;
    expect(leads.offenders).toContainEqual({ kind: 'link', pred: 'A1250', succ: 'A1260', type: 'FS', lag: -5 });
    expect(q.report.checks.find((c) => c.id === 'criticalPathTest')).toMatchObject({ status: 'pass', value: 600 });
    // Missed activities and BEI read the baseline snapshot; CPLI its finish.
    for (const id of ['missedTasks', 'cpli', 'bei'] as const) expect(q.report.checks.find((c) => c.id === id)!.status).not.toBe('na');
    expect(q.names.A1250.name).toBeTruthy();
  });

  it('delay analysis: BL1 against the current schedule, the path contributions add up to the slip along it', async () => {
    const q = (await getScheduleQuality('HLT-026'))!;
    expect([q.forensic.from, q.forensic.to]).toEqual(['BL1', CURRENT_SCHEDULE]);
    const att = q.forensic.attribution!;
    expect(att.steps.length).toBeGreaterThan(0);
    expect(att.steps.reduce((t, s) => t + (s.contribution ?? 0), 0)).toBe(att.total);
    expect(q.forensic.comparison!.finishSlip).toBe(att.total);
    // An unknown or identical pair falls back to the reference and the current schedule.
    const again = (await getScheduleQuality('HLT-026', { from: 'BL9', to: 'BL1' }))!;
    expect([again.forensic.from, again.forensic.to]).toEqual(['BL1', CURRENT_SCHEDULE]);
  });

  it('reads only: no write to the schedule, no audit row', async () => {
    const db = await getDb();
    const count = async () => (await db.execute(sql`select (select count(*) from audit_entries)::int as a, (select coalesce(sum(version), 0) from activities)::int as v, (select count(*) from schedule_runs)::int as r`));
    const rows = (r: unknown) => ((r as { rows?: unknown[] }).rows ?? r) as { a: number; v: number; r: number }[];
    const before = rows(await count())[0];
    await getScheduleQuality('HLT-026');
    await getScheduleQuality('NDC-031', { from: 'BL1' });
    expect(rows(await count())[0]).toEqual(before);
  });

  it('unknown project: null', async () => {
    expect(await getScheduleQuality('XXX-000')).toBeNull();
  });

  it('every persona who sees the schedule gets the cards; a client is sent home', async () => {
    for (const p of PERSONAS) {
      as(p.role);
      if (p.role === 'client') {
        await expect(pageBody('HLT-026')).rejects.toThrow(/REDIRECT/);
        continue;
      }
      const body = await pageBody('HLT-026');
      expect(isValidElement(body.props.quality), p.role).toBe(true);
    }
  });

  it('French render: checks, offender links to the Plan, delay analysis pickers keeping the other parameters', async () => {
    as('director', 'fr');
    const body = await pageBody('HLT-026', { gantt: 'activities', zoom: 'day' });
    const card = body.props.quality as ReactElement<Parameters<typeof ScheduleQualityCards>[0]>;
    expect(card.type).toBe(ScheduleQualityCards);
    const html = renderToStaticMarkup(await ScheduleQualityCards(card.props));
    for (const s of ['Qualité du planning', 'Évaluation DCMA en 14 points', 'Référence BL1', 'Avances', 'Test du chemin critique', 'Conforme', 'Non conforme',
      'Analyse des retards', 'Planning actuel', 'Glissement du chemin critique', 'Apport au glissement'])
      expect(html).toContain(s);
    expect(html).toContain('href="/projects/HLT-026/plan?act=A1250"');
    expect(html).toContain('href="/projects/HLT-026/schedule?gantt=activities&amp;zoom=day&amp;from=BL1&amp;to=current"');
    expect(html).not.toMatch(/\bLeads\b|Critical path test/);
  });
});
