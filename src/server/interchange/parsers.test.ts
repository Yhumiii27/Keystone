// Interchange parsers on the synthetic fixtures of tests/fixtures/ch4 (no database): MS Project XML (MSPDI) and Primavera P6
// XER readers, the MSPDI writer (write → read gives the same schedule), the CSV / header / mapping / number helpers of the
// table imports and the message translation.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { makeT } from '@/i18n/translate';
import { fmt, translateMessage, MESSAGES } from './messages';
import { hoursOfDuration, parseMspdi, writeMspdi } from './mspdi';
import { isoOfSerial, monthIndex, planDateText, serialOfIso } from './model';
import { CARD_KINDS, canImport, importKindsOf } from './rights';
import { autoMapping, columnNames, decodeText, detectHeaderRow, detectSeparator, mapRows, normaliseRow, parseCostType, parseCsv, parseNumberCell, parsePartType, parseUnit, parseWearSpare } from './table';
import { parseClndrData, parseXer } from './xer';
import EXTRA from '@/i18n/extra/ch4-interchange.json';

const fixture = (name: string) => fs.readFileSync(path.join(process.cwd(), 'tests/fixtures/ch4', name));

describe('MSPDI reader', () => {
  const s = parseMspdi(fixture('sample.mspdi.xml').toString('utf8'));

  it('reads the project, the WBS (nested summaries kept with their parent) and the activities', () => {
    expect(s).toMatchObject({ format: 'mspdi', name: 'Sample plant upgrade', company: 'Port authority', start: '2026-01-05', finish: '2026-03-16', statusDate: '2026-02-02', calendarUid: '1', hoursPerDay: 8 });
    expect(s.wbs.map((w) => [w.uid, w.code, w.name, w.parentUid])).toEqual([['1', '1', 'Design', null], ['3', '1.2', 'Detailed design', '1'], ['6', '2', 'Site works', null]]);
    expect(s.activities.map((a) => [a.uid, a.activityId, a.wbsUid, a.durationDays, a.start, a.finish, a.percentComplete])).toEqual([
      ['2', 'D100', '1', 10, '2026-01-05', '2026-01-16', 100],
      ['4', 'D110', '3', 15, '2026-01-19', '2026-02-12', 40],
      ['5', null, '3', 20, '2026-01-07', '2026-02-03', 0],
      ['7', 'S200', '6', 20, '2026-02-16', '2026-03-13', 0],
      ['8', 'S900', '6', 0, '2026-03-16', '2026-03-16', 0],
    ]);
    const [basic, mech, elec, found, handover] = s.activities;
    expect(basic).toMatchObject({ actualStart: '2026-01-05', actualFinish: '2026-01-16', costKeur: 50, actualCostKeur: 48, budgetKeur: 50 });
    expect(mech).toMatchObject({ calendarUid: '2', remainingDays: 9, actualStart: '2026-01-19', actualFinish: null });
    expect(mech.baselines).toEqual([
      { number: 0, start: '2026-01-19', finish: '2026-02-09', durationDays: 15, costKeur: 75 },
      { number: 1, start: '2026-01-12', finish: '2026-02-02', durationDays: 15, costKeur: null },
    ]);
    expect(elec).toMatchObject({ constraint: { type: 'FNLT', date: '2026-02-13' }, critical: true, totalFloatDays: 0 });
    expect(found).toMatchObject({ totalFloatDays: 5, budgetKeur: 110, costKeur: 120 });
    expect(handover).toMatchObject({ milestone: true, durationDays: 0, constraint: null });
  });

  it('reads the logic with lags in working days', () => {
    expect(s.links).toEqual([
      { predUid: '2', succUid: '4', type: 'FS', lagDays: 0 },
      { predUid: '2', succUid: '5', type: 'SS', lagDays: 2 },
      { predUid: '4', succUid: '7', type: 'FS', lagDays: 0 },
      { predUid: '5', succUid: '7', type: 'FF', lagDays: -1 },
      { predUid: '7', succUid: '8', type: 'FS', lagDays: 0 },
    ]);
  });

  it('reads calendars (week, hours, exceptions) and skips unused resource calendars', () => {
    expect(s.calendars.map((c) => [c.uid, c.name, c.workDays, c.hoursPerDay, c.exceptions.map((e) => e.date)])).toEqual([
      ['1', 'Standard', [1, 2, 3, 4, 5], 8, ['2026-01-01']],
      ['2', 'Workshop 4x10', [1, 2, 3, 4], 10, ['2026-02-23', '2026-02-24']],
    ]);
  });

  it('reports what it does not import; resources and assignments', () => {
    expect(s.unmapped).toEqual([
      fmt('As late as possible constraints are imported as ASAP ({0})', 1), fmt('Deadlines are not imported ({0})', 1),
      fmt('Custom fields other than "Activity ID" are not imported ({0})', 1), 'Resource rates and cost accrual are not imported',
    ]);
    expect(s.resources).toEqual([{ uid: '1', name: 'Julien Wagner', type: 'work' }]);
    expect(s.assignments).toEqual([{ activityUid: '4', resourceUid: '1', units: 1, plannedHours: 120, actualHours: 48 }]);
  });

  it('refuses other XML, DOCTYPE declarations and parses ISO durations', () => {
    expect(() => parseMspdi('<html><body/></html>')).toThrow('The file is not an MS Project XML file (MSPDI)');
    expect(() => parseMspdi('<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "aaaa">]><Project><Name>&a;</Name></Project>')).toThrow('DOCTYPE');
    expect([hoursOfDuration('PT40H0M0S'), hoursOfDuration('PT0H30M0S'), hoursOfDuration('P1DT2H'), hoursOfDuration('x'), hoursOfDuration('-PT8H')]).toEqual([40, 0.5, 26, null, -8]);
  });
});

describe('MSPDI writer', () => {
  it('round trip: write → read gives the same schedule', () => {
    const s = parseMspdi(fixture('sample.mspdi.xml').toString('utf8'));
    const xml = writeMspdi(s, { fileName: 'Sample.xml', now: new Date('2026-10-09T08:00:00Z') });
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Project xmlns="http://schemas.microsoft.com/project">')).toBe(true);
    const back = parseMspdi(xml);
    const strip = (x: typeof s) => ({
      ...x, unmapped: [], warnings: [],
      activities: x.activities.map((a) => ({ ...a, notes: null })),
      wbs: x.wbs.map((w) => ({ uid: w.uid, name: w.name, parentUid: w.parentUid })),
    });
    expect(strip(back)).toEqual(strip(s));
    expect(back.activities.map((a) => a.activityId)).toEqual(['D100', 'D110', null, 'S200', 'S900']);
  });

  it('escapes text and writes the Activity ID field definition', () => {
    const s = parseMspdi(fixture('sample.mspdi.xml').toString('utf8'));
    s.activities[0].name = 'Design <A&B> "quoted"';
    const xml = writeMspdi(s, { fileName: 'x.xml' });
    expect(xml).toContain('<Name>Design &lt;A&amp;B&gt; &quot;quoted&quot;</Name>');
    expect(xml).toContain('<Alias>Activity ID</Alias>');
    expect(parseMspdi(xml).activities[0].name).toBe('Design <A&B> "quoted"');
  });
});

describe('P6 XER reader', () => {
  const s = parseXer(fixture('sample.xer').toString('utf8'));

  it('reads the project, WBS, activities (LOE skipped), durations on each calendar and % complete', () => {
    expect(s).toMatchObject({ format: 'xer', name: 'P6-DEMO', start: '2026-03-02', finish: '2026-05-18', statusDate: '2026-04-01', calendarUid: '10', hoursPerDay: 10 });
    expect(s.wbs.map((w) => [w.uid, w.code, w.name, w.parentUid])).toEqual([['1001', 'ENG', 'Engineering', null], ['1002', 'CON', 'Construction', null], ['1003', 'CON.CIV', 'Civil works', '1002']]);
    expect(s.activities.map((a) => [a.activityId, a.wbsUid, a.durationDays, a.start, a.finish, a.percentComplete, a.calendarUid])).toEqual([
      ['A1000', '1001', 5, '2026-03-02', '2026-03-07', 100, null],
      ['A1010', '1001', 10, '2026-03-09', '2026-03-20', 50, '20'],
      ['A1020', '1003', 20, '2026-03-25', '2026-04-15', 0, null],
      ['A1030', '1002', 30, '2026-04-01', '2026-05-06', 0, null],
      ['A1900', '1002', 0, '2026-05-07', '2026-05-07', 0, null],
    ]);
    const [survey, review, found, steel, handover] = s.activities;
    expect(survey).toMatchObject({ actualStart: '2026-03-02', actualFinish: '2026-03-07', totalFloatDays: null });
    expect(review).toMatchObject({ remainingDays: 5, totalFloatDays: 0, critical: true });
    expect(found).toMatchObject({ constraint: { type: 'FNLT', date: '2026-04-17' }, totalFloatDays: 4, critical: false, codes: ['Discipline: CIV'] });
    expect(steel).toMatchObject({ budgetKeur: 135, costKeur: 135, actualCostKeur: 0 });
    expect(handover.milestone).toBe(true);
  });

  it('reads the logic (lag hours on the predecessor calendar), resources and reports the rest', () => {
    expect(s.links).toEqual([
      { predUid: '2001', succUid: '2002', type: 'FS', lagDays: 0 },
      { predUid: '2002', succUid: '2003', type: 'FS', lagDays: 2 },
      { predUid: '2003', succUid: '2004', type: 'SS', lagDays: 5 },
      { predUid: '2004', succUid: '2005', type: 'FS', lagDays: 0 },
    ]);
    expect(s.assignments).toEqual([
      { activityUid: '2004', resourceUid: '500', units: 6, plannedHours: 1800, actualHours: 0 },
      { activityUid: '2004', resourceUid: '501', units: 1, plannedHours: 300, actualHours: 0 },
    ]);
    expect(s.calendars.map((c) => [c.uid, c.workDays, c.hoursPerDay, c.exceptions])).toEqual([
      ['10', [1, 2, 3, 4, 5, 6], 10, [{ date: '2026-05-01', working: false, name: '' }]],
      ['20', [1, 2, 3, 4, 5], 8, []],
    ]);
    expect(s.unmapped).toEqual([
      fmt('Level-of-effort and WBS-summary activities are not imported ({0})', 1), fmt('Secondary constraints are not imported ({0})', 1),
      fmt('P6 activity codes are kept in the activity description ({0})', 1), fmt('Cross-project links are not imported ({0})', 1),
      'Resource rates and cost accrual are not imported', fmt('Other tables of the XER file are not imported: {0}', 'UDFVALUE'),
      fmt('P6 baselines are separate projects — none is imported'),
    ]);
  });

  it('refuses other text and parses P6 calendar data', () => {
    expect(() => parseXer('hello')).toThrow('The file is not a Primavera P6 XER file');
    expect(parseClndrData('', 7)).toEqual({ workDays: [1, 2, 3, 4, 5], hoursPerDay: 7, exceptions: [] });
    expect([isoOfSerial(46143), serialOfIso('2026-05-01'), isoOfSerial(0)]).toEqual(['2026-05-01', 46143, null]);
  });
});

describe('table helpers', () => {
  it('decodes UTF-8 / Windows-1252, detects the separator and parses quoted CSV', () => {
    expect(decodeText(new Uint8Array([0xef, 0xbb, 0xbf, 0x41]))).toBe('A');
    expect(decodeText(new Uint8Array([0x45, 0x74, 0x75, 0x64, 0x65, 0xe9]))).toBe('Etudeé');
    expect(detectSeparator('a;b;c\n1;2;3')).toBe(';');
    expect(detectSeparator('a,b\n1,2')).toBe(',');
    expect(detectSeparator('a\tb')).toBe('\t');
    expect(parseCsv('a;"b;c";"d ""e"""\r\n1;"multi\nline";3', ';')).toEqual([['a', 'b;c', 'd "e"'], ['1', 'multi\nline', '3']]);
  });

  it('parses numbers with a decimal comma or point', () => {
    expect([parseNumberCell('1 250,5', ','), parseNumberCell('1,250.5', '.'), parseNumberCell('1.250', ','), parseNumberCell('1,250', '.'), parseNumberCell('12,5 k€', null)]).toEqual([1250.5, 1250.5, 1250, 1250, 12.5]);
    expect([parseNumberCell('(30)', null), parseNumberCell('−4', null), parseNumberCell('abc', null), parseNumberCell(42, null), parseNumberCell('', null)]).toEqual([-30, -4, null, 42, null]);
  });

  it('finds the header row, maps columns from EN / FR headers and normalises rows', () => {
    const rows = parseCsv(decodeText(fixture('budget-lines.fr.csv')));
    expect(detectHeaderRow(rows, 'budget_lines')).toBe(0);
    const columns = columnNames(rows[0]);
    const mapping = autoMapping(columns, 'budget_lines');
    expect(mapping).toEqual({ code: 'Code', name: 'Catégorie', costType: 'Type', budget: 'Budget (k€)', actual: 'Réalisé (k€)', committed: null, forecast: null });
    const out = mapRows(columns, rows, 0, mapping).map((r) => normaliseRow('budget_lines', r, ','));
    expect(out.map((r) => [r.line, r.key, r.values.costType, r.values.budget, r.errors])).toEqual([
      [2, 'C01', 'labor', 1250.5, []],
      [3, 'Location grue', 'equipment', 85, []],
      [4, 'C99', 'Inconnu', 12, [fmt('Unknown cost type {0}', 'Inconnu')]],
      [5, 'Honoraires bureau de contrôle', 'fees', null, [fmt('Not a number: {0}', 'abc')]],
    ]);
    expect(autoMapping(columnNames(['Activité', 'Ressource', 'Effectif', 'Heures/jour', 'Heures prévues', 'Heures réelles']), 'assignments')).toEqual({
      activity: 'Activité', resource: 'Ressource', detail: null, count: 'Effectif', hoursPerDay: 'Heures/jour', plannedHours: 'Heures prévues', actualHours: 'Heures réelles',
    });
    expect(columnNames(['Name', 'name', '', 'Qty'])).toEqual(['Name', 'name (2)', 'Column C', 'Qty']);
  });

  it('reads codes in English, French or as codes', () => {
    expect([parseCostType('Subcontract'), parseCostType('sous-traitance'), parseCostType('labor'), parseCostType('???')]).toEqual(['subcontract', 'subcontract', 'labor', null]);
    expect([parsePartType('Electrical'), parsePartType('Automation'), parsePartType('heavy_equipment'), parsePartType('Gizmo')]).toEqual(['electrical', 'electronics', 'heavy_equipment', null]);
    expect([parseUnit('pcs'), parseUnit('Lot'), parseUnit('mètre'), parseUnit('gallon')]).toEqual(['pc', 'set', 'm', null]);
    expect([parseWearSpare('PU'), parseWearSpare('Spare part (PR)'), parseWearSpare(''), parseWearSpare('maybe')]).toEqual(['PU', 'PR', null, 'invalid']);
  });
});

describe('import rights and messages', () => {
  it('follows the chapter-4 rights table', () => {
    expect(importKindsOf('director')).toEqual(['mspdi', 'xer', 'budget_lines', 'bom', 'parts', 'assignments']);
    expect(importKindsOf('pm')).toEqual(['mspdi', 'xer', 'budget_lines', 'assignments']);
    expect(importKindsOf('englead')).toEqual(['bom', 'parts']);
    expect(importKindsOf('procurement')).toEqual(['bom', 'parts']);
    expect(importKindsOf('depthead')).toEqual(['assignments']);
    expect(importKindsOf('client')).toEqual([]);
    expect(importKindsOf('member')).toEqual([]);
    // R-041 (P-2): on an existing project, the schedule needs the PM rights and the other kinds the project team; a head of
    // department staffs every project (assignments on any project), a PM only their teams'.
    const lead = { member: true, lead: true };
    const member = { member: true, lead: false };
    const none = { member: false, lead: false };
    expect([canImport('pm', 'mspdi', lead), canImport('pm', 'mspdi', member), canImport('pm', 'mspdi', null), canImport('depthead', 'assignments', member), canImport('depthead', 'assignments', none)])
      .toEqual([true, false, true, true, true]);
    expect([canImport('pm', 'assignments', member), canImport('pm', 'assignments', none)]).toEqual([true, false]);
    expect([canImport('englead', 'bom', member), canImport('englead', 'bom', none), canImport('englead', 'parts', null), canImport('client', 'bom', lead)]).toEqual([true, false, true, false]);
    expect(Object.keys(CARD_KINDS)).toEqual(['MS Project XML', 'Excel / CSV', 'Primavera P6 XER']);
  });

  it('every message template has a French entry and translates with its arguments', () => {
    const fr = EXTRA as Record<string, string>;
    expect(MESSAGES.filter((m) => !fr[m])).toEqual([]);
    for (const m of MESSAGES) expect((fr[m].match(/\{\d\}/g) ?? []).sort(), m).toEqual((m.match(/\{\d\}/g) ?? []).sort());
    const t = makeT('fr');
    expect(translateMessage(fmt('Unknown predecessor {0} — link not imported', 'A9999'), t)).toBe(fr['Unknown predecessor {0} — link not imported'].replace('{0}', 'A9999'));
    expect(translateMessage('Not a template', makeT('en'))).toBe('Not a template');
  });

  it('date helpers', () => {
    expect([planDateText('2026-10-05', 2026), planDateText('2027-01-14', 2026), monthIndex('2026-09-25')]).toEqual(['05 Oct', '14 Jan ’27', 8 + 24 / 30]);
    // R-013: the year suffix is relative to the business year.
    expect([planDateText('2026-10-05', 2027), planDateText('2027-01-14', 2027)]).toEqual(['05 Oct ’26', '14 Jan']);
  });
});
