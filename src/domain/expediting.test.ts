// R-159 (P1, D9-31) — value tests of the expediting rules.
import { describe, expect, it } from 'vitest';
import { DEMO_TODAY_ISO } from './clock';
import {
  activeRelease, deliveryWithoutRelease, expeditingState, inspectionLate, inspectionRef, isLongLead, lateInspectionTitle, lateInspectionsToTell, nextInspection,
  nextInspectionNumber, nextReleaseNumber, parseFabricationProgress, parseInspectionPlan, parseInspectionResult, parseReason, parseReleaseNote, releaseBlockerText,
  releaseBlockers, releaseRequired, type PoInspectionFacts,
} from './expediting';

const today = DEMO_TODAY_ISO; // 2026-09-25
const ins = (number: string, kind: PoInspectionFacts['kind'], result: PoInspectionFacts['result'], position: number, plannedOn: string | null = null): PoInspectionFacts =>
  ({ number, kind, result, position, plannedOn, resultOn: null });

describe('input', () => {
  it('plans an inspection, the name defaulting to the kind', () => {
    expect(parseInspectionPlan({ kind: 'fat', plannedOn: '2026-10-12', inspector: 'Bureau Veritas', itp: 'I-07' })).toEqual({
      ok: true, value: { kind: 'fat', name: 'Factory acceptance test (FAT)', location: null, plannedOn: '2026-10-12', inspector: 'Bureau Veritas', itp: 'I-07' },
    });
    // The ITP tie is for a FAT only.
    expect(parseInspectionPlan({ kind: 'material', itp: 'I-07' })).toMatchObject({ ok: true, value: { itp: null } });
    expect(parseInspectionPlan({ kind: 'x' })).toEqual({ ok: false, error: 'kind' });
    expect(parseInspectionPlan({ kind: 'fat', plannedOn: '2026-02-31' })).toEqual({ ok: false, error: 'date' });
    expect(parseInspectionPlan({ kind: 'fat', name: 'x'.repeat(121) })).toEqual({ ok: false, error: 'name' });
  });

  it('records a result: date not in the future, inspector required, NCR kept when failed only', () => {
    expect(parseInspectionResult({ result: 'failed', resultOn: '2026-09-24', inspector: 'G. Comte', ncr: 'EV-2026-130' }, today)).toEqual({
      ok: true, value: { result: 'failed', resultOn: '2026-09-24', inspector: 'G. Comte', comment: null, ncr: 'EV-2026-130' },
    });
    expect(parseInspectionResult({ result: 'passed', resultOn: '2026-09-24', inspector: 'G. Comte', ncr: 'EV-1' }, today)).toMatchObject({ ok: true, value: { ncr: null } });
    expect(parseInspectionResult({ result: 'planned', resultOn: '2026-09-24', inspector: 'x' }, today)).toEqual({ ok: false, error: 'result' });
    expect(parseInspectionResult({ result: 'passed', resultOn: '', inspector: 'x' }, today)).toEqual({ ok: false, error: 'resultDate' });
    expect(parseInspectionResult({ result: 'passed', resultOn: '2026-09-26', inspector: 'x' }, today)).toEqual({ ok: false, error: 'resultFuture' });
    expect(parseInspectionResult({ result: 'passed', resultOn: '2026-09-25', inspector: ' ' }, today)).toEqual({ ok: false, error: 'inspector' });
  });

  it('fabrication progress: whole % 0–100, reported today by default', () => {
    expect(parseFabricationProgress({ pct: '45' }, today)).toEqual({ ok: true, value: { pct: 45, reportedOn: today, note: null } });
    expect(parseFabricationProgress({ pct: '101' }, today)).toEqual({ ok: false, error: 'pct' });
    expect(parseFabricationProgress({ pct: '4.5' }, today)).toEqual({ ok: false, error: 'pct' });
    expect(parseFabricationProgress({ pct: '40', reportedOn: '2026-09-30' }, today)).toEqual({ ok: false, error: 'resultFuture' });
  });

  it('release note and reason', () => {
    expect(parseReleaseNote({})).toEqual({ ok: true, value: { scope: 'Whole order', reserves: null, inspector: null } });
    expect(parseReleaseNote({ scope: 'Frames 1–4', reserves: 'Touch-up paint on site' })).toMatchObject({ ok: true, value: { scope: 'Frames 1–4', reserves: 'Touch-up paint on site' } });
    expect(parseReason('  ')).toEqual({ ok: false, error: 'reason' });
    expect(parseReason('Wrong order')).toEqual({ ok: true, value: 'Wrong order' });
  });
});

describe('numbers and references', () => {
  it('numbers inspections and release notes', () => {
    expect(nextInspectionNumber([])).toBe('I-1');
    expect(nextInspectionNumber(['I-1', 'I-3', 'X'])).toBe('I-4');
    expect(nextReleaseNumber('PO-1078', 0)).toBe('PO-1078-RN1');
    expect(nextReleaseNumber('PO-1078', 2)).toBe('PO-1078-RN3');
    expect(inspectionRef('PO-1078', 'I-2')).toBe('PO-1078/I-2');
  });
});

describe('rules', () => {
  it('late: planned and past its date', () => {
    expect(inspectionLate({ plannedOn: '2026-09-24', result: 'planned' }, today)).toBe(true);
    expect(inspectionLate({ plannedOn: '2026-09-25', result: 'planned' }, today)).toBe(false);
    expect(inspectionLate({ plannedOn: '2026-09-20', result: 'passed' }, today)).toBe(false);
    expect(inspectionLate({ plannedOn: null, result: 'planned' }, today)).toBe(false);
  });

  it('long lead: 84 days or more between order and expected delivery', () => {
    expect(isLongLead({ orderedOn: '2026-06-01', expectedOn: '2026-08-24' })).toBe(true); // 84 d
    expect(isLongLead({ orderedOn: '2026-06-01', expectedOn: '2026-08-23' })).toBe(false); // 83 d
    expect(isLongLead({ orderedOn: null, expectedOn: '2026-12-01' })).toBe(false);
  });

  it('release blockers: a failed inspection without a passing re-inspection, a FAT not passed', () => {
    expect(releaseBlockers([])).toEqual([]);
    expect(releaseBlockers([ins('I-1', 'material', 'passed', 0)])).toEqual([]);
    expect(releaseBlockers([ins('I-1', 'material', 'failed', 0)])).toEqual([{ kind: 'failed', numbers: ['I-1'] }]);
    // A passing re-inspection of the same kind clears the failure; one of another kind does not.
    expect(releaseBlockers([ins('I-1', 'material', 'failed', 0), ins('I-2', 'material', 'passed_reserve', 1)])).toEqual([]);
    expect(releaseBlockers([ins('I-1', 'material', 'failed', 0), ins('I-2', 'in_process', 'passed', 1)])).toEqual([{ kind: 'failed', numbers: ['I-1'] }]);
    expect(releaseBlockers([ins('I-1', 'fat', 'planned', 0)])).toEqual([{ kind: 'fat' }]);
    expect(releaseBlockers([ins('I-1', 'fat', 'failed', 0)])).toEqual([{ kind: 'failed', numbers: ['I-1'] }, { kind: 'fat' }]);
    expect(releaseBlockerText({ kind: 'failed', numbers: ['I-1', 'I-3'] })).toBe('Failed inspection without a passing re-inspection: I-1, I-3');
  });

  it('release required once an inspection is planned; the note in force is the last not withdrawn', () => {
    expect(releaseRequired([])).toBe(false);
    expect(releaseRequired([ins('I-1', 'fat', 'planned', 0)])).toBe(true);
    const notes = [{ number: 'RN1', issuedOn: '2026-09-01', withdrawn: false }, { number: 'RN2', issuedOn: '2026-09-10', withdrawn: true }];
    expect(activeRelease(notes)?.number).toBe('RN1');
    expect(activeRelease([{ number: 'RN1', issuedOn: '2026-09-01', withdrawn: true }])).toBeNull();
  });

  it('flags a delivery without a release note issued on or before its date (flag, not a block)', () => {
    const note = { number: 'RN1', issuedOn: '2026-09-10', withdrawn: false };
    expect(deliveryWithoutRelease({ required: false, notes: [] }, { receivedOn: null, expectedOn: '2026-09-30' }, today)).toBe(false);
    expect(deliveryWithoutRelease({ required: true, notes: [] }, { receivedOn: null, expectedOn: '2026-09-30' }, today)).toBe(true);
    expect(deliveryWithoutRelease({ required: true, notes: [note] }, { receivedOn: null, expectedOn: '2026-09-30' }, today)).toBe(false);
    // Received before the note was issued: shipped without release.
    expect(deliveryWithoutRelease({ required: true, notes: [note] }, { receivedOn: '2026-09-05', expectedOn: '2026-09-30' }, today)).toBe(true);
    expect(deliveryWithoutRelease({ required: true, notes: [{ ...note, withdrawn: true }] }, { receivedOn: null, expectedOn: null }, today)).toBe(true);
  });

  it('state and next inspection', () => {
    expect(expeditingState([], [], today)).toBe('none');
    expect(expeditingState([ins('I-1', 'fat', 'planned', 0, '2026-10-01')], [], today)).toBe('in_progress');
    expect(expeditingState([ins('I-1', 'fat', 'planned', 0, '2026-09-20')], [], today)).toBe('late');
    expect(expeditingState([ins('I-1', 'fat', 'failed', 0, '2026-09-20')], [], today)).toBe('blocked');
    expect(expeditingState([ins('I-1', 'fat', 'passed', 0)], [{ number: 'RN1', issuedOn: today, withdrawn: false }], today)).toBe('released');
    const list = [ins('I-1', 'material', 'passed', 0, '2026-08-01'), ins('I-2', 'fat', 'planned', 1, '2026-10-20'), ins('I-3', 'in_process', 'planned', 2, '2026-10-05')];
    expect(nextInspection(list)?.number).toBe('I-3');
    expect(nextInspection([ins('I-1', 'other', 'planned', 0)])?.number).toBe('I-1');
  });

  it('late inspections told for long-lead open orders only', () => {
    const po = { number: 'PO-1078', status: 'ordered', orderedOn: '2026-05-01', expectedOn: '2026-11-30' };
    const list = [ins('I-1', 'material', 'planned', 0, '2026-09-20'), ins('I-2', 'fat', 'planned', 1, '2026-10-20')];
    expect(lateInspectionsToTell(po, list, today)).toEqual([{ ref: 'PO-1078/I-1', number: 'I-1', plannedOn: '2026-09-20', daysLate: 5 }]);
    expect(lateInspectionsToTell({ ...po, status: 'cancelled' }, list, today)).toEqual([]);
    expect(lateInspectionsToTell({ ...po, orderedOn: '2026-10-01' }, list, today)).toEqual([]);
    expect(lateInspectionTitle('PO-1078/I-1', 5)).toBe('Supplier inspection late · PO-1078/I-1 · +5 d');
  });
});
