// Primavera P6 XER reader (chapter 4, S-9). Pure: the text of an XER export in, the neutral schedule (./model.ts) out.
//
// XER is a tab-separated dump of P6 tables: "%T <table>", "%F <fields…>", "%R <values…>", "%E". Mapped: PROJECT (name, start,
// data date, calendar), CALENDAR (week days and hours from clndr_data, exceptions), PROJWBS (the WBS tree), TASK (activities,
// milestones, durations, actual / early dates, % complete, constraints, floats), TASKPRED (logic with lags in hours on the
// predecessor's calendar), RSRC + TASKRSRC (resources, hours and costs), ACTVTYPE / ACTVCODE / TASKACTV (activity codes, kept in
// the activity description). Other tables are listed as not imported. When the file holds several projects, the first exported
// one is read (or the one asked for).
import type { LinkType } from '@/server/db/codes';
import { fmt } from './messages';
import {
  MAX_IMPORT_ACTIVITIES, isoOfSerial, isoOfStamp, numOf, type ImportedActivity, type ImportedAssignment, type ImportedCalendar, type ImportedLink,
  type ImportedResource, type ImportedSchedule, type ImportedWbs,
} from './model';

export type XerTables = Record<string, Record<string, string>[]>;

/** Splits an XER text into its tables (rows as field → value). Throws when the text is not an XER export. */
export function readXerTables(text: string): XerTables {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  if (!lines.length || !/^ERMHDR\t/.test(lines[0])) throw new Error(fmt('The file is not a Primavera P6 XER file'));
  const tables: XerTables = {};
  let table = '';
  let fields: string[] = [];
  for (const line of lines) {
    if (line.startsWith('%T\t')) {
      table = line.slice(3).trim();
      tables[table] ??= [];
      fields = [];
    } else if (line.startsWith('%F\t')) fields = line.slice(3).split('\t').map((f) => f.trim());
    else if (line.startsWith('%R\t') && table && fields.length) {
      const values = line.slice(3).split('\t');
      const row: Record<string, string> = {};
      fields.forEach((f, i) => (row[f] = (values[i] ?? '').trim()));
      tables[table].push(row);
    } else if (line.startsWith('%E')) break;
  }
  if (!tables.PROJECT?.length) throw new Error(fmt('The file is not a Primavera P6 XER file'));
  return tables;
}

/** P6 day numbering (1 = Sunday … 7 = Saturday) → ISO weekday. */
const isoWeekdayOfP6 = (d: number) => (d === 1 ? 7 : d - 1);

/** Hours of the work periods "s|08:00|f|12:00" found in a piece of clndr_data. */
function periodHours(s: string): number {
  let h = 0;
  for (const m of s.matchAll(/s\|(\d{1,2}):(\d{2})\|f\|(\d{1,2}):(\d{2})/g)) {
    const a = +m[1] + +m[2] / 60;
    let b = +m[3] + +m[4] / 60;
    if (b === 0) b = 24;
    if (b > a) h += b - a;
  }
  return h;
}

/** Week days, hours and exceptions of a P6 calendar (clndr_data); defaults Mon–Fri when the data is missing. */
export function parseClndrData(data: string, dayHours: number): { workDays: number[]; hoursPerDay: number; exceptions: { date: string; working: boolean; name: string }[] } {
  const dow = data.indexOf('DaysOfWeek()');
  const exi = data.indexOf('Exceptions()');
  const workDays: number[] = [];
  const hours: number[] = [];
  if (dow >= 0) {
    const end = [data.indexOf('VIEW', dow), exi].filter((x) => x > dow).sort((a, b) => a - b)[0] ?? data.length;
    const seg = data.slice(dow, end);
    const starts = [...seg.matchAll(/\(0\|\|([1-7])\(\)\(/g)];
    starts.forEach((m, i) => {
      const piece = seg.slice(m.index!, starts[i + 1]?.index ?? seg.length);
      const h = periodHours(piece);
      if (h > 0) {
        workDays.push(isoWeekdayOfP6(+m[1]));
        hours.push(h);
      }
    });
  }
  const exceptions: { date: string; working: boolean; name: string }[] = [];
  if (exi >= 0) {
    const seg = data.slice(exi);
    const starts = [...seg.matchAll(/\(0\|\|\d+\(d\|(\d+)\)\(/g)];
    starts.forEach((m, i) => {
      const piece = seg.slice(m.index!, starts[i + 1]?.index ?? seg.length);
      const date = isoOfSerial(+m[1]);
      if (date) exceptions.push({ date, working: periodHours(piece) > 0, name: '' });
    });
  }
  return {
    workDays: workDays.length ? workDays.sort() : [1, 2, 3, 4, 5],
    hoursPerDay: Math.min(24, Math.max(0.5, dayHours || (hours.length ? Math.max(...hours) : 8))),
    exceptions,
  };
}

const CONSTRAINT: Record<string, string | null> = {
  CS_MSO: 'MSO', CS_MEO: 'MFO', CS_MSOA: 'SNET', CS_MSOB: 'SNLT', CS_MEOA: 'FNET', CS_MEOB: 'FNLT', CS_MANDSTART: 'MSO', CS_MANDFIN: 'MFO', CS_ALAP: null,
};
const LINK: Record<string, LinkType> = { PR_FS: 'FS', PR_SS: 'SS', PR_FF: 'FF', PR_SF: 'SF' };
const MAPPED_TABLES = new Set(['PROJECT', 'CALENDAR', 'PROJWBS', 'TASK', 'TASKPRED', 'RSRC', 'TASKRSRC', 'ACTVTYPE', 'ACTVCODE', 'TASKACTV', 'CURRTYPE', 'OBS', 'PROJPCAT', 'PCATTYPE', 'PCATVAL']);

/** Projects of an XER file (id, short name, name) — the dialog lets the user pick one when there are several. */
export function xerProjects(tables: XerTables): { id: string; shortName: string }[] {
  return (tables.PROJECT ?? []).map((p) => ({ id: p.proj_id, shortName: p.proj_short_name || p.proj_id }));
}

/** Parses an XER export (one project). `projectId`: the proj_id to read (default: the first exported project). */
export function parseXer(text: string, opts: { projectId?: string | null } = {}): ImportedSchedule {
  const tables = readXerTables(text);
  const unmapped: string[] = [];
  const warnings: string[] = [];
  const projects = tables.PROJECT;
  const proj = projects.find((p) => p.proj_id === opts.projectId) ?? projects.find((p) => p.export_flag === 'Y') ?? projects[0];
  if (projects.length > 1) warnings.push(fmt('The XER file holds {0} projects — only {1} is imported', projects.length, proj.proj_short_name || proj.proj_id));
  const pid = proj.proj_id;

  // Calendars (hours per day on each; the project calendar converts durations without their own calendar).
  const calRows = tables.CALENDAR ?? [];
  const calendars: ImportedCalendar[] = calRows.map((c) => {
    const parsed = parseClndrData(c.clndr_data ?? '', numOf(c.day_hr_cnt) ?? 0);
    return { uid: c.clndr_id, name: c.clndr_name || `Calendar ${c.clndr_id}`, ...parsed };
  });
  const calById = new Map(calendars.map((c) => [c.uid, c]));
  const projectCal = proj.clndr_id && calById.has(proj.clndr_id) ? proj.clndr_id : (calRows.find((c) => c.default_flag === 'Y')?.clndr_id ?? calendars[0]?.uid ?? null);
  const hpd = (projectCal && calById.get(projectCal)?.hoursPerDay) || 8;
  const hoursOfCal = (uid: string | null | undefined) => (uid && calById.get(uid)?.hoursPerDay) || hpd;

  // WBS tree under the project node.
  const wbsRows = (tables.PROJWBS ?? []).filter((w) => w.proj_id === pid).sort((a, b) => (numOf(a.seq_num) ?? 0) - (numOf(b.seq_num) ?? 0));
  const root = wbsRows.find((w) => w.proj_node_flag === 'Y');
  const wbsById = new Map(wbsRows.map((w) => [w.wbs_id, w]));
  const wbs: ImportedWbs[] = [];
  const codeOf = (w: Record<string, string>, depth = 0): string => {
    const parent = wbsById.get(w.parent_wbs_id);
    const own = w.wbs_short_name || w.wbs_id;
    return parent && parent !== root && depth < 20 ? `${codeOf(parent, depth + 1)}.${own}` : own;
  };
  const order: Record<string, string>[] = [];
  const visit = (parentId: string | null, depth: number) => {
    if (depth > 20) return;
    for (const w of wbsRows.filter((x) => (parentId ? x.parent_wbs_id === parentId : !wbsById.has(x.parent_wbs_id)) && x !== root)) {
      order.push(w);
      visit(w.wbs_id, depth + 1);
    }
  };
  visit(root ? root.wbs_id : null, 0);
  for (const w of order) {
    const parent = wbsById.get(w.parent_wbs_id);
    wbs.push({ uid: w.wbs_id, code: codeOf(w), name: w.wbs_name || w.wbs_short_name, parentUid: parent && parent !== root ? parent.wbs_id : null, position: wbs.length });
  }
  const wbsIds = new Set(wbs.map((w) => w.uid));

  // Activity codes: "Type: value".
  const codeTypes = new Map((tables.ACTVTYPE ?? []).map((t) => [t.actv_code_type_id, t.actv_code_type]));
  const codeVals = new Map((tables.ACTVCODE ?? []).map((c) => [c.actv_code_id, { type: c.actv_code_type_id, value: c.short_name || c.actv_code_name }]));
  const codesOf = new Map<string, string[]>();
  let codeCount = 0;
  for (const ta of tables.TASKACTV ?? []) {
    const v = codeVals.get(ta.actv_code_id);
    if (!v) continue;
    codeCount++;
    codesOf.set(ta.task_id, [...(codesOf.get(ta.task_id) ?? []), `${codeTypes.get(v.type) ?? v.type}: ${v.value}`]);
  }

  // Costs and hours per activity from the resource assignments.
  const rsrcRows = tables.RSRC ?? [];
  const taskRsrc = tables.TASKRSRC ?? [];
  const costOf = new Map<string, { budget: number; actual: number; remain: number }>();
  for (const r of taskRsrc) {
    const c = costOf.get(r.task_id) ?? { budget: 0, actual: 0, remain: 0 };
    c.budget += numOf(r.target_cost) ?? 0;
    c.actual += (numOf(r.act_reg_cost) ?? 0) + (numOf(r.act_ot_cost) ?? 0);
    c.remain += numOf(r.remain_cost) ?? 0;
    costOf.set(r.task_id, c);
  }

  const tasks = (tables.TASK ?? []).filter((t) => t.proj_id === pid);
  if (tasks.length > MAX_IMPORT_ACTIVITIES) throw new Error(fmt('The file has more than {0} activities', MAX_IMPORT_ACTIVITIES));
  const activities: ImportedActivity[] = [];
  let skipped = 0;
  let alap = 0;
  let secondary = 0;
  for (const t of tasks) {
    if (t.task_type === 'TT_LOE' || t.task_type === 'TT_WBS') {
      skipped++;
      continue;
    }
    const cal = t.clndr_id && calById.has(t.clndr_id) ? t.clndr_id : null;
    const h = hoursOfCal(cal);
    const milestone = t.task_type === 'TT_Mile' || t.task_type === 'TT_FinMile';
    const target = numOf(t.target_drtn_hr_cnt) ?? 0;
    const remain = numOf(t.remain_drtn_hr_cnt);
    const complete = t.status_code === 'TK_Complete';
    let pct = complete ? 100 : 0;
    if (!complete) {
      if (t.complete_pct_type === 'CP_Drtn' && target > 0 && remain != null) pct = Math.round(((target - remain) / target) * 100);
      else pct = Math.round(numOf(t.phys_complete_pct) ?? 0);
      if (t.status_code === 'TK_NotStart') pct = 0;
    }
    if (t.cstr_type === 'CS_ALAP') alap++;
    if (t.cstr_type2) secondary++;
    const cType = CONSTRAINT[t.cstr_type] ?? null;
    const actualStart = isoOfStamp(t.act_start_date);
    const actualFinish = isoOfStamp(t.act_end_date);
    const cost = costOf.get(t.task_id);
    const k = (n: number) => Math.round(n) / 1000;
    const tf = numOf(t.total_float_hr_cnt);
    activities.push({
      uid: t.task_id, activityId: t.task_code || null, name: t.task_name, wbsUid: wbsIds.has(t.wbs_id) ? t.wbs_id : null,
      durationDays: milestone ? 0 : Math.max(0, Math.round(target / h)), start: actualStart ?? isoOfStamp(t.early_start_date) ?? isoOfStamp(t.restart_date) ?? isoOfStamp(t.target_start_date),
      finish: actualFinish ?? isoOfStamp(t.early_end_date) ?? isoOfStamp(t.reend_date) ?? isoOfStamp(t.target_end_date), actualStart, actualFinish: complete ? actualFinish : null,
      percentComplete: Math.max(0, Math.min(100, pct)), remainingDays: remain == null || pct === 0 || complete ? null : Math.round(remain / h), milestone,
      constraint: cType ? { type: cType, date: isoOfStamp(t.cstr_date) } : null, calendarUid: cal && cal !== projectCal ? cal : null,
      totalFloatDays: tf == null || complete ? null : Math.round(tf / h), critical: tf == null || complete ? null : tf <= 0,
      costKeur: cost ? k(cost.actual + cost.remain) : null, actualCostKeur: cost ? k(cost.actual) : null, budgetKeur: cost ? k(cost.budget) : null, notes: null,
      codes: codesOf.get(t.task_id) ?? [], baselines: [], line: activities.length + 1,
    });
  }
  const actIds = new Set(activities.map((a) => a.uid));
  const calOfTask = new Map(tasks.map((t) => [t.task_id, t.clndr_id && calById.has(t.clndr_id) ? t.clndr_id : null]));
  const links: ImportedLink[] = [];
  let cross = 0;
  for (const l of tables.TASKPRED ?? []) {
    if (!actIds.has(l.task_id)) continue;
    if ((l.pred_proj_id && l.pred_proj_id !== pid) || !actIds.has(l.pred_task_id)) {
      if (l.pred_proj_id && l.pred_proj_id !== pid) cross++;
      else links.push({ predUid: l.pred_task_id, succUid: l.task_id, type: LINK[l.pred_type] ?? 'FS', lagDays: 0 });
      continue;
    }
    const lagH = numOf(l.lag_hr_cnt) ?? 0;
    links.push({ predUid: l.pred_task_id, succUid: l.task_id, type: LINK[l.pred_type] ?? 'FS', lagDays: Math.round(lagH / hoursOfCal(calOfTask.get(l.pred_task_id))) });
  }

  const resources: ImportedResource[] = rsrcRows.map((r) => ({
    uid: r.rsrc_id, name: r.rsrc_name || r.rsrc_short_name, type: r.rsrc_type === 'RT_Mat' ? 'material' : r.rsrc_type === 'RT_Equip' ? 'equipment' : 'work',
  }));
  const resIds = new Set(resources.map((r) => r.uid));
  const assignments: ImportedAssignment[] = taskRsrc
    .filter((r) => actIds.has(r.task_id) && resIds.has(r.rsrc_id))
    .map((r) => ({
      activityUid: r.task_id, resourceUid: r.rsrc_id, units: numOf(r.target_qty_per_hr) ?? 1,
      plannedHours: numOf(r.target_qty), actualHours: (numOf(r.act_reg_qty) ?? 0) + (numOf(r.act_ot_qty) ?? 0),
    }));

  if (skipped) unmapped.push(fmt('Level-of-effort and WBS-summary activities are not imported ({0})', skipped));
  if (alap) unmapped.push(fmt('As late as possible constraints are imported as ASAP ({0})', alap));
  if (secondary) unmapped.push(fmt('Secondary constraints are not imported ({0})', secondary));
  if (codeCount) unmapped.push(fmt('P6 activity codes are kept in the activity description ({0})', codeCount));
  if (cross) unmapped.push(fmt('Cross-project links are not imported ({0})', cross));
  if (rsrcRows.length) unmapped.push('Resource rates and cost accrual are not imported');
  const other = Object.keys(tables).filter((n) => !MAPPED_TABLES.has(n) && tables[n].length);
  if (other.length) unmapped.push(fmt('Other tables of the XER file are not imported: {0}', other.join(', ')));
  unmapped.push(fmt('P6 baselines are separate projects — none is imported'));
  if (!activities.length) warnings.push(fmt('The file contains no activity'));

  const usedCals = new Set([projectCal, ...activities.map((a) => a.calendarUid)].filter(Boolean));
  return {
    format: 'xer', name: proj.proj_short_name || 'Imported schedule', company: null,
    start: isoOfStamp(proj.plan_start_date), finish: isoOfStamp(proj.scd_end_date) ?? isoOfStamp(proj.plan_end_date), statusDate: isoOfStamp(proj.last_recalc_date),
    calendarUid: projectCal, hoursPerDay: hpd, calendars: calendars.filter((c) => usedCals.has(c.uid)), wbs, activities, links, resources: resources.filter((r) => assignments.some((a) => a.resourceUid === r.uid)),
    assignments, unmapped, warnings,
  };
}
