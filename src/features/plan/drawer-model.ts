// View model of the activity drawer (docs/spec/05 §2.4.5, template 1105–1163, logic 4019–4030): General,
// Relationships, Resources & cost and To-dos, rendered to the prototype's display strings and translated.
// Pure (no I/O): the page passes the DAL data in.
import {
  calendarLabel, costBar, drawerStatus, dueText, durationText, effectiveFloat, isSiteCalendar, ownerResource, relText,
  signedDays, successorsOf, withActual, TODO_STATUS_LABEL, type CostBar, type PlanActivity, type PlanPackage,
} from '@/domain/schedule';
import type { Lang, T } from '@/i18n/translate';
import { initials, money } from '@/lib/format';
import type { PlanOwner, PlanRequest, PlanTodo } from '@/server/dal/plan';
import { awaitingApprovalText, daysText, forecastOverText, planT, rescheduleProposedText, todoCountText } from './i18n';

export interface DrawerResourceInput {
  resource: string;
  detail: string;
  units: string;
  progressText: string;
}

export interface DrawerInput {
  act: PlanActivity;
  /** All activities of the project in display order (names, successors, float). */
  activities: PlanActivity[];
  packages: PlanPackage[];
  /** OWN directory (full name and title per key). */
  owners: PlanOwner[];
  /** Recorded resource assignments of the activity (A1250_RES); empty → the owner as lead. */
  assignments: DrawerResourceInput[];
  /** To-dos of the project (linked by `act`). */
  todos: PlanTodo[];
  /** Resource requests of the project (linked by `act`). */
  requests: PlanRequest[];
  /** Department → head's full name (DEPTS). */
  deptHeads: Record<string, string>;
  /** Change requests of the project currently in review ("CR-008"), from the change-control register. */
  pendingChanges?: readonly string[];
  /** URL of a to-do's task page. */
  taskHref: (todo: PlanTodo) => string;
}

export interface DrawerLine {
  id: string;
  name: string;
  rel: string;
  /** `driving` accent-300 · `lo` LO · `normal` neutral-300 · `none` neutral-500 ("No predecessors"). */
  tone: 'driving' | 'lo' | 'normal' | 'none';
}

export interface DrawerTodo {
  id: string;
  title: string;
  meta: string;
  done: boolean;
  initials: string;
  href: string;
}

export interface DrawerView {
  id: string;
  name: string;
  status: { label: string; className: string };
  general: { k: string; v: string; lo: boolean }[];
  preds: DrawerLine[];
  succs: DrawerLine[];
  res: { name: string; sub: string; units: string }[];
  budget: string;
  actual: string;
  eac: string;
  eacLo: boolean;
  bar: CostBar;
  costNote: string;
  todoCount: string;
  todos: DrawerTodo[];
  pending: { id: string; title: string; meta: string }[];
  noTodos: boolean;
}

/** Builds the drawer of one activity, translated for `lang` (`t` = the viewer's translator). */
export function activityDrawerView(input: DrawerInput, baseT: T, lang: Lang): DrawerView {
  const t = planT(baseT, lang);
  const { act: a, activities } = input;
  const f = (k: number) => money(k, lang);
  const byId = new Map(activities.map((x) => [x.id, x]));
  const owner = input.owners.find((o) => o.code === a.owner);
  const ownerName = owner?.name ?? a.owner ?? '—';
  const pkg = input.packages.find((p) => p.code === a.wbs)?.name ?? '';
  const site = isSiteCalendar(a);
  const tf = effectiveFloat(a);

  const general: DrawerView['general'] = [
    { k: 'WBS', v: `${a.wbs} ${t(pkg)}`.trim(), lo: false },
    { k: 'Type', v: t('Task dependent'), lo: false },
    { k: 'Calendar', v: t(calendarLabel(site)), lo: false },
    { k: 'Original / remaining', v: daysText(durationText(a.durationDays, a.pct), lang), lo: false },
    { k: 'Start', v: t(withActual(a.start, a.startActual)), lo: false },
    { k: 'Finish', v: t(withActual(a.finish, a.finishActual)), lo: false },
    { k: 'BL1 finish', v: t(a.baselineFinish), lo: false },
    { k: 'Finish variance', v: daysText(`${a.variance || 0}d`, lang), lo: a.variance < 0 },
    { k: 'Total float', v: tf == null ? t('— (complete)') : daysText(signedDays(tf), lang), lo: tf != null && tf < 0 },
    { k: 'Constraint', v: a.constraint ? t(a.constraint) : t('None'), lo: a.violated },
    { k: 'Owner', v: ownerName, lo: false },
  ].map((g) => ({ ...g, k: t(g.k) }));

  const preds: DrawerLine[] = a.preds
    .filter(([id]) => byId.has(id))
    .map(([id, type, lag], i) => ({
      id,
      name: t(byId.get(id)!.name),
      rel: daysText(relText(type, lag), lang) + (i === 0 ? ' · ' + t('driving') : ''),
      tone: i === 0 ? 'driving' : 'normal',
    }));
  const succs: DrawerLine[] = successorsOf(a.id, activities).map(({ act, type, lag }) => {
    const sf = effectiveFloat(act);
    return { id: act.id, name: t(act.name), rel: daysText(relText(type, lag), lang), tone: sf != null && sf < 0 ? 'lo' : 'normal' };
  });

  const res = input.assignments.length
    ? input.assignments.map((r) => ({ name: r.resource, sub: t(`${r.detail} · ${r.progressText}`), units: t(r.units) }))
    : owner
      ? [ownerResource(owner.name, owner.title, a.durationDays, a.pct, site)].map((r) => ({ ...r, sub: t(r.sub), units: t(r.units) }))
      : [];

  const bar = costBar(a.budget, a.actual, a.eac);
  const costNote = bar.over
    ? forecastOverText(money(bar.overBy, lang, { signed: true }), lang) +
      // The prototype hard-codes this pending change for A1250; it is shown while CR-008 is still in review.
      // TODO(db): change requests are linked to WBS packages, not activities — the activity ↔ CR link is not modelled.
      (a.id === 'A1250' && input.pendingChanges?.includes('CR-008') ? ' — ' + t('second crew (CR-008) pending approval') : '')
    : t('Tracking within budget');

  const aTodos = input.todos.filter((x) => x.act === a.id);
  const todos: DrawerTodo[] = aTodos.map((x) => ({
    id: x.id,
    title: t(x.title),
    meta: t(`${x.person.split(' ')[0]} · ${dueText(x.status, x.due)} · ${TODO_STATUS_LABEL[x.status]}`),
    done: x.status === 'done',
    initials: initials(x.person),
    href: input.taskHref(x),
  }));
  const pending = input.requests
    .filter((r) => r.act === a.id && (r.status === 'pending' || r.status === 'reschedule'))
    .map((r) => ({
      id: r.id,
      title: t(r.title),
      meta:
        r.person +
        ' · ' +
        (r.status === 'pending'
          ? awaitingApprovalText(t(r.dept), lang) + ' — ' + t('not yet in their list')
          : rescheduleProposedText(input.deptHeads[r.dept] ?? r.dept, lang)),
    }));

  const status = drawerStatus(a.pct);
  return {
    id: a.id,
    name: t(a.name),
    status: { label: t(status.label), className: status.className },
    general,
    preds: preds.length ? preds : [{ id: '—', name: t('No predecessors'), rel: '', tone: 'none' }],
    succs: succs.length ? succs : [{ id: '—', name: t('No successors'), rel: '', tone: 'none' }],
    res,
    budget: f(a.budget),
    actual: f(a.actual),
    eac: f(a.eac),
    eacLo: a.eac > a.budget,
    bar,
    costNote,
    todoCount: todoCountText(aTodos.filter((x) => x.status === 'done').length, aTodos.length, lang),
    todos,
    pending,
    noTodos: !aTodos.length && !pending.length,
  };
}
