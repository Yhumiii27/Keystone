// Delivery 2 database layer — writers on an in-memory PGlite: numbering (R-21, CR-011, RQ-045, T-2341),
// workflow rules (CR status derived from the chain, BL2 switch, request → task, task status ⇄ %), viewer as
// actor, per-user notification read state and the audit rows they append.
import { beforeAll, describe, expect, it } from 'vitest';
import { setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { recordStageChange } from './lifecycle';
import { createChangeRequest, decideChangeStep, getChangeControl, submitChangeRequest } from './changes';
import { decideContingencyDraw, getContingency, submitContingencyDraw } from './contingency';
import { addRateRole, addSkill, assignUnassignedHours, getHoursReconciliation, getRateCard, getSkillsMatrix, markHoursImported, setBaseRate, setMultiplier } from './hr';
import { countUnreadNotifications, createNotification, listAudit, listNotifications, markAllNotificationsRead, markNotificationRead } from './notifications';
import {
  acceptReschedule, approveResourceRequest, createResourceRequest, getResourceRequest, listPendingForcedStageChanges, proposeReschedule,
  reRequestResourceRequest, rejectResourceRequest, withdrawResourceRequest,
} from './requests';
import { autoLevelScenario, createScenario, getWhatIf, selectScenario, setScenarioPriority, toggleScenarioLever } from './resources';
import { createRisk, getRiskRegister, updateRisk } from './risks';
import { addChecklistItem, addTaskComment, getTask, listTasks, logTaskTime, setTaskProgress, setTaskStatus, toggleChecklistItem, toggleTaskDone } from './tasks';
import { freezeSnapshot, getTrends, recordStatusReport } from './trends';

beforeAll(async () => {
  setDb(await openDatabase());
}, 60_000);

const lastAudit = async () => (await listAudit({ limit: 1 }))[0];

describe('risks', () => {
  it('adds R-21 on top of the register, then edits it from the drawer', async () => {
    // Q-1 (delivery 7): the cost if it occurs is entered (30) and EMV = cost × P / 5 → 30 at P 5 (clamped from 9).
    const n = await createRisk('HLT-026', { title: 'Port strike', category: 'contractual_client', probability: 9, impact: 2, owner: 'Romain Aubert', response: 'accept', costKeur: 30 }, 'Romain Aubert');
    expect(n).toBe('R-21');
    let reg = (await getRiskRegister('HLT-026'))!;
    expect(reg.risks[0]).toMatchObject({ id: 'R-21', probability: 5, impact: 2, status: 'open', trend: 'flat', plan: '—', trigger: '—', owner: 'Romain Aubert' });
    expect(reg.openEmv).toBe(370);
    expect(await createRisk('NDC-031', { title: 'x', category: 'technical', response: 'avoid' }, 'Romain Aubert')).toBe('R-22');
    await updateRisk('HLT-026', 'R-03', { probability: 3, response: 'transfer' }, 'Romain Aubert');
    await updateRisk('HLT-026', 'R-21', { status: 'closed' }, 'Romain Aubert');
    reg = (await getRiskRegister('HLT-026'))!;
    // Q-1: the cost if it occurs stays 150 and the EMV follows P (120 → 90); the prototype kept the EMV and showed a cost of 200.
    expect(reg.risks.find((r) => r.id === 'R-03')).toMatchObject({ probability: 3, score: 12, level: 'high', response: 'transfer', costIfOccurs: 150, emv: 90 });
    expect(reg.openEmv).toBe(310);
    expect(await lastAudit()).toMatchObject({ who: 'Romain Aubert', object: 'R-21', change: 'status: Open → Closed', area: 'Risks', projectCode: 'HLT-026' });
  });
});

describe('change control', () => {
  it('derives the status from the chain (not stuck in review) and switches BL2 when CR-009 is approved', async () => {
    await decideChangeStep('HLT-026', 'CR-008', 'director', 'ok', 'Marie Lefebvre');
    await decideChangeStep('HLT-026', 'CR-008', 'client', 'ok', 'Nadia Bensaïd');
    expect(await decideChangeStep('HLT-026', 'CR-008', 'ccb', 'ok', 'Marie Lefebvre')).toBe('approved');
    await expect(decideChangeStep('HLT-026', 'CR-008', 'ccb', 'ok', 'Marie Lefebvre')).rejects.toThrow();
    await expect(decideChangeStep('HLT-026', 'CR-009', 'pm', 'ok', 'Romain Aubert')).rejects.toThrow(/not in review/);
    await submitChangeRequest('HLT-026', 'CR-009', 'Romain Aubert');
    for (const [step, who] of [['pm', 'Romain Aubert'], ['director', 'Marie Lefebvre'], ['client', 'Nadia Bensaïd']] as const)
      expect(await decideChangeStep('HLT-026', 'CR-009', step, 'ok', who)).toBe('in_review');
    expect(await decideChangeStep('HLT-026', 'CR-009', 'ccb', 'ok', 'Marie Lefebvre')).toBe('approved');
    const cc = (await getChangeControl('HLT-026'))!;
    expect(cc.baselines.map((b) => [b.code, b.state, b.setOnDate])).toEqual([['BL0', 'superseded', '2026-01-18'], ['BL1', 'superseded', '2026-03-12'], ['BL2', 'current', '2026-09-25']]);
    const cr8 = cc.changeRequests.find((c) => c.id === 'CR-008')!;
    expect(cr8.chain.find((s) => s.step === 'director')).toMatchObject({ decision: 'ok', decidedBy: 'Marie Lefebvre' });
    // S-3 / DELIVERY-6-PLAN §3.1 gap (1): the approval now also fills BL2's activity snapshot. Both audit lines are written in
    // one transaction and can share a millisecond, so look each one up instead of relying on their order.
    const recent = await listAudit({ limit: 5 });
    expect(recent.find((a) => a.object === 'CR-009')).toMatchObject({ change: 'ccb: pending → ok · status: In review → Approved · BL2 snapshot · 21 activities · BL2 current', area: 'Change control' });
    expect(recent.find((a) => a.object === 'HLT-026 BL2')).toMatchObject({ change: 'baseline snapshot · 21 activities · current', area: 'Planning' });
  });

  it('raises CR-011 (submitted, every step pending) and a rejected step rejects it', async () => {
    const n = await createChangeRequest('HLT-026', { title: 'Extra lighting', types: ['scope', 'budget'], amountKeur: 12, scheduleDays: 0, wbsCodes: ['1.6'], justification: 'Client ask' }, 'Romain Aubert');
    expect(n).toBe('CR-011');
    let cr = (await getChangeControl('HLT-026'))!.changeRequests[0];
    expect(cr).toMatchObject({ id: 'CR-011', status: 'in_review', by: 'R. Aubert', date: '25 Sep', justification: 'Client ask', wbs: [{ code: '1.6', name: 'MEP systems', amount: null }] });
    expect(cr.chain.map((s) => s.decision)).toEqual(['pending', 'pending', 'pending', 'pending']);
    expect(await decideChangeStep('HLT-026', 'CR-011', 'client', 'rejected', 'Nadia Bensaïd')).toBe('rejected');
    cr = (await getChangeControl('HLT-026'))!.changeRequests[0];
    expect(cr.statusLabel).toBe('Rejected');
    expect(await createChangeRequest('NDC-031', { title: 'Draft', types: ['schedule'], amountKeur: 0, scheduleDays: 5, submit: false }, 'Romain Aubert')).toBe('CR-012');
    expect((await getChangeControl('NDC-031'))!.changeRequests[0]).toMatchObject({ status: 'draft', wbs: [{ code: '1', name: 'Northgate Data Center Retrofit', amount: null }] });
  });
});

describe('trends and contingency', () => {
  it('records a status report and (re)freezes a snapshot', async () => {
    await recordStatusReport('HLT-026', { period: 'month', audience: 'client', sections: 'summary', note: 'Steel recovery on track' }, 'Romain Aubert');
    await freezeSnapshot('HLT-026', { statusDate: '2026-10-02', cpi: 0.92, spi: 0.91, eacKeur: 5240, floatDays: -25, riskEmvKeur: 340, milestoneSlipDays: 37 });
    const t = (await getTrends('HLT-026'))!;
    expect(t.reports[0]).toMatchObject({ periodLabel: 'September 2026', audienceLabel: 'Client', sectionsLabel: 'Summary + KPIs', generatedBy: 'Romain Aubert' });
    expect(t.snapshots.at(-1)).toMatchObject({ week: 'W40', dateText: '2 Oct', float: -25 });
    expect(t.nextReport?.text).toBe('9 Oct');
  });

  // Delivery 7 (R-071, C-4): a draw-down is submitted, linked, and only drawn once the portfolio director validates it.
  it('submits draw-downs (linked, not drawn yet), the director validates them; the register is created with the budget\'s provision', async () => {
    await submitContingencyDraw('HLT-026', { amountKeur: 10, reason: 'Night shift lighting', linkRef: 'R-07', linkType: 'risk' }, { name: 'Romain Aubert', role: 'pm' });
    let hlt = (await getContingency('HLT-026'))!;
    expect([hlt.drawn, hlt.pending, hlt.remaining, hlt.draws.at(-1)?.dateText, hlt.draws.at(-1)?.linkType, hlt.draws.at(-1)?.status, hlt.draws.at(-1)?.requestedBy])
      .toEqual([48, 10, 102, '25 Sep', 'risk', 'submitted', 'R. Aubert']);
    await decideContingencyDraw('HLT-026', hlt.draws.at(-1)!.id, 'validated', { name: 'Marie Lefebvre', role: 'director' });
    hlt = (await getContingency('HLT-026'))!;
    expect([hlt.drawn, hlt.pending, hlt.remaining, hlt.draws.at(-1)?.approvedBy]).toEqual([58, 0, 92, 'M. Lefebvre']);
    // A-8: NDC-031's provision is its budget's contingency line (100), no longer round(BAC × 3 %) = 63.
    await submitContingencyDraw('NDC-031', { amountKeur: 5, reason: 'UPS', linkRef: 'R-01', linkType: 'risk' }, { name: 'Marie Lefebvre', role: 'director' });
    const ndc = (await getContingency('NDC-031'))!;
    expect([ndc.initial, ndc.isDefault, ndc.drawn, ndc.pending, ndc.draws[0].linkRef]).toEqual([100, false, 0, 5, 'R-01']);
  });
});

describe('resource requests → tasks', () => {
  it('sends RQ-045 as the viewer, prepended, routed to the person’s department', async () => {
    const n = await createResourceRequest(
      { projectCode: 'HLT-026', title: '', activityCode: 'A1320', person: 'Thomas Kerbrat', hours: NaN, startDay: 10, dueDay: 14, priority: 'high', note: 'Rail survey' },
      'Romain Aubert',
    );
    expect(n).toBe('RQ-045');
    const r = (await getResourceRequest('RQ-045'))!;
    expect(r).toMatchObject({ title: 'Untitled request', hours: 8, department: 'Site operations', status: 'pending', sentText: 'Fri 25 Sep', startDay: 10, dueDay: 14, requestedBy: 'R. Aubert' });
    const c = await createResourceRequest({ projectCode: 'HLT-026', title: 'Checks', activityCode: 'A1250', contractRole: 'Contract structural engineer', priority: 'med' }, 'Marie Lefebvre');
    expect((await getResourceRequest(c))).toMatchObject({ id: 'RQ-046', department: 'Engineering', person: null, resource: 'Contract structural engineer', requestedBy: 'M. Lefebvre', startDay: 5, dueDay: 9 });
  });

  it('approve creates T-2341 in the person’s list; reschedule / accept creates T-2342; reject, withdraw, re-request', async () => {
    expect(await approveResourceRequest('RQ-041', 'Marion Kerviel')).toBe('T-2341');
    const r41 = (await getResourceRequest('RQ-041'))!;
    expect([r41.status, r41.response, r41.taskId]).toEqual(['approved', 'Approved · Marion Kerviel · Fri 25 Sep', 'T-2341']);
    const t = (await getTask('T-2341'))!;
    expect(t).toMatchObject({ assignee: 'Julien Wagner', status: 'todo', estimateH: 12, loggedH: 0, labels: ['Engineering'], checklist: { done: 0, total: 3 }, isFresh: true, department: 'Engineering', sourceRequest: 'RQ-041', startDay: 5, dueDay: 7 });
    expect((await listTasks({ person: 'J. Wagner' })).at(-1)?.id).toBe('T-2341');
    expect(await lastAudit()).toMatchObject({ who: 'Marion Kerviel', object: 'Request RQ-041', change: 'approved → task created for Julien Wagner', area: 'Approvals' });

    await proposeReschedule('RQ-042', 2, 'Over capacity that week', 'Gabriel Comte');
    const r42 = (await getResourceRequest('RQ-042'))!;
    expect([r42.status, r42.proposedStartDay, r42.proposedDueDay, r42.response]).toEqual(['reschedule', 18, 19, 'Reschedule proposed · Gabriel Comte · Fri 25 Sep — Over capacity that week']);
    expect(await acceptReschedule('RQ-038', 'Romain Aubert')).toBe('T-2342');
    const r38 = (await getResourceRequest('RQ-038'))!;
    expect([r38.status, r38.startDay, r38.dueDay, r38.response]).toEqual(['approved', 15, 19, 'Rescheduled to 12 Oct – 16 Oct · accepted by PM · assigned']);
    expect((await getTask('T-2342'))).toMatchObject({ assignee: 'Pauline Noguès', startDay: 15, dueDay: 19, labels: ['MEP'] });

    await rejectResourceRequest('RQ-044', '', 'Ines Duarte');
    expect((await getResourceRequest('RQ-044'))!.response).toBe('Rejected · Ines Duarte · Fri 25 Sep');
    await reRequestResourceRequest('RQ-044', 'Romain Aubert');
    expect((await getResourceRequest('RQ-044'))).toMatchObject({ status: 'pending', response: '' });
    await withdrawResourceRequest('RQ-044', 'Romain Aubert');
    expect((await getResourceRequest('RQ-044'))).toMatchObject({ status: 'withdrawn', response: 'Withdrawn by PM · Fri 25 Sep' });
    expect((await getResourceRequest('RQ-044'))!.events.map((e) => e.action)).toEqual(['sent', 'rejected', 'resent', 'withdrawn']);
    await expect(approveResourceRequest('RQ-044', 'Ines Duarte')).rejects.toThrow(/not pending/);
  });

  it('lists forced stage changes awaiting validation', async () => {
    await recordStageChange('NDC-031', 'chantier', 'forced', { reason: 'Client deadline', missing: ['x'], requestedByShortName: 'R. Aubert' });
    expect(await listPendingForcedStageChanges()).toMatchObject([{ projectCode: 'NDC-031', stage: 'chantier', stageLabel: 'Chantier', reason: 'Client deadline', requestedBy: 'Romain Aubert', pm: 'S. Perrin' }]);
  });
});

describe('tasks', () => {
  it('status ⇄ % coupling, checklist, comment by the viewer, time log', async () => {
    await setTaskStatus('T-2318', 'done', 'Hélène Sauvage');
    expect((await getTask('T-2318'))).toMatchObject({ status: 'done', pct: 100 });
    expect(await toggleTaskDone('T-2318', 'Hélène Sauvage')).toBe('doing');
    expect((await getTask('T-2318'))).toMatchObject({ status: 'doing', pct: 75 });
    await setTaskProgress('T-2331', 25, 'Hélène Sauvage');
    expect((await getTask('T-2331'))).toMatchObject({ status: 'doing', pct: 25 });
    await setTaskProgress('T-2331', 100, 'Hélène Sauvage');
    expect((await getTask('T-2331'))).toMatchObject({ status: 'done', pct: 100 });

    expect(await toggleChecklistItem('T-2314', 2)).toBe(true);
    await addChecklistItem('T-2314', 'Archive readings');
    expect((await getTask('T-2314'))!.checklist).toEqual({ done: 3, total: 5 });
    await addTaskComment('T-2314', 'Julien Wagner', '  Re-shot C4 — fine.  ');
    await addTaskComment('T-2314', 'Julien Wagner', '   ');
    const t = (await getTask('T-2314'))!;
    expect(t.comments.length).toBe(4);
    expect(t.comments.at(-1)).toMatchObject({ author: 'Julien Wagner', text: 'Re-shot C4 — fine.' });
    await logTaskTime('T-2314', { hours: 1.5, note: '' });
    await logTaskTime('T-2314', { hours: 0 });
    const t2 = (await getTask('T-2314'))!;
    expect([t2.loggedH, t2.entries.length, t2.entries.at(-1)?.dateText, t2.entries.at(-1)?.note, t2.entries.at(-1)?.person]).toEqual([
      7.5, 3, 'Fri 25 Sep', 'Work on Survey verticality — Bay 3 columns', 'Hélène Sauvage',
    ]);
  });
});

describe('HR and what-if', () => {
  it('rates, multipliers, roles and skills', async () => {
    // R-083 (A-10, R-4a): dated versions, written by the director or Finance (P-12 c — the DAL re-checks the role).
    const FINANCE = { name: 'Léa Marchand', role: 'finance' };
    await setBaseRate('Structural engineer', 88, '2026-09-25', FINANCE);
    await setMultiplier('sun', 2.1, '2026-09-25', FINANCE);
    await addRateRole({ role: 'Commissioning engineer (external)', rateEur: 110, costCenter: 'Site', grade: 'Senior', effectiveFrom: '2026-09-25' }, { name: 'Marie Lefebvre', role: 'director' });
    const rc = await getRateCard();
    expect(rc.roles.find((r) => r.role === 'Structural engineer')!.baseRateEur).toBe(88);
    expect(rc.roles.at(-1)).toMatchObject({ role: 'Commissioning engineer (external)', isExternal: true, costCenter: 'Site', grade: 'Senior' });
    expect(rc.multipliers.find((m) => m.key === 'sun')!.factor).toBe(2.1);
    expect((await listAudit({ limit: 3 })).map((a) => a.change)).toContain('Structural engineer base: 85 → 88 €/h from 25 Sep 2026');
    await addSkill({ name: 'Rope access', category: 'Safety' }, 'Marion Kerviel');
    const m = await getSkillsMatrix();
    expect(m.skills.at(-1)).toEqual({ name: 'Rope access', category: 'Safety' });
    expect(m.people[0].levels.at(-1)).toBe(0);
  });

  it('hours import and assignment', async () => {
    // Delivery 8: the hours writers re-check the project rule with the actor (R-044: Finance reads Hours).
    const PM = { name: 'Romain Aubert', role: 'pm' };
    await expect(markHoursImported('HLT-026', {}, { name: 'Léa Marchand', role: 'finance' })).rejects.toThrow('Hours are read-only for you on this project');
    await markHoursImported('HLT-026', {}, PM);
    await assignUnassignedHours('HLT-026', 0, '1.4', PM);
    const h = (await getHoursReconciliation('HLT-026'))!;
    expect([h.importedText, h.unassigned[0].assignedWbs, h.unassigned[1].assignedWbs]).toEqual(['30 Sep 2026', '1.4', null]);
  });

  it('what-if scenario edits', async () => {
    // Chapter 4 (S-7): levers derived from the data (A1250 assignments) replace the prototype's static ones.
    expect(await toggleScenarioLever('HLT-026', 'A', 'extra_resource:A1250:julien-wagner')).toBe(false);
    await setScenarioPriority('HLT-026', 'B', 'budget');
    await autoLevelScenario('HLT-026', 'B');
    await selectScenario('HLT-026', 'B', 'Romain Aubert');
    await createScenario('HLT-026', { name: 'C', basis: 'Baseline BL1', horizonMonths: 6, hypotheses: 'No overtime' });
    const w = (await getWhatIf('HLT-026'))!;
    const on = (n: string) => Object.entries(w.scenarios.find((s) => s.name === n)!.levers).filter(([, v]) => v).map(([k]) => k);
    expect(on('A')).toEqual(['overtime:A1250:steel-erection-crew', 'extra_resource:A1250:steel-erection-crew']);
    // "Protect budget" on HLT-026: every derived lever costs money → none.
    expect(on('B')).toEqual([]);
    expect(on('C')).toEqual([]);
    expect(w.scenarios.map((s) => [s.name, s.priority, s.selected])).toEqual([['A', 'date', false], ['B', 'budget', true], ['C', 'date', false]]);
  });
});

describe('notifications', () => {
  it('read state is per user (role)', async () => {
    await markNotificationRead('director', 'n1');
    expect(await countUnreadNotifications('director')).toBe(2);
    expect((await listNotifications('client')).find((n) => n.id === 'n1')!.read).toBe(false);
    await markAllNotificationsRead('director');
    expect(await countUnreadNotifications('director')).toBe(0);
    expect(await countUnreadNotifications('client')).toBe(1);
    const code = await createNotification({ kind: 'task', title: 'New task assigned: Erection sequence', sub: 'Approved by Marion Kerviel', screen: 'mywork', audience: ['member'] });
    const member = await listNotifications('member');
    expect(member[0]).toMatchObject({ id: code, read: false, projectCode: null });
    expect(await countUnreadNotifications('member')).toBe(3);
    expect(await countUnreadNotifications('director')).toBe(0);
  });
});
