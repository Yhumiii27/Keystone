// Delivery 7 — lot debt-ux, pure rules: R-169 (form default dates from the data date, delivery terms of new orders, the
// "Award rule" tile, the where-used default part, the RFQ reply date) and R-148 (typed text shown as typed).
import { describe, expect, it } from 'vitest';
import { dataText, makeDataT, projectLabelText } from '@/i18n/data-text';
import { makeT } from '@/i18n/translate';
import { defaultWhereUsedRef, resolvePartQuery } from './bom';
import { formDateText, newActivityDates, newMeetingDateIso, nextMondayIso, nextWeekLabels } from './form-dates';
import { TERMS_TO_AGREE, deliveryTermsText, orderDeliveryTerms } from './order-terms';
import { awardRuleTile, newRfqDefaultDueIso, parseNewRfq } from './procurement';

describe('R-169 — form default dates follow the data date', () => {
  it('reproduce the prototype on the seed (data date Fri 25 Sep 2026)', () => {
    expect(newActivityDates('2026-09-25')).toEqual({ start: '2026-10-05', finish: '2026-10-30' });
    expect([formDateText('2026-10-05'), formDateText('2026-10-30')]).toEqual(['5 Oct 2026', '30 Oct 2026']);
    expect(formDateText(newMeetingDateIso('2026-09-25'))).toBe('6 Oct 2026');
    expect(nextWeekLabels('2026-09-25')).toEqual(['28 Sep', '5 Oct']);
    expect(newRfqDefaultDueIso('2026-09-25')).toBe('2026-10-15');
  });

  it('move with the data date (never a date in the past)', () => {
    expect([nextMondayIso('2026-09-28'), nextMondayIso('2026-09-27'), nextMondayIso('2026-10-03')]).toEqual(['2026-10-05', '2026-09-28', '2026-10-05']);
    expect(newActivityDates('2027-03-10')).toEqual({ start: '2027-03-22', finish: '2027-04-16' });
    expect(newMeetingDateIso('2027-03-10')).toBe('2027-03-23');
    expect(newRfqDefaultDueIso('2027-03-10')).toBe('2027-03-30');
    // An empty reply date takes the default of the status date passed in, so it is never "before the status date".
    expect(parseNewRfq({ title: 'T', suppliers: 'A', articles: 'X' }, '2027-03-10')).toMatchObject({ ok: true, value: { replyDueOn: '2027-03-30' } });
  });
});

describe('R-169 — delivery terms of a new purchase order', () => {
  it('RFQ incoterm and quote payment terms, else nothing ("To be agreed")', () => {
    expect(orderDeliveryTerms({ incoterm: 'DAP', paymentTerms: 'Net 45' })).toBe('DAP site · Net 45');
    expect(orderDeliveryTerms({ incoterm: null, paymentTerms: ' Net 30 ' })).toBe('Net 30');
    expect(orderDeliveryTerms({ incoterm: 'FCA' })).toBe('FCA');
    expect(orderDeliveryTerms()).toBe('');
    const fr = makeT('fr');
    expect([deliveryTermsText('', 'en', makeT('en')), deliveryTermsText(' ', 'fr', fr)]).toEqual([TERMS_TO_AGREE, 'À convenir']);
    expect(deliveryTermsText('Lun–Sam livraison quai 4', 'fr', fr)).toBe('Lun–Sam livraison quai 4');
  });
});

describe('R-169 — "Award rule" tile from the RFQs still to award', () => {
  it('counts the RFQs the project manager decides among those not awarded', () => {
    expect(awardRuleTile([
      { status: 'comparing', awardRule: 'lowest_tco' }, { status: 'open', awardRule: 'technical_first' }, { status: 'awarded', awardRule: 'pm_decides' }, { status: 'draft', awardRule: 'pm_decides' },
    ])).toEqual({ value: '1 / 3', sub: 'RFQs to award decided by the project manager' });
    expect(awardRuleTile([{ status: 'awarded', awardRule: 'pm_decides' }])).toEqual({ value: '—', sub: 'No RFQ to award' });
  });
});

describe('R-169 — where-used default part', () => {
  const parts = [
    { ref: 'A', name: 'a', usage: [{ projectCode: 'P1' }] },
    { ref: 'B', name: 'b', usage: [{ projectCode: 'P1' }, { projectCode: 'P2' }] },
    { ref: 'C', name: 'c', usage: [{ projectCode: 'P2' }, { projectCode: 'P3' }, { projectCode: 'P4' }] },
    { ref: 'D', name: 'd', usage: [] },
  ];
  it('the project part used by the most projects, else the catalogue\'s, else none', () => {
    expect(defaultWhereUsedRef(parts, 'P1')).toBe('B');
    expect(defaultWhereUsedRef(parts, 'P9')).toBe('C');
    expect(defaultWhereUsedRef(parts, null)).toBe('C');
    expect(defaultWhereUsedRef([{ ref: 'D', usage: [] }], 'P1')).toBeNull();
    expect(resolvePartQuery(parts, 'zzz', defaultWhereUsedRef(parts, 'P1'))!.ref).toBe('B');
    expect(resolvePartQuery(parts, '', null)!.ref).toBe('A');
  });
});

describe('R-148 — typed text shown as typed (NEW-D1-2, X-12b)', () => {
  it('never applies the day / month / segment rules; only an exact dictionary entry of the demo data', () => {
    const t = makeT('fr');
    expect(t('Sun Valley Farm')).toBe('dim. Valley Farm'); // what the prototype translator does
    expect(dataText('Sun Valley Farm', 'fr')).toBe('Sun Valley Farm');
    expect(dataText('Mon équipe · Oct', 'fr')).toBe('Mon équipe · Oct');
    expect(dataText('Harbor Line Terminal Expansion', 'fr')).toBe('Extension du terminal Harbor Line');
    expect(dataText('Harbor Line Terminal Expansion', 'en')).toBe('Harbor Line Terminal Expansion');
    expect([dataText('', 'fr'), dataText(null, 'fr'), dataText(undefined, 'fr')]).toEqual(['', null, undefined]);
    expect(makeDataT('fr')('Port authority')).toBe('Autorité portuaire');
    expect(projectLabelText({ displayId: '#026', name: 'Harbor Line Terminal Expansion' }, 'fr')).toBe('#026 · Extension du terminal Harbor Line');
    expect(projectLabelText({ displayId: 'SUN-053', name: 'Sun Valley Farm' }, 'fr')).toBe('SUN-053 · Sun Valley Farm');
  });
});
