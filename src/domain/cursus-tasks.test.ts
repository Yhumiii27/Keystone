// R-180 — Keystone's planned tasks as Cursus's `PUT /v1/instantane` section `taches` (Cursus docs/API-KEYSTONE.md « Tâches
// planifiées »): the day rules (the share view pub_taches_jours for Keystone tasks, the schedule's working calendar for the named
// assignments), the precedence of an assignment over the to-dos of its person on the same activity, what is left out, and how
// Cursus's refusals are read.
import { describe, expect, it } from 'vitest';
import {
  CURSUS_DAY_HOURS_MAX, assignmentDailyHours, cursusSnapshotSince, cursusTaskSnapshot, isRetryableCursusStatus, jsonBytes, refusedTaskIndexes, taskDailyHours,
  type AssignmentFact, type TaskFact,
} from './cursus-tasks';

const weekdays = { isWorkDay: (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay() % 6 !== 0 };
const sixDays = { isWorkDay: (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay() !== 0 };
const HLT = { code: 'HLT-026', name: 'Harbor Line Terminal Expansion', open: true };

const task = (over: Partial<TaskFact> = {}): TaskFact => ({
  number: 'T-2320', title: 'Erection sequence — Bay 4 rafters', project: HLT, activityId: 'act-1250', personId: 'p-wagner', matricule: 'EMP-0018',
  start: '2026-09-25', due: '2026-09-29', estimateH: 6, ...over,
});
const asg = (over: Partial<AssignmentFact> = {}): AssignmentFact => ({
  id: '0b9d7c1e-2f4a-4d3b-9a61-3c5e8f7a1b20', project: HLT, activityId: 'act-1320', activityCode: 'A1320', activityName: 'Crane delivery & erection', personId: 'p-wagner',
  matricule: 'EMP-0018', external: false, start: '2026-10-12', finish: '2026-10-16', durationDays: 5, units: 1, hoursPerDay: 8, plannedHours: 40, calendar: weekdays, ...over,
});

describe('day rules', () => {
  it('a Keystone task: the estimate over its weekdays, 2 decimals (pub_taches_jours)', () => {
    // Fri 25 → Tue 29 Sep 2026: Fri, Mon, Tue — the weekend gets nothing.
    expect(taskDailyHours('2026-09-25', '2026-09-29', 6)).toEqual({ '2026-09-25': 2, '2026-09-28': 2, '2026-09-29': 2 });
    expect(taskDailyHours('2026-09-23', '2026-09-25', 10)).toEqual({ '2026-09-23': 3.33, '2026-09-24': 3.33, '2026-09-25': 3.33 });
    // One day, no weekday, no estimate, due before start: nothing (the view has no row either).
    expect(taskDailyHours('2026-09-25', '2026-09-25', 3)).toEqual({ '2026-09-25': 3 });
    expect(taskDailyHours('2026-09-26', '2026-09-27', 8)).toEqual({});
    expect(taskDailyHours('2026-09-25', '2026-09-29', 0)).toEqual({});
    expect(taskDailyHours('2026-09-29', '2026-09-25', 6)).toEqual({});
    // 60 h on two days: Cursus's 24 h a day at most.
    expect(taskDailyHours('2026-09-28', '2026-09-29', 60)).toEqual({ '2026-09-28': CURSUS_DAY_HOURS_MAX, '2026-09-29': CURSUS_DAY_HOURS_MAX });
  });

  it('a schedule assignment: units × h/d on each working day of its calendar, else the planned hours spread', () => {
    expect(assignmentDailyHours(asg())).toEqual({ '2026-10-12': 8, '2026-10-13': 8, '2026-10-14': 8, '2026-10-15': 8, '2026-10-16': 8 });
    // A 6-day site calendar: Saturday is a working day (Cursus proposes weekend days like the others).
    expect(Object.keys(assignmentDailyHours(asg({ finish: '2026-10-18', calendar: sixDays })))).toEqual(
      ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17'],
    );
    // No rate: 15 h over 3 weeks of weekdays (15 days) → 1 h a day; 10 h over 3 days → 3.33.
    expect(Object.values(assignmentDailyHours(asg({ finish: '2026-10-30', units: null, hoursPerDay: null, plannedHours: 15 })))).toEqual(Array(15).fill(1));
    expect(assignmentDailyHours(asg({ finish: '2026-10-14', units: null, hoursPerDay: null, plannedHours: 10 }))).toEqual({ '2026-10-12': 3.33, '2026-10-13': 3.33, '2026-10-14': 3.33 });
    // Equipment / material (no hours), undated: nothing.
    expect(assignmentDailyHours(asg({ units: 2, hoursPerDay: null, plannedHours: null }))).toEqual({});
    expect(assignmentDailyHours(asg({ start: null }))).toEqual({});
  });

  it('the snapshot covers the timesheets of the last 4 weeks: depuis = the Monday 4 weeks before this week', () => {
    expect(cursusSnapshotSince('2026-09-25')).toBe('2026-08-24');
    expect(cursusSnapshotSince('2026-09-21')).toBe('2026-08-24');
    expect(cursusSnapshotSince('2026-09-27')).toBe('2026-08-24');
  });
});

describe('cursusTaskSnapshot', () => {
  const since = '2026-08-24';

  it('one Cursus task per assignment and per Keystone task, with the projects they cite, ordered by id', () => {
    const s = cursusTaskSnapshot({ tasks: [task()], assignments: [asg()], since });
    expect(s.projets).toEqual([{ code: 'HLT-026', nom: 'Harbor Line Terminal Expansion' }]);
    expect(s.taches).toEqual([
      {
        id: 'KA-0b9d7c1e-2f4a-4d3b-9a61-3c5e8f7a1b20', projet: 'HLT-026', tache: 'A1320 · Crane delivery & erection', matricule: 'EMP-0018', debut: '2026-10-12',
        fin: '2026-10-16', heures: { '2026-10-12': 8, '2026-10-13': 8, '2026-10-14': 8, '2026-10-15': 8, '2026-10-16': 8 },
      },
      {
        id: 'KT-T-2320', projet: 'HLT-026', tache: 'T-2320 · Erection sequence — Bay 4 rafters', matricule: 'EMP-0018', debut: '2026-09-25', fin: '2026-09-29',
        heures: { '2026-09-25': 2, '2026-09-28': 2, '2026-09-29': 2 },
      },
    ]);
    expect(s.depuis).toBe(since);
    expect(Object.values(s.skipped).every((n) => n === 0)).toBe(true);
  });

  it('a to-do inside an assignment of its person on the same activity is covered by the assignment (no double hours)', () => {
    const s = cursusTaskSnapshot({ tasks: [task({ activityId: 'act-1320' }), task({ number: 'T-2305', personId: 'p-roux', matricule: 'EMP-0007', activityId: 'act-1320' })], assignments: [asg()], since });
    // Wagner's task is covered; Roux is not assigned on A1320: his task is sent.
    expect(s.taches.map((t) => t.id)).toEqual(['KA-0b9d7c1e-2f4a-4d3b-9a61-3c5e8f7a1b20', 'KT-T-2305']);
  });

  it('left out: no matricule, closed project, no hours, ended before depuis, external labour, milestones, invalid ids', () => {
    const closed = { code: 'DRR-009', name: 'Depot Roof Replacement', open: false };
    const s = cursusTaskSnapshot({
      tasks: [
        task({ number: 'T-1', matricule: null }), task({ number: 'T-2', personId: 'p-2', matricule: '  ' }), task({ number: 'T-3', project: closed }),
        task({ number: 'T-4', estimateH: 0 }), task({ number: 'T-5', start: '2026-08-03', due: '2026-08-21' }), task({ number: 'T 6 bad' }),
        task({ number: 'T-7', personId: null, matricule: null }),
      ],
      assignments: [asg({ id: 'x1', external: true }), asg({ id: 'x2', durationDays: 0 }), asg({ id: 'x3', start: null })],
      since,
    });
    expect(s.taches).toEqual([]);
    expect(s.projets).toEqual([]);
    expect(s.skipped).toEqual({ no_matricule: 2, closed_project: 1, no_hours: 2, before_since: 1, invalid: 1 });
    expect(s.personsWithoutMatricule).toBe(2);
  });

  it('labels and names are cut to Cursus\'s lengths (160 / 120), white space folded', () => {
    const s = cursusTaskSnapshot({ tasks: [task({ title: `  Long\n${'x'.repeat(300)}`, project: { ...HLT, name: 'N'.repeat(200) } })], assignments: [], since });
    expect(s.taches[0].tache).toHaveLength(160);
    expect(s.taches[0].tache.startsWith('T-2320 · Long x')).toBe(true);
    expect(s.taches[0].tache.endsWith('…')).toBe(true);
    expect(s.projets[0].nom).toHaveLength(120);
  });

  it('a reassigned task keeps its id (Cursus updates it); a person switched to another matricule too', () => {
    const before = cursusTaskSnapshot({ tasks: [task()], assignments: [], since }).taches[0];
    const after = cursusTaskSnapshot({ tasks: [task({ personId: 'p-roux', matricule: 'EMP-0007' })], assignments: [], since }).taches[0];
    expect([before.id, after.id, before.matricule, after.matricule]).toEqual(['KT-T-2320', 'KT-T-2320', 'EMP-0018', 'EMP-0007']);
  });
});

describe('Cursus answers', () => {
  it('retryable: no answer, 401 (key change), 408, 429, 5xx; final: other 4xx', () => {
    expect([null, 401, 408, 429, 500, 503].map(isRetryableCursusStatus)).toEqual([true, true, true, true, true, true]);
    expect([400, 403, 404, 413, 415].map(isRetryableCursusStatus)).toEqual([false, false, false, false, false]);
  });

  it('a 400 VALIDATION naming tasks gives their indexes; any other refused field refuses the snapshot as a whole', () => {
    const body = (champs: string[]) => ({ error: 'Données invalides', code: 'VALIDATION', details: champs.map((champ) => ({ champ, message: 'Matricule inconnu de Cursus' })) });
    expect(refusedTaskIndexes(body(['taches[3].matricule', 'taches[0].projet', 'taches[3].heures.2026-10-12']))).toEqual([0, 3]);
    expect(refusedTaskIndexes(body(['depuis']))).toBeNull();
    expect(refusedTaskIndexes(body(['taches[1].matricule', 'corps']))).toBeNull();
    expect(refusedTaskIndexes({ error: 'x' })).toBeNull();
    expect(refusedTaskIndexes(null)).toBeNull();
  });

  it('body size in UTF-8 bytes', () => {
    expect(jsonBytes({ a: 'é' })).toBe(10);
  });
});
