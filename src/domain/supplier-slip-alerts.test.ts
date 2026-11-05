// S-27 — supplier schedule slip alerts: levels, slots and recipients.
import { describe, expect, it } from 'vitest';
import { makeT } from '@/i18n/translate';
import * as m from './supplier-slip-alerts';
import { SUPPLIER_SLIP_ALERT_DAYS, parseSupplierSlipDays, supplierSlipLevel, usableSupplierSlipDays, supplierSlipRecipients, supplierSlipSlots, supplierSlipTitle } from './supplier-slip-alerts';

describe('supplier slip alerts (S-27)', () => {
  it('one level per 5 working days of slip, none under the threshold', () => {
    expect(SUPPLIER_SLIP_ALERT_DAYS).toBe(5);
    expect([0, 4, 5, 9, 10, 14, 15, 31, -3].map((d) => supplierSlipLevel(d))).toEqual([0, 0, 1, 1, 2, 2, 3, 6, 0]);
    expect(supplierSlipSlots(0)).toEqual([]);
    expect(supplierSlipSlots(3)).toEqual(['level:1', 'level:2', 'level:3']);
  });
  it('the buyer (first active of the chain), else procurement, and the leads', () => {
    const active = new Set(['buyer', 'author', 'proc1', 'proc2', 'pm', 'deputy']);
    expect(supplierSlipRecipients({ buyerChain: [null, 'gone', 'author'], procurement: ['proc1'], leads: ['pm', 'deputy'] }, active)).toEqual(['author', 'pm', 'deputy']);
    expect(supplierSlipRecipients({ buyerChain: [null, null, null], procurement: ['proc1', 'proc2', 'away'], leads: ['pm', 'proc1'] }, active)).toEqual(['proc1', 'proc2', 'pm']);
  });
  it('the title names the order and the slip, in French in the bell', () => {
    expect(supplierSlipTitle('PO-1078', 7)).toBe('Supplier schedule slipping · PO-1078 · +7 working days');
    expect(makeT('fr')(supplierSlipTitle('PO-1078', 7))).toBe('Planning fournisseur en glissement · PO-1078 · +7 jours ouvrés');
  });
  it('S-31: a step other than 5 (the Settings threshold)', () => {
    expect([2, 3, 5, 6, 9].map((d) => supplierSlipLevel(d, 3))).toEqual([0, 1, 1, 2, 3]);
  });
  it('S-31: the threshold typed in Settings — whole working days 1–60; a missing or invalid row gives 5', () => {
    expect(['5', ' 8 ', 60, 1].map(parseSupplierSlipDays)).toEqual([5, 8, 60, 1]);
    expect(['0', '61', '2.5', '2,5', 'ten', '', null, undefined, 4.5].map(parseSupplierSlipDays)).toEqual(Array(9).fill(null));
    expect(usableSupplierSlipDays({ days: 9 })).toBe(9);
    expect([null, {}, { days: 0 }, { days: '7' }, 'x'].map(usableSupplierSlipDays)).toEqual([5, 5, 5, 5, 5]);
  });
});

describe('S-34: escalation to the directors', () => {
  it('defaults, parsing, stored values', () => {
    expect(m.SUPPLIER_SLIP_ESCALATION_STANDARD).toEqual({ days: 10, impactDays: 5 });
    expect(m.parseSupplierSlipEscalation('days', ' 15 ')).toBe(15);
    expect(m.parseSupplierSlipEscalation('days', 120)).toBe(120);
    expect(m.parseSupplierSlipEscalation('days', 121)).toBeNull();
    expect(m.parseSupplierSlipEscalation('impactDays', '61')).toBeNull();
    expect(m.parseSupplierSlipEscalation('impactDays', '0')).toBeNull();
    expect(m.parseSupplierSlipEscalation('impactDays', '2.5')).toBeNull();
    expect(m.parseSupplierSlipEscalation('impactDays', 'ten')).toBeNull();
    expect(m.isSupplierSlipEscalationKey('days')).toBe(true);
    expect(m.isSupplierSlipEscalationKey('other')).toBe(false);
    expect(m.usableSupplierSlipEscalation(null)).toEqual({ days: 10, impactDays: 5 });
    expect(m.usableSupplierSlipEscalation({ days: 20, impactDays: 0 })).toEqual({ days: 20, impactDays: 5 });
    expect(m.usableSupplierSlipEscalation({ days: '20', impactDays: 3 })).toEqual({ days: 10, impactDays: 3 });
  });
  it('both conditions: lasted long enough AND pushing the project finish enough', () => {
    const esc = m.shouldEscalateSupplierSlip;
    const th = { days: 10, impactDays: 5 };
    expect(esc({ lastedDays: 10, finishImpactDays: 5 }, th)).toBe(true);
    expect(esc({ lastedDays: 9, finishImpactDays: 30 }, th)).toBe(false);
    expect(esc({ lastedDays: 40, finishImpactDays: 4 }, th)).toBe(false);
    expect(esc({ lastedDays: 40, finishImpactDays: null }, th)).toBe(false);
  });
  it('title, EN and FR', () => {
    const title = m.supplierSlipEscalationTitle('PO-1078', 12, 6);
    expect(title).toBe('Supplier slip escalated to the directors · PO-1078 · +12 working days · project finish +6 working days');
    expect(makeT('fr')(title)).toBe('Glissement fournisseur remonté à la direction · PO-1078 · +12 jours ouvrés · fin du projet +6 jours ouvrés');
  });
});
