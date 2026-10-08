// Golden values reproducing the prototype's lifecycle / register / wizard logic (docs/spec/03 §5, 01 §10–§11).
import { describe, expect, it } from 'vitest';
import { PROTO, PROTO_GEN } from '@/server/prototype';
import { stage as stageCodec } from '@/server/db/codes';
import {
  STAGE_CODES, STAGE_ORDER, allocateProjectIdentity, analyticHint, categorySource, deliverableProgress, deliverableToggle, isLiveRow, matchesQuery,
  missingOf, moveError, moveModeFor, newProjectCode, nextAnalytic, nextProjectId, registerTitle, sliderLeft, sliderStopOf,
  sliderTicks, stageAtStop, stageCounts, stageSelection, stopForKey, stopFromRatio, templateCategoriesText, transitionsOf,
  wizardClientCode, wizardSummary, wizardTotal, wizardTotalText, type StageCode,
} from './lifecycle';

const code = (label: string) => stageCodec.code(label);
const DELIVS = PROTO.STAGE_DELIVS as Record<string, string[]>;
const DONE = PROTO.STAGE_DONE_DEFAULT as Record<string, Record<string, number[]>>;
const doneOf = (project: string, label: string) => DELIVS[label].map((_, i) => !!DONE[project]?.[label]?.[i]);

describe('stages and transitions', () => {
  it('orders the 13 stages like STATUSES and the 12 ordered ones like STAGE_ORDER', () => {
    expect(STAGE_CODES.map((s) => stageCodec.label(s))).toEqual(PROTO.STATUSES);
    expect(STAGE_ORDER.map((s) => stageCodec.label(s))).toEqual(PROTO.STAGE_ORDER);
  });

  it('reproduces TRANS for every stage', () => {
    for (const [from, tos] of Object.entries(PROTO.TRANS as Record<string, string[]>))
      expect(transitionsOf(code(from)).map((s) => stageCodec.label(s))).toEqual(tos);
  });

  it('opens the Force dialog for Annulé or missing deliverables (line 3938)', () => {
    const missing = missingOf(DELIVS['Fabrication & Assemblage'], doneOf('HLT-026', 'Fabrication & Assemblage'));
    expect(missing).toEqual(['Câblage & armoires terminés', 'NCR majeures clôturées']);
    expect(moveModeFor('fat', missing)).toBe('forced');
    expect(moveModeFor('annule', [])).toBe('forced');
    expect(moveModeFor('fabrication_assemblage', missingOf(DELIVS.Approvisionnements, doneOf('HLT-026', 'Approvisionnements')))).toBe('auto');
  });

  it('validates moves on the server side', () => {
    expect(moveError('fabrication_assemblage', 'expedition', 'forced', [], 'x')).toBe('This stage change is not allowed');
    expect(moveError('clos', 'annule', 'forced', [], 'x')).toBe('This stage change is not allowed');
    expect(moveError('fabrication_assemblage', 'fat', 'auto', ['a'], '')).toMatch(/force/);
    expect(moveError('fabrication_assemblage', 'fat', 'forced', ['a'], '   ')).toMatch(/reason/);
    expect(moveError('fabrication_assemblage', 'fat', 'forced', ['a'], 'Client pressure')).toBeNull();
    expect(moveError('approvisionnements', 'fabrication_assemblage', 'auto', [], '')).toBeNull();
  });

  it('shows deliverable progress "2 / 4" for HLT-026', () => {
    expect(deliverableProgress(doneOf('HLT-026', 'Fabrication & Assemblage'))).toEqual({ done: 2, total: 4, text: '2 / 4', pct: '50%' });
    expect(deliverableProgress([])).toEqual({ done: 0, total: 0, text: '0 / 0', pct: '0%' });
  });

  it('auto-advances when the last missing deliverable of the current stage is ticked (toggleDeliv 3923)', () => {
    const d0 = doneOf('HLT-026', 'Fabrication & Assemblage');
    const a = deliverableToggle('fabrication_assemblage', 'fabrication_assemblage', d0, 2);
    expect(a).toEqual({ done: [true, true, true, false], advanceTo: null });
    const b = deliverableToggle('fabrication_assemblage', 'fabrication_assemblage', a.done, 3);
    expect(b).toEqual({ done: [true, true, true, true], advanceTo: 'fat' });
    // unticking never advances; a past stage never advances; Clos has no next stage
    expect(deliverableToggle('fabrication_assemblage', 'fabrication_assemblage', b.done, 3).advanceTo).toBeNull();
    expect(deliverableToggle('fat', 'fabrication_assemblage', a.done, 3).advanceTo).toBeNull();
    expect(deliverableToggle('clos', 'clos', [true, false], 1).advanceTo).toBeNull();
    expect(deliverableToggle('garantie', 'garantie', [true, true, false], 2, true).advanceTo).toBe('clos');
  });

  it('hides indicators for Initiative, APS, Clos, Annulé and projects without health (showH)', () => {
    expect(isLiveRow('apd', 'off_track')).toBe(true);
    expect(isLiveRow('initiative', 'on_track')).toBe(false);
    expect(isLiveRow('clos', 'on_track')).toBe(false);
    expect(isLiveRow('fabrication_assemblage', null)).toBe(false);
  });
});

describe('stage slider', () => {
  const stages = PROTO_GEN.initialProjects.map((p) => code(p.status));
  const counts = stageCounts(stages);

  it('maps stops to filters', () => {
    expect(sliderStopOf(null)).toBe(0);
    expect(sliderStopOf('fabrication_assemblage')).toBe(6);
    expect(sliderStopOf('annule')).toBe(13);
    expect(stageAtStop(0)).toBeNull();
    expect(stageAtStop(6)).toBe('fabrication_assemblage');
    expect(stageAtStop(99)).toBe('annule');
    expect(stageAtStop(-3)).toBeNull();
  });

  it('positions ticks at i/13 with 3 decimals', () => {
    expect([0, 1, 6, 13].map(sliderLeft)).toEqual(['0.000%', '7.692%', '46.154%', '100.000%']);
    expect([0, 0.04, 0.5, 0.97, 1.4, -1].map(stopFromRatio)).toEqual([0, 1, 7, 13, 13, 0]);
  });

  it('handles the keyboard like stKey', () => {
    expect(stopForKey('ArrowRight', 6)).toBe(7);
    expect(stopForKey('ArrowUp', 13)).toBe(13);
    expect(stopForKey('ArrowLeft', 0)).toBe(0);
    expect(stopForKey('ArrowDown', 3)).toBe(2);
    expect(stopForKey('Home', 9)).toBe(0);
    expect(stopForKey('End', 2)).toBe(13);
    expect(stopForKey('Enter', 2)).toBeNull();
  });

  it('counts the 17 seed projects per stage and colours the ticks', () => {
    const ticks = sliderTicks(counts, stages.length, 6);
    expect(ticks.map((t) => `${t.label}:${t.count}`)).toEqual([
      'All:17', 'Init.:2', 'APS:1', 'APD:2', 'Études:1', 'Appro.:2', 'Fab.:1', 'FAT:0', 'Expéd.:0', 'Chantier:1', 'MES/SAT:1', 'Garantie:1', 'Clos:4', 'Annulé:1',
    ]);
    expect(ticks.map((t) => t.dot)).toEqual(['past', 'past', 'past', 'past', 'past', 'past', 'on', 'empty', 'empty', 'has', 'has', 'has', 'has', 'has']);
    expect(ticks.map((t) => t.text)).toEqual(['has', 'has', 'has', 'has', 'has', 'has', 'on', 'empty', 'empty', 'has', 'has', 'has', 'has', 'has']);
    expect(ticks.filter((t) => t.odd).map((t) => t.index)).toEqual([1, 3, 5, 7, 9, 11, 13]);
  });

  it('describes the selection', () => {
    expect(stageSelection(null, 17, null)).toEqual({ label: 'All projects', sub: '17 projects', hint: 'Drag the cursor to filter by stage' });
    expect(stageSelection('Fabrication & Assemblage', 1, 'Structure, montage mécanique, câblage')).toEqual({
      label: 'Fabrication & Assemblage',
      sub: '1 project · Structure, montage mécanique, câblage',
      hint: 'Drag the cursor or use ← → to change stage',
    });
    expect(registerTitle(null, 17)).toBe('All projects · 17');
    expect(registerTitle('APD', 2)).toBe('APD projects · 2');
  });
});

describe('register search (line 3933)', () => {
  const hlt = { names: ['Harbor Line Terminal Expansion', 'Extension du terminal Harbor Line'], code: 'HLT-026', number: '#026', analytic: 'HAV004', machineType: 'EMP' };
  it.each([
    ['', true], ['harbor', true], ['terminal harbor', true], ['hlt', true], ['#026', true], ['026', true], ['hav0', true],
    ['emp', true], ['em', false], ['memu', false], ['northgate', false],
  ])('"%s" → %s', (q, ok) => expect(matchesQuery(hlt, q)).toBe(ok));
});

describe('new project wizard', () => {
  const PROJ_ID = PROTO.PROJ_ID as Record<string, { id: string; ana: string }>;
  const ids = Object.values(PROJ_ID).map((p) => p.id);
  const anas = Object.values(PROJ_ID).map((p) => p.ana);
  const CODES = PROTO.CLIENT_CODES as Record<string, string>;

  it('numbers the next project #045 (nextProjectId)', () => {
    expect(nextProjectId(ids)).toBe(PROTO_GEN.nextProjectId);
    expect(nextProjectId(ids)).toBe('#045');
    expect(nextProjectId([...ids, null, 'EWA-051', '#045'])).toBe('#046');
    expect(nextProjectId([])).toBe('#001');
  });

  it('derives the analytic code from the client (nextAnalytic / clientCode3)', () => {
    expect(nextAnalytic(wizardClientCode('Logistics BU', CODES), anas)).toBe('LOG001');
    expect(nextAnalytic(wizardClientCode('Port authority', CODES), anas)).toBe('HAV002');
    expect(nextAnalytic(wizardClientCode('Acme Corp', CODES), anas)).toBe('ACM001');
    expect(nextAnalytic(wizardClientCode('', CODES), anas)).toBe('XXX001');
    expect(wizardClientCode('Q1', CODES)).toBe('QXX');
    expect(newProjectCode('LOG', '#045')).toBe('LOG-045');
  });

  it('never issues an analytic code that already exists (CPL002 is taken in the seed)', () => {
    expect(nextAnalytic('CPL', anas)).toBe('CPL003');
    expect(nextAnalytic('NGD', anas)).toBe('NGD002');
    expect(nextAnalytic('ABC', ['ABC001', 'ABC002', 'ABC004'])).toBe('ABC005');
    expect(nextAnalytic('ABC', ['ABC002', 'ABC003'])).toBe('ABC004');
  });

  it('allocates number, code and analytic code of a new project (npCreate)', () => {
    const codes = Object.keys(PROJ_ID).concat(PROTO_GEN.initialProjects.map((p) => p.code));
    expect(allocateProjectIdentity({ code3: 'LOG', numbers: ids, codes, analytics: anas })).toEqual({ number: '#045', code: 'LOG-045', analytic: 'LOG001' });
    // second creation: the counters moved on
    expect(allocateProjectIdentity({ code3: 'LOG', numbers: [...ids, '#045'], codes: [...codes, 'LOG-045'], analytics: [...anas, 'LOG001'] })).toEqual({
      number: '#046', code: 'LOG-046', analytic: 'LOG002',
    });
    // a number whose code is already used by a pipeline project (EWA-051) is skipped
    expect(allocateProjectIdentity({ code3: 'EWA', numbers: [...ids, '#045', '#046', '#047', '#048', '#049', '#050'], codes, analytics: anas }).code).toBe('EWA-052');
  });

  it('explains the analytic code (anaHint)', () => {
    expect(analyticHint('', CODES)).toBe('3 client letters + incremental number');
    expect(analyticHint('Logistics BU', CODES)).toBe('Client code LOG · incremental number');
    expect(analyticHint('Acme Corp', CODES)).toBe('New client — code ACM proposed');
  });

  it('totals the budget with contingency (npTotal / totalText)', () => {
    const emp = (PROTO.NP_TEMPLATES as { id: string; cats: [string, string, string][] }[]).find((t) => t.id === 'EMP')!;
    const cats = emp.cats.map(([, , budget]) => ({ budget }));
    expect(wizardTotal(cats, 5)).toBeCloseTo(2037);
    expect(wizardTotalText(wizardTotal(cats, 5), 'EUR')).toBe('€2.04M');
    expect(wizardTotalText(wizardTotal(cats, 15), 'USD')).toBe('$2.23M');
    expect(wizardTotalText(wizardTotal([{ budget: '400' }, { budget: 'abc' }, { budget: '' }], 10), 'EUR')).toBe('€440k');
    expect(wizardTotalText(0, 'EUR')).toBe('€0k');
  });

  it('writes the copy panel, budget caption and "Will be created" sentence', () => {
    expect(templateCategoriesText(7)).toBe('7 categories');
    expect(templateCategoriesText(0)).toBe('Define in step 3');
    expect(categorySource({ blank: true, name: 'Projet blank' })).toBe('Start from nothing');
    expect(categorySource({ blank: false, name: 'Planning EMP' })).toBe('Budget structure of Planning EMP');
    expect(
      wizardSummary({
        projectId: '#045', analytic: 'LOG001', das: '2', machineType: 'EMP', name: '',
        template: { blank: false, wbs: '6 phases · 14 lots', acts: '38 activités · 52 liens' }, categories: 7, contingencyPct: 5, calendar: 'Standard 5d · 8h',
      }),
    ).toBe(
      '#045 · LOG001 · DAS 2 · EMP · Untitled project · status Initiative · 6 phases · 14 lots, 38 activités · 52 liens copied · 7 cost categories with 5% contingency · Standard 5d · 8h calendar · weekly data date.',
    );
    expect(
      wizardSummary({
        projectId: '#045', analytic: 'ACM001', das: '4', machineType: 'R&D', name: 'Lab line', template: { blank: true, wbs: 'Vide', acts: 'Aucune' },
        categories: 0, contingencyPct: 10, calendar: '24h continuous',
      }),
    ).toBe('#045 · ACM001 · DAS 4 · R&D · Lab line · status Initiative · empty WBS · 0 cost categories with 10% contingency · 24h continuous calendar · weekly data date.');
  });
});

// Type-level guard: StageCode stays the DB code union.
const _s: StageCode = 'annule';
void _s;
