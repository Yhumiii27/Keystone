// View models of the Resource requests and Approvals screens (docs/spec/08 §5.4, §6.4; prototype reqRow / reqKpis /
// apprKpis / team, logic 4117–4145): DAL rows + domain figures → translated, serialisable strings and flags for the
// Server Components and their client islands. Pure (no server-only import at runtime).
import { LO, OK, shade } from '@/components/app/tones';
import {
  AVG_RESPONSE_DEPARTMENT, AVG_RESPONSE_PM, REQUEST_FILTERS, RESCHEDULE_SHIFTS, approvalKpis, approveTarget, datesText, firstName,
  matchesFilter, pendingHoursByPerson, projectsText, requestChipCounts, requestImpact, requestKpis, requestSteps, shiftedDates, teamLoad,
  weekLabel, type PoolFacts, type RequestFilter,
} from '@/domain/requests';
import { initials } from '@/lib/format';
import { REQUEST_STATUS_TAG, shortDateOfIso } from '@/server/db/codes';
import type { Lang, T } from '@/i18n/translate';
import type { ResourceRequestRow } from '@/server/dal/requests';
import type { ApprovalsScreenData } from '@/server/dal/requests-screens';
import {
  approveLabelText, committedText, dataText, decidedSubText, hoursNum, hoursRequestedText, hoursText, impactText, inListText, nothingWaitingText, reqT,
  responseText, teamLoadLabel,
} from './i18n';

export interface KpiView {
  label: string;
  value: string;
  sub: string;
  color: string;
}

export interface ChipView {
  value: RequestFilter | null;
  label: string;
  count: number;
}

/** One row of the Requests grid table (and the shared fields of the Approvals cards). */
export interface RequestRowView {
  id: string;
  /** "Sent Fri 25 Sep". */
  sent: string;
  title: string;
  critical: boolean;
  high: boolean;
  /** "A1250 · Steel erection — Bays 3–4". */
  actLine: string;
  initials: string;
  person: string;
  dept: string;
  dates: string;
  hours: string;
  statusLabel: string;
  tagClass: string;
  steps: [boolean, boolean, boolean];
  stepLabel: string;
  /** Decision line, or "Awaiting {department head}". */
  response: string;
  isPending: boolean;
  isReschedule: boolean;
  isRejected: boolean;
  /** "12 Oct – 16 Oct" (reschedule proposals). */
  proposed: string;
  /** Sent by the viewer: PM actions (withdraw, accept, re-request) are available. */
  mine: boolean;
}

/** `reqRow` (4117) translated. `viewer` = full and short name of the viewer (PM actions on their own requests only). */
export function requestRowView(r: ResourceRequestRow, t: T, lang: Lang, viewer: { name: string; short: string }): RequestRowView {
  const tt = reqT(t, lang);
  const who = r.person ? firstName(r.person) : r.resource;
  return {
    id: r.id,
    sent: tt('Sent ' + r.sentText),
    title: dataText(r.title, lang),
    critical: !!r.activity?.critical,
    high: r.priority === 'high',
    actLine: r.activity ? `${r.activity.code} · ${tt(r.activity.name)}` : tt('Activity'),
    initials: initials(r.resource),
    person: tt(r.resource),
    dept: tt(r.department),
    dates: tt(datesText(r.start, r.due)),
    hours: hoursText(r.hours, lang),
    statusLabel: tt(r.statusLabel),
    tagClass: `tag ${REQUEST_STATUS_TAG[r.status]}`,
    steps: requestSteps(r.status),
    stepLabel: r.status === 'approved' ? inListText(who, lang) : tt('Not sent to the person yet'),
    response: r.response ? responseText(r.response, tt, lang) : tt(`Awaiting ${r.departmentHead ?? r.department}`),
    isPending: r.status === 'pending',
    isReschedule: r.status === 'reschedule',
    isRejected: r.status === 'rejected',
    proposed: r.proposedStart && r.proposedDue ? tt(datesText(r.proposedStart, r.proposedDue)) : '',
    mine: r.requestedBy === viewer.short || r.requestedByName === viewer.name,
  };
}

export interface RequestsScreenModel {
  kpis: KpiView[];
  chips: ChipView[];
  rows: RequestRowView[];
}

/** Requests screen (`reqKpis`, `reqChips`, `reqRows`, 4134–4138). `rows` = the outbox shown (all statuses). */
export function requestsScreenModel(
  rows: readonly ResourceRequestRow[],
  filter: RequestFilter | null,
  t: T,
  lang: Lang,
  viewer: { name: string; short: string },
): RequestsScreenModel {
  const tt = reqT(t, lang);
  const k = requestKpis(rows);
  const counts = requestChipCounts(rows);
  const projects = projectsText(rows.map((r) => r.projectShortName ?? r.projectShort));
  return {
    kpis: [
      { label: tt('Requests sent'), value: String(k.sent), sub: tt(projects ? `${projects} · last 2 weeks` : 'last 2 weeks'), color: OK },
      { label: tt('Awaiting review'), value: String(k.pending), sub: hoursRequestedText(k.pendingHours, lang), color: k.pending ? LO : OK },
      { label: tt('Needs your answer'), value: String(k.reschedule), sub: tt('Reschedule proposals'), color: k.reschedule ? LO : OK },
      { label: tt('Approved'), value: String(k.approved), sub: tt('Now in team members’ lists'), color: OK },
      { label: tt('Avg response'), value: tt(AVG_RESPONSE_PM), sub: tt('Department heads'), color: OK },
    ],
    chips: REQUEST_FILTERS.map((f, i) => ({ value: f.value, label: tt(f.label), count: counts[i] })),
    rows: rows.filter((r) => matchesFilter(r.status, filter)).map((r) => requestRowView(r, t, lang, viewer)),
  };
}

// ── Approvals ──────────────────────────────────────────────────────────────────────────────────────────

export interface QueueItemView extends RequestRowView {
  /** "Sent Fri 25 Sep by R. Aubert". */
  meta: string;
  /** Project tag ("Harbor Line"). */
  project: string;
  note: string;
  impact: string;
  impactColor: string;
  /** "Approve & send to {first}" target (first name, or the translated "procurement"). */
  target: string;
  /** Full button label: "Approve & send to Julien" / FR "Approuver et envoyer aux achats" for a contract role. */
  approveLabel: string;
  /** "→ {dates}" for the +1 / +2 / +3 week shifts. */
  proposedByShift: string[];
  shiftLabels: string[];
}

export interface TeamRowView {
  name: string;
  role: string;
  initials: string;
  w1: { v: string; bg: string; fg: string };
  w2: { v: string; bg: string; fg: string };
  pend: string;
  pendColor: string;
}

export interface ApprovalsModel {
  head: { name: string; initials: string; role: string } | null;
  kpis: KpiView[];
  queue: QueueItemView[];
  decided: RequestRowView[];
  /** "Nothing waiting — every request for {dept} is decided". */
  queueEmpty: string;
  team: TeamRowView[];
  /** Team load week headers ("28 Sep", "5 Oct"). */
  weekHeads: [string, string];
}

/** Approvals of one department (`apprKpis`, `queue`, `decided`, `team`, 4130–4145). */
export function approvalsModel(
  data: ApprovalsScreenData,
  t: T,
  lang: Lang,
  viewer: { name: string; short: string },
): ApprovalsModel {
  const tt = reqT(t, lang);
  const d = data.department;
  const pool: PoolFacts[] = data.pool.people.map((p) => ({ name: p.name, department: p.department, loads: p.loads }));
  const weekStarts = data.pool.weeks.map((w) => w.start);
  const team = teamLoad(pool, d.name, pendingHoursByPerson(data.allPending));
  const k = approvalKpis([...data.pending, ...data.decided], team, d);
  const w0 = weekStarts[0] ? shortDateOfIso(weekStarts[0]) : '28 Sep';
  const w1 = weekStarts[1] ? shortDateOfIso(weekStarts[1]) : '5 Oct';
  const cell = (v: number) => ({ v: `${v}%`, ...shade(v) });
  return {
    head: d.head ? { name: d.head, initials: d.headInitials ?? initials(d.head), role: tt(d.headTitle ?? '') } : null,
    kpis: [
      { label: tt('Pending approvals'), value: String(k.pending), sub: hoursRequestedText(k.pendingHours, lang), color: k.pending ? LO : OK },
      { label: teamLoadLabel(w0, tt, lang), value: `${k.teamLoad}%`, sub: tt(k.teamSize === 1 ? '1 person' : `${k.teamSize} people`), color: k.teamLoad > 100 ? LO : OK },
      { label: tt('Capacity · 8 wks'), value: `${k.capacityH} h`, sub: committedText(k.committedH, lang), color: k.committedH > k.capacityH ? LO : OK },
      { label: tt('Decided'), value: String(k.decided), sub: decidedSubText(k.approved, k.rejected, lang), color: OK },
      { label: tt('Avg response'), value: tt(AVG_RESPONSE_DEPARTMENT), sub: tt('Target ≤ 1 day'), color: OK },
    ],
    queue: data.pending.map((r) => {
      const base = requestRowView(r, t, lang, viewer);
      const imp = requestImpact(r, pool, weekStarts);
      return {
        ...base,
        meta: `${base.sent} ${tt('by')} ${r.requestedBy}`,
        project: tt(r.projectShortName ?? r.projectShort),
        note: dataText(r.note, lang),
        impact: imp ? impactText(imp.first, imp.load, weekLabel(r.start), imp.after, tt, lang) : tt('No named resource — contract hire, no current load'),
        impactColor: imp?.over ? LO : 'var(--color-neutral-400)',
        target: r.person ? approveTarget(r.person) : tt(approveTarget(null)),
        approveLabel: approveLabelText(r.person ? approveTarget(r.person) : null, tt, lang),
        proposedByShift: RESCHEDULE_SHIFTS.map((s) => {
          const x = shiftedDates(r.start, r.due, s.value);
          return tt(datesText(x.start, x.due));
        }),
        shiftLabels: RESCHEDULE_SHIFTS.map((s) => tt(s.label)),
      };
    }),
    decided: data.decided.map((r) => requestRowView(r, t, lang, viewer)),
    queueEmpty: nothingWaitingText(d.name, tt),
    team: team.map((p) => {
      const job = data.pool.people.find((x) => x.name === p.name)?.jobTitle ?? '';
      return {
        name: p.name, role: tt(job), initials: initials(p.name), w1: cell(p.w1), w2: cell(p.w2),
        pend: p.pending ? `+${hoursNum(p.pending, lang)} h` : '—', pendColor: p.pending ? LO : 'var(--color-neutral-500)',
      };
    }),
    weekHeads: [tt(w0), tt(w1)],
  };
}
