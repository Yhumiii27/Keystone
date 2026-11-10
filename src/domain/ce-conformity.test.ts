// R-160 (P2, D9-32): CE conformity file rules — value tests.
import { describe, expect, it } from 'vitest';
import {
  CE_APPLICATION_DATE, DEFAULT_EHSR, DEFAULT_TECHFILE, EMPTY_CE_FILE, applyCeScope, ceChangedFields, ceEditScope, ceMarketDate, ceReadiness,
  ceRegulationApplies, declarationKindOf, parseCeFile, parseChecklistEntry, type CeFileValues,
} from './ce-conformity';

const EHSR = ['1.1', '1.2', '3.1'];
const TECH = ['description', 'risk_assessment'];
const ctx = { ehsrCodes: EHSR, techCodes: TECH, deliverables: ['D-021', 'D-024'] };

const full: CeFileValues = {
  regime: 'machinery', category: 'not_listed', route: 'module_a', riskAssessmentRef: 'RPT-HLT-040', standards: ['EN ISO 12100:2010'],
  instructionsRef: 'MAN-HLT-015', declarationSignatory: 'R. Aubert', declarationOn: '2027-02-01', declarationRef: 'COC-HLT-001', ceMarkingOn: '2027-02-02',
  ehsr: { '1.1': 'met', '1.2': 'met', '3.1': 'na' },
  techFile: { description: { status: 'done', deliverable: 'D-021', codexRef: null }, risk_assessment: { status: 'done', deliverable: null, codexRef: 'RPT-HLT-040' } },
};

describe('reference checklists', () => {
  it('Annex III headings by number and short title, Annex IV headings, unique codes', () => {
    expect(DEFAULT_EHSR.map((e) => e.code)).toEqual(['1.1', '1.2', '1.3', '1.4', '1.5', '1.6', '1.7', '2', '3.1', '3.2', '3.3', '3.4', '3.5', '3.6', '4.1', '4.2', '4.3', '4.4', '5', '6']);
    expect(DEFAULT_EHSR.find((e) => e.code === '1.3')?.title).toBe('Protection against mechanical hazards');
    expect(new Set(DEFAULT_TECHFILE.map((e) => e.code)).size).toBe(DEFAULT_TECHFILE.length);
    expect(DEFAULT_TECHFILE).toHaveLength(11);
  });

  it('a typed entry: Annex III number or lowercase key, a title', () => {
    expect(parseChecklistEntry('ehsr', ' 1.1.9 ', 'Protection against corruption')).toEqual({ ok: true, value: { kind: 'ehsr', code: '1.1.9', title: 'Protection against corruption' } });
    expect(parseChecklistEntry('ehsr', 'x', 'T')).toEqual({ ok: false, error: 'A number reads "1.1.9"' });
    expect(parseChecklistEntry('techfile', 'noise_data', 'Noise measurements')).toMatchObject({ ok: true });
    expect(parseChecklistEntry('techfile', 'Noise', 'Noise')).toEqual({ ok: false, error: 'A key reads "lowercase_letters"' });
    expect(parseChecklistEntry('other', 'a', 'b')).toEqual({ ok: false, error: 'Unknown list' });
    expect(parseChecklistEntry('ehsr', '1.8', '')).toEqual({ ok: false, error: 'Title is required' });
  });
});

describe('parseCeFile', () => {
  it('accepts a complete file and drops "not assessed" answers', () => {
    const r = parseCeFile({ ...full, ehsr: { ...full.ehsr }, standards: 'EN ISO 12100:2010\n\nen iso 12100:2010\nEN 60204-1' }, ctx);
    expect(r.ok && r.value.standards).toEqual(['EN ISO 12100:2010', 'EN 60204-1']);
    const r2 = parseCeFile({ ehsr: { '1.1': 'todo', '1.2': 'applies' } }, ctx);
    expect(r2).toEqual({ ok: true, value: { ...EMPTY_CE_FILE, ehsr: { '1.2': 'applies' } } });
  });

  it('refuses unknown choices, references, dates and checklist codes', () => {
    expect(parseCeFile({ regime: 'machine' }, ctx)).toEqual({ ok: false, error: 'Unknown regime' });
    expect(parseCeFile({ route: 'module_z' }, ctx)).toEqual({ ok: false, error: 'Unknown conformity assessment route' });
    expect(parseCeFile({ riskAssessmentRef: 'not a ref' }, ctx)).toEqual({ ok: false, error: 'Risk assessment is not a Codex reference' });
    expect(parseCeFile({ declarationOn: '2027-02-30' }, ctx)).toEqual({ ok: false, error: 'Invalid date' });
    expect(parseCeFile({ ehsr: { '9.9': 'met' } }, ctx)).toEqual({ ok: false, error: 'Unknown requirement' });
    expect(parseCeFile({ techFile: { description: { status: 'done', deliverable: 'D-999' } } }, ctx)).toEqual({ ok: false, error: 'Unknown deliverable' });
    expect(parseCeFile({ techFile: { description: { status: 'done' } } }, ctx)).toEqual({ ok: false, error: 'A heading marked done needs a deliverable or a Codex reference' });
    expect(parseCeFile(null, ctx)).toEqual({ ok: false, error: 'Invalid request' });
  });

  it('partly completed machinery: no route, no CE marking', () => {
    expect(parseCeFile({ regime: 'partly_completed', route: 'module_a' }, ctx)).toEqual({ ok: false, error: 'Partly completed machinery has no conformity assessment route' });
    expect(parseCeFile({ regime: 'partly_completed', ceMarkingOn: '2027-03-01' }, ctx)).toEqual({ ok: false, error: 'Partly completed machinery bears no CE marking' });
    expect(declarationKindOf('partly_completed')).toBe('Declaration of incorporation');
    expect(declarationKindOf(null)).toBe('EU declaration of conformity');
  });
});

describe('readiness (computed)', () => {
  const lists = { ehsr: EHSR, techFile: TECH };
  it('no file: not started, 0 of 9', () => {
    const r = ceReadiness(null, lists);
    expect([r.state, r.done, r.total, r.pct, r.complete]).toEqual(['none', 0, 9, 0, false]);
  });

  it('a complete machinery file: 9 of 9', () => {
    const r = ceReadiness(full, lists);
    expect([r.state, r.done, r.total, r.pct, r.missing]).toEqual(['complete', 9, 9, 100, []]);
    expect(r.ehsr).toEqual({ settled: 3, total: 3, open: 0 });
  });

  it('an open requirement, a heading to do and no marking: in progress, what is missing', () => {
    const r = ceReadiness({ ...full, ehsr: { '1.1': 'applies', '1.2': 'met' }, techFile: { description: full.techFile.description }, ceMarkingOn: null }, lists);
    expect([r.state, r.done, r.pct]).toEqual(['in_progress', 6, 67]);
    expect(r.missing).toEqual(['Essential requirements assessed and met', 'Technical file complete', 'CE marking dated']);
    expect(r.ehsr).toEqual({ settled: 1, total: 3, open: 1 });
  });

  it('partly completed machinery: 6 checks, the declaration of incorporation', () => {
    const r = ceReadiness({ ...full, regime: 'partly_completed', category: null, route: null, ceMarkingOn: null }, lists);
    expect([r.total, r.complete]).toEqual([6, true]);
    expect(r.checks.map((c) => c.label)).toContain('Declaration of incorporation signed');
  });

  it('a heading removed from Settings no longer counts; a new one is to settle', () => {
    expect(ceReadiness(full, { ehsr: ['1.1', '1.2'], techFile: TECH }).complete).toBe(true);
    expect(ceReadiness(full, { ehsr: [...EHSR, '1.1.9'], techFile: TECH }).complete).toBe(false);
  });
});

describe('who edits', () => {
  it('engineering lead and quality: technical; PM lead: project fields; director and others: read', () => {
    const can = { lead: true, canEditScreen: true };
    expect(['englead', 'quality', 'pm', 'director', 'procurement'].map((r) => ceEditScope(r, can))).toEqual(['technical', 'technical', 'project', 'none', 'none']);
    expect(ceEditScope('pm', { lead: false, canEditScreen: true })).toBe('none');
    expect(ceEditScope('englead', { lead: false, canEditScreen: false })).toBe('none');
  });

  it('a PM save keeps the technical fields as stored', () => {
    const before = { ...EMPTY_CE_FILE, regime: 'machinery' as const };
    const sent = { ...full, regime: 'partly_completed' as const };
    const out = applyCeScope(before, sent, 'project');
    expect(out.regime).toBe('machinery');
    expect([out.declarationSignatory, out.declarationOn, out.declarationRef, out.ceMarkingOn]).toEqual(['R. Aubert', '2027-02-01', 'COC-HLT-001', '2027-02-02']);
    expect(out.ehsr).toEqual({});
    expect(applyCeScope({ ...before, regime: 'partly_completed' }, full, 'project').ceMarkingOn).toBeNull();
    expect(applyCeScope(before, full, 'none')).toBe(before);
  });

  it('audit values: the changed fields only', () => {
    expect(ceChangedFields(EMPTY_CE_FILE, { ...EMPTY_CE_FILE, regime: 'machinery', standards: ['EN 619'] })).toEqual({
      before: { regime: null, standards: [] }, after: { regime: 'machinery', standards: ['EN 619'] },
    });
  });
});

describe('placing on the market', () => {
  const base = { quantity: 3, deliveredOn: [], handoverOn: [], plannedFinish: null, finishMonth: null };
  it('every unit delivered → last delivery; else latest handover; else planned finish; else finish month end', () => {
    expect(ceMarketDate({ ...base, deliveredOn: ['2026-11-02', '2026-12-15', '2026-10-01'], handoverOn: ['2027-05-01'] })).toBe('2026-12-15');
    expect(ceMarketDate({ ...base, deliveredOn: ['2026-11-02'], handoverOn: [null, '2027-03-10', '2027-02-01'] })).toBe('2027-03-10');
    expect(ceMarketDate({ ...base, plannedFinish: '2027-06-30', finishMonth: 11 })).toBe('2027-06-30');
    expect(ceMarketDate({ ...base, finishMonth: 11 })).toBe('2026-12-31');
    expect(ceMarketDate({ ...base, finishMonth: 13.4 })).toBe('2027-02-28');
    expect(ceMarketDate(base)).toBeNull();
  });

  it('the Regulation applies from 20 Jan 2027; an unknown date counts as applying', () => {
    expect(CE_APPLICATION_DATE).toBe('2027-01-20');
    expect(['2027-01-19', '2027-01-20', null].map(ceRegulationApplies)).toEqual([false, true, true]);
  });
});
