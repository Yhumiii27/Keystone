import { describe, expect, it } from 'vitest';
import { PROTO } from '@/server/prototype';
import {
  ACTUALS_SOURCE, LEGACY_STATUS, STAGES, budgetChangeStatus, calendar, clientCode3, constraintText, costType, displayOfIso,
  fmtDOfIso, isDisplayDate, isoOfDemoDate, isoOfDisplayDate, machineType, shortDateYearOfIso, milestoneStatus, nextStageOf, parseConstraint, splitActual, stage, stepDecision,
} from './codes';

describe('lifecycle codes', () => {
  it('maps the 13 STATUSES both ways, in order', () => {
    expect(STAGES.map((s) => s.label)).toEqual(PROTO.STATUSES);
    expect(stage.code('Fabrication & Assemblage')).toBe('fabrication_assemblage');
    expect(stage.code('Mise Service & SAT')).toBe('mise_en_service_sat');
    expect(stage.label('annule')).toBe('Annulé');
    expect(() => stage.code('Active')).toThrow();
  });
  it('follows STAGE_ORDER for the next stage', () => {
    const order = PROTO.STAGE_ORDER as string[];
    for (let i = 0; i < order.length; i++) expect(nextStageOf(stage.code(order[i]))).toBe(i < order.length - 1 ? stage.code(order[i + 1]) : null);
    expect(nextStageOf('annule')).toBeNull();
  });
  it('maps legacy statuses like STATUS_MAP_OLD', () => {
    for (const [old, label] of Object.entries(PROTO.STATUS_MAP_OLD as Record<string, string>)) expect(LEGACY_STATUS[old]).toBe(stage.code(label));
  });
  it('keeps the slider short labels (ST_SHORT)', () => {
    expect(STAGES.map((s) => s.short).join(',')).toBe('Init.,APS,APD,Études,Appro.,Fab.,FAT,Expéd.,Chantier,MES/SAT,Garantie,Clos,Annulé');
    expect(STAGES.filter((s) => s.group === 'pipeline').map((s) => s.label)).toEqual(PROTO.PIPE_STAGES);
    expect(STAGES.filter((s) => s.group === 'execution').map((s) => s.label)).toEqual(PROTO.EXEC_STAGES);
  });
});

describe('enum codecs', () => {
  it('cost types and actuals sources (SRC_OF)', () => {
    for (const [label, src] of Object.entries(PROTO.SRC_OF as Record<string, string>)) expect(ACTUALS_SOURCE[costType.code(label)]).toBe(src);
    expect(costType.label('subcontract')).toBe('Subcontract');
  });
  it('machine types store R&D as rnd', () => {
    expect(machineType.code('R&D')).toBe('rnd');
    expect(machineType.label('rnd')).toBe('R&D');
    expect((PROTO.MACHINE_TYPES as string[]).map((m) => machineType.label(machineType.code(m)))).toEqual(PROTO.MACHINE_TYPES);
  });
  it('calendars accept the screen alias "Site 6d · 10h"', () => {
    expect(calendar.code('Chantier 6d · 10h')).toBe('site_6x10');
    expect(calendar.code('Site 6d · 10h')).toBe('site_6x10');
    expect(calendar.label('standard_5x8_workshop')).toBe('Standard 5d · 8h + Atelier');
  });
  it('statuses', () => {
    expect(milestoneStatus.code('At risk')).toBe('at_risk');
    expect(budgetChangeStatus.label('pending')).toBe('Pending');
    expect(stepDecision.code('n/a')).toBe('na');
  });
});

describe('dates', () => {
  it('parses prototype display dates', () => {
    expect(isoOfDisplayDate('05 Jan', 2026)).toBe('2026-01-05');
    expect(isoOfDisplayDate('3 Apr A', 2026)).toBe('2026-04-03');
    expect(isoOfDisplayDate('14 Jan ’27', 2026)).toBe('2027-01-14');
    expect(isoOfDisplayDate('12 Mar 2026', 2026)).toBe('2026-03-12');
    expect(isoOfDisplayDate('Pending CR-009', 2026)).toBeNull();
    expect(isoOfDisplayDate('', 2026)).toBeNull();
    // R-013: a year-less display date is in the given (business) year; the seeds read the data set's year.
    expect([isoOfDisplayDate('14 Jan', 2027), isoOfDisplayDate('12 Mar 2026', 2027), isoOfDemoDate('05 Jan')]).toEqual(['2027-01-14', '2026-03-12', '2026-01-05']);
  });
  it('shows the year of a date outside the business year (R-013)', () => {
    // On the demo date (2026) nothing changes; with a business date in 2027 the 2026 dates carry their year.
    expect([shortDateYearOfIso('2026-03-12', 2026), shortDateYearOfIso('2027-01-14', 2026)]).toEqual(['12 Mar', '14 Jan 2027']);
    expect([shortDateYearOfIso('2026-03-12', 2027), shortDateYearOfIso('2027-01-14', 2027)]).toEqual(['12 Mar 2026', '14 Jan']);
    expect([fmtDOfIso('2026-03-12', 2026), fmtDOfIso('2027-02-13', 2026)]).toEqual(['12 Mar', '13 Feb ’27']);
    expect([fmtDOfIso('2026-03-12', 2027), fmtDOfIso('2027-02-13', 2027), fmtDOfIso('2028-02-13', 2027)]).toEqual(['12 Mar ’26', '13 Feb', '13 Feb ’28']);
    expect([isDisplayDate('2 Oct'), isDisplayDate('5 Jan 2027'), isDisplayDate('next week')]).toEqual([true, true, false]);
  });
  it('formats ISO dates like fmtDY', () => {
    expect(displayOfIso('2026-02-09')).toBe('9 Feb 2026');
    expect(displayOfIso('2027-01-14')).toBe('14 Jan 2027');
  });
  it('splits the actual suffix', () => {
    expect(splitActual('17 Aug A')).toEqual({ text: '17 Aug', actual: true });
    expect(splitActual('09 Oct')).toEqual({ text: '09 Oct', actual: false });
    expect(splitActual('05 Jan ’27')).toEqual({ text: '05 Jan ’27', actual: false });
  });
  it('round-trips constraints', () => {
    expect(parseConstraint('FNLT 18 Dec')).toEqual({ type: 'FNLT', date: '18 Dec' });
    expect(parseConstraint('')).toBeNull();
    expect(constraintText('SNET', '12 Oct')).toBe('SNET 12 Oct');
    expect(constraintText(null, null)).toBe('');
  });
});

describe('clientCode3', () => {
  it('uses the registered code, else the first 3 letters padded with X', () => {
    expect(clientCode3('Port authority', 'HAV')).toBe('HAV');
    expect(clientCode3('Logistics business unit')).toBe('LOG');
    expect(clientCode3('A1')).toBe('AXX');
    expect(clientCode3('')).toBe('XXX');
  });
});
