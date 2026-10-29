// R-051 (P-7d): pure rules of approval delegations — state on the business date, refusals of a new delegation, who cancels,
// and the identity of an inline decision.
import { describe, expect, it } from 'vitest';
import { DEMO_TODAY_ISO } from './clock';
import { DELEGATION_MAX_DAYS, canCancelDelegation, decisionKey, delegationError, delegationState, isDelegationActive, isInternalUser, periodsOverlap } from './delegations';

const today = DEMO_TODAY_ISO; // Fri 25 Sep 2026
const pm = { userId: 'u-pm', active: true, roles: ['pm'] as const, external: false };
const englead = { userId: 'u-eng', active: true, roles: ['englead'] as const, external: false };
const client = { userId: 'u-cl', active: true, roles: ['client'] as const, external: true };
const base = { today, approver: pm, substitute: englead, existing: [] };

describe('R-051 — delegation rules', () => {
  it('state on the business date: both ends included, cancelled first', () => {
    const d = { startsOn: '2026-09-25', endsOn: '2026-10-02', cancelledAt: null };
    expect([delegationState(d, '2026-09-24'), delegationState(d, today), delegationState(d, '2026-10-02'), delegationState(d, '2026-10-03')]).toEqual(['upcoming', 'active', 'active', 'ended']);
    expect(delegationState({ ...d, cancelledAt: '2026-09-25T08:00:00.000Z' }, today)).toBe('cancelled');
    expect(isDelegationActive(d, today)).toBe(true);
    expect([periodsOverlap(d, { startsOn: '2026-10-02', endsOn: '2026-10-09' }), periodsOverlap(d, { startsOn: '2026-10-03', endsOn: '2026-10-09' })]).toEqual([true, false]);
  });

  it('internal users only: never a client or an external user', () => {
    expect([isInternalUser(pm), isInternalUser(client), isInternalUser({ roles: ['pm'], external: true }), isInternalUser({ roles: ['client', 'pm'], external: false })]).toEqual([true, false, false, true]);
  });

  it('a valid delegation, starting today or later', () => {
    expect(delegationError({ startsOn: today, endsOn: '2026-10-02' }, base)).toBeNull();
    expect(delegationError({ startsOn: '2026-10-05', endsOn: '2026-10-09' }, base)).toBeNull();
    // Started before today but still running: accepted (the past part routes nothing).
    expect(delegationError({ startsOn: '2026-09-20', endsOn: '2026-09-28' }, base)).toBeNull();
  });

  it('refusals', () => {
    const err = (input: { startsOn: unknown; endsOn: unknown }, ctx: Partial<Parameters<typeof delegationError>[1]> = {}) => delegationError(input, { ...base, ...ctx });
    expect(err({ startsOn: '2026-02-30', endsOn: '2026-10-02' })).toBe('dates');
    expect(err({ startsOn: 'tomorrow', endsOn: '2026-10-02' })).toBe('dates');
    expect(err({ startsOn: 20260925, endsOn: '2026-10-02' })).toBe('dates');
    expect(err({ startsOn: '2026-10-02', endsOn: '2026-10-01' })).toBe('order');
    expect(err({ startsOn: '2026-09-01', endsOn: '2026-09-24' })).toBe('past');
    expect(err({ startsOn: today, endsOn: '2027-09-26' })).toBe('long');
    expect(DELEGATION_MAX_DAYS).toBe(366);
    expect(err({ startsOn: today, endsOn: '2026-10-02' }, { substitute: pm })).toBe('self');
    expect(err({ startsOn: today, endsOn: '2026-10-02' }, { substitute: client })).toBe('external');
    expect(err({ startsOn: today, endsOn: '2026-10-02' }, { substitute: null })).toBe('external');
    expect(err({ startsOn: today, endsOn: '2026-10-02' }, { substitute: { ...englead, active: false } })).toBe('inactive');
    expect(err({ startsOn: today, endsOn: '2026-10-02' }, { approver: client, substitute: pm })).toBe('approver');
  });

  it('overlapping delegations of the same approver are refused; cancelled and ended ones do not count', () => {
    const existing = [{ startsOn: '2026-09-28', endsOn: '2026-10-09', cancelledAt: null }];
    expect(delegationError({ startsOn: '2026-10-05', endsOn: '2026-10-20' }, { ...base, existing })).toBe('overlap');
    expect(delegationError({ startsOn: '2026-10-10', endsOn: '2026-10-20' }, { ...base, existing })).toBeNull();
    expect(delegationError({ startsOn: '2026-10-05', endsOn: '2026-10-20' }, { ...base, existing: [{ ...existing[0], cancelledAt: '2026-09-25T08:00:00.000Z' }] })).toBeNull();
    // An old ended delegation cannot overlap a period that ends today or later, by construction.
    expect(delegationError({ startsOn: today, endsOn: '2026-10-20' }, { ...base, existing: [{ startsOn: '2026-08-01', endsOn: '2026-08-31', cancelledAt: null }] })).toBeNull();
  });

  it('the approver cancels their own running or upcoming delegation; the director any; nobody a finished one', () => {
    const d = { approverUserId: 'u-pm', startsOn: today, endsOn: '2026-10-02', cancelledAt: null };
    expect(canCancelDelegation(d, { userId: 'u-pm', role: 'pm' }, today)).toBe(true);
    expect(canCancelDelegation(d, { userId: 'u-eng', role: 'englead' }, today)).toBe(false);
    expect(canCancelDelegation(d, { userId: 'u-dir', role: 'director' }, today)).toBe(true);
    expect(canCancelDelegation(d, { userId: null, role: 'pm' }, today)).toBe(false);
    expect(canCancelDelegation(d, { userId: 'u-pm', role: 'pm' }, '2026-10-03')).toBe(false);
    expect(canCancelDelegation({ ...d, cancelledAt: '2026-09-25T08:00:00.000Z' }, { userId: 'u-dir', role: 'director' }, today)).toBe(false);
  });

  it('decision identity: field order and the display-only stage label do not matter', () => {
    expect(decisionKey({ mode: 'purchase-order', projectCode: 'HLT-026', number: 'PO-1082' })).toBe(decisionKey({ number: 'PO-1082', mode: 'purchase-order', projectCode: 'HLT-026' }));
    expect(decisionKey({ mode: 'stage', projectCode: 'NDC-031', transitionId: 'x', fromLabel: 'A' })).toBe(decisionKey({ mode: 'stage', projectCode: 'NDC-031', transitionId: 'x', fromLabel: null }));
    expect(decisionKey({ mode: 'purchase-order', projectCode: 'HLT-026', number: 'PO-1082' })).not.toBe(decisionKey({ mode: 'purchase-order', projectCode: 'HLT-026', number: 'PO-1083' }));
    expect([decisionKey(null), decisionKey('x')]).toEqual(['', '']);
  });
});
