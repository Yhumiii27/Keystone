// Golden values of the Plan — WBS & activities screen (docs/spec/05 §2.4) + an oracle: the prototype's
// planRows / planKpis logic (design lines 3988–4046) transcribed verbatim and run on the 6 projects with data.
import { describe, expect, it } from 'vitest';
import { PROTO, PROTO_GEN } from '@/server/prototype';
import { isoOfDemoDate, splitActual } from '@/server/db/codes';
import { money } from '@/lib/format';
import {
  DEFAULT_COLLAPSED, PROGRESS_STATUS, applyBudget, buildPlanRows, clampPct, costBar, createsCycle, drawerStatus, dueText,
  durationText, effectiveFloat, floatText, isSiteCalendar, moveWithin, nextActivityCode, nextWorkPackageCode, ownerResource,
  parseDuration, parsePredecessors, predsInput, predsLabel, progressKpis, relText, rollUp, structureKpis, successorsOf,
  varianceText, visibleRows, workingDaysBetween, type LinkType, type PlanActivity, type PlanPackage, type PlanRoot,
} from './schedule';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Proto = any;
const f = (k: number) => money(k, 'en');

/** Prototype ACTS → the plan's inputs (what the DAL returns). */
function inputsOf(code: string) {
  const pd = PROTO_GEN.projectData[code];
  const acts = pd.ACTS as Proto[];
  const r = acts[0];
  const root: PlanRoot = { code: r.w, name: r.n, start: r.s, finish: r.f, baselineFinish: r.bl, totalFloat: r.tf };
  const packages: PlanPackage[] = acts.filter((a) => !a.id && a.lv === 1).map((a) => ({ code: a.w, name: a.n }));
  const activities: PlanActivity[] = acts.filter((a) => a.id).map((a) => {
    const s = splitActual(a.s);
    const fi = splitActual(a.f);
    return {
      id: a.id, wbs: a.w, name: a.n, durationDays: a.d, start: s.text, startActual: s.actual, finish: fi.text, finishActual: fi.actual,
      startDate: isoOfDemoDate(s.text), baselineFinish: a.bl, variance: a.v, constraint: a.c, violated: !!a.viol, totalFloat: a.tf,
      pct: a.pc, owner: a.o, budget: a.b[0], actual: a.b[1], eac: a.b[2], preds: a.p,
    };
  });
  const todos = (PROTO.TODOS as Proto[]).filter((t) => t.project === pd.p3);
  const todosOf = (id: string) => {
    const l = (PROTO.TODOS as Proto[]).filter((t) => t.act === id);
    return { done: l.filter((t) => t.status === 'done').length, total: l.length };
  };
  return {
    pd, root, packages, activities, todosOf,
    projectTodos: { done: todos.filter((t) => t.status === 'done').length, total: todos.length },
  };
}

// ── Oracle: prototype logic 3988–4046 without overrides (wbsOv/wbsRm/wbsOrd/added empty) ─────────────
function oracle(code: string) {
  const PD = PROTO_GEN.projectData[code];
  const ACTS = PD.ACTS as Proto[];
  const LO = 'LO';
  const applyOv = (x: Proto) => ({ ...x, tf: x.pc === 100 ? null : x.tf == null ? 10 : x.tf });
  const ACTS_P: Proto[] = [ACTS[0]];
  for (const h of ACTS.filter((x) => !x.id && x.lv === 1)) {
    ACTS_P.push(h);
    ACTS.filter((x) => x.id && x.w === h.w).map(applyOv).forEach((x) => ACTS_P.push(x));
  }
  const todosOf = (id: string) => (PROTO.TODOS as Proto[]).filter((t) => t.act === id);
  const kids = (w: string) => ACTS_P.filter((a) => a.id && a.w === w);
  const roll = (w: string) => {
    const k = kids(w);
    if (!k.length) return { s: '—', f: '—', bl: '—', pct: 0, tf: null, td: 0, tdd: 0, v: null, bud: 0, n: 0 };
    const tb = k.reduce((a, x) => a + x.b[0], 0) || 1;
    const un = k.filter((x) => x.pc < 100);
    return {
      s: k[0].s, f: k[k.length - 1].f, bl: k[k.length - 1].bl, pct: Math.round(k.reduce((a, x) => a + x.b[0] * x.pc, 0) / tb),
      tf: un.length ? Math.min(...un.map((x) => (x.tf == null ? 0 : x.tf))) : null,
      td: k.reduce((a, x) => a + todosOf(x.id).length, 0), tdd: k.reduce((a, x) => a + todosOf(x.id).filter((t) => t.status === 'done').length, 0),
      v: null, bud: tb, n: k.length,
    };
  };
  const rows = ACTS_P.map((a) => {
    const isSum = !a.id;
    const r: Proto = isSum
      ? a.lv === 0
        ? {
            s: a.s, f: a.f, bl: a.bl, pct: PD.pct, tf: a.tf,
            td: (PROTO.TODOS as Proto[]).filter((t) => t.project === PD.p3).length,
            tdd: (PROTO.TODOS as Proto[]).filter((t) => t.project === PD.p3 && t.status === 'done').length,
            v: PD.floatDays, bud: ACTS_P.filter((x) => x.id).reduce((s, x) => s + x.b[0], 0), n: ACTS_P.filter((x) => x.id).length,
          }
        : roll(a.w)
      : a;
    const td = isSum ? r.td : todosOf(a.id).length;
    const tdd = isSum ? r.tdd : todosOf(a.id).filter((t) => t.status === 'done').length;
    const tf = isSum ? r.tf : a.tf;
    const pcv = isSum ? r.pct : a.pc;
    const vv = isSum ? r.v : a.v;
    const behind = tf != null && tf < 0 && pcv < 100;
    return {
      id: isSum ? a.w : a.id, critical: behind,
      dur: isSum ? (r.n ? r.n + ' act.' : '—') : a.d + 'd', start: isSum ? r.s : a.s, finish: isSum ? r.f : a.f, bl: isSum ? r.bl : a.bl,
      var: vv == null ? '' : vv + 'd', varColor: vv < 0 ? LO : 'N4',
      preds: isSum ? '' : a.p.map(([id, t, l]: Proto) => id + ' ' + t + (l ? (l > 0 ? '+' : '') + l + 'd' : '')).join(', ') || '—',
      predsText: isSum ? '' : a.p.map(([id, t, l]: Proto) => id + ' ' + t + (l ? (l > 0 ? '+' : '') + l : '')).join(', '),
      cons: isSum ? '' : a.c || '—',
      tf: tf == null ? '—' : (tf > 0 ? '+' : '') + tf + 'd', tfColor: tf != null && tf < 0 ? LO : 'N3',
      pct: pcv + '%',
      barColor: pcv === 100 ? 'N5' : behind ? LO : 'A',
      todos: td ? tdd + '/' + td : '',
      statusText: pcv === 100 ? 'Completed' : behind ? 'Behind' : pcv > 0 ? 'In progress' : 'Not started',
      statusClass: pcv === 100 ? 'tag tag-neutral' : behind ? 'tag tag-accent' : pcv > 0 ? 'tag tag-outline' : 'text-muted',
      budget: isSum ? (r.bud ? f(r.bud) : '—') : String(a.b[0]),
    };
  });
  const acts = ACTS_P.filter((a) => a.id);
  const relCount = (t: string) => acts.reduce((a, x) => a + x.p.filter((p: Proto) => p[1] === t).length, 0);
  const actDone = acts.filter((a) => a.pc === 100);
  const actBehind = acts.filter((a) => a.tf != null && a.tf < 0 && a.pc < 100);
  const totBud = acts.reduce((s, a) => s + a.b[0], 0) || 1;
  const structure = [
    ['Work packages', ACTS_P.filter((a) => !a.id && a.lv === 1).length, acts.length + ' activities · ' + f(acts.reduce((s, a) => s + a.b[0], 0))],
    ['Activities', acts.length, actBehind.length + ' on the critical path'],
    ['Relationships', acts.reduce((a, x) => a + x.p.length, 0), 'FS ' + relCount('FS') + ' · SS ' + relCount('SS') + ' · FF ' + relCount('FF')],
    ['Constraints', acts.filter((a) => a.c).length, acts.filter((a) => a.viol).length + ' violated'],
  ];
  const progress = [
    ['Overall progress', Math.round(acts.reduce((s, a) => s + a.b[0] * a.pc, 0) / totBud) + ' %'],
    ['Completed', actDone.length + ' / ' + acts.length, f(actDone.reduce((s, a) => s + a.b[0], 0)) + ' earned'],
    ['In progress', acts.filter((a) => a.pc > 0 && a.pc < 100).length, actBehind.length + ' behind schedule'],
    ['Not started', acts.filter((a) => a.pc === 0).length],
  ];
  return { rows, structure, progress };
}

/** Our row model, rendered to the prototype's strings. */
function ours(code: string) {
  const i = inputsOf(code);
  const rows = buildPlanRows({ root: i.root, rootPct: i.pd.pct, floatDays: i.pd.floatDays, packages: i.packages, activities: i.activities, todosOf: i.todosOf, projectTodos: i.projectTodos });
  const st = structureKpis(i.packages.length, i.activities);
  const pk = progressKpis(i.activities);
  return {
    rows: rows.map((r) => ({
      id: r.id, critical: r.behind,
      dur: r.kind === 'act' ? r.act!.durationDays + 'd' : r.count ? r.count + ' act.' : '—',
      start: r.start, finish: r.finish, bl: r.baselineFinish,
      var: varianceText(r.variance), varColor: (r.variance ?? 0) < 0 ? 'LO' : 'N4',
      preds: r.act ? predsLabel(r.act.preds) : '', predsText: r.act ? predsInput(r.act.preds) : '',
      cons: r.act ? r.act.constraint || '—' : '',
      tf: floatText(r.tf), tfColor: r.tf != null && r.tf < 0 ? 'LO' : 'N3',
      pct: r.pct + '%',
      barColor: r.bar === 'done' ? 'N5' : r.bar === 'behind' ? 'LO' : 'A',
      todos: r.todos.total ? r.todos.done + '/' + r.todos.total : '',
      statusText: PROGRESS_STATUS[r.status].label, statusClass: PROGRESS_STATUS[r.status].className,
      budget: r.kind === 'act' ? String(r.budget) : r.budget ? f(r.budget) : '—',
    })),
    structure: [
      ['Work packages', st.workPackages, st.activities + ' activities · ' + f(st.budget)],
      ['Activities', st.activities, st.behind + ' on the critical path'],
      ['Relationships', st.relationships, `FS ${st.byType.FS} · SS ${st.byType.SS} · FF ${st.byType.FF}`],
      ['Constraints', st.constraints, st.violated + ' violated'],
    ],
    progress: [
      ['Overall progress', pk.overall + ' %'],
      ['Completed', pk.done + ' / ' + pk.total, f(pk.earned) + ' earned'],
      ['In progress', pk.running, pk.behind + ' behind schedule'],
      ['Not started', pk.notStarted],
    ],
  };
}

const CODES = Object.keys(PROTO_GEN.projectData);

describe('plan row model and KPIs — oracle (prototype logic) on the 6 projects with data', () => {
  it.each(CODES)('%s rows', (code) => {
    expect(ours(code).rows).toEqual(oracle(code).rows);
  });
  it.each(CODES)('%s KPIs', (code) => {
    const o = ours(code);
    const p = oracle(code);
    expect(o.structure).toEqual(p.structure);
    expect(o.progress).toEqual(p.progress);
  });
});

describe('HLT-026 golden values (docs/spec/05 §2.4)', () => {
  const i = inputsOf('HLT-026');
  const rows = buildPlanRows({ root: i.root, rootPct: 64, floatDays: -27, packages: i.packages, activities: i.activities, todosOf: i.todosOf, projectTodos: i.projectTodos });

  it('structure KPIs', () => {
    const k = structureKpis(i.packages.length, i.activities);
    expect(k).toEqual({ workPackages: 8, activities: 21, budget: 4650, behind: 5, relationships: 30, byType: { FS: 25, SS: 3, FF: 2, SF: 0 }, constraints: 4, violated: 1 });
    expect(f(k.budget)).toBe('€4.65M');
  });

  it('progress KPIs', () => {
    const k = progressKpis(i.activities);
    expect(k).toEqual({ overall: 63, done: 10, total: 21, earned: 2520, running: 3, behind: 5, notStarted: 8, nextStart: { id: 'A1260', start: '05 Oct' } });
  });

  it('next start sorts by real start date (NDC-031: A3330 · 24 Sep before A3240 · 9 Oct)', () => {
    expect(progressKpis(inputsOf('NDC-031').activities).nextStart).toEqual({ id: 'A3330', start: '24 Sep' });
  });

  it('root row', () => {
    expect(rows[0]).toMatchObject({ kind: 'root', id: '1', start: '05 Jan', finish: '14 Jan ’27', baselineFinish: '18 Dec', tf: -27, pct: 64, variance: -27, budget: 4650, count: 21, behind: true, status: 'behind', todos: { done: 2, total: 25 } });
  });

  it('work package 1.4 roll-up', () => {
    const r = rollUp(i.activities.filter((a) => a.wbs === '1.4'));
    expect(r).toEqual({ start: '18 May A', finish: '06 Nov', baselineFinish: '25 Sep', pct: 82, tf: -27, budget: 1025, count: 4 });
    expect(rows.find((x) => x.id === '1.4')).toMatchObject({ indent: 18, status: 'behind', bar: 'behind', todos: { done: 1, total: 10 } });
  });

  it('empty work package', () => {
    expect(rollUp([])).toEqual({ start: '—', finish: '—', baselineFinish: '—', pct: 0, tf: null, budget: 0, count: 0 });
  });

  it('A1250 row', () => {
    const a = rows.find((x) => x.id === 'A1250')!;
    expect(a).toMatchObject({ indent: 36, start: '17 Aug A', finish: '09 Oct', baselineFinish: '31 Aug', variance: -39, tf: -27, pct: 72, status: 'behind', bar: 'behind', todos: { done: 0, total: 5 } });
    expect(predsLabel(a.act!.preds)).toBe('A1240 FS, A1220 FS+10d, A1230 FF+5d');
    expect(predsInput(a.act!.preds)).toBe('A1240 FS, A1220 FS+10, A1230 FF+5');
  });

  it('collapse (default 1.1–1.3 collapsed)', () => {
    const v = visibleRows(rows, { ...DEFAULT_COLLAPSED });
    expect(v.length).toBe(1 + 8 + 21 - (2 + 3 + 2));
    expect(v.filter((r) => r.kind === 'act')[0].id).toBe('A1230');
  });
});

describe('row derivations', () => {
  it('float, variance and status', () => {
    expect([floatText(null), floatText(20), floatText(-27), floatText(0)]).toEqual(['—', '+20d', '-27d', '0d']);
    expect([varianceText(null), varianceText(0), varianceText(-39)]).toEqual(['', '0d', '-39d']);
    expect(effectiveFloat({ pct: 100, totalFloat: -27 })).toBeNull();
    expect(effectiveFloat({ pct: 50, totalFloat: null })).toBe(10);
    expect(effectiveFloat({ pct: 0, totalFloat: -27 })).toBe(-27);
    expect(clampPct('140')).toBe(100);
    expect(clampPct('abc')).toBe(0);
    expect(clampPct('-5')).toBe(0);
  });
  it('drawer status (labels/classes differ from the table)', () => {
    expect(drawerStatus(100)).toEqual({ label: 'Complete', className: 'tag tag-neutral' });
    // X-13b / R-154: same classes as the table (the prototype inverted them, 02 Q-6).
    expect(drawerStatus(72)).toEqual({ label: 'In progress · 72%', className: 'tag tag-outline' });
    expect(drawerStatus(0)).toEqual({ label: 'Not started', className: 'text-muted' });
  });
  it('relationship text', () => {
    expect([relText('FS', 0), relText('FS', 10), relText('FS', -5), relText('FF', 5)]).toEqual(['FS', 'FS +10d', 'FS -5d', 'FF +5d']);
  });
});

describe('activity drawer — A1250', () => {
  const i = inputsOf('HLT-026');
  const a = i.activities.find((x) => x.id === 'A1250')!;

  it('general', () => {
    expect(isSiteCalendar(a)).toBe(true);
    expect(isSiteCalendar(i.activities.find((x) => x.id === 'A1230')!)).toBe(false);
    expect(isSiteCalendar(i.activities.find((x) => x.id === 'A1020')!)).toBe(false);
    expect(durationText(a.durationDays, a.pct)).toBe('40d / 11d');
  });

  it('successors', () => {
    const s = successorsOf('A1250', i.activities).map((x) => [x.act.id, relText(x.type, x.lag), effectiveFloat(x.act)]);
    expect(s).toEqual([['A1260', 'FS -5d', -27], ['A1320', 'FS', 20], ['A1420', 'FS +5d', 10]]);
  });

  it('cost bar and note', () => {
    expect(costBar(280, 210, 470)).toEqual({ actualW: '53.6%', budgetW: '71.4%', eacW: '100%', over: true, overBy: 190 });
    expect(money(190, 'en', { signed: true })).toBe('+€190k');
    expect(costBar(210, 208, 208).over).toBe(false);
    expect(costBar(0, 0, 0)).toMatchObject({ actualW: '0%', eacW: '0%' });
  });

  it('default resource line', () => {
    const l1410 = i.activities.find((x) => x.id === 'A1410')!;
    expect(ownerResource('Pauline Noguès', 'MEP lead', l1410.durationDays, l1410.pct, true)).toEqual({ name: 'Pauline Noguès', sub: 'MEP lead · lead · 176 / 320 h', units: '6 × 10 h/d' });
    expect(ownerResource('Romain Aubert', 'Project manager', 45, 100, false).units).toBe('8 h/d');
  });

  it('to-do due texts (TODAY = 4, Fri 25 Sep)', () => {
    expect(dueText('doing', 4, 4)).toBe('Today');
    expect(dueText('todo', 8, 4)).toBe('Thu 1 Oct');
    expect(dueText('review', 1, 4)).toBe('Overdue · Tue 22 Sep');
    expect(dueText('done', 1, 4)).toBe('Done');
  });
});

describe('predecessor syntax and validation', () => {
  const ids = new Set(inputsOf('HLT-026').activities.map((a) => a.id));
  it('parses the documented forms', () => {
    expect(parsePredecessors('A1010 FS+5, a1020 ss, A1230 FF 5d, A1240', ids)).toEqual({
      links: [['A1010', 'FS', 5], ['A1020', 'SS', 0], ['A1230', 'FF', 5], ['A1240', 'FS', 0]], errors: [],
    });
    expect(parsePredecessors('A1250 FS-5', ids).links).toEqual([['A1250', 'FS', -5]]);
    expect(parsePredecessors('', ids)).toEqual({ links: [], errors: [] });
  });
  it('reports unknown ids, bad syntax, self-links and duplicates', () => {
    const r = parsePredecessors('A9999, foo, A1250, A1010, A1010 SS', ids, 'A1250');
    expect(r.links).toEqual([['A1010', 'FS', 0]]);
    expect(r.errors.map((e) => e.reason)).toEqual(['unknown', 'syntax', 'self', 'duplicate']);
  });
  it('round-trips the input text', () => {
    for (const a of inputsOf('HLT-026').activities) expect(parsePredecessors(predsInput(a.preds), ids).links).toEqual(a.preds);
  });
  it('detects logic loops', () => {
    const acts = inputsOf('HLT-026').activities;
    const predsOf = (id: string) => acts.find((a) => a.id === id)?.preds.map((p) => p[0]) ?? [];
    expect(createsCycle('A1010', ['A1260'], predsOf)).toBe('A1260');
    expect(createsCycle('A1260', ['A1010'], predsOf)).toBeNull();
    expect(createsCycle('A1620', ['A1610', 'A1520'], predsOf)).toBeNull();
  });
});

describe('add forms and inline edits', () => {
  it('working days between the default dates (5 Oct → 30 Oct 2026)', () => {
    expect(workingDaysBetween('5 Oct 2026', '30 Oct 2026', 2026)).toBe(18);
    expect(workingDaysBetween('30 Oct 2026', '5 Oct 2026', 2026)).toBe(20);
    expect(workingDaysBetween('soon', '30 Oct 2026', 2026)).toBe(20);
    expect(workingDaysBetween('1 Oct 2026', '2 Oct 2026', 2026)).toBe(1);
    // R-013: a year-less date is in the business year — 28 Dec 2027 → 3 Jan 2028 across the year end.
    expect(workingDaysBetween('28 Dec', '3 Jan 2028', 2027)).toBe(4);
  });
  it('numbering', () => {
    expect(nextActivityCode(1, 0, new Set(['A1010']))).toBe('A1901');
    expect(nextActivityCode(3, 1, new Set(['A3902']))).toBe('A3903');
    expect(nextWorkPackageCode(['1.1', '1.2', '1.3', '1.4', '1.5', '1.6', '1.7', '1.8'])).toBe('1.9');
    expect(nextWorkPackageCode(['1.1', '1.2', '1.4', '1.5', '1.6', '1.7', '1.8'])).toBe('1.9');
  });
  it('moves within a work package', () => {
    expect(moveWithin(['A', 'B', 'C'], 'B', -1)).toEqual(['B', 'A', 'C']);
    expect(moveWithin(['A', 'B', 'C'], 'C', 1)).toBeNull();
    expect(moveWithin(['A', 'B', 'C'], 'A', -1)).toBeNull();
  });
  it('duration and budget edits (applyOv)', () => {
    expect(parseDuration('25', 40)).toBe(25);
    expect(parseDuration('', 40)).toBe(40);
    expect(parseDuration('x', 40)).toBe(40);
    expect(applyBudget('300', { budget: 280, eac: 470 })).toEqual({ budget: 300, eac: 470 });
    expect(applyBudget('500', { budget: 280, eac: 470 })).toEqual({ budget: 500, eac: 500 });
    expect(applyBudget('210', { budget: 210, eac: 208 })).toEqual({ budget: 210, eac: 208 });
    expect(applyBudget('', { budget: 210, eac: 208 })).toEqual({ budget: 0, eac: 208 });
  });
  it('link types', () => {
    const t: LinkType[] = ['FS', 'SS', 'FF', 'SF'];
    expect(t.map((x) => relText(x, 0))).toEqual(t);
  });
});
