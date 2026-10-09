import 'server-only';
// Server-side view model of the Plan screen: the domain row model (src/domain/schedule.ts) rendered to the
// prototype's display strings, translated for the viewer's language. Serialisable (passed to the client table).
import { LO, OK } from '@/components/app/tones';
import { CRITICAL_FLOAT_DAYS, longDateText } from '@/domain/schedule-rollup';
import {
  PROGRESS_STATUS, buildPlanRows, criticalCount, floatText, predsInput, predsLabel, progressKpis, structureKpis, varianceText,
  type BarTone, type PlanRow,
} from '@/domain/schedule';
import type { Lang, T } from '@/i18n/translate';
import { STATUS_DATE, money } from '@/lib/format';
import type { BaselineInfo } from '@/server/dal/baselines';
import type { PlanData, PlanTodo } from '@/server/dal/plan';
import { baselineKpiSub, daysText, finishVsBaselineText } from './i18n';

export type PlanView = 'structure' | 'progress';

export interface PlanRowView {
  kind: PlanRow['kind'];
  /** Displayed id: "1", "1.4", "A1250". */
  id: string;
  /** Work-package code (activity rows: their package) — collapse key. */
  wbs: string;
  /** Translated name (display). */
  name: string;
  /** Stored name — the name input's value (an edit must not persist the translation). */
  nameValue: string;
  /** "1.4 · Steel structure" — value of the Add activity "Work package" option (WP rows). */
  wpOption?: string;
  indent: number;
  mark: boolean;
  /** OWN key and full name (activities). */
  owner: string | null;
  ownerName: string;
  /** Structure: "4 act." / "—" (WP), '' (root); activity input value in `durValue`. */
  dur: string;
  durValue: string;
  /** Structure: WP/root money or '—'; activity input value (k€). */
  budget: string;
  /** Predecessors input value ("A1240 FS, A1220 FS+10"). */
  predsValue: string;
  /** Predecessors as read-only text ("A1240 FS, A1220 FS+10d", '—' when none — spec `preds`). */
  predsLabel: string;
  /** Read-only duration ("40d"; FR "40 j"). */
  durLabel: string;
  /** Constraint text (translated), '' on summaries. */
  cons: string;
  consLo: boolean;
  start: string;
  finish: string;
  bl: string;
  variance: string;
  varLo: boolean;
  pct: number;
  bar: BarTone;
  tf: string;
  tfLo: boolean;
  statusText: string;
  statusClass: string;
  /** Behind → lightning. */
  critical: boolean;
  /** "done/total" or ''. */
  todos: string;
}

export interface KpiView {
  label: string;
  value: string;
  sub: string;
  color: string;
}

export function todoCounts(todos: PlanTodo[]) {
  return (actId: string) => {
    const l = todos.filter((t) => t.act === actId);
    return { done: l.filter((t) => t.status === 'done').length, total: l.length };
  };
}

/** All rows of the plan (collapse is applied by the client table). */
export function planRows(data: PlanData, todos: PlanTodo[]): PlanRow[] {
  return buildPlanRows({
    root: data.root,
    rootPct: data.control.pct,
    floatDays: data.control.floatDays,
    packages: data.packages,
    activities: data.activities,
    todosOf: todoCounts(todos),
    projectTodos: { done: todos.filter((t) => t.status === 'done').length, total: todos.length },
  });
}

export function planRowViews(rows: PlanRow[], data: PlanData, t: T, lang: Lang): PlanRowView[] {
  const ownerName = new Map(data.owners.map((o) => [o.code, o.name]));
  return rows.map((r) => {
    const a = r.act;
    const sum = r.kind !== 'act';
    const status = PROGRESS_STATUS[r.status];
    return {
      kind: r.kind,
      id: r.id,
      wbs: r.wbs,
      name: t(r.name),
      nameValue: r.name,
      wpOption: r.kind === 'wp' ? `${r.id} · ${r.name}` : undefined,
      indent: r.indent,
      mark: r.mark,
      owner: a?.owner ?? null,
      ownerName: a?.owner ? (ownerName.get(a.owner) ?? a.owner) : '',
      dur: r.kind === 'wp' ? (r.count ? `${r.count} act.` : '—') : '',
      durValue: a ? String(a.durationDays) : '',
      budget: sum ? (r.budget ? money(r.budget, lang) : '—') : String(r.budget),
      predsValue: a ? predsInput(a.preds) : '',
      predsLabel: a ? daysText(predsLabel(a.preds), lang) : '',
      durLabel: a ? daysText(`${a.durationDays}d`, lang) : '',
      cons: a ? t(a.constraint || '—') : '',
      consLo: !!a?.violated,
      start: t(r.start),
      finish: t(r.finish),
      bl: t(r.baselineFinish),
      variance: daysText(varianceText(r.variance), lang),
      varLo: (r.variance ?? 0) < 0,
      pct: r.pct,
      bar: r.bar,
      tf: daysText(floatText(r.tf), lang),
      tfLo: r.tf != null && r.tf < 0,
      statusText: t(status.label),
      statusClass: status.className,
      critical: r.behind,
      todos: r.todos.total ? `${r.todos.done}/${r.todos.total}` : '',
    };
  });
}

/** Chapter 4 context of the KPI tiles: the project data date and the displayed baseline (S-3). */
export interface PlanKpiContext {
  /** ISO data date (default: the status date). */
  dataDate?: string;
  /** Displayed baseline (null: the prototype's fixed "BL1" and `baselineSet`). */
  baseline?: Pick<BaselineInfo, 'code' | 'setOn' | 'changeRequest' | 'activityCount'> | null;
}

/** The five KPI tiles of the view (`planKpis`, logic 4036–4046), translated. */
export function planKpis(view: PlanView, data: PlanData, t: T, lang: Lang, ctx: PlanKpiContext = {}): KpiView[] {
  const acts = data.activities;
  const f = (k: number) => money(k, lang);
  const bl = ctx.baseline ?? null;
  if (view === 'structure') {
    const k = structureKpis(data.packages.length, acts);
    return [
      { label: t('Work packages'), value: String(k.workPackages), sub: t(`${k.activities} activities · ${f(k.budget)}`), color: OK },
      // S-1: critical = total float ≤ 0 and not complete (the prototype counted float < 0; same figures on the seed).
      { label: t('Activities'), value: String(k.activities), sub: t(`${criticalCount(acts, CRITICAL_FLOAT_DAYS)} on the critical path`), color: OK },
      { label: t('Relationships'), value: String(k.relationships), sub: t(`FS ${k.byType.FS} · SS ${k.byType.SS} · FF ${k.byType.FF}`), color: OK },
      { label: t('Constraints'), value: String(k.constraints), sub: t(`${k.violated} violated`), color: k.violated ? LO : OK },
      bl
        ? { label: t('Baseline'), value: bl.code, sub: baselineKpiSub(bl.setOn ? t(longDateText(bl.setOn)) : null, bl.changeRequest, bl.activityCount, lang), color: OK }
        : { label: t('Baseline'), value: 'BL1', sub: t(`Set ${data.control.baselineSet} · ${k.activities} activities`), color: OK },
    ];
  }
  const k = progressKpis(acts);
  const dataDate = ctx.dataDate ? longDateText(ctx.dataDate) : STATUS_DATE;
  return [
    { label: t('Overall progress'), value: `${k.overall} %`, sub: t(`weighted by budget · data date ${dataDate}`), color: OK },
    { label: t('Completed'), value: `${k.done} / ${k.total}`, sub: t(`${f(k.earned)} earned`), color: OK },
    { label: t('In progress'), value: String(k.running), sub: t(`${k.behind} behind schedule`), color: k.behind ? LO : OK },
    {
      label: t('Not started'), value: String(k.notStarted),
      sub: t(k.nextStart ? `Next start · ${k.nextStart.id} · ${k.nextStart.start}` : 'All activities started'), color: OK,
    },
    {
      label: t('Project float'), value: t(data.control.floatShort),
      sub: finishVsBaselineText(t(data.control.finishText), bl?.code ?? 'BL1', t(data.control.baselineText), lang), color: data.control.floatDays < 0 ? LO : OK,
    },
  ];
}
