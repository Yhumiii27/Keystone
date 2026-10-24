// R-188 (estimate class, DIG-PRODI ±50 % / ±30 % / +10 −5 %) against a seeded in-memory database: the seeded classes, the
// class and range of a budget, the class set by "Set baseline" / "Re-baseline" (stage default, chosen class, invalid input,
// audit), the 0048 backfill and the Portfolio overview's "Uncertainty gap". Session and project context are mocked.
import fs from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/server/session', async () => {
  const { makeT } = await import('@/i18n/translate');
  return { getI18n: async () => ({ lang: 'en', t: makeT('en') }) };
});
vi.mock('@/server/project-context', async () => {
  const { getProject } = await import('@/server/dal/projects');
  return {
    getProjectContext: async (code: string) => ({
      project: await getProject(code), viewer: { role: 'director', name: 'Marie Lefebvre', short: 'Marie Lefebvre', personId: null }, canEdit: () => true,
      isMine: true, isLead: true,
    }),
  };
});

import { and, desc, eq, sql } from 'drizzle-orm';
import { legacyBaselineClass } from '@/domain/estimate-class';
import { setBaselineAction } from '@/features/plan/scheduling-actions';
import { rebaselineSchedule } from '@/features/schedule/actions';
import { getDb, setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { auditEntries, baselines, projects } from '@/server/db/schema';
import { listProjectBaselines } from './baselines';
import { getBudgetEstimate, listBudgetEstimates } from './estimate-class';
import { getPortfolioOverview } from './portfolio';

const projectId = async (code: string) => (await (await getDb()).select({ id: projects.id }).from(projects).where(eq(projects.code, code)))[0].id;
const classes = async (code: string) => (await listProjectBaselines(code)).map((b) => [b.code, b.estimateClass]);

describe('estimate class of budgets (R-188)', () => {
  beforeAll(async () => {
    setDb(await openDatabase());
  }, 60_000);

  it('seeds HLT-026 BL0 at E30 and every BL1 / BL2 at E10', async () => {
    expect(await classes('HLT-026')).toEqual([['BL0', 'E30'], ['BL1', 'E10'], ['BL2', 'E10']]);
    for (const code of ['NDC-031', 'RCF-019', 'ERP-202', 'MSR-012', 'WSA-044']) expect(await classes(code)).toEqual([['BL1', 'E10']]);
  });

  it('gives each budget its class and range: current baseline, else the class of the stage', async () => {
    expect(await getBudgetEstimate('HLT-026')).toEqual({
      estimateClass: 'E10', source: 'baseline', baselineCode: 'BL1', bac: 4800, range: { low: 4560, central: 4800, high: 5280 },
    });
    expect(await getBudgetEstimate('EWA-051')).toEqual({
      estimateClass: 'E50', source: 'stage', baselineCode: null, bac: 2200, range: { low: 1100, central: 2200, high: 3300 },
    });
    expect(await getBudgetEstimate('RBR-048')).toMatchObject({ estimateClass: 'E30', source: 'stage', range: { low: 3570, high: 6630 } });
    expect(await getBudgetEstimate('PRS-038')).toEqual({ estimateClass: null, source: 'none', baselineCode: null, bac: 3800, range: null });
    expect(await getBudgetEstimate('NOPE-1')).toBeNull();
    const all = await listBudgetEstimates();
    expect([all.get('HLT-026')?.estimateClass, all.get('FTU-052')?.estimateClass, all.get('CER-047')?.estimateClass, all.get('ALP-021')?.estimateClass]).toEqual([
      'E10', 'E50', 'E30', null,
    ]);
  });

  it('shows the Uncertainty gap after the six prototype tiles of the Portfolio overview', async () => {
    const ov = await getPortfolioOverview(null, 'en');
    // HLT-026 4 800, NDC-031 2 100, RCF-019 1 350, ERP-202 960, MSR-012 620 at E10 (15 % each) = 1 474.5 k€; PRS-038 not classified.
    expect(ov.kpis.at(-1)).toEqual({ key: 'uncertainty', label: 'Uncertainty gap', value: '€1.47M', sub: '1 not at class E10', icon: 'range', alert: true });
  });

  it('Set baseline: class of the stage by default, the chosen class otherwise; an unknown class is refused; audited', async () => {
    const db = await getDb();
    const pid = await projectId('NDC-031');
    await db.delete(baselines).where(eq(baselines.projectId, pid));
    expect(await setBaselineAction('NDC-031', { name: 'Initial plan', estimateClass: 'E99' })).toEqual({ error: 'Unknown estimate class' });
    expect(await setBaselineAction('NDC-031', { name: 'Initial plan', estimateClass: 'E30' })).toMatchObject({ toast: expect.stringContaining('BL0') });
    expect(await setBaselineAction('NDC-031', { name: 'APD', estimateClass: '' })).toMatchObject({ toast: expect.stringContaining('BL1') });
    // NDC-031 is at Approvisionnements: the default is E10.
    expect(await classes('NDC-031')).toEqual([['BL0', 'E30'], ['BL1', 'E10']]);
    const [a] = await db.select().from(auditEntries).where(and(eq(auditEntries.objectRef, 'NDC-031 BL0'), eq(auditEntries.area, 'Planning'))).orderBy(desc(auditEntries.occurredAt));
    expect(a.after).toEqual({ estimateClass: 'E30' });
  });

  it('Re-baseline: the class goes with the frozen version; an unknown class is refused', async () => {
    const db = await getDb();
    const pid = await projectId('RCF-019');
    await db.delete(baselines).where(eq(baselines.projectId, pid));
    expect(await rebaselineSchedule('RCF-019', { name: 'Proposal', reason: 'Offer', estimateClass: 'E2' })).toEqual({ error: 'Unknown estimate class' });
    expect(await rebaselineSchedule('RCF-019', { name: 'Proposal', reason: 'Offer', estimateClass: 'E50' })).toEqual({ toast: 'Proposal · Baseline frozen · BL0' });
    expect(await classes('RCF-019')).toEqual([['BL0', 'E50']]);
    expect(await getBudgetEstimate('RCF-019')).toMatchObject({ estimateClass: 'E50', source: 'baseline', baselineCode: 'BL0' });
  });

  it('0048 backfill classifies the baselines recorded before R-188 by the rule of legacyBaselineClass', async () => {
    const db = await getDb();
    await db.update(baselines).set({ estimateClass: null });
    const file = path.join(process.cwd(), 'drizzle', '0048_baseline_estimate_class_backfill.sql');
    await db.execute(sql.raw(fs.readFileSync(file, 'utf8')));
    const rows = await db.select({ code: baselines.code, stage: projects.stage, cls: baselines.estimateClass }).from(baselines).innerJoin(projects, eq(projects.id, baselines.projectId));
    expect(rows.length).toBeGreaterThan(5);
    for (const r of rows) expect([r.code, r.cls]).toEqual([r.code, legacyBaselineClass(r.code, r.stage)]);
    // Running it again changes nothing.
    await db.execute(sql.raw(fs.readFileSync(file, 'utf8')));
    expect(await classes('HLT-026')).toEqual([['BL0', 'E30'], ['BL1', 'E10'], ['BL2', 'E10']]);
  });
});
