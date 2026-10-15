// Delivery 8, lot cost-change — the pure rules: R-069 (steps a request needs, the current step of the sequential chain, the
// contractual impact inferred for older requests, who may decide now), R-015 (the bell notice of the chain), R-081 (category
// amounts frozen after BL1, the category budget posted at approval), R-077 (invoicing blocked above 100 % per schedule group),
// R-080 (Budget tile colours from the Settings thresholds), R-054 (« Planning BL1 posé » follows BL1).
import { describe, expect, it } from 'vitest';
import {
  BL1_STAGE_DELIVERABLE, bl1TickRefused, categoryAmountFrozen, hasBl1,
} from './baseline-policy';
import {
  DEFAULT_CCB_THRESHOLD_KEUR, awaitingStepsText, canDecideStep, crHint, crNoticeOf, currentStep, holdsStep, inferredContractImpact, isCcbThreshold, isStepOpen,
  requiredSteps, stepWaitsForEarlier, type ChainStepLike,
} from './change-control';
import { INVOICE_BLOCKED_MESSAGE, SHARE_TOLERANCE_PCT, invoiceBlocked, scheduleGroupHint, sharesOver } from './contract';
import { amendmentOutcome, isContractualChange, postedCategoryBudget } from './cost-control';
import { budgetKpiAlerts, tcpiAlertLimit } from './evm';
import { DEFAULT_HEALTH_THRESHOLDS, indexAlert } from './health';
import { indexAlert as portfolioIndexAlert } from './portfolio';
import { makeT } from '@/i18n/translate';

type D = ChainStepLike['decision'];
const chain = (pm: D, director: D, client: D, ccb: D, approvers: (string | null)[] = ['Romain Aubert', 'Marie Lefebvre', 'Nadia Bensaïd', 'Marie Lefebvre']): ChainStepLike[] =>
  (['pm', 'director', 'client', 'ccb'] as const).map((step, i) => ({ step, decision: [pm, director, client, ccb][i], approver: approvers[i] }));
const inReview = (c: ChainStepLike[]) => ({ status: 'in_review', chain: c });

describe('R-069 — the steps a request needs (P-6c)', () => {
  it('PM and director always; the client unless internal; the board strictly above the threshold (amount in absolute value)', () => {
    const at = (contractImpact: Parameters<typeof requiredSteps>[0]['contractImpact'], amountKeur: number, ccbThresholdKeur = 50) =>
      Object.values(requiredSteps({ contractImpact, amountKeur, ccbThresholdKeur })).join(' ');
    expect(at('price', 50)).toBe('pending pending pending na');
    expect(at('price', 50.01)).toBe('pending pending pending pending');
    expect(at('price', -51)).toBe('pending pending pending pending');
    expect(at('dates', 0)).toBe('pending pending pending na');
    expect(at('price_dates', 85)).toBe('pending pending pending pending');
    expect(at('none', 85)).toBe('pending pending na pending');
    expect(at('none', 10)).toBe('pending pending na na');
    expect(at(null, 10)).toBe('pending pending pending na');
    expect(at(undefined, 10)).toBe('pending pending pending na');
    expect(at('price', 1, 0)).toBe('pending pending pending pending');
    expect(at('price', 0, 0)).toBe('pending pending pending na');
    // An unusable threshold falls back to the default 50 k€.
    expect([at('price', 51, Number.NaN), at('price', 50, -3)]).toEqual(['pending pending pending pending', 'pending pending pending na']);
    expect(DEFAULT_CCB_THRESHOLD_KEUR).toBe(50);
  });

  it('a valid threshold: a finite number of k€, 0 to 1 000 000', () => {
    expect([0, 50, 12.5, 1_000_000].every(isCcbThreshold)).toBe(true);
    expect([-1, 1_000_001, Number.NaN, Number.POSITIVE_INFINITY, '50', null, undefined, {}].some(isCcbThreshold)).toBe(false);
  });

  it('contractual impact of a request raised before it was asked (seed, backfill)', () => {
    expect([
      inferredContractImpact({ clientStep: 'na', amountKeur: 15, scheduleDays: 0 }),
      inferredContractImpact({ clientStep: 'ok', amountKeur: 120, scheduleDays: 12 }),
      inferredContractImpact({ clientStep: 'ok', amountKeur: 65, scheduleDays: 0 }),
      inferredContractImpact({ clientStep: 'pending', amountKeur: 0, scheduleDays: 27 }),
      inferredContractImpact({ clientStep: null, amountKeur: 0, scheduleDays: 0 }),
    ]).toEqual(['none', 'price_dates', 'price', 'dates', null]);
  });
});

describe('R-069 — the sequential chain (P-6b)', () => {
  it('the current step: the first pending one after approved or not-required steps; none after a rejection or a gap', () => {
    expect(currentStep(chain('ok', 'pending', 'pending', 'pending'))).toBe('director');
    expect(currentStep(chain('ok', 'ok', 'na', 'pending'))).toBe('ccb');
    expect(currentStep(chain('pending', 'pending', 'pending', 'na'))).toBe('pm');
    expect(currentStep(chain('ok', 'rejected', 'pending', 'pending'))).toBeNull();
    expect(currentStep(chain('ok', 'ok', 'ok', 'na'))).toBeNull();
    expect(currentStep(chain(null, null, null, null))).toBeNull();
    expect(currentStep([])).toBeNull();
  });

  it('who decides now: the current step only, its holder (role, or the named approver when routed by person)', () => {
    const cr8 = inReview(chain('ok', 'pending', 'pending', 'pending'));
    expect([isStepOpen(cr8, 'director'), isStepOpen(cr8, 'client'), isStepOpen({ ...cr8, status: 'draft' }, 'director')]).toEqual([true, false, false]);
    expect([stepWaitsForEarlier(cr8, 'client'), stepWaitsForEarlier(cr8, 'ccb'), stepWaitsForEarlier(cr8, 'director'), stepWaitsForEarlier(cr8, 'pm')]).toEqual([true, true, false, false]);
    expect(canDecideStep(cr8, 'director', { role: 'director' })).toBe(true);
    expect(canDecideStep(cr8, 'director', { role: 'director', name: 'Marie Lefebvre' })).toBe(true);
    expect(canDecideStep(cr8, 'director', { role: 'director', name: 'Someone Else' })).toBe(false);
    expect(canDecideStep(cr8, 'client', { role: 'client' })).toBe(false);
    expect(holdsStep(cr8, 'client', { role: 'client', name: 'Nadia Bensaïd' })).toBe(true);
    // The board has no named approver: its recorder's role (the director, P-6a).
    const board = inReview(chain('ok', 'ok', 'ok', 'pending'));
    expect([canDecideStep(board, 'ccb', { role: 'director', name: 'Anyone' }), canDecideStep(board, 'ccb', { role: 'pm' })]).toEqual([true, false]);
  });

  it('hints and the Pending value sub-line', () => {
    const cr8 = { status: 'in_review' as const, chain: chain('ok', 'pending', 'pending', 'pending') };
    expect([crHint(cr8, 'client'), crHint(cr8, 'director'), crHint(cr8, 'pm')]).toEqual(['Waiting for Portfolio director', '', '']);
    const atClient = { status: 'in_review' as const, chain: chain('ok', 'ok', 'pending', 'pending') };
    expect(crHint(atClient, 'director')).toBe('Waiting for Client / sponsor');
    expect(awaitingStepsText([cr8, atClient, { status: 'draft', chain: chain('pending', 'pending', 'pending', 'pending') }])).toBe('Awaiting director · client');
    expect(awaitingStepsText([{ status: 'in_review', chain: chain('pending', 'pending', 'na', 'na') }, { status: 'in_review', chain: chain('ok', 'ok', 'ok', 'pending') }])).toBe('Awaiting PM · CCB');
    expect(awaitingStepsText([])).toBeNull();
    // FR: every combination has its own entry (the generic "Awaiting …" rule would leave the step names in English).
    const fr = makeT('fr');
    expect(['Awaiting director · client', 'Awaiting PM · CCB', 'Awaiting PM · director · client · CCB', 'Awaiting director'].map(fr)).toEqual([
      'En attente directeur · client', 'En attente CP · comité', 'En attente CP · directeur · client · comité', 'En attente directeur',
    ]);
  });
});

describe('R-015 (part) — the bell notice of the chain (X-6a)', () => {
  const people = { pm: 'p-pm', directors: ['p-dir', 'p-dir2'], clientContacts: ['p-cli'], requester: 'p-req' };
  const cr = (status: string, c: ChainStepLike[]) => ({ id: 'CR-011', status: status as 'in_review', chain: c });
  it('in review → the current step’s approvers; decided → the requester; never the actor; none when nobody is left', () => {
    expect(crNoticeOf(cr('in_review', chain('pending', 'pending', 'pending', 'na')), people, null)).toEqual({ title: 'Change request awaiting your decision · CR-011', toPersonIds: ['p-pm'] });
    expect(crNoticeOf(cr('in_review', chain('ok', 'pending', 'pending', 'na')), people, 'p-pm')).toEqual({ title: 'Change request awaiting your decision · CR-011', toPersonIds: ['p-dir', 'p-dir2'] });
    expect(crNoticeOf(cr('in_review', chain('ok', 'ok', 'pending', 'na')), people, 'p-dir')).toEqual({ title: 'Change request awaiting your decision · CR-011', toPersonIds: ['p-cli'] });
    expect(crNoticeOf(cr('in_review', chain('ok', 'ok', 'ok', 'pending')), people, 'p-cli')?.toPersonIds).toEqual(['p-dir', 'p-dir2']);
    // The director who just decided is not told about the board step they record next — the other director is.
    expect(crNoticeOf(cr('in_review', chain('ok', 'ok', 'na', 'pending')), people, 'p-dir')?.toPersonIds).toEqual(['p-dir2']);
    expect(crNoticeOf(cr('approved', chain('ok', 'ok', 'ok', 'ok')), people, 'p-dir')).toEqual({ title: 'Change request approved · CR-011', toPersonIds: ['p-req'] });
    expect(crNoticeOf(cr('rejected', chain('ok', 'rejected', 'pending', 'na')), people, 'p-dir')).toEqual({ title: 'Change request rejected · CR-011', toPersonIds: ['p-req'] });
    expect(crNoticeOf(cr('approved', chain('ok', 'ok', 'ok', 'na')), people, 'p-req')).toBeNull();
    expect(crNoticeOf(cr('in_review', chain('pending', 'pending', 'pending', 'na')), people, 'p-pm')).toBeNull();
    expect(crNoticeOf(cr('draft', chain('pending', 'pending', 'pending', 'na')), people, null)).toBeNull();
    expect(crNoticeOf(cr('in_review', chain('ok', 'ok', 'pending', 'na')), { ...people, clientContacts: [] }, null)).toBeNull();
    expect(crNoticeOf(cr('in_review', chain('ok', 'pending', 'pending', 'na')), { ...people, directors: ['p-dir', 'p-dir'] }, null)?.toPersonIds).toEqual(['p-dir']);
  });
});

describe('R-081 — category amounts frozen after BL1 (C-3a), posted at approval (A-4)', () => {
  it('frozen once the project has BL1 or a later baseline, in any state', () => {
    expect([categoryAmountFrozen([]), categoryAmountFrozen(['BL0']), categoryAmountFrozen(['BL0', 'BL1']), categoryAmountFrozen(['BL2'])]).toEqual([false, false, true, true]);
  });

  it('the category budget after the posting: two decimals, never below 0', () => {
    expect([postedCategoryBudget(100, 40), postedCategoryBudget(100, -40.555), postedCategoryBudget(30, -55), postedCategoryBudget(0, 0)]).toEqual([140, 59.45, 0, 0]);
  });

  it('a money amendment only when the contractual impact includes the price (a request without one keeps delivery 7’s rule)', () => {
    const base = { clientStep: 'ok' as const, amount: 85 };
    expect([null, 'price', 'price_dates', 'dates', 'none'].map((contractImpact) => isContractualChange({ ...base, contractImpact: contractImpact as never }))).toEqual([true, true, true, false, false]);
    expect(amendmentOutcome({ ...base, contractImpact: 'dates' }, { hasContract: true, amendmentExists: false })).toBe('not_contractual');
    expect(amendmentOutcome({ ...base, contractImpact: 'price' }, { hasContract: true, amendmentExists: false })).toBe('prepared');
  });
});

describe('R-077 — invoicing blocked while a schedule group exceeds 100 % (C-7)', () => {
  it('Σ shares above 100 % plus the 0.01 tolerance', () => {
    expect(SHARE_TOLERANCE_PCT).toBe(0.01);
    expect([sharesOver(100), sharesOver(100.01), sharesOver(100.02), sharesOver(140)]).toEqual([false, false, true, true]);
  });

  it('per group: the base contract (no amendment) and each amendment — position 0 is an amendment, not the base', () => {
    const ms = [
      { number: 'M1', sharePct: 60 }, { number: 'M2', sharePct: 45, amendment: null },
      { number: 'M6', sharePct: 100, amendment: 0 }, { number: 'M7', sharePct: 50, amendment: 1 }, { number: 'M8', sharePct: 60, amendment: 1 },
    ];
    expect(['M1', 'M2', 'M6', 'M7', 'M8', 'M99'].map((n) => invoiceBlocked(ms, n))).toEqual([true, true, false, true, true, false]);
    expect(invoiceBlocked([{ number: 'M1', sharePct: 60 }, { number: 'M2', sharePct: 40 }], 'M1')).toBe(false);
    // The DAL groups by amendment id.
    expect(invoiceBlocked([{ number: 'M1', sharePct: 100, amendment: null }, { number: 'M6', sharePct: 80, amendment: 'a-1' }, { number: 'M7', sharePct: 30, amendment: 'a-1' }], 'M6')).toBe(true);
    expect(INVOICE_BLOCKED_MESSAGE).toBe('Payment milestones exceed 100 % — invoicing is blocked until the schedule is corrected');
  });

  it('the group hint: blocked above 100 %, the prototype hint below, nothing at 100 %', () => {
    expect(scheduleGroupHint({ sharePct: 105, shareOk: false }, 'en')).toBe('Shares total 105 % · invoicing blocked');
    expect(scheduleGroupHint({ sharePct: 102.5, shareOk: false }, 'fr', makeT('fr'))).toBe('Total des parts 102,5 % · facturation bloquée');
    expect(scheduleGroupHint({ sharePct: 90, shareOk: false }, 'en')).toBe('Shares must total 100 %');
    expect(scheduleGroupHint({ sharePct: 100, shareOk: true }, 'fr')).toBe('');
  });
});

describe('R-080 — Budget tile colours from the Settings health thresholds (C-1)', () => {
  it('HLT-026 (CPI 0.89, SPI 0.82, VAC −565, TCPI 1.25): every alert; NDC-031-like figures: none', () => {
    expect(budgetKpiAlerts({ cpi: 0.89, spi: 0.82, vac: -565, tcpi: 1.25 })).toEqual({ cpi: true, eac: true, vac: true, tcpi: true, cv: true, sv: true });
    expect(budgetKpiAlerts({ cpi: 1.04, spi: 0.98, vac: 80, tcpi: 0.97 })).toEqual({ cpi: false, eac: false, vac: false, tcpi: false, cv: false, sv: false });
    // Over budget at a healthy CPI: EAC / VAC stay neutral (the overrun is not a cost-performance alert).
    expect(budgetKpiAlerts({ cpi: 0.98, spi: 1, vac: -10, tcpi: 1.01 })).toMatchObject({ cpi: false, eac: false, vac: false, tcpi: false });
  });

  it('custom thresholds move the colours; TCPI limit = 1 / "At risk below"', () => {
    expect(tcpiAlertLimit()).toBeCloseTo(1.0309, 4);
    expect(tcpiAlertLimit({ risk: 0.8, off: 0.7 })).toBeCloseTo(1.25, 6);
    const core = { cpi: 0.89, spi: 0.82, vac: -565, tcpi: 1.2 };
    expect(budgetKpiAlerts(core, { risk: 0.85, off: 0.8 })).toEqual({ cpi: false, eac: false, vac: false, tcpi: true, cv: false, sv: true });
    expect(budgetKpiAlerts(core, { risk: 0.8, off: 0.7 })).toEqual({ cpi: false, eac: false, vac: false, tcpi: false, cv: false, sv: false });
  });

  it('indexAlert moved to ./health, the same function re-exported by ./portfolio', () => {
    expect(portfolioIndexAlert).toBe(indexAlert);
    expect([indexAlert(0.96), indexAlert(0.97), indexAlert(0.96, { risk: 0.95, off: 0.9 })]).toEqual([true, false, false]);
    expect(DEFAULT_HEALTH_THRESHOLDS.risk).toBe(0.97);
  });
});

describe('R-054 — « Planning BL1 posé » follows BL1 (L-2 "a")', () => {
  it('BL1: a BLn ≥ 1 current or superseded (a proposed one does not count)', () => {
    expect(hasBl1([])).toBe(false);
    expect(hasBl1([{ code: 'BL0', state: 'current' }])).toBe(false);
    expect(hasBl1([{ code: 'BL0', state: 'superseded' }, { code: 'BL1', state: 'current' }])).toBe(true);
    expect(hasBl1([{ code: 'BL1', state: 'proposed' }])).toBe(false);
    expect(hasBl1([{ code: 'BL1', state: 'superseded' }, { code: 'BL2', state: 'current' }])).toBe(true);
  });

  it('a manual tick without BL1 and an untick with BL1 are refused — only on APD #1', () => {
    expect(BL1_STAGE_DELIVERABLE).toEqual({ stage: 'apd', position: 1 });
    const apd1 = (done: boolean) => ({ stage: 'apd', position: 1, done });
    expect([bl1TickRefused(apd1(true), false), bl1TickRefused(apd1(false), true), bl1TickRefused(apd1(true), true), bl1TickRefused(apd1(false), false)]).toEqual([true, true, false, false]);
    expect([bl1TickRefused({ stage: 'apd', position: 0, done: true }, false), bl1TickRefused({ stage: 'etudes', position: 1, done: true }, false)]).toEqual([false, false]);
  });
});
