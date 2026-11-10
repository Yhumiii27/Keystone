// View models of the Lessons learned & closure screen (docs/spec/07 §2.7, template 921–931) and of the client status report
// (the former client portal's figures, docs/spec/03 §8): the domain figures (src/domain/rexclient.ts) and the DAL rows turned
// into the translated strings, tag classes and links the components render. Pure (no I/O): `t` and `lang` come from the page.
import { LO, OK } from '@/components/app/tones';
import {
  clientDecisions, clientKpis, rexView, contractSummary, invoiceRow, type ChangeRequestLike, type ClosureMark, type DeliverableLike, type EvmLike,
  type Kpi, type ScheduleHeaderLike, type Tone,
} from '@/domain/rexclient';
import { yearOfIso } from '@/domain/clock';
import type { MilestoneInput } from '@/domain/schedule-gantt';
import type { Lang, T } from '@/i18n/translate';
import type { ClosureItemStatus, LessonStatus } from '@/server/db/codes';
import type { ClientReportData } from '@/server/dal/client-report';
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

// ── Client status report ────────────────────────────────────────────────────────────────────────────────
// D9-06 / D9-22: the client portal was removed (clients never see Keystone); its model remains for the client audience of the
// status report the project team generates from Trends and sends (src/server/export/providers/status-report.ts).

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
}

export interface ClientReportView {
  kpis: KpiView[];
  decisions: DecisionView[];
  decided: { id: string; title: string; state: string; when: string }[];
  invoices: { no: string; name: string; amount: string; status: string; payment: string }[];
  /** Empty-state text of the invoices (internal project / no billing plan), null when there are invoices. */
  invoicesEmpty: string | null;
  summary: { k: string; v: string }[] | null;
}

export interface ClientReportInput {
  data: ClientReportData;
  schedule: ScheduleLike | null;
  /** The project has a billing plan, and it is an internal one (no client revenue). */
  billing: { internal: boolean } | null;
  /** R-013: business date. */
  today: string;
}

export function clientReportView({ data, schedule, billing, today }: ClientReportInput, t: T, lang: Lang): ClientReportView {
  // The DAL lists the change requests / deliverables waiting for the client and those it decided; the domain derives both lists.
  const all = [...data.decisions, ...data.decided];
  const crs: ChangeRequestLike[] = all.flatMap((x) => (x.changeRequest ? [x.changeRequest] : []));
  const dlv: DeliverableLike[] = all.flatMap((x) => (x.deliverable ? [x.deliverable] : []));
  const year = yearOfIso(today);
  const dec = clientDecisions(crs, dlv, lang, year);
  const evm: EvmLike | null = schedule && schedule.ev.length ? { pv: schedule.pv, ev: schedule.ev, bac: schedule.bac } : null;
  const kpis = clientKpis({ evm, schedule: schedule?.header ?? null, awaiting: dec.waiting.length });
  return {
    kpis: kpiViews(kpis, t, lang),
    decisions: dec.waiting.map((d) => ({ kind: d.kind, kindLabel: t(d.kindLabel), id: d.id, when: t(d.when), title: exactText(d.title, lang), sub: t(d.sub) })),
    decided: dec.decided.map((d) => ({ id: d.id, title: exactText(d.title, lang), state: t(d.state), when: t(d.when) })),
    invoices: data.invoices.map((i) => {
      const r = invoiceRow({ milestone: i.milestone, amountKeur: i.amountKeur, status: i.status, invoiceNumber: i.invoiceNumber, dueOn: i.dueOn }, lang, year, data.currency);
      return {
        no: r.no, name: milestoneText(r.name, i.milestoneNumber, t, lang), amount: r.amount, status: t(r.status),
        payment: r.payment.kind === 'due' ? dueText(r.payment.date, t, lang) : t(r.payment.text),
      };
    }),
    invoicesEmpty: data.invoices.length ? null : t(billing?.internal ? INTERNAL : 'No billing plan for this project yet'),
    summary: data.contract ? contractSummary(data.contract, lang).map((r) => ({ k: t(r.k), v: r.v })) : null,
  };
}
