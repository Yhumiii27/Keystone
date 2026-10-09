// "Import P&ID tags" staging (src/domain/pid-import.ts): delimited text parsing, header recognition (EN / FR names, a
// title row above the header), value parsing and rejections, the staged plan against the Harbor Line tags (new,
// updated with the changed fields, unchanged, removed by "Replace all", rejected, the Keystone mapping kept), the
// revision rule and the result toast.
import { describe, expect, it } from 'vitest';
import { bomScope, pidTagKind, type PlcType } from '@/server/db/codes';
import PROTO from '@/server/prototype/prototype-data.json';
import {
  CLIENT_NOTE, importResultText, normaliseRevision, normaliseTag, parseDelimited, parsePidTagList, planHasChanges, planPidImport, type ExistingPidTag,
} from './pid-import';

/* eslint-disable @typescript-eslint/no-explicit-any */
const EXISTING: ExistingPidTag[] = ((PROTO as any).PID_TAGS as any[]).map((t, i) => ({
  tag: t.tag, description: t.desc, kind: pidTagKind.code(t.kind), scope: bomScope.code(t.scope), partRef: t.ref || null, note: t.note, activityCode: t.act,
  plcType: (t.plc || null) as PlcType | null, stateFeedback: t.fb, role: t.role, sheet: 1 + (i % 4),
}));
const CTX = { catalogue: new Set(['EL-PLC-S7', 'CTL-WIND-SN', 'EL-SWG-11KV', 'CR-MOT-15K']), activities: new Set(['A1410', 'A1420', 'A1320', 'A1430']) };
const plan = (text: string, mode: 'merge' | 'replace' = 'merge') => planPidImport(parsePidTagList(parseDelimited(text)), EXISTING, mode, CTX);

describe('parseDelimited', () => {
  it('detects tab, semicolon and comma; quoted cells; CRLF; BOM; empty rows dropped', () => {
    expect(parseDelimited('Tag\tDescription\nLT-101\tLevel\n\n')).toEqual([['Tag', 'Description'], ['LT-101', 'Level']]);
    expect(parseDelimited('﻿Tag;Description\r\nLT-101;"Level; high"\r\n')).toEqual([['Tag', 'Description'], ['LT-101', 'Level; high']]);
    expect(parseDelimited('Tag,Description\nP-110,"Pump ""A"", RM → process"\nM-110,"Motor\nline 2"')).toEqual([
      ['Tag', 'Description'], ['P-110', 'Pump "A", RM → process'], ['M-110', 'Motor\nline 2'],
    ]);
    expect(parseDelimited('Tag\nLT-101')).toEqual([['Tag'], ['LT-101']]);
    expect(parseDelimited('')).toEqual([]);
  });
});

describe('parsePidTagList', () => {
  it('file-level errors', () => {
    expect(parsePidTagList([]).error).toBe('The file is empty');
    expect(parsePidTagList([['Name', 'Description'], ['x', 'y']]).error).toBe('No "Tag" column in the first rows of the file');
    expect(parsePidTagList([['Tag', 'Kind'], ['LT-101', 'Instrument']]).error).toBe('No "Description" column in the file');
    expect(parsePidTagList([['Tag', 'Description']]).error).toBe('The file lists no tag');
  });

  it('header within the first rows, EN / FR names, ignored columns, values parsed, blank cells keep the stored value', () => {
    const p = parsePidTagList([
      ['P&ID tag list — PID-HLT-026 rev E'],
      ['Repère', 'Désignation', 'Nature', 'Périmètre', 'Référence', 'Activité', 'Automate', "Retour d’état", 'Rôle', 'Feuille', 'Remarque', 'Line size'],
      ['lt-101', 'Level transmitter', 'Instrument', 'Surcouche', 'el-plc-s7', 'a1410', 'Automate process', '', 'Capteur', '1', '', 'DN50'],
      ['T-101', 'Tank', 'Équipement', 'Fourniture client', '—', '', '', '', 'passif', '', '', ''],
    ]);
    expect(p.error).toBeNull();
    expect(p.columns).toEqual(['tag', 'description', 'kind', 'scope', 'reference', 'activity', 'plc', 'feedback', 'role', 'sheet', 'note']);
    expect(p.ignored).toEqual(['Line size']);
    expect(p.rows).toEqual([
      { line: 3, tag: 'LT-101', fields: { description: 'Level transmitter', kind: 'instrument', scope: 'overlay', partRef: 'EL-PLC-S7', activityCode: 'A1410', plcType: 'P', role: 'sensor', sheet: 1 } },
      { line: 4, tag: 'T-101', fields: { description: 'Tank', kind: 'equipment', scope: 'client', partRef: null, role: 'passive' } },
    ]);
  });

  it('rejections with reasons', () => {
    const p = parsePidTagList([
      ['Tag', 'Description', 'Kind', 'Scope', 'PLC', 'Role', 'Sheet'],
      ['', 'No tag', 'Instrument', '', '', '', ''],
      ['XV 111', 'Valve', 'Valve', '', '', '', ''],
      ['XV-112', 'Valve', 'Instrument', 'Vendor', '', '', ''],
      ['XV-113', 'Valve', 'Instrument', '', 'DCS', '', ''],
      ['XV-114', 'Valve', 'Instrument', '', '', 'motor', ''],
      ['XV-115', 'Valve', 'Instrument', '', '', '', '0'],
      ['<b>', 'x', 'Instrument', '', '', '', ''],
    ]);
    expect(p.rows).toEqual([]);
    expect(p.rejected).toEqual([
      { line: 2, tag: '—', reason: 'No tag' },
      { line: 3, tag: 'XV 111', reason: 'Invalid kind "Valve" (Instrument or Equipment)' },
      { line: 4, tag: 'XV-112', reason: 'Invalid scope "Vendor" (Keystone, Overlay or Client)' },
      { line: 5, tag: 'XV-113', reason: 'Invalid PLC "DCS" (P, S, L or empty)' },
      { line: 6, tag: 'XV-114', reason: 'Invalid role "motor" (sensor, actuator, ctrl or passive)' },
      { line: 7, tag: 'XV-115', reason: 'Invalid sheet "0"' },
      { line: 8, tag: '<B>', reason: 'Invalid tag "<b>"' },
    ]);
    expect(normaliseTag('  xv   111 ')).toBe('XV 111');
  });
});

describe('planPidImport', () => {
  const FILE = [
    'Tag;Description;Kind;Scope;Reference;Activity;PLC;State feedback;Role;Sheet',
    // unchanged
    'LT-101;Level transmitter — RM tank T-101;Instrument;Overlay;EL-PLC-S7;A1410;P;;sensor;1',
    // updated: description + feedback (XV-111 gets its position feedback); reference fills an unmapped tag
    'XV-111;Automatic valve — transfer line (fail-closed);Instrument;Keystone;CR-MOT-15K;A1410;P;ZSO/ZSC-111 · Open / closed;actuator;4',
    // updated: the file's reference differs from Keystone's mapping → kept, warning
    'P-110;Transfer pump RM → process;Equipment;Keystone;EL-SWG-11KV;A1410;P;VFD-110 · Run status · FT-110 · Flow;actuator;4',
    // new tags
    'PT-301;Pressure transmitter — hoist hydraulics;Instrument;;XX-UNKNOWN;A9999;S;;;',
    'TK-301;Hydraulic tank;Equipment;Client;EL-PLC-S7;;;;;2',
    // rejected: new tag without kind, duplicate
    'FT-302;Flow meter;;;;;;;;',
    'LT-101;Level transmitter (again);Instrument;Overlay;;;;;;',
  ].join('\n');

  it('Add & update: new, updated (changed fields), unchanged, rejected; the Keystone mapping kept', () => {
    const p = plan(FILE);
    expect(p.error).toBeNull();
    expect(p.lines.map((l) => [l.line, l.tag, l.delta, l.changes, l.reason, l.warnings])).toEqual([
      [2, 'LT-101', 'unchanged', [], null, []],
      [3, 'XV-111', 'updated', ['description', 'reference', 'feedback'], null, []],
      [4, 'P-110', 'unchanged', [], null, ['Mapping kept in Keystone (CR-MOT-15K; the file gives EL-SWG-11KV)']],
      [5, 'PT-301', 'new', [], null, ['XX-UNKNOWN is not in the catalogue', 'Activity A9999 is not in the project plan']],
      [6, 'TK-301', 'new', [], null, ['Reference ignored: client-supplied equipment']],
      [7, 'FT-302', 'rejected', [], 'A new tag needs a kind (Instrument or Equipment)', []],
      [8, 'LT-101', 'rejected', [], 'Duplicate tag (line 2)', []],
    ]);
    expect(p.lines.find((l) => l.tag === 'PT-301')!.value).toEqual({
      tag: 'PT-301', description: 'Pressure transmitter — hoist hydraulics', kind: 'instrument', scope: 'keystone', partRef: 'XX-UNKNOWN', note: '', activityCode: 'A9999',
      plcType: 'S', stateFeedback: '', role: 'sensor', sheet: 1,
    });
    expect(p.lines.find((l) => l.tag === 'TK-301')!.value).toMatchObject({ scope: 'client', partRef: null, note: CLIENT_NOTE, role: 'passive', sheet: 2 });
    expect(p.lines.find((l) => l.tag === 'XV-111')!.value).toMatchObject({ partRef: 'CR-MOT-15K', stateFeedback: 'ZSO/ZSC-111 · Open / closed', description: 'Automatic valve — transfer line (fail-closed)' });
    expect(p.counts).toEqual({ new: 2, updated: 1, unchanged: 2, removed: 0, rejected: 2, rows: 7, imported: 5 });
    expect(planHasChanges(p)).toBe(true);
    expect(importResultText(p, 'E')).toBe('5 tags · rev E imported · 2 new · 1 updated · 2 rejected');
  });

  it('Replace all: the tags the file no longer lists are removed (a rejected line keeps its tag)', () => {
    const p = plan(FILE, 'replace');
    const removed = p.lines.filter((l) => l.delta === 'removed');
    expect(removed.map((l) => l.tag)).toEqual(EXISTING.map((t) => t.tag).filter((t) => !['LT-101', 'XV-111', 'P-110'].includes(t)));
    expect(removed.find((l) => l.tag === 'SIS-001')!.warnings).toEqual(['Mapping to EL-PLC-S7 lost']);
    expect(p.counts.removed).toBe(21);
    expect(importResultText(p, 'E')).toBe('5 tags · rev E imported · 2 new · 1 updated · 21 removed · 2 rejected');
    // An existing tag on a rejected line is not removed.
    const q = plan('Tag,Description,Kind\nLT-101,Level,Pump', 'replace');
    expect(q.lines.some((l) => l.tag === 'LT-101' && l.delta === 'removed')).toBe(false);
  });

  it('scope changes: to client clears the mapping (and gets the free-issue note); from client drops the note', () => {
    const p = plan('Tag,Description,Scope\nLT-101,Level transmitter — RM tank T-101,Client\nT-101,Raw material tank 40 m³,Keystone');
    const toClient = p.lines.find((l) => l.tag === 'LT-101')!;
    expect([toClient.delta, toClient.changes, toClient.warnings, toClient.value!.partRef, toClient.value!.note]).toEqual([
      'updated', ['scope', 'reference', 'note'], ['Mapping to EL-PLC-S7 removed: client-supplied equipment'], null, CLIENT_NOTE,
    ]);
    const fromClient = p.lines.find((l) => l.tag === 'T-101')!;
    expect([fromClient.changes, fromClient.value!.note]).toEqual([['scope', 'note'], '']);
  });

  it('the same list again: nothing to write; file-level errors plan nothing', () => {
    const same = ['Tag\tDescription', ...EXISTING.map((t) => `${t.tag}\t${t.description}`)].join('\n');
    const p = plan(same);
    expect([p.counts.unchanged, p.counts.imported, planHasChanges(p)]).toEqual([24, 24, false]);
    const bad = plan('Name,Description\nx,y');
    expect([bad.error, bad.lines, bad.counts.imported, planHasChanges(bad)]).toEqual(['No "Tag" column in the first rows of the file', [], 0, false]);
  });

  it('revision', () => {
    expect(['E', ' e ', 'C1', '02', '', 'rev E', 'ABCDEFG', 7].map(normaliseRevision)).toEqual(['E', 'E', 'C1', '02', null, null, null, null]);
  });
});
