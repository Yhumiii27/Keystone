// Golden values of the activity drawer (docs/spec/05 §2.4.5) on HLT-026, from the prototype data:
// A1250 (in progress, 4 recorded resources, cost overrun, 5 to-dos, pending requests) and A1010 (complete).
import { describe, expect, it } from 'vitest';
import type { LinkType, PlanActivity, PlanPackage } from '@/domain/schedule';
import { makeT, type Lang } from '@/i18n/translate';
import { isoOfDisplayDate, splitActual } from '@/server/db/codes';
import type { PlanOwner, PlanRequest, PlanTodo } from '@/server/dal/plan';
import { PROTO, PROTO_GEN } from '@/server/prototype';
import { activityDrawerView, type DrawerInput } from './drawer-model';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Proto = any;
const pd = PROTO_GEN.projectData['HLT-026'];
const ACTS = pd.ACTS as Proto[];
const activities: PlanActivity[] = ACTS.filter((a) => a.id).map((a) => {
  const s = splitActual(a.s);
  const f = splitActual(a.f);
  return {
    id: a.id, wbs: a.w, name: a.n, durationDays: a.d, start: s.text, startActual: s.actual, finish: f.text, finishActual: f.actual,
    startDate: isoOfDisplayDate(s.text), baselineFinish: a.bl, variance: a.v, constraint: a.c, violated: !!a.viol, totalFloat: a.tf,
    pct: a.pc, owner: a.o, budget: a.b[0], actual: a.b[1], eac: a.b[2], preds: a.p as [string, LinkType, number][],
  };
});
const packages: PlanPackage[] = ACTS.filter((a) => !a.id && a.lv === 1).map((a) => ({ code: a.w, name: a.n }));
const owners: PlanOwner[] = Object.entries(PROTO.OWN as Record<string, [string, string]>).map(([code, [name, title]]) => ({ code, name, title }));
const todos = (PROTO.TODOS as (PlanTodo & { project: string })[]).filter((x) => x.project === 'HLT');
const requests = (PROTO.REQUESTS as (PlanRequest & { project: string })[]).filter((x) => x.project === 'HLT');
const deptHeads = Object.fromEntries(Object.entries(PROTO.DEPTS as Record<string, [string, string]>).map(([k, [head]]) => [k, head]));
const A1250_RES = (PROTO.A1250_RES as [string, string, string, string][]).map(([resource, detail, units, progressText]) => ({ resource, detail, units, progressText }));

/**
 * NEW-D2-2 (Delivery 7, R-062): CR-008 names A1250 (the seed's link — the prototype hard-coded "second crew (CR-008)" on it).
 * The cost note names the requests in review touching the activity; a "Change requests" section lists them.
 */
const CR008 = (status: 'in_review' | 'approved', extra: Partial<NonNullable<DrawerInput['changeLinks']>[number]> = {}) => ({
  cr: 'CR-008', title: 'Steel erection acceleration — second crew', status, durationDays: 20, newDurationDays: null, appliedAt: null, appliedFromDays: null,
  href: '/projects/HLT-026/changes?cr=CR-008', ...extra,
});
const view = (id: string, lang: Lang, assignments: DrawerInput['assignments'] = []) =>
  activityDrawerView(
    {
      act: activities.find((a) => a.id === id)!, activities, packages, owners, assignments, todos, requests, deptHeads, changeLinks: id === 'A1250' ? [CR008('in_review')] : [],
      taskHref: (x) => `/my/tasks/${x.id}`,
    },
    makeT(lang),
    lang,
  );

describe('activity drawer — A1250 (EN)', () => {
  const v = view('A1250', 'en', A1250_RES);

  it('header and General', () => {
    expect([v.id, v.name, v.status]).toEqual(['A1250', 'Steel erection — Bays 3–4', { label: 'In progress · 72%', className: 'tag tag-accent' }]);
    expect(v.general.map((g) => [g.k, g.v, g.lo])).toEqual([
      ['WBS', '1.4 Steel structure', false],
      ['Type', 'Task dependent', false],
      ['Calendar', 'Site 6d · 10h', false],
      ['Original / remaining', '40d / 11d', false],
      ['Start', '17 Aug A', false],
      ['Finish', '09 Oct', false],
      ['BL1 finish', '31 Aug', false],
      ['Finish variance', '-39d', true],
      ['Total float', '-27d', true],
      ['Constraint', 'None', false],
      ['Owner', 'Julien Wagner', false],
    ]);
  });

  it('relationships: first predecessor is "driving", successors behind in LO', () => {
    expect(v.preds).toEqual([
      { id: 'A1240', name: 'Steel erection — Bays 1–2', rel: 'FS · driving', tone: 'driving' },
      { id: 'A1220', name: 'Foundations — Bays 3–4', rel: 'FS +10d', tone: 'normal' },
      { id: 'A1230', name: 'Steel fabrication & delivery', rel: 'FF +5d', tone: 'normal' },
    ]);
    expect(v.succs).toEqual([
      { id: 'A1260', name: 'Roof decking', rel: 'FS -5d', tone: 'lo' },
      { id: 'A1320', name: 'Crane delivery & rigging', rel: 'FS', tone: 'normal' },
      { id: 'A1420', name: 'Lighting & power distribution', rel: 'FS +5d', tone: 'normal' },
    ]);
  });

  it('resources & cost', () => {
    expect(v.res).toEqual([
      { name: 'Julien Wagner', sub: 'Structural engineer · lead · 296 / 400 h', units: '40 h/wk' },
      { name: 'Steel erection crew', sub: 'Subcontractor · 6 ironworkers · 1,840 / 2,400 h', units: '6 × 10 h/d' },
      { name: 'Mobile crane 250 t', sub: 'Equipment · 1 unit · 28 / 40 d', units: '1 unit' },
      { name: 'Structural steel', sub: 'Material · 132 t installed', units: '184 t' },
    ]);
    expect([v.budget, v.actual, v.eac, v.eacLo]).toEqual(['€280k', '€210k', '€470k', true]);
    expect(v.bar).toEqual({ actualW: '53.6%', budgetW: '71.4%', eacW: '100%', over: true, overBy: 190 });
    // NEW-D2-2 (R-062): "— CR-008 pending approval" from the activity's links (the prototype's hard-coded "second crew (CR-008) pending approval").
    expect(v.costNote).toBe('Forecast +€190k over this package’s budget — CR-008 pending approval');
    expect(v.changes).toEqual([
      { id: 'CR-008', title: 'Steel erection acceleration — second crew', status: { label: 'In review', tone: 'accent' }, duration: '20d', href: '/projects/HLT-026/changes?cr=CR-008' },
    ]);
    // Once CR-008 is decided (no longer in review), the pending-change mention goes; the request stays listed.
    const decided = activityDrawerView(
      {
        act: activities.find((a) => a.id === 'A1250')!, activities, packages, owners, assignments: A1250_RES, todos, requests, deptHeads,
        changeLinks: [CR008('approved', { newDurationDays: 28, appliedAt: '2026-09-25T10:00:00Z', appliedFromDays: 20, durationDays: 28 })], taskHref: (x) => `/my/tasks/${x.id}`,
      },
      makeT('en'),
      'en',
    );
    expect(decided.costNote).toBe('Forecast +€190k over this package’s budget');
    expect(decided.changes.map((c) => [c.status.label, c.duration])).toEqual([['Approved', '20d → 28d · applied']]);
    const fr = activityDrawerView(
      {
        act: activities.find((a) => a.id === 'A1250')!, activities, packages, owners, assignments: A1250_RES, todos, requests, deptHeads,
        changeLinks: [CR008('in_review', { newDurationDays: 28 })], taskHref: (x) => `/my/tasks/${x.id}`,
      },
      makeT('fr'),
      'fr',
    );
    expect(fr.costNote).toMatch(/ — CR-008 en attente d’approbation$/);
    expect(fr.changes.map((c) => [c.status.label, c.duration])).toEqual([['En revue', '20 j → 28 j']]);
    expect(view('A1260', 'en').changes).toEqual([]);
  });

  it('to-dos and pending requests', () => {
    expect(v.todoCount).toBe('0 of 5 done');
    expect(v.todos.map((x) => [x.id, x.title, x.meta, x.done, x.initials, x.href])).toEqual([
      ['T-2314', 'Survey verticality — Bay 3 columns', 'Hélène · Today · In progress', false, 'HS', '/my/tasks/T-2314'],
      ['T-2318', 'Weld inspection report — Bay 3', 'Hélène · Thu 1 Oct · To do', false, 'HS', '/my/tasks/T-2318'],
      ['T-2305', 'Torque check — Bay 3 bolt groups', 'Julien · Today · In progress', false, 'JW', '/my/tasks/T-2305'],
      ['T-2320', 'Erection sequence — Bay 4 rafters', 'Julien · Tue 29 Sep · To do', false, 'JW', '/my/tasks/T-2320'],
      ['T-2325', 'CR-008 cost estimate — second crew', 'Léa · Tue 29 Sep · To do', false, 'LM', '/my/tasks/T-2325'],
    ]);
    expect(v.pending.map((x) => [x.id, x.meta])).toEqual([
      ['RQ-043', 'Contract structural engineer · awaiting Engineering approval — not yet in their list'],
      ['RQ-042', 'Hélène Sauvage · awaiting Quality approval — not yet in their list'],
      ['RQ-041', 'Julien Wagner · awaiting Engineering approval — not yet in their list'],
    ]);
    expect(v.noTodos).toBe(false);
  });
});

describe('activity drawer — other cases', () => {
  it('A1010 complete: office calendar, no predecessors, owner as lead, within budget', () => {
    const v = view('A1010', 'en');
    expect(v.status).toEqual({ label: 'Complete', className: 'tag tag-neutral' });
    expect(Object.fromEntries(v.general.map((g) => [g.k, g.v]))).toMatchObject({ Calendar: 'Standard 5d · 8h', 'Original / remaining': '45d / 0d', 'Total float': '— (complete)', 'Finish variance': '0d' });
    expect(v.preds).toEqual([{ id: '—', name: 'No predecessors', rel: '', tone: 'none' }]);
    expect(v.succs.map((x) => [x.id, x.rel])).toEqual([['A1020', 'FS'], ['A1230', 'FS +10d']]);
    expect(v.res).toEqual([{ name: 'Romain Aubert', sub: 'Project manager · lead · 360 / 360 h', units: '8 h/d' }]);
    expect(v.costNote).toBe('Tracking within budget');
    expect([v.todoCount, v.noTodos]).toEqual(['0 of 0 done', true]);
  });

  it('A1620 violated constraint, A1260 reschedule request', () => {
    const v = view('A1620', 'en');
    expect(v.general.find((g) => g.k === 'Constraint')).toEqual({ k: 'Constraint', v: 'FNLT 18 Dec', lo: true });
    expect(v.succs).toEqual([{ id: '—', name: 'No successors', rel: '', tone: 'none' }]);
    const r = view('A1260', 'en');
    expect(r.pending.map((x) => x.meta)).toEqual(['Fabien Bertrand · awaiting Controls & planning approval — not yet in their list']);
  });

  it('French', () => {
    const v = view('A1250', 'fr', A1250_RES);
    expect(v.status.label).toBe('En cours · 72%');
    expect(v.general.slice(0, 5).map((g) => [g.k, g.v])).toEqual([
      ['WBS', '1.4 Steel structure'],
      ['Type', 'Dépendante des tâches'],
      ['Calendrier', 'Chantier 6j · 10h'],
      ['Initiale / restante', '40 j / 11 j'],
      ['Début', '17 août A'],
    ]);
    expect(v.preds[0].rel).toBe('FS · pilotant');
    expect(v.res[0]).toEqual({ name: 'Julien Wagner', sub: 'Ingénieur structure · responsable · 296 / 400 h', units: '40 h/sem.' });
    // NEW-D2-2 (R-062): the requests in review touching the activity (the prototype's hard-coded « seconde équipe (CR-008) »).
    expect(v.costNote).toBe('Prévision +190 k€ au-dessus du budget de ce lot — CR-008 en attente d’approbation');
    expect(v.todoCount).toBe('0 sur 5 terminées');
    expect(v.todos[0].meta).toBe('Hélène · Aujourd’hui · En cours');
    expect(v.pending[0].meta).toBe('Contract structural engineer · en attente de validation Ingénierie — pas encore dans leur liste');
    expect(view('A1010', 'fr').status.label).toBe('Terminée');
    expect(v.general.find((g) => g.k === 'Contrainte')?.v).toBe('Aucune');
    expect(v.general.find((g) => g.k === 'Écart de fin')).toEqual({ k: 'Écart de fin', v: '-39 j', lo: true });
  });
});

describe('activity drawer — chapter 4 (S-1, S-2, S-3)', () => {
  const cals = [
    { code: 'standard_5x8', name: 'Standard 5d · 8h', hoursPerDay: 8 },
    { code: 'site_6x10', name: 'Chantier 6d · 10h', hoursPerDay: 10 },
    { code: 'continuous_24h', name: 'Continu 24h / 7d', hoursPerDay: 24 },
  ];
  const ch4 = (id: string, patch: Partial<PlanActivity>, extra: Partial<DrawerInput> = {}, lang: Lang = 'en') =>
    activityDrawerView(
      {
        act: { ...activities.find((a) => a.id === id)!, ...patch }, activities, packages, owners, assignments: [], todos, requests, deptHeads, changeLinks: [],
        taskHref: (x) => `/my/tasks/${x.id}`, calendars: cals, projectCalendar: 'standard_5x8', baselineCode: 'BL2', removableTodos: new Set(['T-2314']), ...extra,
      },
      makeT(lang),
      lang,
    );

  it('calendar: the project calendar unless overridden; resource hours follow it', () => {
    const v = ch4('A1410', {});
    expect(v.general.find((g) => g.key === 'calendar')).toEqual({ k: 'Calendar', v: 'Standard 5d · 8h', lo: false, key: 'calendar' });
    expect(v.calendar).toEqual({
      value: '',
      options: [
        { value: '', label: 'Project calendar · Standard 5d · 8h' }, { value: 'standard_5x8', label: 'Standard 5d · 8h' },
        { value: 'site_6x10', label: 'Chantier 6d · 10h' }, { value: 'continuous_24h', label: 'Continu 24h / 7d' },
      ],
    });
    expect(v.res[0].units).toBe('8 h/d');
    const site = ch4('A1410', { calendarCode: 'site_6x10' });
    expect([site.general.find((g) => g.key === 'calendar')!.v, site.calendar.value, site.res[0].units]).toEqual(['Chantier 6d · 10h', 'site_6x10', '6 × 10 h/d']);
    expect(ch4('A1410', { calendarCode: 'continuous_24h' }).res[0]).toMatchObject({ units: '24 h/d', sub: 'MEP lead · lead · 528 / 960 h' });
    expect(ch4('A1410', {}, {}, 'fr').calendar.options[0].label).toBe('Calendrier du projet · Standard 5j · 8h');
  });

  it('displayed baseline key, remaining duration entered, free float once scheduled', () => {
    const v = ch4('A1250', { scheduled: true, freeFloat: 0, remainingDays: 9 });
    const kv = Object.fromEntries(v.general.map((g) => [g.k, g.v]));
    expect(kv).toMatchObject({ 'BL2 finish': '31 Aug', 'Original / remaining': '40d / 9d', 'Free float': '0d' });
    expect(kv['BL1 finish']).toBeUndefined();
    expect(Object.keys(Object.fromEntries(ch4('A1250', {}).general.map((g) => [g.k, g.v])))).not.toContain('Free float');
    expect(ch4('A1250', {}, {}, 'fr').general.find((g) => g.k === 'Fin BL2')?.v).toBe('31 août');
  });

  it('driving predecessors come from the CPM once rescheduled (none when all are complete)', () => {
    expect(ch4('A1250', { scheduled: true, drivingPreds: [] }).preds.map((p) => [p.id, p.rel, p.tone])).toEqual([
      ['A1240', 'FS', 'normal'], ['A1220', 'FS +10d', 'normal'], ['A1230', 'FF +5d', 'normal'],
    ]);
    expect(ch4('A1250', { scheduled: true, drivingPreds: ['A1230'] }).preds.map((p) => p.tone)).toEqual(['normal', 'normal', 'driving']);
    expect(ch4('A1250', {}).preds[0].rel).toBe('FS · driving');
  });

  it('to-dos created from the drawer are removable', () => {
    const v = ch4('A1250', {});
    expect(v.todos.filter((x) => x.removable).map((x) => x.id)).toEqual(v.todos.some((x) => x.id === 'T-2314') ? ['T-2314'] : []);
  });
});
