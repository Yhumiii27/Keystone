// P-7b = a, D-1b = a, P-7c = a (Delivery 7, R-124, R-106): the circuit Keystone shows over Codex's mirrored proof —
// decisions pending sync with Codex, the open step, a rejection stopping the circuit, the PM's validation starting an
// engineering deliverable's circuit — and the texts and inputs around it.
import { describe, expect, it } from 'vitest';
import {
  circuitNoteText, circuitStartToast, codexCircuitState, codexDecisionToast, isEngineeringDeliverable, parseRejectComment, type CircuitInput, type CodexEntryLike,
} from './codex-approvals';

const at = '2026-10-11T08:00:00.000Z';
const approval = (step: number, extra: Partial<CodexEntryLike> = {}): CodexEntryLike => ({
  kind: 'approval', revision: 'A', stepPosition: step, decision: 'approved', syncStatus: 'pending', actorName: 'Gabriel Comte', recordedAt: at, ...extra,
});
const start = (extra: Partial<CodexEntryLike> = {}): CodexEntryLike => ({
  kind: 'circuit_start', revision: 'A', stepPosition: null, decision: null, syncStatus: 'pending', actorName: 'Romain Aubert', recordedAt: at, ...extra,
});
const circuit = (x: Partial<CircuitInput> = {}): CircuitInput => ({ status: 'release_proposed', revision: 'A', steps: 3, signed: [], entries: [], needsStart: false, ...x });

describe('codexCircuitState', () => {
  it('opens the first step not signed in Codex nor approved in Keystone', () => {
    expect(codexCircuitState(circuit())).toMatchObject({ started: true, nextStep: 1, approved: [], rejection: null, releaseRequested: false, sync: null });
    expect(codexCircuitState(circuit({ signed: [1] })).nextStep).toBe(2);
    const s = codexCircuitState(circuit({ entries: [approval(1)] }));
    expect([s.nextStep, s.approved.map((a) => a.step), s.sync, s.releaseRequested]).toEqual([2, [1], 'pending', false]);
  });

  it('every step decided: the release is requested from Codex, nothing is open', () => {
    const s = codexCircuitState(circuit({ signed: [1], entries: [approval(2, { syncStatus: 'sent' })] }));
    expect([s.nextStep, s.releaseRequested, s.sync]).toEqual([null, true, 'sent']);
    // A step Codex has signed meanwhile no longer shows the Keystone decision.
    expect(codexCircuitState(circuit({ signed: [1, 2], entries: [approval(1), approval(2)] }))).toMatchObject({ approved: [], releaseRequested: false, nextStep: null, sync: null });
  });

  it('a rejection stops the circuit until Codex answers; a failed delivery shows first', () => {
    const s = codexCircuitState(circuit({ entries: [approval(1, { syncStatus: 'failed' }), approval(2, { decision: 'rejected' })] }));
    expect([s.nextStep, s.rejection?.step, s.releaseRequested, s.sync]).toEqual([null, 2, false, 'failed']);
  });

  it('only a record in Release proposed has an open circuit; entries of another revision are stale', () => {
    for (const status of ['draft', 'frozen', 'released', 'obsolete'] as const)
      expect(codexCircuitState(circuit({ status, entries: [approval(1)] }))).toMatchObject({ nextStep: null, approved: [], started: status === 'released' || status === 'obsolete' });
    expect(codexCircuitState(circuit({ revision: 'B', entries: [approval(1)] }))).toMatchObject({ nextStep: 1, approved: [] });
    // Out-of-range steps are ignored.
    expect(codexCircuitState(circuit({ entries: [approval(0), approval(3), approval(7)] })).approved).toEqual([]);
  });

  it('an engineering deliverable waits for the PM’s validation (P-7c); Codex signing a step also means it started', () => {
    expect(codexCircuitState(circuit({ needsStart: true }))).toMatchObject({ started: false, nextStep: null });
    const s = codexCircuitState(circuit({ needsStart: true, entries: [start()] }));
    expect([s.started, s.nextStep, s.startPending?.actorName, s.sync]).toEqual([true, 1, 'Romain Aubert', 'pending']);
    expect(codexCircuitState(circuit({ needsStart: true, signed: [1] }))).toMatchObject({ started: true, nextStep: 2, startPending: null });
  });
});

describe('texts and inputs', () => {
  it('circuit note under the status', () => {
    const note = (x: Partial<CircuitInput>) => circuitNoteText(codexCircuitState(circuit(x)), !!x.needsStart, x.status ?? 'release_proposed');
    expect(note({})).toBeNull();
    expect(note({ needsStart: true })).toBe('Awaiting PM validation');
    expect(note({ needsStart: true, entries: [start()] })).toBe('Approval circuit started · Pending sync with Codex');
    expect(note({ needsStart: true, signed: [1] })).toBe('Approval circuit in progress in Codex');
    expect(note({ entries: [approval(1)] })).toBe('Approved · Pending sync with Codex');
    expect(note({ entries: [approval(1), approval(2, { syncStatus: 'failed' })] })).toBe('Release approved · Sync with Codex failed');
    expect(note({ entries: [approval(1, { decision: 'rejected', syncStatus: 'sent' })] })).toBe('Rejected · Sent to Codex');
    expect(note({ status: 'released', entries: [approval(1)] })).toBeNull();
  });

  it('engineering deliverables: a discipline’s project record with recipients', () => {
    expect(isEngineeringDeliverable({ project: 'HLT-026', service: 'elec', recipients: ['auto'] })).toBe(true);
    expect(isEngineeringDeliverable({ project: 'HLT-026', service: 'elec', recipients: [] })).toBe(false);
    expect(isEngineeringDeliverable({ project: 'HLT-026', service: 'quality', recipients: ['client'] })).toBe(false);
    expect(isEngineeringDeliverable({ project: 'QMS', service: 'process', recipients: ['meca'] })).toBe(false);
  });

  it('a rejection needs its reason (≤ 1000 characters); toasts', () => {
    expect(parseRejectComment('  Wrong torque values  ')).toEqual({ ok: true, value: 'Wrong torque values' });
    for (const bad of ['', '   ', null, 42, {}]) expect(parseRejectComment(bad)).toEqual({ ok: false, error: 'Give the reason for the rejection' });
    expect(parseRejectComment('x'.repeat(1001))).toEqual({ ok: false, error: 'The reason is too long' });
    expect(codexDecisionToast('RPT-HLT-014', 'rejected', 'pending')).toBe('RPT-HLT-014 · Rejected · Pending sync with Codex');
    expect(circuitStartToast('SCH-ELE-026', 'sent')).toBe('SCH-ELE-026 · Approval circuit started · Sent to Codex');
  });
});
