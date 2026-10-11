// View models of the Lessons learned & closure screen (docs/spec/07 §2.7, template 921–931) and of the client portal
// "My project — client view" (docs/spec/03 §8, template 2180–2236): the domain figures (src/domain/rexclient.ts) and
// the DAL rows turned into the translated strings, tag classes and links the components render. Pure (no I/O): `t`
// and `lang` come from the page.
import { LO, OK } from '@/components/app/tones';
import { screenHref } from '@/config/screens';
import {
  CLIENT_TABS, DOCS_TAB, clientDecisions, clientKpis, clientMilestones, clientProgress, issueRow, openIssueCount, rexView, sharedDocRow,
  contractSummary, invoiceRow, type ChangeRequestLike, type ClientTab, type ClosureMark, type DeliverableLike, type EvmLike, type Kpi,
  type ScheduleHeaderLike, type Tone,
} from '@/domain/rexclient';
import { scheduleView, type GanttTask, type MilestoneInput, type ScheduleInput, type ScheduleMilestone } from '@/domain/schedule-gantt';
import { slipText } from '@/features/schedule/i18n';
import type { Lang, T } from '@/i18n/translate';
import { fmtDOfIso, type ClosureItemStatus, type LessonStatus } from '@/server/db/codes';
import type { ClientPortal } from '@/server/dal/client';
import type { ProjectRex } from '@/server/dal/rex';
import { dueText, exactText, milestoneText, subText } from './i18n';

const tag = (tone: Tone) => `tag tag-${tone}`;
const INTERNAL = 'Internal project — no client billing';

export interface KpiView {
  label: string;
  value: string;
  sub: string;
  color: string;
}

const kpiViews = (ks: Kpi[], t: T, lang: Lang): KpiView[] =>
  ks.map((k) => ({ label: t(k.label), value: t(k.value), sub: k.sub ? subText(k.sub, t, lang) : '', color: k.alert ? LO : OK }));

// ── Lessons learned & closure ──────────────────────────────────────────────────────────────────────────

export interface LessonView {
  id: string;
  theme: string;
  what: string;
  impact: string;
  reco: string;
  apply: string;
  status: string;
  tagClass: string;
  /** Current status (the Server Function checks the lesson has not moved on meanwhile). */
  from: LessonStatus;
  /** "Validate" / "Mark applied" (translated) and the status it leads to; null once applied. */
  next: { to: LessonStatus; label: string } | null;
}

export interface ClosureView {
  position: number;
  item: string;
  owner: string;
  status: string;
  mark: ClosureMark;
  color: string;
  textColor: string;
  /** Status the click leads to (the Server Function checks the row has not changed meanwhile). */
  from: ClosureItemStatus;
}

export interface RexScreenView {
  kpis: KpiView[];
  lessons: LessonView[];
  closure: ClosureView[];
  satisfaction: { criterion: string; score: string; width: string }[];
  satAvg: string;
}

export function rexScreenView(d: ProjectRex, t: T, lang: Lang): RexScreenView {
  const v = rexView(d, lang);
  return {
    kpis: kpiViews(v.kpis, t, lang),
    // Lessons are typed in Keystone: their texts are translated on an exact dictionary entry only; the theme, the
    // status and the template / procedure options are labels.
    lessons: v.lessons.map((l, i) => ({
      id: l.id, from: d.lessons[i].status, theme: t(l.theme), what: exactText(l.what, lang), impact: exactText(l.impact, lang), reco: exactText(l.reco, lang), apply: exactText(l.apply, lang),
      status: t(l.status), tagClass: tag(l.tone), next: l.next ? { to: l.next.to, label: t(l.next.label) } : null,
    })),
    closure: v.closure.map((c, i) => ({
      position: c.position, item: t(c.item), owner: c.owner, status: t(c.status), mark: c.mark, color: c.color, textColor: c.textColor, from: d.closure[i].status,
    })),
    satisfaction: v.satisfaction.map((s) => ({ criterion: t(s.criterion), score: s.score, width: s.width })),
    satAvg: v.satAvg,
  };
}

// ── Client portal ──────────────────────────────────────────────────────────────────────────────────────

/** `/projects/{code}/client` with `?tab=` (Progress & milestones is the default, no parameter). */
export function clientHref(code: string, tab: ClientTab = 'progress'): string {
  const base = screenHref('client', { code });
  return tab === 'progress' ? base : `${base}?tab=${tab}`;
}

export interface ScheduleLike {
  header: ScheduleHeaderLike & { start: number; chartMonths: string[] };
  milestones: MilestoneInput[];
  pv: number[];
  ev: number[];
  bac: number;
}

export interface DecisionView {
  kind: 'change_request' | 'deliverable';
  kindLabel: string;
  id: string;
  when: string;
  title: string;
  sub: string;
  approveLabel: string;
}

export interface ClientScreenView {
  tab: ClientTab;
  tabs: { value: ClientTab; label: string; href: string }[];
  kpis: KpiView[];
  /** Null without schedule data (empty state). */
  progress: { label: string; planH: string; actH: string }[] | null;
  milestones: { name: string; baseDate: string; fcDate: string; status: string; tagClass: string }[];
  decisions: DecisionView[];
  decided: { id: string; title: string; state: string; tagClass: string; when: string }[];
  invoices: { no: string; name: string; amount: string; status: string; tagClass: string; payment: string }[];
  /** Empty-state text of the invoices card (internal project / no billing plan), null when there are invoices. */
  invoicesEmpty: string | null;
  summary: { k: string; v: string }[] | null;
  /** Contract summary empty state (no billing plan), null when there is a summary (internal projects: €0k rows). */
  summaryEmpty: string | null;
  /** `when`: "Raised 22 Sep", followed by "· Answered 30 Sep" once the project manager answered (R-137). */
  issues: { id: string; title: string; when: string; status: string; tagClass: string; response: string }[];
  docs: { id: string; title: string; typeLabel: string; date: string; rev: string; status: string; tagClass: string; acknowledged: boolean; ackLabel: string }[];
  docsLabels: { idHeader: string; sub: string; empty: string };
  /** "Schedule" tab (S-9a): the summary Gantt and the milestones, read-only; null on the other tabs / without a schedule. */
  planning?: ClientPlanningView | null;
}

/** Client portal "Schedule" tab (S-9a): the Schedule screen's Gantt (work packages without owners) and milestone list. */
export interface ClientPlanningView {
  months: string[];
  tasks: GanttTask[];
  milestones: Pick<ScheduleMilestone, 'name' | 'bL' | 'fL' | 'done'>[];
  todayL: string;
  /** Milestone list: translated name, "Baseline 15 Mar · Forecast 2 Apr", signed slip, status code and label. */
  list: { name: string; dates: string; slipText: string; slipAlert: boolean; status: ScheduleMilestone['status']; statusLabel: string }[];
  /** "Forecast finish 14 Jan 2027 · Baseline 15 Dec 2026". */
  finish: string;
}

export function clientPlanningView(d: ScheduleInput, t: T, lang: Lang): ClientPlanningView {
  const v = scheduleView(d);
  return {
    months: v.ganttMonths.map((m) => t(m)),
    // Owners are internal (initials of the project team): the client view leaves them out.
    tasks: v.tasks.map((x) => ({ ...x, name: exactText(x.name, lang), owner: '', slipText: slipText(x.slipText, lang) })),
    milestones: v.milestones.map((m) => ({ name: exactText(m.name, lang), bL: m.bL, fL: m.fL, done: m.done })),
    todayL: v.todayL,
    list: v.milestones.map((m) => ({
      name: exactText(m.name, lang), dates: `${t('Baseline')} ${t(m.baseDate)} ${t('· Forecast')} ${t(m.fcDate)}`, slipText: slipText(m.slipText, lang), slipAlert: m.slipAlert,
      status: m.status, statusLabel: t(m.statusLabel),
    })),
    finish: `${t('Forecast finish')} ${t(d.header.finishText)} · ${t('Baseline')} ${t(d.header.baselineText)}`,
  };
}

export interface ClientScreenInput {
  code: string;
  tab: ClientTab;
  portal: ClientPortal;
  schedule: ScheduleLike | null;
  /** The project has a billing plan, and it is an internal one (no client revenue). */
  billing: { internal: boolean } | null;
}

export function clientScreenView({ code, tab, portal, schedule, billing }: ClientScreenInput, t: T, lang: Lang): ClientScreenView {
  // The DAL lists the change requests / deliverables waiting for the client and those it decided; the domain derives both lists.
  const all = [...portal.decisions, ...portal.decided];
  const crs: ChangeRequestLike[] = all.flatMap((x) => (x.changeRequest ? [x.changeRequest] : []));
  const dlv: DeliverableLike[] = all.flatMap((x) => (x.deliverable ? [x.deliverable] : []));
  const dec = clientDecisions(crs, dlv, lang);
  const evm: EvmLike | null = schedule && schedule.ev.length ? { pv: schedule.pv, ev: schedule.ev, bac: schedule.bac } : null;
  const kpis = clientKpis({ evm, schedule: schedule?.header ?? null, awaiting: dec.waiting.length, openIssues: openIssueCount(portal.issues) });
  return {
    tab,
    tabs: CLIENT_TABS.map((o) => ({ value: o.value, label: t(o.label), href: clientHref(code, o.value) })),
    kpis: kpiViews(kpis, t, lang),
    progress: schedule && evm ? clientProgress(schedule.header.chartMonths, evm).map((p) => ({ ...p, label: t(p.label) })) : null,
    milestones: schedule
      ? clientMilestones(schedule.milestones, schedule.header.start).map((m) => ({ name: exactText(m.name, lang), baseDate: t(m.baseDate), fcDate: t(m.fcDate), status: t(m.status), tagClass: tag(m.tone) }))
      : [],
    decisions: dec.waiting.map((d) => ({ kind: d.kind, kindLabel: t(d.kindLabel), id: d.id, when: t(d.when), title: exactText(d.title, lang), sub: t(d.sub), approveLabel: t(d.approveLabel) })),
    decided: dec.decided.map((d) => ({ id: d.id, title: exactText(d.title, lang), state: t(d.state), tagClass: tag(d.tone), when: t(d.when) })),
    invoices: portal.invoices.map((i) => {
      const r = invoiceRow({ milestone: i.milestone, amountKeur: i.amountKeur, status: i.status, invoiceNumber: i.invoiceNumber, dueOn: i.dueOn }, lang, portal.currency);
      return {
        no: r.no, name: milestoneText(r.name, i.milestoneNumber, t, lang), amount: r.amount, status: t(r.status), tagClass: tag(r.tone),
        payment: r.payment.kind === 'due' ? dueText(r.payment.date, t, lang) : t(r.payment.text),
      };
    }),
    invoicesEmpty: portal.invoices.length ? null : t(billing?.internal ? INTERNAL : 'No billing plan for this project yet'),
    summary: portal.contract ? contractSummary(portal.contract, lang).map((r) => ({ k: t(r.k), v: r.v })) : null,
    summaryEmpty: portal.contract ? null : t('No contract recorded for this project'),
    issues: portal.issues.map((i) => {
      const r = issueRow({ number: i.number, title: i.title, raisedOn: i.raisedOn, status: i.status, response: i.response });
      const when = i.answeredOn ? `${t(r.when)} · ${t('Answered')} ${t(fmtDOfIso(i.answeredOn))}` : t(r.when);
      return { id: r.id, title: exactText(r.title, lang), when, status: t(r.status), tagClass: tag(r.tone), response: exactText(r.response, lang) };
    }),
    docs: portal.documents.map((d) => {
      const r = sharedDocRow(d);
      // R-148: Codex record titles as typed (or their seeded demo entry), whoever created them.
      const title = exactText(r.title, lang);
      return { id: r.id, title, typeLabel: t(r.typeLabel), date: t(r.date), rev: r.rev, status: t(r.status), tagClass: tag(r.tone), acknowledged: r.acknowledged, ackLabel: t(r.ackLabel) };
    }),
    docsLabels: { idHeader: t(DOCS_TAB.idHeader), sub: t(DOCS_TAB.sub), empty: t(DOCS_TAB.empty) },
  };
}
