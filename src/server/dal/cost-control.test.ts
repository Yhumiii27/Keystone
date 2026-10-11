// Delivery 7, lot cost-control — the database layer on an in-memory PGlite seeded from the prototype:
//  R-073 earned value computed from Keystone data (the seeded projects' old → new figures, decision C-2a / A-12 / A-15),
//  R-068 approved change requests posted once to the BAC and the contract through the single register (A-4),
//  R-070 / R-071 the contingency register as the drawn figure, linked draw-downs validated by the director (A-8, C-4),
//  R-072 the cost if a risk occurs and the derived EMV (Q-1), and the backfill of a database seeded before.
import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { getDb, setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { changeRequestPostings, changeRequestSteps, changeRequests, projects, risks } from '@/server/db/schema';
import { backfillCostControl } from '@/server/db/seed/cost-control';
import { getApprovalInbox } from '@/server/approvals';
import { PERSONA_BY_ROLE } from '@/config/personas';
import { getBudgetContract, getBudgetData } from './budget';
import { postApprovedChange } from './change-posting';
import { createChangeRequest, decideChangeStep } from './changes';
import { getClientPortal } from './client';
import { ContingencyError, decideContingencyDraw, drawLinkOptions, getContingency, listDrawsAwaitingValidation, submitContingencyDraw } from './contingency';
import { getContract } from './contract';
import { getCostControl } from './cost';
import { getProjectEvm, listProjectEvms } from './evm';
import { listAudit } from './notifications';
import { getProject, listProjects } from './projects';
import { getRiskRegister, updateRisk } from './risks';

const DIRECTOR = { name: 'Marie Lefebvre', role: 'director' };
const round2 = (v: number | null) => (v == null ? null : Math.round(v * 100) / 100);

beforeAll(async () => {
  setDb(await openDatabase());
}, 60_000);

describe('R-073 — earned value from Keystone data at the data date (25 Sep 2026)', () => {
  it('the six projects with activities: old (seeded) → new figures', async () => {
    const evms = await listProjectEvms();
    const table = Object.fromEntries([...evms].map(([code, e]) => [code, [round2(e.progress), e.pv, e.ev, e.ac, round2(e.spi), round2(e.cpi), e.planSource]]));
    // [progress, PV, EV, AC, SPI, CPI] — was (seeded PV/EV/AC of projectData()): HLT-026 [0.64, 3420, 3080, 3360, 0.90, 0.92],
    // NDC-031 [0.51, 1688?, 1071, 1020], RCF-019 [0.82, …, 1107, 1210], ERP-202 [0.45, …, 432, 410], WSA-044 [0.27, …, 918, 880],
    // MSR-012 [0.91, …, 564, 550]. PV now follows the cost-loaded BL1, EV = progress × BAC (C-2a), AC = activities' actual cost
    // + validated contingency draw-downs (A-8).
    expect(table).toEqual({
      'HLT-026': [0.63, 3663, 3006, 3360, 0.82, 0.89, 'baseline'],
      'NDC-031': [0.46, 1018, 973, 884, 0.96, 1.1, 'baseline'],
      'RCF-019': [0.77, 1149, 1040, 1076, 0.91, 0.97, 'baseline'],
      'ERP-202': [0.52, 500, 499, 457, 1, 1.09, 'baseline'],
      'WSA-044': [0.08, 271, 271, 247, 1, 1.1, 'baseline'],
      'MSR-012': [0.92, 580, 572, 553, 0.99, 1.03, 'baseline'],
    });
    // Projects without activities keep their own figures (no Keystone data, A-15 demo data).
    expect(evms.has('EWA-051')).toBe(false);
  });

  it('the projects register shows the computed progress, actual cost and SPI (health follows); the others keep theirs', async () => {
    const rows = Object.fromEntries((await listProjects()).map((p) => [p.code, [round2(p.progress), p.actual, round2(p.spi), p.health]]));
    expect(rows['HLT-026']).toEqual([0.63, 3360, 0.82, 'off_track']);
    expect(rows['NDC-031']).toEqual([0.46, 884, 0.96, 'at_risk']);
    expect(rows['MSR-012']).toEqual([0.92, 553, 0.99, 'on_track']);
    // No activity: the stored figures (PRS-038 11 % · 410 k€; ALP-021 complete).
    expect(rows['PRS-038']).toEqual([0.11, 410, 1, 'on_track']);
    expect(rows['ALP-021'].slice(0, 2)).toEqual([1, 706]);
  });

  it('Budget: series, % complete, work-package actual / EAC from the activities, orders placed from the purchase orders', async () => {
    const c = (await getCostControl('HLT-026'))!;
    const e = (await getProjectEvm('HLT-026'))!;
    expect([c.pv, c.ev, c.ac, c.pct, c.evmSource]).toEqual([e.series.pv, e.series.ev, e.series.ac, 63, 'keystone']);
    expect(c.workPackages.map((w) => [w.wbs, w.actual, w.eac])).toEqual([
      ['1.1', 318, 318], ['1.2', 662, 662], ['1.3', 802, 802], ['1.4', 816, 1189], ['1.5', 372, 690], ['1.6', 296, 830], ['1.7', 46, 372], ['1.8', 0, 165],
      ['—', 48, 208],
    ]);
    // Open orders: PO-1052 (cranes, 3 700 k€ at list price), PO-1063, PO-1071, PO-1078 — the prototype's literal was 713.
    expect(c.ordersPlaced).toBe(3946.5);
    expect(c.categories.find((k) => k.costType === 'material')!.committed).toBe(3946.5);
    expect((await getBudgetContract('HLT-026'))!.openCommit).toBe(3946.5);
    expect((await getBudgetData('HLT-026'))!.contract!.openCommit).toBe(3946.5);
    // The written narrative stays; a generated note quotes the computed CPI (A-12).
    expect(c.note).toBe('Overrun is widening ~$40k a month, led by steel labor.');
    expect((await getCostControl('NDC-031'))!.note).toBe('Cost performance is healthy (CPI 1.10); the forecast at completion sits within budget.');
  });
});

describe('R-070 — the contingency register is the drawn figure (A-8)', () => {
  it('Budget reconciliation: drawn 48 (was 208 · 139 %), the forecast 208 apart; the reserve line follows the register', async () => {
    const c = (await getCostControl('HLT-026'))!;
    expect(c.recon).toMatchObject({ cont: 150, contUsed: 48, contForecast: 208, contPending: 0 });
    expect(c.categories.find((k) => k.costType === 'reserve')).toMatchObject({ budget: 150, actual: 48, forecast: 208 });
    // NDC-031 has no register: its budget line is the provision (100), nothing drawn (the seeded 85 was a forecast).
    const n = (await getCostControl('NDC-031'))!;
    expect(n.recon).toMatchObject({ cont: 100, contUsed: 0, contForecast: 85 });
    expect(n.categories.find((k) => k.costType === 'reserve')).toMatchObject({ actual: 0, forecast: 85 });
  });
});

describe('R-068 — the Budget reads the single change register (A-4)', () => {
  it('HLT-026: approved +200 · 3, pending +85 · CR-008 in review; list without drafts; work-package changes from the register', async () => {
    const c = (await getCostControl('HLT-026'))!;
    expect(c.recon).toMatchObject({ orig: 4600, chg: 200, crCount: 3, pending: 85, pendingSub: 'CR-008 · In review' });
    expect(c.changes.map((r) => [r.id, r.amount, r.days, r.status, r.meta])).toEqual([
      ['CR-004', 120, 12, 'approved', '14 May · R. Aubert'],
      ['CR-006', 65, 0, 'approved', '02 Jul · Steering committee'],
      ['CR-007', 15, 0, 'approved', '20 Aug · R. Aubert'],
      ['CR-008', 85, -12, 'in_review', '24 Sep · R. Aubert'],
      ['CR-005', -40, 0, 'rejected', '11 Jun · Client'],
    ]);
    // Was 1.2 +120 · 1.4 +65 · 1.6 +15 (the Budget's own list, 04 Q6): the register's WBS.
    expect(c.workPackages.filter((w) => w.changes).map((w) => [w.wbs, w.changes])).toEqual([['1.3', 120], ['1.5', 65], ['1.7', 15]]);
    expect(c.bac).toBe(4800);
  });

  it('approving CR-008 posts +85 to the BAC and work package 1.4 and prepares a draft amendment, once', async () => {
    await decideChangeStep('HLT-026', 'CR-008', 'director', 'ok', 'Marie Lefebvre');
    await decideChangeStep('HLT-026', 'CR-008', 'client', 'ok', 'Nadia Bensaïd');
    expect(await decideChangeStep('HLT-026', 'CR-008', 'ccb', 'ok', 'Marie Lefebvre')).toBe('approved');
    expect((await getProject('HLT-026'))!.budget).toBe(4885);
    const c = (await getCostControl('HLT-026'))!;
    expect(c.recon).toMatchObject({ orig: 4600, chg: 285, crCount: 4, pending: 0, pendingSub: 'No change request in review' });
    expect(c.workPackages.find((w) => w.wbs === '1.4')!.changes).toBe(85);
    const ct = (await getContract('HLT-026'))!;
    const a = ct.amendments.at(-1)!;
    expect([a.label, a.amountKeur, a.status, a.changeRequestLinked, a.signed]).toEqual(['Amendment 3 — Second steel crew — schedule recovery (CR-008)', 85, 'draft', true, false]);
    // A draft amendment does not change the contract value (signed ones do).
    expect(ct.valueKeur).toBe(5400 + 120);
    expect((await getClientPortal('HLT-026')).contract!.approvedChangesKeur).toBe(285);
    const audit = await listAudit({ limit: 6 });
    expect(audit.find((r) => r.area === 'Budget' && r.object === 'CR-008')!.change).toBe('posted to the budget · BAC 4800 → 4885 k€ · 1.4 +85 k€');
    expect(audit.find((r) => r.area === 'Contract')!.change).toBe('amendment prepared from CR-008 · Amendment 3 — Second steel crew — schedule recovery (CR-008) · 85 k€ · Draft');
    expect(audit.find((r) => r.area === 'Change control' && r.object === 'CR-008')!.change).toContain('posted · BAC 4800 → 4885 k€ · amendment prepared');
    // Idempotent: a second posting of the same request does nothing.
    const db = await getDb();
    const [cr] = await db.select({ id: changeRequests.id }).from(changeRequests).where(eq(changeRequests.number, 'CR-008'));
    expect(await db.transaction((tx) => postApprovedChange(tx, cr.id, 'Marie Lefebvre'))).toBeNull();
    expect((await getProject('HLT-026'))!.budget).toBe(4885);
    expect((await db.select().from(changeRequestPostings).where(eq(changeRequestPostings.changeRequestId, cr.id))).length).toBe(1);
    expect((await getContract('HLT-026'))!.amendments.length).toBe(ct.amendments.length);
  });

  it('an internal change (client step not required) moves the BAC only; a project without contract records "no contract"', async () => {
    const db = await getDb();
    const n = await createChangeRequest('HLT-026', { title: 'Yard lighting', types: ['budget'], amountKeur: 12, scheduleDays: 0, wbsCodes: ['1.7'] }, 'Romain Aubert');
    const [cr] = await db.select({ id: changeRequests.id }).from(changeRequests).where(eq(changeRequests.number, n));
    // The client step "not required" (as the seeded CR-007; set automatically once R-069 lands).
    await db.update(changeRequestSteps).set({ decision: 'na' }).where(and(eq(changeRequestSteps.changeRequestId, cr.id), eq(changeRequestSteps.step, 'client')));
    for (const [step, who] of [['pm', 'Romain Aubert'], ['director', 'Marie Lefebvre'], ['ccb', 'Marie Lefebvre']] as const) await decideChangeStep('HLT-026', n, step, 'ok', who);
    const [p] = await db.select().from(changeRequestPostings).where(eq(changeRequestPostings.changeRequestId, cr.id));
    expect([p.amountKeur, p.bacBeforeKeur, p.bacAfterKeur, p.amendmentOutcome, p.amendmentId, p.allocations]).toEqual([12, 4885, 4897, 'not_contractual', null, [{ code: '1.7', amountKeur: 12 }]]);
    expect((await getContract('HLT-026'))!.amendments.some((a) => a.changeRequestRef === n)).toBe(false);

    const m = await createChangeRequest('NDC-031', { title: 'UPS bypass', types: ['scope', 'budget'], amountKeur: 30, scheduleDays: 5, wbsCodes: ['1'] }, 'Sophie Perrin');
    for (const [step, who] of [['pm', 'Sophie Perrin'], ['director', 'Marie Lefebvre'], ['client', 'Nadia Bensaïd'], ['ccb', 'Marie Lefebvre']] as const) await decideChangeStep('NDC-031', m, step, 'ok', who);
    const [ndc] = await db.select({ id: projects.id, bac: projects.budgetKeur }).from(projects).where(eq(projects.code, 'NDC-031'));
    expect(ndc.bac).toBe(2130);
    const [q] = await db.select().from(changeRequestPostings).where(eq(changeRequestPostings.projectId, ndc.id));
    expect(q.amendmentOutcome).toBe('no_contract');
    // A request on the project root spreads over the work packages pro rata of their original budget.
    expect(q.allocations.reduce((t, a) => t + a.amountKeur, 0)).toBeCloseTo(30, 10);
    expect(q.allocations.map((a) => a.code)).toEqual(['1.1', '1.2', '1.3', '1.4', '1.5', '1.6']);
  });

  it('a rejected request posts nothing', async () => {
    const db = await getDb();
    const n = await createChangeRequest('RCF-019', { title: 'Extra panels', types: ['budget'], amountKeur: 20, scheduleDays: 0, wbsCodes: ['1.3'] }, 'Claire Moreau');
    await decideChangeStep('RCF-019', n, 'director', 'rejected', 'Marie Lefebvre');
    const [cr] = await db.select({ id: changeRequests.id }).from(changeRequests).where(eq(changeRequests.number, n));
    expect(await db.select().from(changeRequestPostings).where(eq(changeRequestPostings.changeRequestId, cr.id))).toEqual([]);
    expect((await getProject('RCF-019'))!.budget).toBe(1350);
  });
});

describe('R-071 — linked draw-downs validated by the portfolio director (C-4)', () => {
  it('offers the project\'s change requests, risks and NCRs only', async () => {
    const links = await drawLinkOptions('HLT-026');
    expect(links.find((l) => l.value === 'R-03')).toMatchObject({ type: 'risk' });
    expect(links.find((l) => l.value === 'NCR-029')).toMatchObject({ type: 'ncr' });
    expect(links.some((l) => l.value === 'CR-009')).toBe(false); // still a draft
    await expect(submitContingencyDraw('HLT-026', { amountKeur: 5, reason: 'x', linkRef: 'R-99', linkType: 'risk' }, 'Romain Aubert')).rejects.toThrow(ContingencyError);
    // NDC-031's R-01 exists, but not on HLT-026 (R-01 is not an HLT-026 risk number).
    await expect(submitContingencyDraw('HLT-026', { amountKeur: 5, reason: 'x', linkRef: 'R-01', linkType: 'risk' }, 'Romain Aubert')).rejects.toThrow('Unknown change request, risk or NCR');
  });

  it('a submitted draw-down is not drawn; the director validates (→ drawn, actual cost) or rejects it; the balance is checked', async () => {
    const before = (await getProjectEvm('HLT-026'))!.ac;
    const r = await submitContingencyDraw('HLT-026', { amountKeur: 30, reason: 'Second mill audit', linkRef: 'NCR-029', linkType: 'ncr' }, 'Romain Aubert');
    expect([r.amount, r.requestedBy, r.director]).toEqual([30, 'Romain Aubert', 'Marie Lefebvre']);
    let c = (await getContingency('HLT-026'))!;
    expect([c.drawn, c.pending, c.remaining, c.draws.at(-1)!.status, c.draws.at(-1)!.approvedBy]).toEqual([48, 30, 102, 'submitted', null]);
    expect((await listDrawsAwaitingValidation()).map((d) => [d.projectCode, d.amount, d.linkRef, d.requestedBy])).toEqual([['HLT-026', 30, 'NCR-029', 'R. Aubert']]);
    // Balance: 150 − 48 drawn − 30 pending = 72 left to submit.
    await expect(submitContingencyDraw('HLT-026', { amountKeur: 73, reason: 'x', linkRef: 'R-03', linkType: 'risk' }, 'Romain Aubert')).rejects.toThrow('The draw-down exceeds the remaining provision');
    // Only the director decides; then the draw-down is drawn and counts in the actual cost at its date.
    await expect(decideContingencyDraw('HLT-026', r.drawId, 'validated', { name: 'Romain Aubert', role: 'pm' })).rejects.toThrow('Only the portfolio director validates contingency draw-downs');
    const d = await decideContingencyDraw('HLT-026', r.drawId, 'validated', DIRECTOR, '');
    expect([d.decision, d.requestedBy]).toEqual(['validated', 'Romain Aubert']);
    c = (await getContingency('HLT-026'))!;
    expect([c.drawn, c.pending, c.remaining, c.draws.at(-1)!.status, c.draws.at(-1)!.approvedBy]).toEqual([78, 0, 72, 'validated', 'M. Lefebvre']);
    expect((await getProjectEvm('HLT-026'))!.ac).toBe(before + 30);
    expect((await getCostControl('HLT-026'))!.recon.contUsed).toBe(78);
    await expect(decideContingencyDraw('HLT-026', r.drawId, 'rejected', DIRECTOR)).rejects.toThrow('This draw-down is not waiting for a decision any more');
    // Rejected: kept in the register with its comment, never drawn.
    const x = await submitContingencyDraw('HLT-026', { amountKeur: 10, reason: 'Extra lighting', linkRef: 'CR-004', linkType: 'change_request' }, 'Romain Aubert');
    await decideContingencyDraw('HLT-026', x.drawId, 'rejected', DIRECTOR, 'Covered by CR-004');
    c = (await getContingency('HLT-026'))!;
    expect([c.drawn, c.pending, c.draws.at(-1)!.status, c.draws.at(-1)!.decisionComment, c.draws.at(-1)!.decidedBy]).toEqual([78, 0, 'rejected', 'Covered by CR-004', 'M. Lefebvre']);
    const audit = await listAudit({ limit: 3 });
    expect(audit.find((a) => a.area === 'Contingency')!.change).toBe('draw-down rejected · 10 k€ · CR-004 · Covered by CR-004');
  });

  it('validating cannot take the drawn total above the provision', async () => {
    const a = await submitContingencyDraw('MSR-012', { amountKeur: 6, reason: 'Display rework', linkRef: 'R-01', linkType: 'risk' }, 'Antoine Naveau');
    const b = await submitContingencyDraw('MSR-012', { amountKeur: 4, reason: 'Cabling', linkRef: 'R-02', linkType: 'risk' }, 'Antoine Naveau');
    // MSR-012's provision is its budget line, 10 k€: 6 + 4 fit; a third one does not.
    await expect(submitContingencyDraw('MSR-012', { amountKeur: 1, reason: 'x', linkRef: 'R-01', linkType: 'risk' }, 'Antoine Naveau')).rejects.toThrow('The draw-down exceeds the remaining provision');
    await decideContingencyDraw('MSR-012', a.drawId, 'validated', DIRECTOR);
    await decideContingencyDraw('MSR-012', b.drawId, 'validated', DIRECTOR);
    expect((await getContingency('MSR-012'))!).toMatchObject({ initial: 10, drawn: 10, remaining: 0, isDefault: false });
  });

  it('My approvals: the director\'s inbox lists the draw-downs awaiting validation; nobody else\'s does', async () => {
    const s = await submitContingencyDraw('NDC-031', { amountKeur: 12, reason: 'UPS spare battery', linkRef: 'R-02', linkType: 'risk' }, 'S. Perrin');
    const inbox = await getApprovalInbox(PERSONA_BY_ROLE.director, { projectCode: 'HLT-026', lang: 'en' });
    const items = inbox.items.filter((i) => i.kind === 'contingency');
    expect(items.map((i) => [i.id, i.title, i.sub, i.who, i.when, i.href, i.decision])).toEqual([
      ['NDC-031', 'UPS spare battery', '€12k · R-02', 'S. Perrin', '25 Sep', '/projects/NDC-031/contingency', { mode: 'contingency-draw', projectCode: 'NDC-031', drawId: s.drawId }],
    ]);
    expect(inbox.decided).toBeGreaterThanOrEqual(5);
    const pm = await getApprovalInbox(PERSONA_BY_ROLE.pm, { projectCode: 'NDC-031', lang: 'en' });
    expect(pm.items.some((i) => i.kind === 'contingency')).toBe(false);
  });
});

describe('R-072 — cost if it occurs entered, EMV = cost × P / 5 (Q-1)', () => {
  it('the seeded EMVs are unchanged; the EMV follows a change of probability or of cost', async () => {
    let reg = (await getRiskRegister('HLT-026'))!;
    const r03 = reg.risks.find((r) => r.id === 'R-03')!;
    expect([r03.emv, r03.costIfOccurs, reg.openEmv]).toEqual([120, 150, 340]);
    await updateRisk('HLT-026', 'R-03', { probability: 5 }, 'Romain Aubert');
    reg = (await getRiskRegister('HLT-026'))!;
    expect([reg.risks.find((r) => r.id === 'R-03')!.emv, reg.openEmv, (await getContingency('HLT-026'))!.exposure]).toEqual([150, 370, 370]);
    expect((await listAudit({ limit: 1 }))[0].change).toBe('P: 4 → 5 · EMV: 120 → 150 k€');
    await updateRisk('HLT-026', 'R-03', { costKeur: 200, probability: 4 }, 'Romain Aubert');
    reg = (await getRiskRegister('HLT-026'))!;
    expect([reg.risks.find((r) => r.id === 'R-03')!.emv, reg.risks.find((r) => r.id === 'R-03')!.costIfOccurs]).toEqual([160, 200]);
    expect((await listAudit({ limit: 1 }))[0].change).toBe('P: 5 → 4 · cost if it occurs: 150 → 200 k€ · EMV: 150 → 160 k€');
  });

  it('backfill of a database seeded before migration 0007: cost = EMV × 5 / P (two decimals), else 0', async () => {
    const db = await getDb();
    const [w] = await db.select({ id: risks.id }).from(risks).innerJoin(projects, eq(projects.id, risks.projectId)).where(and(eq(projects.code, 'WSA-044'), eq(risks.number, 'R-03')));
    await db.update(risks).set({ costKeur: null, emvKeur: 32 }).where(eq(risks.id, w.id));
    const [x] = await db.select({ id: risks.id }).from(risks).innerJoin(projects, eq(projects.id, risks.projectId)).where(and(eq(projects.code, 'WSA-044'), eq(risks.number, 'R-04')));
    await db.update(risks).set({ costKeur: null, emvKeur: null }).where(eq(risks.id, x.id));
    // Before the backfill the register already reads the legacy EMV (no row shows a wrong figure in between).
    expect((await getRiskRegister('WSA-044'))!.risks.find((r) => r.id === 'R-03')!.emv).toBe(32);
    await backfillCostControl(db);
    const rows = await db.select({ id: risks.id, cost: risks.costKeur }).from(risks).where(eq(risks.id, w.id));
    expect(rows[0].cost).toBe(53.33);
    expect((await db.select({ cost: risks.costKeur }).from(risks).where(eq(risks.id, x.id)))[0].cost).toBe(0);
    expect((await getRiskRegister('WSA-044'))!.risks.find((r) => r.id === 'R-03')!.emv).toBe(32);
  });
});
