// Delivery 3 database layer — writers on an in-memory PGlite: Codex vault (deposit, approval circuit, release,
// acknowledgement, downloads), contract and billing (sheet edits, amendments, bonds, milestones, invoices, payments),
// meetings (new meeting, minutes lines, transcript analysis, send minutes → MIN record + tasks), stakeholders,
// interfaces and prioritisation weights / scores. Each write appends an audit row with the viewer as the actor.
import { beforeAll, describe, expect, it } from 'vitest';
import { getDb, setDb } from '@/server/db/client';
import { applyCodexDocumentStates } from '@/server/integrations/codex/mirror';
import { openDatabase } from '@/server/db/open';
import { getCashFlow, listBillingPlans } from './cashflow';
import { addAmendment, addBond, addPaymentMilestone, getContract, issueInvoice, markInvoicePaid, updateContractSheet } from './contract';
import {
  acknowledgeDocument, depositInCodex, freezeDocument, getCodexSyncState, getDocumentRecord, listVaultDocuments, logDocumentDownload,
  proposeDocumentRelease, recordCircuitStart, recordDocumentDecision,
} from './documents';
import { createInterface, freezeInterface, listInterfaces, markInterfaceReceived } from './interfaces';
import {
  addMeetingLine, analyseTranscript, applyTranscriptToMinutes, createMeeting, getMeeting, listMeetings, sendMinutes, toggleMeetingAction,
} from './meetings';
import { listAudit, listActivity } from './notifications';
import { getPrioritisation, getScoreWeights, resetScoreWeights, saveProposalScore, setScoreWeight } from './prioritisation';
import { addStakeholder, getStakeholderRegister } from './stakeholders';
import { getTask, listTasks } from './tasks';

beforeAll(async () => {
  setDb(await openDatabase());
}, 60_000);

const lastAudit = async () => (await listAudit({ limit: 1 }))[0];
const vault = async (n: string) => (await listVaultDocuments()).find((d) => d.number === n)!;

describe('Codex vault writers', () => {
  // P-7b = a, D-1b = a (Delivery 7, R-124): the decisions go to Codex through the outbox; the index record (status,
  // approval proof) changes only when Codex answers — before, the second approval released the record at once.
  it('approval circuit of RPT-HLT-014: quality manager, then project manager → release requested, pending sync with Codex', async () => {
    const QM = { name: 'Gabriel Comte', role: 'quality' };
    const PM = { name: 'Romain Aubert', role: 'pm' };
    expect(await recordDocumentDecision('RPT-HLT-014', { decision: 'approved' }, QM)).toMatchObject({ step: 1, role: 'quality_manager', releaseRequested: false });
    let d = await vault('RPT-HLT-014');
    expect([d.statusLabel, d.approvalsGiven, d.nextRoleLabel, d.nextApprover, d.circuitNote]).toEqual(['Release proposed', 0, 'Project manager', 'R. Aubert', 'Approved · Pending sync with Codex']);
    // A screen still showing step 1 is refused.
    await expect(recordDocumentDecision('RPT-HLT-014', { decision: 'approved', step: 1 }, QM)).rejects.toThrow(/no longer open/);
    expect(await recordDocumentDecision('RPT-HLT-014', { decision: 'approved', step: 2 }, PM)).toMatchObject({ step: 2, role: 'project_manager', releaseRequested: true });
    d = await vault('RPT-HLT-014');
    expect([d.status, d.shared, d.canApprove, d.nextRoleLabel, d.circuitNote]).toEqual(['release_proposed', false, false, null, 'Release approved · Pending sync with Codex']);
    const r = (await getDocumentRecord('RPT-HLT-014'))!;
    expect(r.approvals.map((a) => [a.roleLabel, a.signedOn, a.keystone && [a.keystone.decision, a.keystone.by, a.keystone.sync]])).toEqual([
      ['Author', '2026-09-26', null], ['Quality manager', null, ['approved', 'G. Comte', 'pending']], ['Project manager', null, ['approved', 'R. Aubert', 'pending']],
    ]);
    await expect(recordDocumentDecision('RPT-HLT-014', { decision: 'approved' }, PM)).rejects.toThrow(/no approval step open/);
    expect(await lastAudit()).toMatchObject({ who: 'Romain Aubert', object: 'RPT-HLT-014', area: 'Documents', change: 'approved · Project manager · release requested · Pending sync with Codex' });
    expect((await listActivity())[0]).toMatchObject({ who: 'Romain Aubert', what: 'RPT-HLT-014 rev A · Approved · Project manager · Pending sync with Codex', projectCode: 'HLT-026' });
  });

  it('client acknowledges PID-HLT-026; downloads are logged before the Codex log', async () => {
    await acknowledgeDocument('PID-HLT-026', 'Nadia Bensaïd');
    expect((await vault('PID-HLT-026')).acknowledged).toBe(true);
    await expect(acknowledgeDocument('BOM-MEC-026', 'Nadia Bensaïd')).rejects.toThrow(/not shared/);
    await logDocumentDownload('PID-HLT-026', 'Marie Lefebvre');
    expect((await getDocumentRecord('PID-HLT-026'))!.downloads.map((x) => x.text)).toEqual([
      'Marie Lefebvre · rev D · 29 Sep · PDF', 'S. Haddad · rev D · 27 Sep · PDF', 'N. Bensaïd · rev D · 28 Sep · PDF',
    ]);
  });

  it('freeze → propose release on an engineering draft; wrong transitions are refused', async () => {
    await freezeDocument('SCH-ELE-026', 'Antoine Girard');
    await proposeDocumentRelease('SCH-ELE-026', 'Antoine Girard');
    let d = await vault('SCH-ELE-026');
    // P-7c = a (Delivery 7, R-106): an engineering deliverable's circuit waits for the PM's "Validate release (PM)".
    expect([d.statusLabel, d.nextRoleLabel, d.nextApprover, d.canApprove, d.circuitNote]).toEqual(['Release proposed', null, null, false, 'Awaiting PM validation']);
    await expect(freezeDocument('SCH-ELE-026', 'Antoine Girard')).rejects.toThrow(/not Draft/);
    const db = await getDb();
    await db.transaction((tx) => recordCircuitStart(tx, 'SCH-ELE-026', { name: 'Romain Aubert', role: 'pm' }));
    await expect(db.transaction((tx) => recordCircuitStart(tx, 'SCH-ELE-026', { name: 'Romain Aubert', role: 'pm' }))).rejects.toThrow(/already started/);
    await expect(db.transaction((tx) => recordCircuitStart(tx, 'RPT-HLT-016', { name: 'Romain Aubert', role: 'pm' }))).rejects.toThrow(/not an engineering deliverable/);
    d = await vault('SCH-ELE-026');
    expect([d.nextRoleLabel, d.nextApprover, d.canApprove, d.circuitNote]).toEqual(['Engineering lead', 'A. Girard', true, 'Approval circuit started · Pending sync with Codex']);
    await recordDocumentDecision('SCH-ELE-026', { decision: 'approved' }, { name: 'Antoine Girard', role: 'englead' });
    await recordDocumentDecision('SCH-ELE-026', { decision: 'approved' }, { name: 'Romain Aubert', role: 'pm' });
    expect([(await vault('SCH-ELE-026')).status, (await vault('SCH-ELE-026')).withdrawal]).toEqual(['release_proposed', null]);
    // Codex answers (the HTTP connector's refresh): released, rev A withdrawn automatically; the outbox entries close.
    await db.transaction((tx) => applyCodexDocumentStates(tx, [{
      number: 'SCH-ELE-026', revision: 'B', status: 'released', withdrawnRevision: 'A', withdrawnOn: '2026-09-29',
      approvals: [{ step: 1, signedOn: '2026-09-29', signedBy: 'A. Girard' }, { step: 2, signedOn: '2026-09-29', signedBy: 'R. Aubert' }],
    }]));
    d = await vault('SCH-ELE-026');
    expect([d.status, d.withdrawal, d.approvalsGiven, d.circuitNote, d.circuitState.approved]).toEqual(['released', { revision: 'A', on: '2026-09-29' }, 2, null, []]);
    expect((await getDocumentRecord('SCH-ELE-026'))!.approvals.map((a) => [a.who, a.signed, a.keystone])).toEqual([['S. Haddad', true, null], ['A. Girard', true, null], ['R. Aubert', true, null]]);
    expect(await lastAudit()).toMatchObject({ who: 'Codex', object: 'SCH-ELE-026', change: 'status: Release proposed → Released · synced from Codex' });
  });

  it('deposit a new certificate (CER-HLT-042, Draft, New, first in the vault) and a new revision of PID-HLT-026', async () => {
    expect(await depositInCodex({ typeCode: 'CER', project: 'HLT-026', linkedPo: 'PO-2026-118', linkedPart: 'CR-RAIL-A100' }, 'Marie Lefebvre')).toEqual({ number: 'CER-HLT-042', created: true });
    const all = await listVaultDocuments();
    expect(all[0]).toMatchObject({
      number: 'CER-HLT-042', title: 'Material certificate 3.1 — S355 · heat 7781', status: 'draft', revision: 'A', author: 'M. Lefebvre', service: 'procurement',
      confidentiality: 'internal', tagsText: 'PO-2026-118 · CR-RAIL-A100', isNew: true, dateText: '29 Sep',
    });
    expect(all[0].links.map((l) => [l.kindLabel, l.ref])).toEqual([['Purchase order', 'PO-2026-118'], ['Article', 'CR-RAIL-A100']]);
    expect((await getCodexSyncState())!.records).toBe(413);
    expect(await depositInCodex({ typeCode: 'PID', project: 'HLT-026', revisionOf: 'PID-HLT-026' }, 'Pauline Noguès')).toEqual({ number: 'PID-HLT-026', created: false });
    const pid = (await getDocumentRecord('PID-HLT-026'))!;
    expect([pid.status, pid.revision, pid.shared, pid.approvals.map((a) => a.signed)]).toEqual(['draft', 'D', false, [true, false, false]]);
    expect((await depositInCodex({ typeCode: 'NCR', project: 'QMS' }, 'Gabriel Comte')).number).toBe('NCR-QMS-040');
  });
});

describe('contract & billing writers', () => {
  it('issue M4 (INV-2026-004 at the current amount) then mark it paid; the billing plan follows', async () => {
    expect(await issueInvoice('HLT-026', { milestone: 'M4', note: 'Cranes 1–2' }, 'Romain Aubert')).toBe('INV-2026-004');
    let c = (await getContract('HLT-026'))!;
    const inv = c.invoices.find((i) => i.number === 'INV-2026-004')!;
    expect([inv.issuedText, inv.amountKeur, inv.dueText, inv.statusLabel, inv.note]).toEqual(['30 Sep', 1104, '14 Nov', 'Awaiting payment', 'Cranes 1–2']);
    expect([c.invoicedKeur, c.nextInvoiceNumber]).toEqual([4140, 'INV-2026-005']);
    await expect(issueInvoice('HLT-026', { milestone: 'M4' }, 'Romain Aubert')).rejects.toThrow(/already invoiced/);
    await markInvoicePaid('HLT-026', 'M3', 'Romain Aubert');
    c = (await getContract('HLT-026'))!;
    expect(c.milestones.map((m) => m.statusLabel)).toEqual(['Paid', 'Paid', 'Paid', 'Invoiced', 'Planned']);
    expect(c.invoices.find((i) => i.milestoneNumber === 'M3')).toMatchObject({ paidText: '30 Sep', status: 'paid' });
    expect([c.paidKeur, c.retentionKeur]).toEqual([3036, 152]);
    expect((await listBillingPlans())['HLT-026'].next).toMatchObject({ label: 'M5 Handover', amountKeur: 1380 });
    expect((await getCashFlow(null)).rows[0].plan.outstandingKeur).toBe(1104);
    expect((await listActivity())[0]).toMatchObject({ who: 'Romain Aubert', kind: 'invoice' });
  });

  it('a signed amendment re-prices the milestones; bonds and milestones are appended; sheet edits are validated', async () => {
    expect(await addAmendment('HLT-026', { subject: 'Amendment 3 — extra lighting', changeRequestRef: 'CR-007', amountKeur: 80, status: 'signed', signedOn: '2026-09-30' }, 'Romain Aubert'))
      .toBe('Amendment 3 — extra lighting (CR-007)');
    let c = (await getContract('HLT-026'))!;
    expect([c.valueKeur, c.milestones[4].amountKeur, c.amendments[2].changeRequestLinked, c.amendments[2].dateText]).toEqual([5600, 1400, true, '30 Sep 2026']);
    expect(await addBond('HLT-026', { type: 'warranty', amountKeur: 280, issuer: 'BNP Paribas', validUntil: '2029-01-14' }, 'Romain Aubert')).toBe('Warranty bond · BNP Paribas');
    expect(await addPaymentMilestone('HLT-026', { label: 'Final acceptance', sharePct: 5, contractualDue: '2028-01-14' }, 'Romain Aubert')).toBe('M6');
    c = (await getContract('HLT-026'))!;
    expect([c.bondsInForce.count, c.bondsInForce.total, c.sharePctTotal, c.milestones.at(-1)!.dueText]).toEqual([2, 3, 105, '14 Jan 2028']);
    await updateContractSheet('HLT-026', { paymentTerms: 'Net 60 days', baseAmountKeur: 5500 }, 'Romain Aubert');
    c = (await getContract('HLT-026'))!;
    expect([c.sheet.termsDays, c.valueKeur, c.invoices[0].dueText]).toEqual([60, 5700, '11 May']);
    expect(await lastAudit()).toMatchObject({ object: 'CTR-HLT-001', change: 'baseAmountKeur: 5400 → 5500 · paymentTerms: Net 45 days → Net 60 days', area: 'Contract' });
    await expect(updateContractSheet('HLT-026', { retentionPct: 120 }, 'Romain Aubert')).rejects.toThrow();
    await expect(addAmendment('NDC-031', { subject: 'x', amountKeur: 1, status: 'draft' }, 'Romain Aubert')).rejects.toThrow(/No contract/);
  });
});

describe('meetings writers', () => {
  it('new meeting MTG-130 on top of the register, organized by the viewer', async () => {
    const n = await createMeeting('HLT-026', {
      title: 'Crane erection briefing', type: 'internal', series: 'one_off', date: '2026-10-06', time: '9:00', location: '', invitees: ['R. Aubert', 'L. Fabre', 'J. Wagner'],
      agenda: ['Lifting plan', 'Access windows'],
    }, 'Romain Aubert');
    expect(n).toBe('MTG-130');
    const m = (await listMeetings('HLT-026'))[0];
    expect(m).toMatchObject({ number: 'MTG-130', statusLabel: 'Scheduled', organizer: 'R. Aubert', location: 'Teams', durationText: '1 h', time: '09:00', dateText: '6 Oct 2026' });
    expect(m.agenda.map((a) => a.title)).toEqual(['Lifting plan', 'Access windows']);
    await addMeetingLine('MTG-130', 1, { type: 'action', text: 'Confirm the window with the port', owner: '', due: '' }, 'Romain Aubert');
    const m2 = (await getMeeting('MTG-130'))!;
    expect([m2.status, m2.agenda[1].lines[0]]).toEqual(['notes_in_progress', expect.objectContaining({ owner: 'R. Aubert', due: '—', dueDate: null, overdue: false, origin: 'manual' })]);
  });

  it('transcript of MTG-119: analyse, then add the proposals to the last agenda point (once)', async () => {
    await analyseTranscript('MTG-119', 'Antoine Girard');
    let m = (await getMeeting('MTG-119'))!;
    expect(m.transcript).toMatchObject({ analysed: true, applied: false });
    // S-10 (chapter 4): the analysis is real (local rules here: no ANTHROPIC_API_KEY under Vitest). It finds the same three
    // decisions and three actions as the prototype's pre-baked result, but A. Girard's action has no due date — the transcript
    // states none (the prototype invented "9 Oct").
    expect(m.transcript!.proposals.map((p) => [p.type, p.owner, p.due])).toEqual([
      ['decision', null, null], ['decision', null, null], ['decision', null, null], ['action', 'S. Haddad', '6 Oct'], ['action', 'P. Noguès', '3 Oct'], ['action', 'A. Girard', null],
    ]);
    expect(await applyTranscriptToMinutes('MTG-119', 'Antoine Girard')).toBe(6);
    expect(await applyTranscriptToMinutes('MTG-119', 'Antoine Girard')).toBe(0);
    m = (await getMeeting('MTG-119'))!;
    expect([m.status, m.agenda[2].lines.length, m.agenda[2].lines[3]]).toEqual(['scheduled', 6, expect.objectContaining({ type: 'action', owner: 'S. Haddad', dueDate: '2026-10-06', origin: 'transcript' })]);
  });

  it('send the minutes of MTG-118: MIN-HLT-027 released in the vault, tasks for J. Wagner and H. Sauvage, read receipts', async () => {
    expect(await toggleMeetingAction('MTG-118', 1, 1, 'Romain Aubert')).toBe(true);
    const tasksBefore = (await listTasks()).length;
    const sent = await sendMinutes('MTG-118', 'Romain Aubert');
    expect(sent).toEqual({ minutesNumber: 'MIN-HLT-027', invited: 5, tasks: ['T-2341', 'T-2342'] });
    const m = (await getMeeting('MTG-118'))!;
    expect([m.status, m.sentText, m.minutesIndexed]).toEqual(['minutes_sent', '30 Sep', true]);
    expect(m.participants.filter((p) => p.minutesRecipient).map((p) => [p.name, p.readOn])).toEqual([['L. Fabre', null], ['J. Wagner', null], ['H. Sauvage', null], ['T. Kerbrat', null]]);
    expect(m.agenda[1].lines.filter((l) => l.type === 'action').map((l) => l.taskNumber)).toEqual(['T-2341', 'T-2342']);
    const t = (await getTask('T-2341'))!;
    expect([t.assignee, t.title, t.labels, t.status, t.estimateH, t.start, t.due]).toEqual(['Julien Wagner', 'Electrode oven on site and WPS reminder to welders', ['Meeting', 'MTG-118'], 'todo', 2, '2026-09-25', '2026-09-30']);
    expect((await listTasks()).length).toBe(tasksBefore + 2);
    const doc = (await listVaultDocuments())[0];
    expect(doc).toMatchObject({ number: 'MIN-HLT-027', type: 'MIN', status: 'released', title: 'Weekly site meeting #24', author: 'R. Aubert', confidentiality: 'internal', tagsText: 'MTG-118 · Weekly site meeting', isNew: true, shared: true, acknowledged: false });
    await expect(addMeetingLine('MTG-118', 0, { type: 'info', text: 'late' }, 'Romain Aubert')).rejects.toThrow(/already sent/);
    expect((await sendMinutes('MTG-121', 'Sophie Perrin')).minutesNumber).toBe('MIN-NDC-025');
  });
});

describe('stakeholders, interfaces, prioritisation writers', () => {
  it('add a stakeholder: owner normalised to the short name, last contact 30 Sep, notes "New"', async () => {
    await addStakeholder('HLT-026', { name: 'Yves Morel', organisation: 'Bureau Veritas', role: 'Inspector', type: 'third_party', contactEmail: 'y.morel@bv.com', owner: 'Amélie Ollivier' }, 'Romain Aubert');
    const r = (await getStakeholderRegister('HLT-026')).stakeholders.at(-1)!;
    expect(r).toMatchObject({ name: 'Yves Morel', owner: 'A. Ollivier', lastText: '30 Sep', notes: 'New', stale: false, typeLabel: 'Third party', initials: 'YM' });
    await expect(addStakeholder('HLT-026', { name: 'X', organisation: 'Y', type: 'client', contactEmail: 'nope', owner: 'R. Aubert' }, 'Romain Aubert')).rejects.toThrow(/e-mail/);
  });

  it('register IF-10, mark the late IF-07 received, then freeze it', async () => {
    expect(await createInterface('HLT-026', { title: 'Port Wi-Fi coverage', keystoneSide: 'automation', otherParty: 'Client · IT', dataExpected: 'Coverage map', neededBy: '2026-11-02', owner: 'Sami Haddad' }, 'Romain Aubert')).toBe('IF-10');
    await markInterfaceReceived('HLT-026', 'IF-07', 'Romain Aubert');
    await expect(freezeInterface('HLT-026', 'IF-02', 'Romain Aubert')).rejects.toThrow(/Open/);
    await freezeInterface('HLT-026', 'IF-07', 'Romain Aubert');
    const rows = await listInterfaces('HLT-026');
    expect(rows.map((r) => [r.number, r.statusLabel])).toEqual([
      ['IF-01', 'Received'], ['IF-02', 'Open'], ['IF-03', 'Frozen'], ['IF-04', 'Received'], ['IF-05', 'Open'], ['IF-06', 'Frozen'], ['IF-07', 'Frozen'], ['IF-10', 'Open'],
    ]);
    expect(rows.at(-1)).toMatchObject({ owner: 'S. Haddad', providedText: '—', neededText: '2 Nov', daysToNeed: 32 });
    expect(await lastAudit()).toMatchObject({ object: 'IF-07', change: 'status: Received → Frozen', area: 'Interfaces' });
  });

  it('weights per user, reset; proposal score saved with the scorer', async () => {
    await setScoreWeight('pm', 'risk', 0.4);
    expect((await getScoreWeights('pm')).risk).toBe(0.4);
    expect((await getScoreWeights('director')).risk).toBe(0.2);
    const pf = await getPrioritisation('pm', null);
    expect(pf.weightSum).toBeCloseTo(1.2);
    await resetScoreWeights('pm');
    expect((await getScoreWeights('pm')).risk).toBe(0.2);
    await saveProposalScore('FTU-052', { fit: 5, margin: 4, risk: 9, comment: 'Strong fit' }, 'Marie Lefebvre');
    const row = (await getPrioritisation('director', null)).ranking.find((r) => r.project.code === 'FTU-052')!;
    expect(row.scores).toEqual([5, 4, 5, 4, 2]);
    expect(await lastAudit()).toMatchObject({ who: 'Marie Lefebvre', object: 'FTU-052', change: 'score: fit 5 · margin 4 · risk 5', area: 'Prioritisation' });
  });
});
