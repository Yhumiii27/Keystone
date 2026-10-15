// Delivery 8, lot cost-change — the database layer on in-memory PGlite databases seeded from the prototype:
//  R-069 the sequential change-request chain (P-6b), the steps fixed from the contractual impact and the Settings board threshold
//        (P-6c, strict "above"), the client portal reached only at the client's turn, the backfill of a database seeded before;
//  R-015 (part) the bell notices of the chain (X-6a: the approvers of the current step, then the requester; never the actor);
//  R-081 the cost-category amounts frozen after BL1 (C-3a) and the optional category posted at approval (A-4);
//  R-080 the cost note against the Settings threshold (C-1);
//  R-077 invoicing blocked while a schedule group exceeds 100 % (C-7), planned milestones edited / removed (C-7a);
//  R-054 « Planning BL1 posé » ticked by the real BL1 (L-2 "a").
import { and, eq, inArray, isNotNull, isNull, ne, notInArray } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { CATEGORY_FROZEN_MESSAGE, BL1_DELIVERABLE_MESSAGE } from '@/domain/baseline-policy';
import { INVOICE_BLOCKED_MESSAGE } from '@/domain/contract';
import { getDb, setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import {
  auditEntries, baselines, changeRequests, costCategories, paymentMilestones, projects, stageDeliverableChecks, stageDeliverableDefs,
} from '@/server/db/schema';
import { backfillContractImpacts } from '@/server/db/seed/cost-change';
import { notificationsFor } from './shell';
import { createBaselineSnapshot, snapshotIntoBaseline } from './baselines';
import { addProjectCostCategory, updateProjectCostCategory } from './budget-categories';
import { notifyChangeRequest } from './change-notices';
import { postApprovedChange } from './change-posting';
import { ChangeStepError, createChangeRequest, decideChangeStep, getChangeControl, listChangeRequestsAwaiting, submitChangeRequest } from './changes';
import { getClientPortal } from './client';
import { MilestoneEditError, addPaymentMilestone, getContract, issueInvoice, removePaymentMilestone, updatePaymentMilestone } from './contract';
import { costNote, getCostControl } from './cost';
import { markBl1Deliverable, projectHasBl1 } from './lifecycle';
import { listAudit } from './notifications';
import { getRegisterData, moveProjectStage, setDeliverableAndAdvance } from './projects-register';
import { getSettings, resetSettings, setCcbThreshold } from './settings';

const PM = 'Romain Aubert';
const DIRECTOR = 'Marie Lefebvre';
const CLIENT = 'Nadia Bensaïd';
const DIRECTOR_ACTOR = { name: DIRECTOR, role: 'director' };

const crOf = async (code: string, id: string) => (await getChangeControl(code))!.changeRequests.find((c) => c.id === id)!;
const chainOf = async (code: string, id: string) => (await crOf(code, id)).chain.map((s) => `${s.step}:${s.decision}`);
const caught = async (p: Promise<unknown>) => p.then(() => null, (e: unknown) => e);
const newCr = (input: Partial<Parameters<typeof createChangeRequest>[1]> & { amountKeur: number }) =>
  createChangeRequest('HLT-026', { title: 'Test change', types: ['budget'], scheduleDays: 0, wbsCodes: ['1.7'], justification: 'Test', ...input }, PM);

describe('R-069 — sequential chain, steps from the contractual impact and the board threshold', () => {
  beforeAll(async () => {
    setDb(await openDatabase());
  }, 60_000);

  it('the seed: contractual impacts inferred from the prototype chains and figures', async () => {
    const crs = (await getChangeControl('HLT-026'))!.changeRequests;
    expect(Object.fromEntries(crs.map((c) => [c.id, c.contractImpact]))).toMatchObject({
      'CR-004': 'price_dates', 'CR-006': 'price', 'CR-007': 'none', 'CR-008': 'price_dates', 'CR-009': 'dates',
    });
    // The stored decisions are kept as they were (CR-008: PM approved, the rest pending; CR-009 still a draft).
    expect(await chainOf('HLT-026', 'CR-008')).toEqual(['pm:ok', 'director:pending', 'client:pending', 'ccb:pending']);
  });

  it('backfill of a database seeded before: the impact inferred from the stored chain and figures, idempotent', async () => {
    const db = await getDb();
    const [hlt] = await db.select({ id: projects.id }).from(projects).where(eq(projects.code, 'HLT-026'));
    const before = Object.fromEntries((await getChangeControl('HLT-026'))!.changeRequests.map((c) => [c.id, c.contractImpact]));
    await db.update(changeRequests).set({ contractImpact: null }).where(and(eq(changeRequests.projectId, hlt.id), inArray(changeRequests.number, ['CR-004', 'CR-007', 'CR-008'])));
    expect(await backfillContractImpacts(db)).toBe(3);
    expect(await backfillContractImpacts(db)).toBe(0);
    const after = Object.fromEntries((await getChangeControl('HLT-026'))!.changeRequests.map((c) => [c.id, c.contractImpact]));
    expect(after).toEqual(before);
    // Rows without amount nor days stay unrecorded (nothing to infer).
    const left = await db.select({ n: changeRequests.number }).from(changeRequests).where(and(isNull(changeRequests.contractImpact), notInArray(changeRequests.amountKeur, [0])));
    expect(left).toEqual([]);
  });
  it('CR-008: a later step is refused while the director has not decided; the client sees it only at her turn', async () => {
    for (const step of ['client', 'ccb'] as const) {
      const e = await caught(decideChangeStep('HLT-026', 'CR-008', step, 'ok', step === 'client' ? CLIENT : DIRECTOR));
      expect(e).toBeInstanceOf(ChangeStepError);
      expect((e as ChangeStepError).code).toBe('not_current');
    }
    expect((await caught(decideChangeStep('HLT-026', 'CR-008', 'pm', 'ok', PM)) as ChangeStepError).code).toBe('not_pending');
    expect((await listChangeRequestsAwaiting('HLT-026', 'director')).map((c) => c.id)).toEqual(['CR-008']);
    expect((await listChangeRequestsAwaiting('HLT-026', 'client')).map((c) => c.id)).toEqual([]);
    expect((await getClientPortal('HLT-026')).decisions.map((d) => d.id)).not.toContain('CR-008');

    expect(await decideChangeStep('HLT-026', 'CR-008', 'director', 'ok', DIRECTOR)).toBe('in_review');
    expect((await listChangeRequestsAwaiting('HLT-026', 'director')).map((c) => c.id)).toEqual([]);
    expect((await listChangeRequestsAwaiting('HLT-026', 'client')).map((c) => c.id)).toEqual(['CR-008']);
    const portal = await getClientPortal('HLT-026');
    expect(portal.decisions.map((d) => d.id)).toContain('CR-008');
    // The internal cost category never reaches the portal.
    expect(portal.decisions.every((d) => d.changeRequest == null || d.changeRequest.costCategoryCode === null)).toBe(true);
    // The board still waits for the client.
    expect((await caught(decideChangeStep('HLT-026', 'CR-008', 'ccb', 'ok', DIRECTOR)) as ChangeStepError).code).toBe('not_current');
    expect(await decideChangeStep('HLT-026', 'CR-008', 'client', 'ok', CLIENT)).toBe('in_review');
    expect(await decideChangeStep('HLT-026', 'CR-008', 'ccb', 'ok', DIRECTOR)).toBe('approved');
    expect((await caught(decideChangeStep('HLT-026', 'CR-008', 'ccb', 'ok', DIRECTOR)) as ChangeStepError).code).toBe('not_in_review');
  });

  it('steps a new request needs: client "n/a" for an internal change, board only strictly above the threshold (50 k€)', async () => {
    const cases: [Parameters<typeof newCr>[0], string[]][] = [
      [{ amountKeur: 50, contractImpact: 'price' }, ['pm:pending', 'director:pending', 'client:pending', 'ccb:na']],
      [{ amountKeur: 51, contractImpact: 'price' }, ['pm:pending', 'director:pending', 'client:pending', 'ccb:pending']],
      [{ amountKeur: -51, contractImpact: 'price' }, ['pm:pending', 'director:pending', 'client:pending', 'ccb:pending']],
      [{ amountKeur: 20, contractImpact: 'none' }, ['pm:pending', 'director:pending', 'client:na', 'ccb:na']],
      [{ amountKeur: 0, scheduleDays: 5, contractImpact: 'dates' }, ['pm:pending', 'director:pending', 'client:pending', 'ccb:na']],
      // An older caller without the impact: nothing recorded, the client step stays required.
      [{ amountKeur: 10 }, ['pm:pending', 'director:pending', 'client:pending', 'ccb:na']],
    ];
    for (const [input, chain] of cases) {
      const n = await newCr(input);
      expect([n, await chainOf('HLT-026', n)]).toEqual([n, chain]);
      expect((await crOf('HLT-026', n)).contractImpact).toBe(input.contractImpact ?? null);
    }
    expect((await listAudit({ limit: 12 })).some((a) => /^created · status: In review · contractual impact: None \(internal\)$/.test(a.change))).toBe(true);
  });

  it('an internal change skips the client: PM → director → (board) → approved, no amendment prepared', async () => {
    const n = await newCr({ amountKeur: 60, contractImpact: 'none', title: 'Internal rework' });
    await decideChangeStep('HLT-026', n, 'pm', 'ok', PM);
    await decideChangeStep('HLT-026', n, 'director', 'ok', DIRECTOR);
    expect((await listChangeRequestsAwaiting('HLT-026', 'client')).map((c) => c.id)).not.toContain(n);
    expect((await caught(decideChangeStep('HLT-026', n, 'client', 'ok', CLIENT)) as ChangeStepError).code).toBe('not_pending');
    expect(await decideChangeStep('HLT-026', n, 'ccb', 'ok', DIRECTOR)).toBe('approved');
    const amendments = (await getContract('HLT-026'))!.amendments.map((a) => a.label);
    expect(amendments.some((l) => l.includes(n))).toBe(false);
  });

  it('the Settings threshold (director only, audited) is read when the steps are fixed; Reset restores 50 k€', async () => {
    expect((await getSettings()).ccbThresholdKeur).toBe(50);
    expect(await caught(setCcbThreshold(100, { name: PM, role: 'pm' }))).toBeInstanceOf(Error);
    expect(((await caught(setCcbThreshold(-1, DIRECTOR_ACTOR))) as Error).message).toBe('Enter a threshold in k€ (0 or more)');
    expect(((await caught(setCcbThreshold(Number.NaN, DIRECTOR_ACTOR))) as Error).message).toBe('Enter a threshold in k€ (0 or more)');
    expect(await setCcbThreshold(100, DIRECTOR_ACTOR)).toBe(100);
    expect((await listAudit({ limit: 1 }))[0]).toMatchObject({ object: 'Change control board', change: 'threshold 50 → 100 k€', area: 'Settings' });
    const a = await newCr({ amountKeur: 100, contractImpact: 'price' });
    const b = await newCr({ amountKeur: 100.4, contractImpact: 'price' }); // rounded to 100 k€ — not above
    const c = await newCr({ amountKeur: 101, contractImpact: 'price' });
    expect([await chainOf('HLT-026', a), await chainOf('HLT-026', b), await chainOf('HLT-026', c)].map((x) => x[3])).toEqual(['ccb:na', 'ccb:na', 'ccb:pending']);
    // Steps already fixed do not move when the threshold changes.
    await setCcbThreshold(0, DIRECTOR_ACTOR);
    expect((await chainOf('HLT-026', a))[3]).toBe('ccb:na');
    expect((await chainOf('HLT-026', await newCr({ amountKeur: 1, contractImpact: 'price' })))[3]).toBe('ccb:pending');
    expect((await chainOf('HLT-026', await newCr({ amountKeur: 0, scheduleDays: 3, contractImpact: 'dates' })))[3]).toBe('ccb:na');
    await resetSettings(DIRECTOR_ACTOR);
    expect((await getSettings()).ccbThresholdKeur).toBe(50);
  });

  it('submitting a draft fixes its steps from the rule in force (CR-009, 0 k€ / +27 d: no board); a second submit is refused', async () => {
    expect((await crOf('HLT-026', 'CR-009')).status).toBe('draft');
    await submitChangeRequest('HLT-026', 'CR-009', PM);
    expect(await chainOf('HLT-026', 'CR-009')).toEqual(['pm:pending', 'director:pending', 'client:pending', 'ccb:na']);
    expect(((await caught(submitChangeRequest('HLT-026', 'CR-009', PM))) as Error).message).toBe('CR-009 is not a draft');
  });

});

describe('R-015 (part) — bell notices of the change-request chain', () => {
  beforeAll(async () => {
    setDb(await openDatabase());
  }, 60_000);

  const titles = async (role: 'pm' | 'director' | 'client' | 'quality', n: string) =>
    (await notificationsFor(role)).filter((x) => x.title.endsWith(` · ${n}`)).map((x) => x.title);

  it('submitted → the current step’s approvers; each decision → the next ones; final → the requester; never the actor', async () => {
    const n = await newCr({ amountKeur: 70, contractImpact: 'price', title: 'Extra bollards' });
    // Current step = PM, the PM of record raised it: nobody to tell.
    expect(await notifyChangeRequest('HLT-026', n, PM)).toEqual([]);
    await decideChangeStep('HLT-026', n, 'pm', 'ok', PM);
    expect((await notifyChangeRequest('HLT-026', n, PM)).length).toBeGreaterThan(0);
    expect(await titles('director', n)).toEqual([`Change request awaiting your decision · ${n}`]);
    expect(await titles('client', n)).toEqual([]);
    await decideChangeStep('HLT-026', n, 'director', 'ok', DIRECTOR);
    await notifyChangeRequest('HLT-026', n, DIRECTOR);
    expect(await titles('client', n)).toEqual([`Change request awaiting your decision · ${n}`]);
    const bell = (await notificationsFor('client')).find((x) => x.title.endsWith(n))!;
    expect([bell.sub, bell.href]).toEqual(['Extra bollards', `/projects/HLT-026/changes?cr=${n}`]);
    await decideChangeStep('HLT-026', n, 'client', 'ok', CLIENT);
    await notifyChangeRequest('HLT-026', n, CLIENT);
    // The board (P-6a: recorded by the director) — a second notice to the directors.
    expect(await titles('director', n)).toEqual([`Change request awaiting your decision · ${n}`, `Change request awaiting your decision · ${n}`]);
    await decideChangeStep('HLT-026', n, 'ccb', 'ok', DIRECTOR);
    await notifyChangeRequest('HLT-026', n, DIRECTOR);
    expect(await titles('pm', n)).toEqual([`Change request approved · ${n}`]);
    expect(await titles('quality', n)).toEqual([]);
  });

  it('a rejection tells the requester; a client contact of another organisation never gets the notice', async () => {
    const n = await newCr({ amountKeur: 5, contractImpact: 'price' });
    await decideChangeStep('HLT-026', n, 'pm', 'ok', PM);
    await decideChangeStep('HLT-026', n, 'director', 'rejected', DIRECTOR);
    expect(await notifyChangeRequest('HLT-026', n, DIRECTOR)).toHaveLength(1);
    expect(await titles('pm', n)).toEqual([`Change request rejected · ${n}`]);
    expect(await titles('client', n)).toEqual([]);
    // A project of another client organisation: its CR at the client's turn reaches nobody of the Port authority.
    const db = await getDb();
    const [hlt] = await db.select({ clientId: projects.clientId }).from(projects).where(eq(projects.code, 'HLT-026'));
    const [other] = await db.select({ code: projects.code }).from(projects)
      .where(and(isNotNull(projects.clientId), ne(projects.clientId, hlt.clientId!), inArray(projects.code, ['NDC-031', 'RCF-019', 'WSA-044', 'MSR-012', 'EWA-051'])));
    expect(other).toBeTruthy();
    const m = await createChangeRequest(other.code, { title: 'Other client', types: ['budget'], amountKeur: 5, scheduleDays: 0, contractImpact: 'price' }, PM);
    await decideChangeStep(other.code, m, 'pm', 'ok', PM);
    await decideChangeStep(other.code, m, 'director', 'ok', DIRECTOR);
    await notifyChangeRequest(other.code, m, DIRECTOR);
    expect(await titles('client', m)).toEqual([]);
  });

  it('an unknown request or project notifies nobody and never throws', async () => {
    expect(await notifyChangeRequest('HLT-026', 'CR-999', PM)).toEqual([]);
    expect(await notifyChangeRequest('ZZZ-000', 'CR-008', PM)).toEqual([]);
  });
});

describe('R-081 — cost-category amounts frozen after BL1, the category posted at approval', () => {
  beforeAll(async () => {
    setDb(await openDatabase());
  }, 60_000);

  const cat = async (code: string, c: string) => (await getCostControl(code))!.categories.find((x) => x.code === c)!;

  it('HLT-026 has BL1: a budget change is refused (the director included), name and type stay editable', async () => {
    const c1 = await cat('HLT-026', 'C01');
    expect(((await caught(updateProjectCostCategory('HLT-026', 'C01', { budgetKeur: c1.budget + 10 }, DIRECTOR))) as Error).message).toBe(CATEGORY_FROZEN_MESSAGE);
    await updateProjectCostCategory('HLT-026', 'C01', { name: `${c1.name} (site)`, budgetKeur: c1.budget }, PM);
    expect(await cat('HLT-026', 'C01')).toMatchObject({ name: `${c1.name} (site)`, budget: c1.budget });
  });

  it('a category added after BL1 starts at 0 k€ (forecast 0)', async () => {
    const code = await addProjectCostCategory('HLT-026', { name: 'Late scope', type: 'material', budgetKeur: 120 }, PM);
    expect(await cat('HLT-026', code)).toMatchObject({ budget: 0, forecast: 0 });
  });

  it('a project without BL1 keeps free amounts', async () => {
    const db = await getDb();
    const withBl = (await db.select({ id: baselines.projectId, code: baselines.code }).from(baselines)).filter((b) => b.code !== 'BL0').map((b) => b.id);
    const [free] = await db.select({ code: projects.code, id: projects.id }).from(projects).where(withBl.length ? notInArray(projects.id, withBl) : undefined);
    expect(free).toBeTruthy();
    const code = await addProjectCostCategory(free.code, { name: 'Free category', type: 'material', budgetKeur: 30 }, DIRECTOR);
    const [row] = await db.select().from(costCategories).where(and(eq(costCategories.projectId, free.id), eq(costCategories.code, code)));
    expect([row.budgetKeur, row.forecastKeur]).toEqual([30, 30]);
    await updateProjectCostCategory(free.code, code, { budgetKeur: 45 }, DIRECTOR);
    const [after] = await db.select().from(costCategories).where(eq(costCategories.id, row.id));
    expect(after.budgetKeur).toBe(45);
  });

  it('an approved request naming a category posts its amount there once (forecast follows while nothing is spent), clamped at 0', async () => {
    const c0 = await addProjectCostCategory('HLT-026', { name: 'Fenders', type: 'material', budgetKeur: 0 }, PM);
    const n = await newCr({ amountKeur: 40, contractImpact: 'price', costCategoryCode: c0 });
    expect((await crOf('HLT-026', n)).costCategoryCode).toBe(c0);
    await decideChangeStep('HLT-026', n, 'pm', 'ok', PM);
    await decideChangeStep('HLT-026', n, 'director', 'ok', DIRECTOR);
    expect(await decideChangeStep('HLT-026', n, 'client', 'ok', CLIENT)).toBe('approved');
    expect(await cat('HLT-026', c0)).toMatchObject({ budget: 40, forecast: 40 });
    const audit = (await listAudit({ limit: 6 })).map((a) => a.change);
    expect(audit).toContain('budget: 0 → 40 k€ · from ' + n);
    expect(audit.some((c) => c.includes(`· category ${c0} 0 → 40 k€`))).toBe(true);
    // Posted once: a second posting of the same request (retry, concurrent approval) moves nothing.
    const db = await getDb();
    const [row] = await db.select({ id: changeRequests.id }).from(changeRequests).where(eq(changeRequests.number, n));
    expect(await db.transaction((tx) => postApprovedChange(tx, row.id, DIRECTOR))).toBeNull();
    expect(await cat('HLT-026', c0)).toMatchObject({ budget: 40, forecast: 40 });
    // A negative request larger than the category is clamped at 0 (the Server Function refuses it before; the writer never goes below).
    const m = await newCr({ amountKeur: -55, contractImpact: 'price', costCategoryCode: c0 });
    await decideChangeStep('HLT-026', m, 'pm', 'ok', PM);
    await decideChangeStep('HLT-026', m, 'director', 'ok', DIRECTOR);
    await decideChangeStep('HLT-026', m, 'client', 'ok', CLIENT);
    expect(await decideChangeStep('HLT-026', m, 'ccb', 'ok', DIRECTOR)).toBe('approved');
    expect(await cat('HLT-026', c0)).toMatchObject({ budget: 0, forecast: 0 });
  });
});

describe('R-080 — the cost note follows the Settings "At risk below" threshold (C-1)', () => {
  it('"running ahead" below the threshold (0.97 by default), "healthy" at or above it; a written narrative is kept', () => {
    const stored = 'Cost performance is healthy (CPI 0.95); the forecast at completion sits within budget.';
    expect(costNote(stored, 0.96)).toBe('Spending is running ahead of earned value (CPI 0.96); the forecast at completion exceeds the budget.');
    expect(costNote(stored, 0.96, { risk: 0.95, off: 0.9 })).toBe('Cost performance is healthy (CPI 0.96); the forecast at completion sits within budget.');
    expect(costNote(stored, 0.97)).toBe('Cost performance is healthy (CPI 0.97); the forecast at completion sits within budget.');
    expect(costNote('Steel labour drives the overrun.', 0.5)).toBe('Steel labour drives the overrun.');
  });
});

describe('R-077 — invoicing blocked above 100 %, planned milestones edited and removed', () => {
  beforeAll(async () => {
    setDb(await openDatabase());
  }, 60_000);

  const PM_ACTOR = { name: PM, role: 'pm' };

  it('a base group at 100.5 % blocks every base milestone, not the amendment’s; the DAL refuses the invoice', async () => {
    const c = (await getContract('HLT-026'))!;
    const planned = c.milestones.filter((m) => m.status === 'planned' && m.billable && m.amendment == null);
    expect(planned.length).toBeGreaterThan(0);
    expect(c.milestones.some((m) => m.blocked)).toBe(false);
    const base = c.milestones.filter((m) => m.amendment == null).reduce((a, m) => a + m.sharePct, 0);
    const share = Math.round((100.5 - base) * 100) / 100;
    expect(share).toBeGreaterThan(0);
    const added = await addPaymentMilestone('HLT-026', { label: 'Extra test', sharePct: share, contractualDue: '2027-03-01' }, PM);
    const after = (await getContract('HLT-026'))!;
    expect(after.milestones.filter((m) => m.amendment == null).every((m) => m.blocked)).toBe(true);
    expect(after.milestones.filter((m) => m.amendment != null).every((m) => !m.blocked)).toBe(true);
    expect(((await caught(issueInvoice('HLT-026', { milestone: planned[0].number }, PM))) as Error).message).toBe(INVOICE_BLOCKED_MESSAGE);
    // Corrected by an edit (0 %): invoicing is possible again.
    await updatePaymentMilestone('HLT-026', added, { label: 'Extra test', sharePct: 0, contractualDue: '2027-03-01', condition: null }, PM_ACTOR);
    expect((await getContract('HLT-026'))!.milestones.some((m) => m.blocked)).toBe(false);
    expect((await listAudit({ limit: 1 }))[0]).toMatchObject({ change: `payment milestone ${added} changed · share: ${share} → 0 %`, area: 'Contract' });
    expect(await issueInvoice('HLT-026', { milestone: planned[0].number }, PM)).toMatch(/^INV-/);
  });

  it('a removed number is never reused; only a planned milestone is changed; the writer re-checks the actor', async () => {
    const a = await addPaymentMilestone('HLT-026', { label: 'Spare', sharePct: 0, contractualDue: '2027-04-01' }, PM);
    await removePaymentMilestone('HLT-026', a, PM_ACTOR);
    expect((await getContract('HLT-026'))!.milestones.map((m) => m.number)).not.toContain(a);
    const b = await addPaymentMilestone('HLT-026', { label: 'Spare 2', sharePct: 0, contractualDue: '2027-04-01' }, PM);
    expect(Number(b.slice(1))).toBe(Number(a.slice(1)) + 1);
    const invoiced = (await getContract('HLT-026'))!.milestones.find((m) => m.status !== 'planned')!;
    const patch = { label: 'X', sharePct: 10, contractualDue: '2027-01-01', condition: null };
    expect(((await caught(updatePaymentMilestone('HLT-026', invoiced.number, patch, PM_ACTOR))) as MilestoneEditError).code).toBe('not_planned');
    expect(((await caught(removePaymentMilestone('HLT-026', invoiced.number, PM_ACTOR))) as MilestoneEditError).code).toBe('not_planned');
    expect(((await caught(removePaymentMilestone('HLT-026', 'M99', PM_ACTOR))) as MilestoneEditError).code).toBe('unknown');
    for (const actor of [{ name: 'Julien Wagner', role: 'member' }, { name: CLIENT, role: 'client' }, { name: 'Gabriel Comte', role: 'quality' }]) {
      expect([actor.role, ((await caught(removePaymentMilestone('HLT-026', b, actor))) as MilestoneEditError).code]).toEqual([actor.role, 'not_allowed']);
    }
    expect(((await caught(updatePaymentMilestone('HLT-026', b, { ...patch, sharePct: 101 }, PM_ACTOR))) as Error).message).toBe('Invalid share');
    expect(((await caught(updatePaymentMilestone('HLT-026', b, { ...patch, label: ' ' }, PM_ACTOR))) as Error).message).toBe('The milestone is required');
    expect(((await caught(updatePaymentMilestone('HLT-026', b, { ...patch, contractualDue: '2027-13-01' }, PM_ACTOR))) as Error).message).toBe('Invalid contractual date');
    await removePaymentMilestone('HLT-026', b, DIRECTOR_ACTOR);
    const db = await getDb();
    expect(await db.select().from(paymentMilestones).where(eq(paymentMilestones.number, b))).toEqual([]);
    expect((await db.select({ change: auditEntries.change }).from(auditEntries).where(eq(auditEntries.entityType, 'payment_milestone'))).filter((r) => r.change.startsWith(`payment milestone ${b} removed`))).toHaveLength(1);
  });
});

describe('R-054 — « Planning BL1 posé » follows the real BL1', () => {
  beforeAll(async () => {
    setDb(await openDatabase());
  }, 60_000);

  async function apd1(code: string) {
    const db = await getDb();
    const [def] = await db.select({ id: stageDeliverableDefs.id }).from(stageDeliverableDefs).where(and(eq(stageDeliverableDefs.stage, 'apd'), eq(stageDeliverableDefs.position, 1)));
    const [p] = await db.select({ id: projects.id }).from(projects).where(eq(projects.code, code));
    const [row] = await db.select({ done: stageDeliverableChecks.done }).from(stageDeliverableChecks).where(and(eq(stageDeliverableChecks.projectId, p.id), eq(stageDeliverableChecks.deliverableId, def.id)));
    return row?.done ?? false;
  }

  /** A seeded project without any baseline (the Plan's "Set baseline" creates BL0 first, then BL1). */
  async function projectWithoutBaseline() {
    const db = await getDb();
    const withBl = [...new Set((await db.select({ id: baselines.projectId }).from(baselines)).map((b) => b.id))];
    const rows = await db.select({ code: projects.code }).from(projects).where(withBl.length ? notInArray(projects.id, withBl) : undefined);
    return rows[0].code;
  }

  it('the register: BL1 of HLT-026 (set, its date), manual tick refused without BL1, untick refused with it', async () => {
    const reg = await getRegisterData();
    expect(reg.bl1?.['HLT-026']?.set).toBe(true);
    expect((await projectHasBl1('HLT-026')).bl1).toBe(true);
    const code = await projectWithoutBaseline();
    expect((await projectHasBl1(code)).bl1).toBe(false);
    expect(((await caught(setDeliverableAndAdvance(code, 'apd', 1, true))) as Error).message).toBe(BL1_DELIVERABLE_MESSAGE);
    expect(((await caught(setDeliverableAndAdvance('HLT-026', 'apd', 1, false))) as Error).message).toBe(BL1_DELIVERABLE_MESSAGE);
  });

  it('a forced stage change without BL1 still works (APD → Études, the deliverable missing)', async () => {
    const code = await projectWithoutBaseline();
    const db = await getDb();
    await db.update(projects).set({ stage: 'apd' }).where(eq(projects.code, code));
    await moveProjectStage(code, 'etudes', 'forced', { reason: 'Long-lead order released before BL1', missing: ['Planning BL1 posé'], requestedBy: 'R. Aubert' });
    expect((await db.select({ stage: projects.stage }).from(projects).where(eq(projects.code, code)))[0].stage).toBe('etudes');
    expect(await apd1(code)).toBe(false);
  });

  it('"Set baseline": BL0 does not tick it, BL1 does (once, audited in the actor’s name); the next set does not re-tick', async () => {
    const code = await projectWithoutBaseline();
    expect(await apd1(code)).toBe(false);
    const bl0 = await createBaselineSnapshot(code, { actorName: PM, makeCurrent: true });
    expect([bl0.code, bl0.bl1Ticked]).toEqual(['BL0', undefined]);
    expect(await apd1(code)).toBe(false);
    const bl1 = await createBaselineSnapshot(code, { actorName: PM, makeCurrent: true });
    expect([bl1.code, bl1.bl1Ticked]).toEqual(['BL1', true]);
    expect(await apd1(code)).toBe(true);
    expect((await listAudit({ limit: 3 })).find((a) => a.area === 'Lifecycle')).toMatchObject({ who: PM, change: 'deliverable ticked: Planning BL1 posé · BL1 set' });
    expect((await projectHasBl1(code)).bl1).toBe(true);
    // Unticking is refused now; ticking again changes nothing (no second audit line).
    expect(((await caught(setDeliverableAndAdvance(code, 'apd', 1, false))) as Error).message).toBe(BL1_DELIVERABLE_MESSAGE);
    const db = await getDb();
    const [p] = await db.select({ id: projects.id }).from(projects).where(eq(projects.code, code));
    expect(await db.transaction((tx) => markBl1Deliverable(tx, p.id, DIRECTOR))).toBe(false);
  });

  it('a change request approval making BLn current ticks it — the baseline filled at approval, or already snapshotted', async () => {
    const db = await getDb();
    const [hlt] = await db.select({ id: projects.id }).from(projects).where(eq(projects.code, 'HLT-026'));
    const [def] = await db.select({ id: stageDeliverableDefs.id }).from(stageDeliverableDefs).where(and(eq(stageDeliverableDefs.stage, 'apd'), eq(stageDeliverableDefs.position, 1)));
    const untick = () => db.update(stageDeliverableChecks).set({ done: false }).where(and(eq(stageDeliverableChecks.projectId, hlt.id), eq(stageDeliverableChecks.deliverableId, def.id)));
    // Branch 1: CR-009's BL2 has no snapshot yet — filled and made current at approval.
    await untick();
    await submitChangeRequest('HLT-026', 'CR-009', PM);
    await decideChangeStep('HLT-026', 'CR-009', 'pm', 'ok', PM);
    await decideChangeStep('HLT-026', 'CR-009', 'director', 'ok', DIRECTOR);
    expect(await apd1('HLT-026')).toBe(false);
    expect(await decideChangeStep('HLT-026', 'CR-009', 'client', 'ok', CLIENT)).toBe('approved');
    expect(await apd1('HLT-026')).toBe(true);
    // Branch 2: a proposed BL3 frozen with its snapshot before the approval (Schedule "Re-baseline").
    await untick();
    const n = await createChangeRequest('HLT-026', { title: 'Re-baseline', types: ['schedule'], amountKeur: 0, scheduleDays: 10, contractImpact: 'dates', proposeBaseline: true }, PM);
    const bl = (await getChangeControl('HLT-026'))!.changeRequests.find((c) => c.id === n)!.baseline!;
    await snapshotIntoBaseline('HLT-026', bl, { actorName: PM, makeCurrent: false });
    expect(await apd1('HLT-026')).toBe(false);
    for (const [step, who] of [['pm', PM], ['director', DIRECTOR], ['client', CLIENT]] as const) await decideChangeStep('HLT-026', n, step, 'ok', who);
    expect(await apd1('HLT-026')).toBe(true);
    expect((await listAudit({ limit: 8 })).filter((a) => a.area === 'Lifecycle' && a.change === 'deliverable ticked: Planning BL1 posé · BL1 set')).toHaveLength(1);
  });
});
