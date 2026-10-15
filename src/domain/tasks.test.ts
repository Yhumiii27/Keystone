// Golden values of the My work / Task logic (docs/spec/00 §8.8, docs/spec/10 §6.4, §7.4, §9) on the prototype seed:
// the prototype's own code (design lines 3893–3896, 4058–4097) is ported verbatim below as the reference and
// compared with src/domain/tasks.ts for every person of TODOS, plus the literal figures quoted in the spec.
import { describe, expect, it } from 'vitest';
import { TODAY, dayDate, dayLabel } from '@/lib/format';
import { PROTO } from '@/server/prototype';
import {
  applyProgress, applyStatus, boardColumns, calendarBars, calendarDays, calendarStart, checklistCounts, checklistPct, dueBucket, dueText,
  dueTodayBadge, dueTone, floatText, hoursBar, hoursCellText, hoursText, initialPct, isCritical, logTimeTarget, nextWeekEnd,
  parseHours, plannedHours, sortByDue, spanText, toggleDone, todayColumn, workGroups, workKpis, workingDayOf,
  type TaskPriority, type TaskStatus, type WorkTask,
} from './tasks';

interface ProtoTodo {
  id: string; person: string; title: string; project: string; act: string; status: TaskStatus; prio: TaskPriority;
  start: number; due: number; est: number; logged: number; cl: [number, number]; labels: string[]; pct: number;
}
type Person = [string, string, number[]];

const TODOS = PROTO.TODOS as ProtoTodo[];
const PEOPLE = PROTO.PEOPLE as Person[];
const CHECKS = PROTO.CHECKS as Record<string, [string, number][]>;
const PERSONS = [...new Set(TODOS.map((t) => t.person))];

type Item = WorkTask & { id: string };
const toTask = (t: ProtoTodo): Item => ({ id: t.id, status: t.status, priority: t.prio, start: t.start, due: t.due, estimateH: t.est, loggedH: t.logged });
const mineOf = (person: string) => TODOS.filter((t) => t.person === person);
const ids = (xs: { id: string }[]) => xs.map((x) => x.id);

// ── Reference: the prototype's code, verbatim (only `this.state` replaced by the seed) ──────────────────
const LO = 'var(--color-accent-300)';
const OK = 'var(--color-text)';
const protoDueText = (t: ProtoTodo) => (t.status === 'done' ? 'Done' : t.due < TODAY ? 'Overdue · ' + dayLabel(t.due) : t.due === TODAY ? 'Today' : dayLabel(t.due));
const protoDueColor = (t: ProtoTodo) =>
  t.status === 'done' ? 'var(--color-neutral-500)' : t.due < TODAY ? LO : t.due === TODAY ? 'var(--color-accent-300)' : 'var(--color-neutral-400)';
function protoWork(person: string) {
  const pInfo = PEOPLE.find((p) => p[0] === person) || [person, 'Team member', [80, 80]];
  const mine = TODOS.filter((t) => t.person === person);
  const open = mine.filter((t) => t.status !== 'done');
  const logged = mine.reduce((a, t) => a + (t.start <= TODAY ? t.logged : 0), 0);
  const load = Math.round((pInfo[2][0] + pInfo[2][1]) / 2);
  const workKpis = [
    { label: 'Due today', value: open.filter((t) => t.due === TODAY).length, sub: dayLabel(TODAY), color: OK },
    { label: 'Overdue', value: open.filter((t) => t.due < TODAY).length, sub: 'Needs a new date or a push', color: open.some((t) => t.due < TODAY) ? LO : OK },
    { label: 'Next week', value: open.filter((t) => t.due > TODAY && t.due <= 9).length, sub: '28 Sep – 2 Oct', color: OK },
    { label: 'Logged this week', value: logged.toFixed(1) + ' h', sub: 'of 40 h · ' + Math.round((logged / 40) * 100) + '%', color: OK },
    { label: 'Load next 2 wks', value: load + '%', sub: load > 100 ? 'Over capacity — rebalance' : 'Within capacity', color: load > 100 ? LO : OK },
  ];
  const byDue = (a: ProtoTodo, b: ProtoTodo) => a.due - b.due || (a.prio === 'high' ? -1 : 1);
  const grp = (label: string, items: ProtoTodo[]) => ({ label, items: items.map((t) => t.id) });
  const workGroups = [
    grp('Overdue', open.filter((t) => t.due < TODAY).sort(byDue)),
    grp('Today', open.filter((t) => t.due === TODAY).sort(byDue)),
    grp('Next week', open.filter((t) => t.due > TODAY && t.due <= 9).sort(byDue)),
    grp('Later', open.filter((t) => t.due > 9).sort(byDue)),
    grp('Recently done', mine.filter((t) => t.status === 'done')),
  ].filter((g) => g.items.length);
  const boardCols = ['todo', 'doing', 'review', 'done'].map((s) => mine.filter((t) => t.status === s).sort(byDue).map((t) => t.id));
  const calDays = Array.from({ length: 10 }, (_, i) => {
    const d = dayDate(i);
    return { wd: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()], n: d.getDate(), today: i === TODAY };
  });
  const calRows = open
    .filter((t) => t.start <= 9 && t.due >= 0)
    .sort(byDue)
    .map((t) => {
      const l = Math.max(t.start, 0),
        r = Math.min(t.due, 9),
        late = t.due < TODAY;
      return { id: t.id, l: l * 10 + '%', w: (r - l + 1) * 10 + '%', tone: late ? 'late' : t.status === 'doing' ? 'doing' : 'idle' };
    });
  const calHours = Array.from({ length: 10 }, (_, i) => {
    const h = open.reduce((a, t) => a + (t.start <= i && t.due >= i ? t.est / (t.due - t.start + 1) : 0), 0);
    return { v: h ? h.toFixed(1) : '—', over: h > 8 };
  });
  return { workKpis, workGroups, boardCols, calDays, calRows, calHours, logTarget: (open[0] || mine[0]).id };
}
/** setTask from the status segment (4091) and the % segment (4098). */
const protoStatus = (t: { status: TaskStatus; pct: number }, v: TaskStatus) => ({ status: v, pct: v === 'done' ? 100 : t.pct === 100 ? 75 : t.pct });
const protoPct = (t: { status: TaskStatus; pct: number }, v: number) => ({
  pct: v,
  status: (v === 100 ? 'done' : (t.status === 'done' || t.status === 'todo') && v > 0 ? 'doing' : t.status) as TaskStatus,
});
const protoToggle = (x: { status: TaskStatus }) => ({ status: x.status === 'done' ? 'doing' : 'done', pct: x.status === 'done' ? 75 : 100 });
const groupKeyLabel = { overdue: 'Overdue', today: 'Today', next: 'Next week', later: 'Later', done: 'Recently done' } as const;
const pctStr = (f: number) => Math.round(f * 1000) / 10 + '%';

describe('My work — every person of TODOS against the prototype logic', () => {
  for (const person of PERSONS) {
    it(person, () => {
      const ref = protoWork(person);
      const mine = mineOf(person).map(toTask);
      const loads = PEOPLE.find((p) => p[0] === person)![2];
      const k = workKpis(mine, loads);
      expect([k.dueToday, k.overdue, k.nextWeek, k.loggedH.toFixed(1) + ' h', `of 40 h · ${k.loggedPct}%`, k.load + '%', k.overCapacity]).toEqual([
        ref.workKpis[0].value, ref.workKpis[1].value, ref.workKpis[2].value, ref.workKpis[3].value, ref.workKpis[3].sub, ref.workKpis[4].value,
        ref.workKpis[4].sub === 'Over capacity — rebalance',
      ]);
      expect(workGroups(mine).map((g) => ({ label: groupKeyLabel[g.key], items: ids(g.items) }))).toEqual(ref.workGroups);
      expect(boardColumns(mine).map((c) => ids(c.items))).toEqual(ref.boardCols);
      expect(calendarDays(calendarStart(0)).map((d) => ({ wd: d.weekday, n: d.day, today: d.isToday }))).toEqual(ref.calDays);
      expect(calendarBars(mine, 0).map((b) => ({ id: b.task.id, l: pctStr(b.left), w: pctStr(b.width), tone: b.tone }))).toEqual(ref.calRows);
      expect(plannedHours(mine, 0).map((h) => ({ v: hoursCellText(h.hours), over: h.over }))).toEqual(ref.calHours);
      expect(logTimeTarget(mineOf(person))!.id).toBe(ref.logTarget);
      for (const t of mineOf(person)) {
        expect(dueText(toTask(t))).toBe(protoDueText(t));
        expect({ done: 'var(--color-neutral-500)', overdue: LO, today: 'var(--color-accent-300)', normal: 'var(--color-neutral-400)' }[dueTone(toTask(t))]).toBe(protoDueColor(t));
        expect(hoursText(t.logged, t.est)).toBe(t.logged + '/' + t.est + ' h');
        expect(initialPct(t.status, t.logged, t.est)).toBe(t.pct);
      }
    });
  }
});

describe('My work — figures quoted in docs/spec/10 §6.4 (Hélène Sauvage, status date Fri 25 Sep)', () => {
  const mine = mineOf('Hélène Sauvage').map(toTask);
  it('KPIs 2 · 1 · 2 · 15.0 h (38 %) · 45 % within capacity', () => {
    const k = workKpis(mine, [40, 50, 60, 80, 90, 100, 110, 100]);
    expect(k).toEqual({ dueToday: 2, overdue: 1, nextWeek: 2, loggedH: 15, loggedPct: 38, load: 45, overCapacity: false });
    expect(dayLabel(TODAY)).toBe('Fri 25 Sep');
    expect(spanText(TODAY + 1, nextWeekEnd())).toBe('28 Sep – 2 Oct');
    expect(spanText(0, 9)).toBe('21 Sep – 2 Oct');
  });
  it('groups: Overdue T-2302 · Today T-2314, T-2311 · Next week T-2318, T-2331 · Later T-2335, T-2340 · Recently done T-2290', () => {
    expect(workGroups(mine).map((g) => [g.key, ids(g.items)])).toEqual([
      ['overdue', ['T-2302']], ['today', ['T-2314', 'T-2311']], ['next', ['T-2318', 'T-2331']], ['later', ['T-2335', 'T-2340']], ['done', ['T-2290']],
    ]);
    expect(dueTodayBadge(mine)).toBe('2');
  });
  it('calendar: 5 bars, today band at column 5, planned hours peak 6.5 h on Fri 25 Sep', () => {
    expect(calendarBars(mine, 0).map((b) => [b.task.id, b.left, b.width, b.tone])).toEqual([
      ['T-2302', 0.1, 0.2, 'late'], ['T-2314', 0.3, 0.2, 'doing'], ['T-2311', 0.2, 0.3, 'doing'], ['T-2318', 0.4, 0.5, 'idle'], ['T-2331', 0.6, 0.4, 'idle'],
    ]);
    expect(todayColumn(0)).toBe(4);
    expect(plannedHours(mine, 0).map((h) => hoursCellText(h.hours))).toEqual(['—', '2.0', '3.3', '5.3', '6.5', '1.2', '2.5', '2.5', '2.5', '1.3']);
  });
  it('member persona Julien Wagner: 1 due today, 1 overdue, 1 next week, 14.0 h (35 %), load 95 %', () => {
    const k = workKpis(mineOf('Julien Wagner').map(toTask), [90, 100, 130]);
    expect(k).toEqual({ dueToday: 1, overdue: 1, nextWeek: 1, loggedH: 14, loggedPct: 35, load: 95, overCapacity: false });
  });
  it('over capacity above 100 %; persons outside the pool have no load', () => {
    expect(workKpis([], [130, 125]).overCapacity).toBe(true);
    expect(workKpis([], [100, 100]).overCapacity).toBe(false);
    expect(workKpis([], null)).toMatchObject({ load: null, overCapacity: false, loggedH: 0, loggedPct: 0 });
  });
});

describe('calendar navigation (two-week window moved by whole weeks)', () => {
  const mine = mineOf('Hélène Sauvage').map(toTask);
  it('next window 28 Sep – 9 Oct: bars clipped to the window, today band in column 0', () => {
    const start = calendarStart(1);
    expect(spanText(start, start + 9)).toBe('28 Sep – 9 Oct');
    expect(todayColumn(start)).toBeNull();
    expect(calendarBars(mine, start).map((b) => [b.task.id, b.left, b.width])).toEqual([
      ['T-2318', 0, 0.4], ['T-2331', 0.1, 0.4], ['T-2335', 0.5, 0.4], ['T-2340', 0.7, 0.3],
    ]);
    expect(calendarDays(start)[0]).toEqual({ offset: 5, weekday: 'Mon', day: 28, isToday: false });
  });
  it('previous window 14 Sep – 25 Sep keeps the today band on the last column', () => {
    expect(spanText(calendarStart(-1), calendarStart(-1) + 9)).toBe('14 Sep – 25 Sep');
    expect(todayColumn(calendarStart(-1))).toBe(9);
    // Working days before 21 Sep (the prototype's `o % 5` gave Thu 10 Sep for −4 and Sun 13 Sep for −1).
    expect(calendarDays(calendarStart(-1)).map((d) => `${d.weekday} ${d.day}`)).toEqual([
      'Mon 14', 'Tue 15', 'Wed 16', 'Thu 17', 'Fri 18', 'Mon 21', 'Tue 22', 'Wed 23', 'Thu 24', 'Fri 25',
    ]);
    expect([-1, -5, -6].map(dayLabel)).toEqual(['Fri 18 Sep', 'Mon 14 Sep', 'Fri 11 Sep']);
    expect(dueText({ status: 'doing', due: -1 })).toBe('Overdue · Fri 18 Sep');
    const isoOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    for (let o = -12; o < 12; o++) expect(workingDayOf(isoOf(dayDate(o)))).toBe(o);
  });
});

describe('sorting', () => {
  it('byDue: due ascending, then high priority first; ties keep list order (the prototype comparator is asymmetric)', () => {
    const t = (id: string, due: number, priority: TaskPriority) => ({ id, due, priority });
    const xs = [t('a', 4, 'med'), t('b', 4, 'high'), t('c', 2, 'low'), t('d', 4, 'high'), t('e', 4, 'med')];
    expect(ids(sortByDue(xs))).toEqual(['c', 'b', 'd', 'a', 'e']);
    // Per person and per bucket (the only way the prototype sorts) the orders are identical — see the per-person tests.
  });
  it('buckets around the status date', () => {
    expect([3, 4, 5, 9, 10].map((d) => dueBucket(d))).toEqual(['overdue', 'today', 'next', 'next', 'later']);
    expect(nextWeekEnd(4)).toBe(9);
    expect(nextWeekEnd(5)).toBe(14);
  });
});

describe('status ⇄ percent coupling (10 §9)', () => {
  const states: { status: TaskStatus; pct: number }[] = [];
  for (const status of ['todo', 'doing', 'review', 'done'] as TaskStatus[]) for (const pct of [0, 25, 50, 75, 100]) states.push({ status, pct });

  it('status segment = prototype setTask for every state', () => {
    for (const s of states) for (const v of ['todo', 'doing', 'review', 'done'] as TaskStatus[]) expect(applyStatus(s, v)).toEqual(protoStatus(s, v));
    expect(applyStatus({ status: 'done', pct: 100 }, 'review')).toEqual({ status: 'review', pct: 75 });
    expect(applyStatus({ status: 'doing', pct: 50 }, 'done')).toEqual({ status: 'done', pct: 100 });
  });
  it('% segment = prototype setTask, except 0 % on a done task which becomes "To do"', () => {
    for (const s of states)
      for (const v of [0, 25, 50, 75, 100]) {
        const expected = s.status === 'done' && v === 0 ? { status: 'todo', pct: 0 } : protoPct(s, v);
        expect(applyProgress(s, v)).toEqual(expected);
      }
    expect(applyProgress({ status: 'todo', pct: 0 }, 25)).toEqual({ status: 'doing', pct: 25 });
    expect(applyProgress({ status: 'review', pct: 75 }, 50)).toEqual({ status: 'review', pct: 50 });
    expect(applyProgress({ status: 'doing', pct: 75 }, 140)).toEqual({ status: 'done', pct: 100 });
  });
  it('list toggle done ↔ in progress (100 % ↔ 75 %)', () => {
    for (const s of states) expect(toggleDone(s)).toEqual(protoToggle(s));
  });
});

describe('task sheet (10 §7.4, T-2314 Survey verticality — Bay 3 columns)', () => {
  it('checklist 2 of 4 done (50 %); tasks without items keep their stored counts ("0 of 3")', () => {
    const c = checklistCounts(CHECKS['T-2314'].map((x) => !!x[1]), { done: 2, total: 4 });
    expect(c).toEqual({ done: 2, total: 4 });
    expect(checklistPct(c)).toBe(50);
    expect(checklistCounts(CHECKS['T-2318'].map((x) => !!x[1]), { done: 0, total: 3 })).toEqual({ done: 0, total: 3 });
    expect(checklistCounts([], { done: 0, total: 3 })).toEqual({ done: 0, total: 3 });
    expect(checklistPct({ done: 0, total: 0 })).toBe(0);
  });
  // The cost note (6.0 h × rate) is valued at the dated rates since R-083 (src/features/mywork/model.ts `costNote`).
  it('time 6.0 / 8 h (75 % bar); over-estimate bar is LO and capped', () => {
    expect(hoursBar(6, 8)).toEqual({ share: 0.75, over: false });
    expect(hoursBar(4.5, 4)).toEqual({ share: 1, over: true });
    expect(hoursBar(0, 0)).toEqual({ share: 0, over: false });
  });
  it('plan card: float "-27d" critical while open; "— (complete)" for finished activities', () => {
    expect(floatText(-27)).toBe('-27d');
    expect(floatText(20)).toBe('+20d');
    expect(floatText(0)).toBe('0d');
    expect(floatText(null)).toBe('— (complete)');
    expect(isCritical(-27, 'doing')).toBe(true);
    expect(isCritical(-27, 'done')).toBe(false);
    expect(isCritical(null, 'doing')).toBe(false);
  });
  it('log form hours: positive, ≤ 24, comma decimals', () => {
    expect(['2.5', '2,5', '.5', ' 3 ', 8].map(parseHours)).toEqual([2.5, 2.5, 0.5, 3, 8]);
    expect(['', '0', '-2', 'abc', '25', '1e2', '2.5h', null].map(parseHours)).toEqual([null, null, null, null, null, null, null, null]);
  });
});

describe('working-day axis', () => {
  it('ISO dates ↔ offsets; weekend dates round to the next Monday (start) or previous Friday (due)', () => {
    expect(['2026-09-21', '2026-09-25', '2026-09-28', '2026-10-02', '2026-10-09', '2026-09-14'].map((d) => workingDayOf(d))).toEqual([0, 4, 5, 9, 14, -5]);
    expect(workingDayOf('2026-09-26', 'up')).toBe(5);
    expect(workingDayOf('2026-09-27', 'down')).toBe(4);
    expect(workingDayOf('2026-09-19', 'down')).toBe(-1);
  });
});
