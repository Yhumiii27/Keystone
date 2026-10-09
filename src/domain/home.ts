// Home — role-specific landing page (docs/spec/03 §1; prototype `homes`, logic 4421–4435).
// Pure builders: each role turns its inputs into a HomeView of English source strings (money already formatted
// for the language, as the prototype's `f()`), rendered through t() by src/features/home.
// The KPI/row rules re-use other modules' formulas (Overview 3792–3808, Budget 3834, Schedule 3859, Resources 3866–3882,
// My work 4058–4071, Approvals 4120–4145, ECO 4192–4194/4350, PLM 4176–4179/4280–4281, BOM 4204–4223,
// Purchase orders 4308–4328, Skills 4394, Drawings 4373–4376); each is reproduced here at the scale the Home needs.
import { screenHref, type RoleKey, type ScreenId } from '@/config/screens';
import type { Lang } from '@/i18n/translate';
import { STATUS_DATE, TODAY, dateOf, dayLabel, money } from '@/lib/format';
import { weekHoursOf } from './kpis';
import { mainShortfall, peakWeekNumbers, unmetDemand, weekRangesText, type CapacityRow } from './resources';
import { nextWeekEnd, spanText } from './tasks';

// ── View model ───────────────────────────────────────────────────────────────────────────────────────────

/**
 * Display text: an English source string (rendered with t()), or a template with parameters for the dynamic
 * sentences the prototype dictionary cannot translate (FR in src/i18n/extra/home.json; string params go through t()).
 */
export type Txt = string | { tpl: string; p: Record<string, string | number> };

export interface HomeKpi {
  label: Txt;
  value: Txt;
  sub: Txt;
  /** Value in LO (accent-300) instead of OK (text). */
  lo: boolean;
}

export interface HomeRow {
  title: Txt;
  sub: Txt;
  /** '' = no tag. */
  tag: Txt;
  tagClass: string;
  href: string;
}

export interface HomeList {
  title: Txt;
  rows: HomeRow[];
}

export interface HomeView {
  greeting: Txt;
  sub: Txt;
  kpis: HomeKpi[];
  left: HomeList;
  right: HomeList;
}

/** Lower-cases the initial of a translated fragment unless it opens an acronym ("PV modules…" stays). */
const lcInitial = (s: string) => (/^\p{Lu}\p{Ll}/u.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s);

/**
 * Fills a Txt with a translator (t for strings, template + translated string params). A placeholder may carry the
 * `|lc` modifier (`{name|lc}`, FR templates only: "Prochain : {name|lc}" → "Prochain : structure hors d’eau").
 */
export function renderTxt(x: Txt, t: (s: string) => string): string {
  if (typeof x === 'string') return t(x);
  return t(x.tpl).replace(/\{(\w+)(\|lc)?\}/g, (m, k: string, lc: string | undefined) => {
    const v = x.p[k];
    if (v == null) return m;
    const s = typeof v === 'number' ? String(v) : t(v);
    return lc ? lcInitial(s) : s;
  });
}

// ── Shared tags and links ───────────────────────────────────────────────────────────────────────────────

const TAG = { accent: 'tag tag-accent', outline: 'tag tag-outline', neutral: 'tag tag-neutral' } as const;

/** Screen URL with prototype selection keys mapped to search params (docs/spec/00 §8.3). */
export function homeHref(screen: ScreenId, opts: { code?: string; taskId?: string; params?: Record<string, string> } = {}): string {
  const base = screenHref(screen, { code: opts.code, taskId: opts.taskId });
  const qs = new URLSearchParams(opts.params ?? {}).toString();
  return qs ? `${base}?${qs}` : base;
}

const kpi = (label: Txt, value: Txt | number, sub: Txt, lo: boolean): HomeKpi => ({ label, value: typeof value === 'number' ? String(value) : value, sub, lo });
const row = (title: Txt, sub: Txt, tag: Txt | number, tagClass: string, href: string): HomeRow => ({
  title, sub, tag: typeof tag === 'number' ? String(tag) : tag, tagClass, href,
});
const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

// ── Inputs (prototype-shaped records) ───────────────────────────────────────────────────────────────────

export interface Persona {
  name: string;
  /** EN title ("Portfolio director"). */
  title: string;
}

export interface CurrentProject {
  code: string;
  /** English name ("Harbor Line Terminal Expansion"). */
  name: string;
  /** 3-letter key used by requests, BOM usage, ECO targets ("HLT"). */
  shortCode: string;
}

/** Cumulative EVM series of a project (k€); EV/AC stop at the data date. */
export interface EvmSeries {
  bac: number;
  pv: number[];
  ev: number[];
  ac: number[];
}

export interface ScheduleHeader {
  /** Project start, month offset from Jan 2026. */
  start: number;
  floatDays: number;
  /** "−27 days". */
  floatText: string;
  /** "−27 d". */
  floatShort: string;
  /** "4 of 8 packages critical". */
  critText: string;
  /** "2 of 6". */
  milesText: string;
  milestones: { name: string; baselineMonth: number; forecastMonth: number; statusLabel: string }[];
}

/** Overview KPI tile (src/domain/portfolio.ts `portfolioKpis`): EN source strings, money formatted; `alert` = LO. */
export interface PortfolioKpi {
  label: string;
  value: string;
  sub: string;
  alert: boolean;
}

export interface Part {
  ref: string;
  name: string;
  mfr: string;
  /** 'Manufactured' | 'Purchased'. */
  mb: string;
  /** Unit price (€). */
  price: number;
  /** 'Validated' | 'Not validated' | 'Outdated' | 'Obsolete'. */
  status: string;
  /** Quantity per project short code. */
  usage: Record<string, number>;
}

export interface PurchaseOrder {
  id: string;
  supplier: string;
  status: string;
  /** [part ref, ordered qty, received qty]. */
  lines: [string, number, number][];
  /** Activity the order feeds (late delivery when it has started). */
  act: string | null;
  /**
   * Order value in € from its own line prices (purchasing DAL), as Purchase orders shows it; absent = the prototype's
   * Σ list price × quantity (`poValue` 4309). Identical on the seed, different for orders priced by an RFQ award.
   */
  valueEur?: number;
}

export type EcoApprover = 'englead' | 'quality' | 'pm';
export interface Eco {
  id: string;
  type: string;
  status: string;
  /**
   * The status is already the effective one, as Vigie reports it (effectivity lock included): ECOs of the Vigie
   * mirror. Absent for the prototype rows, whose effective status is derived from the approvals (`ecoStatus`).
   */
  reported?: boolean;
  /** Decision per key ('pending' | 'ok' | 'rejected'); a decision recorded in Keystone counts once recorded. */
  appr: Record<EcoApprover, string>;
  projects: string[];
  parts: string[];
  title: string;
}

export interface ResourceRequest {
  id: string;
  pm: string;
  /** Project short code. */
  project: string;
  person: string;
  dept: string;
  title: string;
  hours: number;
  /** Working-day offsets (TODAY = 4). */
  start: number;
  due: number;
  status: 'draft' | 'pending' | 'approved' | 'reschedule' | 'rejected' | 'withdrawn';
}

/** PEOPLE row: name, role, load % for the next 8 weeks. */
export interface PersonLoad {
  name: string;
  role: string;
  loads: number[];
}

export interface Todo {
  id: string;
  person: string;
  title: string;
  project: string;
  status: 'todo' | 'doing' | 'review' | 'done';
  start: number;
  due: number;
  logged: number;
}

export interface Drawing {
  no: string;
  title: string;
  rev: string;
  state: string;
}

/** Change request with its approval chain (decision codes 'pending' | 'ok' | 'rejected' | 'na'). */
export interface ChangeRequest {
  /** Project code ("HLT-026"). */
  code: string;
  /** Short project name ("Harbor Line"). */
  projectName: string;
  id: string;
  title: string;
  amount: number;
  days: number;
  /** "24 Sep". */
  date: string;
  /** 'draft' | 'in_review' | 'approved' | 'rejected'. */
  status: string;
  chain: Partial<Record<'pm' | 'director' | 'client' | 'ccb', string>>;
}

/** Client deliverable row (DELIVERABLES 3464): [id, title, type, status, note]. */
export interface ClientDeliverable {
  id: string;
  title: string;
  type: string;
  status: string;
  note: string;
}

/** A line of the project's deliverables register (quality DAL `listDeliverables`), as the client Home needs it. */
export interface RegisterDeliverable {
  number: string;
  title: string;
  /** Settings label of the type ("Test & inspection reports"). */
  typeLabel: string;
  status: 'planned' | 'in_progress' | 'internal_review' | 'submitted' | 'accepted' | 'rejected';
  statusLabel: string;
  /** The register's acceptance text ("Accept by 2 Oct", "Issue 30 Sep", "25 Sep · comments issued"). */
  acceptanceText: string;
  /** ISO date of the client's acceptance (PV), null when not accepted. */
  acceptedOn: string | null;
  /** The same date as displayed ("18 Sep"). */
  acceptedOnText: string | null;
}

/**
 * Deliverables on the client Home (the prototype's static DELIVERABLES 3464: D-014…D-017 of Harbor Line), from the
 * register: being produced, waiting for the client, rejected, or accepted since `acceptedSince` (ISO, the status date
 * − 30 days); planned ones and older acceptances stay on the client portal. Register order.
 */
export function clientHomeDeliverables(rows: RegisterDeliverable[], acceptedSince: string): ClientDeliverable[] {
  return rows
    .filter((d) => d.status !== 'planned' && (d.status !== 'accepted' || (!!d.acceptedOn && d.acceptedOn >= acceptedSince)))
    .map((d) => ({
      id: d.number, title: d.title, type: d.typeLabel, status: d.statusLabel,
      note: d.status === 'accepted' && d.acceptedOnText ? `Signed ${d.acceptedOnText}` : d.acceptanceText,
    }));
}

/** A milestone of the project's billing plan (client portal `invoices`). */
export interface BillingInvoice {
  /** "M3" on a contract plan; null on a legacy monthly plan. */
  milestoneNumber: string | null;
  /** "M3 Structure topped out" (contract) / "Sep" (legacy monthly plan). */
  milestone: string;
  amountKeur: number;
  status: string;
  /** "INV-2026-003"; null on a legacy plan. */
  invoiceNumber: string | null;
  /** Payment due date as displayed ("10 Nov"); null when unknown. */
  dueText: string | null;
}

/** The client's open invoice: the first invoiced, unpaid milestone of the billing plan; null when none. */
export function clientOpenInvoice(plan: BillingInvoice[]): ClientInput['invoice'] {
  const m = plan.find((x) => x.status === 'invoiced');
  if (!m) return null;
  // "M3 Structure topped out" → number "M3" + name "Structure topped out" (the name is translated, the number is not).
  const name = m.milestoneNumber && m.milestone.startsWith(m.milestoneNumber + ' ') ? m.milestone.slice(m.milestoneNumber.length + 1) : m.milestone;
  return { invoiceNumber: m.invoiceNumber, milestoneNumber: m.milestoneNumber, name, amount: m.amountKeur, due: m.dueText };
}

/** "INV-2026-003 · M3 Structure topped out · €1.38M · due 10 Nov" (parts the plan does not have are left out). */
function invoiceSub(inv: NonNullable<ClientInput['invoice']>, lang: Lang): Txt {
  const p: Record<string, string> = { name: inv.name, amt: money(inv.amount, lang), inv: inv.invoiceNumber ?? '', no: inv.milestoneNumber ?? '', date: inv.due ?? '' };
  const parts = [inv.invoiceNumber ? '{inv}' : '', inv.milestoneNumber ? '{no} {name}' : '{name}', '{amt}', inv.due ? 'due {date}' : ''];
  return { tpl: parts.filter(Boolean).join(' · '), p };
}

export interface PortfolioAlert {
  title: string;
  detail: string;
  href: string;
}

/** Labels shared by several roles. */
export interface Lookups {
  /** PROJ_NAMES: short code → short project name ("HLT" → "Harbor Line"). */
  projectNames: Record<string, string>;
}

// ── Shared derivations ───────────────────────────────────────────────────────────────────────────────────

/** EVM indices at the data date (logic 3786–3788). */
export function evmAtDate(s: EvmSeries) {
  const n = s.ev.length;
  const ev = s.ev[n - 1] ?? 0, ac = s.ac[n - 1] ?? 0, pv = s.pv[n - 1] ?? 0;
  const cpi = ac ? ev / ac : 1, spi = pv ? ev / pv : 1;
  return { ev, ac, pv, cpi, spi, eac: cpi ? s.bac / cpi : s.bac };
}

/** Effective change-request status from its chain (allCRs, line 4593): a rejected step rejects, all steps ok approve. */
export function changeRequestStatus(cr: Pick<ChangeRequest, 'status' | 'chain'>): string {
  const need = Object.values(cr.chain).filter((v) => v && v !== 'na');
  if (!need.length) return cr.status;
  if (need.includes('rejected')) return 'rejected';
  if (need.every((v) => v === 'ok')) return 'approved';
  return cr.status;
}

/**
 * Effective ECO status (allEcos, line 4192). ECOs of the Vigie mirror carry it (`reported`: Vigie decides the status,
 * effectivity lock included; a decision recorded in Keystone does not move it before Vigie does). Prototype rows
 * derive it without overrides: any rejection → Rejected; all approvals ok → Released.
 */
export function ecoStatus(e: Eco): string {
  if (e.reported) return e.status;
  const appr = Object.values(e.appr);
  if (appr.includes('rejected')) return 'Rejected';
  if ((['englead', 'quality', 'pm'] as const).every((k) => e.appr[k] === 'ok') && e.status !== 'Draft') return 'Released';
  return e.status;
}
const ecoOpen = (s: string) => s !== 'Released' && s !== 'Rejected';
const ecoTag = (s: string) => (s === 'Released' ? TAG.neutral : s === 'Rejected' ? TAG.outline : s === 'In approval' ? TAG.accent : TAG.outline);
const poTag = (s: string) =>
  s === 'Received' ? TAG.neutral : s === 'Partially received' ? TAG.accent : s === 'Cancelled' || s === 'Draft' ? TAG.neutral : TAG.outline;
const partTag = (s: string) => (s === 'Validated' ? TAG.neutral : s === 'Not validated' ? TAG.outline : TAG.accent);
const dwgTag = (s: string) => (s === 'Released' ? TAG.neutral : s === 'Obsolete' ? TAG.outline : TAG.accent);
const usedIn = (p: Part) => Object.keys(p.usage).filter((k) => p.usage[k] > 0);

/** Order value in € (poValue, line 4309): the order's own value when known, else Σ list price × quantity. */
export function poValue(o: PurchaseOrder, parts: Map<string, Part>): number {
  return o.valueEur ?? o.lines.reduce((a, [ref, q]) => a + (parts.get(ref)?.price ?? 0) * q, 0);
}

/** BOM articles of a project not fully ordered (shortfall, line 4328). */
export function bomShortfall(parts: Part[], pos: PurchaseOrder[], p3: string) {
  const ordered: Record<string, number> = {};
  for (const o of pos) if (o.status !== 'Cancelled') for (const [ref, q] of o.lines) ordered[ref] = (ordered[ref] ?? 0) + q;
  return parts
    .filter((p) => (p.usage[p3] ?? 0) > 0 && p.mb === 'Purchased' && (ordered[p.ref] ?? 0) < p.usage[p3])
    .map((p) => ({ part: p, need: p.usage[p3] - (ordered[p.ref] ?? 0) }));
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const lcFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
/** "Second steel crew — schedule recovery" → "Second steel crew". */
const shortTitle = (s: string) => s.split(' — ')[0];
const crAwaiting = (cr: ChangeRequest, step: 'client' | 'director') => changeRequestStatus(cr) === 'in_review' && cr.chain[step] === 'pending';

/** "Good morning, Marie" / "Portfolio director · Friday 25 Sep 2026" (homeVals, line 4435). */
function greeting(persona: Persona): Pick<HomeView, 'greeting' | 'sub'> {
  return { greeting: 'Good morning, ' + persona.name.split(' ')[0], sub: persona.title + ' · Friday ' + STATUS_DATE };
}

const NO_DATA = 'No planning data yet';

// ── Director ─────────────────────────────────────────────────────────────────────────────────────────────

export interface DirectorInput {
  lang: Lang;
  persona: Persona;
  /** Current project (the header project): its purchase orders feed the PO row, as in the prototype. */
  project: CurrentProject;
  /** The Portfolio overview's KPI tiles for the selected zone (`portfolioKpis`); the Home shows the first four. */
  portfolioKpis: PortfolioKpi[];
  /** The Overview's "Needs attention" items, filtered by zone. */
  alerts: PortfolioAlert[];
  /** Change requests of every project. */
  changeRequests: ChangeRequest[];
  purchaseOrders: PurchaseOrder[];
  ecos: Eco[];
  requests: ResourceRequest[];
}

export function directorHome(i: DirectorInput): HomeView {
  const { lang, project } = i;
  // portfolioKpis.slice(0,4): Total budget, Actual cost, Forecast (EAC), Cost perf. (CPI) — same tiles as the Overview.
  const kpis = i.portfolioKpis.slice(0, 4).map((k) => kpi(k.label, k.value, k.sub, k.alert));
  // Change requests in review across the portfolio (the prototype hard-codes CR-008; derived here from the register).
  const crs = i.changeRequests.filter((c) => changeRequestStatus(c) === 'in_review');
  const crSub = crs.length
    ? crs.map((c) => `${c.projectName} · ${c.id} ${lcFirst(shortTitle(c.title))} · ${money(c.amount, lang, { signed: true })}`).join(', ')
    : 'None';
  const crHref = crs.length ? homeHref('changes', { code: crs[0].code, params: { cr: crs[0].id } }) : homeHref('changes', { code: project.code });
  const awaiting = i.purchaseOrders.filter((o) => o.status === 'Awaiting approval');
  const inApproval = i.ecos.filter((e) => ecoStatus(e) === 'In approval');
  const pending = i.requests.filter((r) => r.status === 'pending');
  return {
    ...greeting(i.persona),
    kpis,
    left: { title: 'Needs attention', rows: i.alerts.map((a) => row(a.title, a.detail, '', '', a.href)) },
    right: {
      title: 'Approvals across the portfolio',
      rows: [
        row('Change requests pending', crSub, crs.length, crs.length ? TAG.accent : TAG.neutral, crHref),
        row('Purchase orders awaiting approval', awaiting.map((o) => o.id).join(', ') || 'None', awaiting.length, TAG.outline, homeHref('orders', { code: project.code })),
        row('ECOs in approval', inApproval.map((e) => e.id).join(', ') || 'None', inApproval.length, TAG.outline, homeHref('eco')),
        row('Resource requests pending', `Department heads · ${pending.length} open`, pending.length, TAG.neutral, homeHref('requests')),
      ],
    },
  };
}

// ── Project manager ──────────────────────────────────────────────────────────────────────────────────────

export interface PmInput {
  lang: Lang;
  persona: Persona;
  project: CurrentProject;
  /** null for projects without planning data (empty KPIs, never another project's figures). */
  evm: EvmSeries | null;
  schedule: ScheduleHeader | null;
  requests: ResourceRequest[];
  purchaseOrders: PurchaseOrder[];
  parts: Part[];
  ecos: Eco[];
}

const REQ_TAG: Record<ResourceRequest['status'], [string, string]> = {
  draft: ['Draft', TAG.outline],
  pending: ['Pending', TAG.outline],
  reschedule: ['Reschedule proposed', TAG.accent],
  approved: ['Approved', TAG.neutral],
  rejected: ['Rejected', TAG.neutral],
  withdrawn: ['Rejected', TAG.neutral],
};

export function pmHome(i: PmInput): HomeView {
  const { lang, project } = i;
  const code = project.code;
  let kpis: HomeKpi[];
  if (i.evm && i.schedule) {
    const e = evmAtDate(i.evm);
    const s = i.schedule;
    kpis = [
      kpi('SPI', e.spi.toFixed(2), `Earning ${Math.round(e.spi * 100)}¢ of planned work per $1`, e.spi < 0.97),
      kpi('CPI', e.cpi.toFixed(2), 'Target ≥ 1.00', true),
      kpi('Forecast (EAC)', money(e.eac, lang), 'At current CPI', true),
      kpi('Critical path float', s.floatText, s.critText, s.floatDays < 0),
    ];
  } else {
    kpis = ['SPI', 'CPI', 'Forecast (EAC)', 'Critical path float'].map((l) => kpi(l, '—', NO_DATA, false));
  }
  const parts = new Map(i.parts.map((p) => [p.ref, p]));
  const waiting: HomeRow[] = [
    ...i.purchaseOrders
      .filter((o) => o.status === 'Awaiting approval')
      .map((o) => row(`${o.id} · ${o.supplier}`, 'Purchase order · ' + money(poValue(o, parts) / 1000, lang), 'Approve', TAG.accent, homeHref('orders', { code, params: { po: o.id } }))),
    ...i.ecos
      .filter((e) => ecoStatus(e) === 'In approval' && e.appr.pm === 'pending' && e.projects.includes(project.shortCode))
      .map((e) => row(e.id, e.title, 'Approve as PM', TAG.accent, homeHref('eco', { params: { eco: e.id } }))),
  ];
  // Static in the prototype ("Schedule slip −27 d"); shown here only when the project's float is negative.
  if (i.schedule && i.schedule.floatDays < 0)
    waiting.push(
      row('Re-baseline proposal', { tpl: 'Schedule slip {d} · BL2 to submit to the change control board', p: { d: i.schedule.floatShort } }, 'Prepare', TAG.outline, homeHref('schedule', { code })),
    );
  return {
    ...greeting(i.persona),
    kpis,
    left: {
      title: { tpl: 'My resource requests — {name}', p: { name: project.name } },
      rows: i.requests
        .filter((r) => r.project === project.shortCode)
        .slice(0, 6)
        .map((r) => row(r.title, `${r.person} · ${r.dept} · ${r.hours} h`, REQ_TAG[r.status][0], REQ_TAG[r.status][1], homeHref('requests'))),
    },
    right: { title: 'Waiting for me', rows: waiting },
  };
}

// ── Department head ──────────────────────────────────────────────────────────────────────────────────────

export interface DeptHeadInput {
  persona: Persona;
  /** Department of the viewer ("Engineering"). */
  dept: string;
  requests: ResourceRequest[];
  people: PersonLoad[];
  /** DEPT_OF: person → department. */
  deptOf: Record<string, string>;
  /** REQ_STATUS: status → [label, tag class]. */
  reqStatus: Record<string, [string, string]>;
  lookups: Lookups;
  /** ISO Mondays of the pool's window weeks (peak week numbers, A-12). */
  weekStarts: string[];
  /** Department capacity vs demand over the window, as the Resources bars (unmet demand, A-12). */
  departments: CapacityRow[];
}

/**
 * "Over-allocated" sub of the department head's Home, as Resources computes it (A-12; the prototype's constant "Peak
 * weeks 41–43"): the ISO weeks in which someone is above 110 %.
 */
export function peakWeeksTxt(people: Pick<PersonLoad, 'loads'>[], weekStarts: readonly string[]): Txt {
  const weeks = peakWeekNumbers(people, weekStarts);
  if (!weeks.length) return 'No week above 110%';
  return { tpl: weeks.length === 1 ? 'Peak week {range}' : 'Peak weeks {range}', p: { range: weekRangesText(weeks) } };
}

/** "Unmet demand" sub (A-12; the prototype's constant "Mostly engineering"): the department short the most. */
export function shortfallTxt(rows: readonly CapacityRow[]): Txt {
  const top = mainShortfall(rows);
  return top ? { tpl: 'Mostly {dept|lc}', p: { dept: top.name } } : 'No department over capacity';
}

/** Resource KPIs of the Resources screen (logic 3869–3882): utilization = mean of 8-week averages; over-allocated = peak > 110 %. */
export function teamLoad(people: PersonLoad[]) {
  const avgs = people.map((p) => avg(p.loads));
  return {
    utilization: people.length ? Math.round(avgs.reduce((a, b) => a + b, 0) / people.length) : 0,
    over: people.filter((p) => Math.max(...p.loads) > 110).length,
  };
}

export function deptHeadHome(i: DeptHeadInput): HomeView {
  const pending = i.requests.filter((r) => r.dept === i.dept && r.status === 'pending');
  const { utilization, over } = teamLoad(i.people);
  const unmet = unmetDemand(i.departments);
  const dates = (r: ResourceRequest) => dayLabel(r.start).slice(4) + ' – ' + dayLabel(r.due).slice(4);
  return {
    ...greeting(i.persona),
    kpis: [
      kpi('Awaiting my approval', pending.length, 'Resource requests · ' + i.dept, pending.length > 0),
      kpi('Team utilization', utilization + '%', 'Target 85–95%', false),
      // A-12 (chapter 4): the peak weeks and the unmet demand are computed as on Resources — the prototype's constants were
      // "Peak weeks 41–43" and "240 h · Mostly engineering".
      kpi('Over-allocated', over + plural(over, ' person', ' people'), peakWeeksTxt(i.people, i.weekStarts), over > 0),
      kpi('Unmet demand', `${unmet} h`, shortfallTxt(i.departments), unmet > 0),
    ],
    left: {
      title: { tpl: 'Approval queue — {dept}', p: { dept: i.dept } },
      rows: pending.map((r) => {
        const [label, cls] = i.reqStatus[r.status] ?? [r.status, TAG.outline];
        return row(r.title, `${r.person} · ${i.lookups.projectNames[r.project] ?? r.project} · ${r.hours} h · ${dates(r)}`, label, cls, homeHref('approvals'));
      }),
    },
    right: {
      title: 'Team load — next 8 weeks',
      rows: i.people
        .filter((p) => (i.deptOf[p.name] ?? '') === i.dept)
        .map((p) => {
          const a = Math.round(avg(p.loads));
          return row(p.name, p.role, a + '%', a > 100 ? TAG.accent : TAG.neutral, homeHref('resources'));
        }),
    },
  };
}

// ── Team member ──────────────────────────────────────────────────────────────────────────────────────────

export interface MemberInput {
  persona: Persona;
  /** Person whose work is shown: the viewer (the prototype always showed Hélène Sauvage — defect, docs/spec/00 §7.16). */
  person: string;
  todos: Todo[];
  people: PersonLoad[];
  /** CERTS: person → certification text. */
  certs: Record<string, string>;
  /** STATUS_L: task status → label. */
  statusLabels: Record<string, string>;
  lookups: Lookups;
  /** A-12 (10 OQ18): hours of the person's time entries this week (`loggedInWeek`); absent → the prototype's formula. */
  loggedThisWeekH?: number;
}

/** My work buckets (logic 4061–4071). */
export function workSummary(todos: Todo[], person: string, people: PersonLoad[]) {
  const mine = todos.filter((t) => t.person === person);
  const open = mine.filter((t) => t.status !== 'done');
  const logged = mine.reduce((a, t) => a + (t.start <= TODAY ? t.logged : 0), 0);
  const loads = people.find((p) => p.name === person)?.loads ?? [80, 80];
  return {
    open,
    dueToday: open.filter((t) => t.due === TODAY).length,
    overdue: open.filter((t) => t.due < TODAY).length,
    nextWeek: open.filter((t) => t.due > TODAY && t.due <= nextWeekEnd()).length,
    logged,
    load: Math.round((loads[0] + loads[1]) / 2),
  };
}

export function memberHome(i: MemberInput): HomeView {
  const w = workSummary(i.todos, i.person, i.people);
  const logged = i.loggedThisWeekH ?? w.logged;
  // Computed instead of the prototype's literals "28 Sep – 2 Oct" and "of 40 h" (same values at the status date): next
  // week's span (as My work's calendar) and the standard calendar's weekly hours (5 × 8 h, S-2).
  const weekH = weekHoursOf();
  return {
    ...greeting(i.persona),
    kpis: [
      kpi('Due today', w.dueToday, dayLabel(TODAY), false),
      kpi('Overdue', w.overdue, 'Needs a new date or a push', w.overdue > 0),
      kpi('Next week', w.nextWeek, spanText(nextWeekEnd() - 4, nextWeekEnd()), false),
      kpi('Logged this week', logged.toFixed(1) + ' h', { tpl: 'of {h} h · {pct}%', p: { h: weekH, pct: Math.round((logged / weekH) * 100) } }, false),
    ],
    left: {
      title: 'My tasks',
      rows: w.open
        .slice(0, 6)
        .map((t) =>
          row(t.title, (i.lookups.projectNames[t.project] ?? t.project) + ' · due ' + dayLabel(t.due), i.statusLabels[t.status] ?? t.status, t.due <= TODAY ? TAG.accent : TAG.neutral, homeHref('task', { taskId: t.id })),
        ),
    },
    right: {
      title: 'This week',
      rows: [
        row('Hours logged', { tpl: 'Read from Lucca · {h} h this week', p: { h: w.logged } }, 'Lucca', TAG.neutral, homeHref('mywork')),
        row('Load', `Average ${w.load}% over the next 2 weeks`, w.load + '%', w.load > 100 ? TAG.accent : TAG.neutral, homeHref('mywork')),
        row('Skills & certifications', i.certs[i.person] || '—', 'View', TAG.outline, homeHref('skills')),
      ],
    },
  };
}

// ── Engineering lead ─────────────────────────────────────────────────────────────────────────────────────

export interface EngLeadInput {
  persona: Persona;
  ecos: Eco[];
  /** ECO_TYPES: type key → label. */
  ecoTypes: Record<string, string>;
  drawings: Drawing[];
  parts: Part[];
  skills: string[];
  /** SKILL_LV: person → level per skill (0–5). */
  skillLevels: Record<string, number[]>;
  people: PersonLoad[];
}

/** Skill coverage (logic 4394): a skill family is a gap when fewer than 2 people are at level ≥ 4. */
export function skillCoverage(skills: string[], people: PersonLoad[], levels: Record<string, number[]>) {
  return skills.map((name, i) => {
    const lv = people.map((p) => levels[p.name]?.[i] ?? 0);
    const experts = lv.filter((v) => v >= 4).length;
    const able = lv.filter((v) => v >= 3).length;
    return { name, experts, able, gap: experts < 2, text: `${experts} expert${experts === 1 ? '' : 's'} · ${able} at level ≥3` };
  });
}

export function engLeadHome(i: EngLeadInput): HomeView {
  const ecos = i.ecos.map((e) => ({ ...e, status: ecoStatus(e) }));
  const open = ecos.filter((e) => ecoOpen(e.status));
  const validated = i.parts.filter((p) => p.status === 'Validated').length;
  return {
    ...greeting(i.persona),
    kpis: [
      kpi('Open ECOs', open.length, `${ecos.length} in total`, false),
      kpi('Awaiting my approval', ecos.filter((e) => e.status === 'In approval' && e.appr.englead === 'pending').length, { tpl: 'As {role}', p: { role: i.persona.title } }, false),
      kpi('WIP / under review', i.drawings.filter((d) => d.state === 'WIP' || d.state === 'Under review').length, 'Linked to open ECOs', false),
      kpi(
        'Validated',
        (i.parts.length ? Math.round((validated / i.parts.length) * 100) : 0) + '%',
        `${i.parts.filter((p) => p.status === 'Not validated').length} awaiting qualification`,
        false,
      ),
    ],
    left: {
      title: 'ECOs waiting for engineering',
      rows: open.map((e) => row(`${e.id} · ${i.ecoTypes[e.type] ?? e.type}`, e.title, e.status, ecoTag(e.status), homeHref('eco', { params: { eco: e.id } }))),
    },
    right: {
      title: 'Watchlist',
      rows: [
        ...skillCoverage(i.skills, i.people, i.skillLevels)
          .filter((c) => c.gap)
          .map((c) =>
            row(
              c.name,
              { tpl: `Single expert — {e} expert${c.experts === 1 ? '' : 's'} · {a} at level ≥3`, p: { e: c.experts, a: c.able } },
              'Skill gap',
              TAG.outline,
              homeHref('skills'),
            ),
          ),
        ...i.drawings
          .filter((d) => d.state !== 'Released')
          .slice(0, 3)
          .map((d) => row(`${d.no} · rev ${d.rev}`, d.title, d.state, dwgTag(d.state), homeHref('drawings', { params: { dwg: d.no } }))),
      ],
    },
  };
}

// ── Quality manager ──────────────────────────────────────────────────────────────────────────────────────

export interface QualityInput {
  persona: Persona;
  project: CurrentProject;
  ecos: Eco[];
  parts: Part[];
  requests: ResourceRequest[];
}

export function qualityHome(i: QualityInput): HomeView {
  const ecos = i.ecos.map((e) => ({ ...e, status: ecoStatus(e) }));
  const inUseBad = i.parts.filter((p) => (p.status === 'Outdated' || p.status === 'Obsolete') && usedIn(p).length);
  const bomNotValidated = i.parts.filter((p) => (p.usage[i.project.shortCode] ?? 0) > 0 && p.status === 'Not validated').length;
  const inspections = i.requests.filter((r) => r.dept === 'Quality' && r.status === 'pending').length;
  return {
    ...greeting(i.persona),
    kpis: [
      kpi('ECOs awaiting quality', ecos.filter((e) => e.status === 'In approval' && e.appr.quality === 'pending').length, 'ISO 9001 review', false),
      kpi('Outdated still in use', inUseBad.length, inUseBad.map((p) => p.ref).join(' · ') || 'None', inUseBad.length > 0),
      kpi('Not validated', bomNotValidated, 'Blocked for purchasing', bomNotValidated > 0),
      kpi('Inspections requested', inspections, 'Pending department approval', false),
    ],
    left: {
      title: 'Quality approvals',
      rows: ecos
        .filter((e) => e.status === 'In approval' || e.status === 'Impact analysis')
        .map((e) => row(e.id, e.title, e.appr.quality === 'pending' ? 'To review' : e.appr.quality === 'rejected' ? 'Rejected' : 'Approved', TAG.outline, homeHref('eco', { params: { eco: e.id } }))),
    },
    right: {
      title: 'Parts needing action',
      rows: i.parts
        .filter((p) => p.status !== 'Validated' && usedIn(p).length)
        .slice(0, 6)
        .map((p) => row(`${p.ref} · ${p.name}`, 'Used in ' + usedIn(p).join(', '), p.status, partTag(p.status), homeHref('plm', { params: { part: p.ref } }))),
    },
  };
}

// ── Procurement ──────────────────────────────────────────────────────────────────────────────────────────

export interface ProcurementInput {
  lang: Lang;
  persona: Persona;
  project: CurrentProject;
  purchaseOrders: PurchaseOrder[];
  parts: Part[];
  ecos: Eco[];
  /** Percent complete of the current project's activities (an order feeding a started activity is late). */
  activityPct: Record<string, number>;
}

export function procurementHome(i: ProcurementInput): HomeView {
  const { lang, project } = i;
  const code = project.code;
  const parts = new Map(i.parts.map((p) => [p.ref, p]));
  const pos = i.purchaseOrders;
  const awaiting = pos.filter((o) => o.status === 'Awaiting approval').length;
  // Late deliveries (poKpis[2], line 4325): open order whose activity has already started.
  const late = pos.filter((o) => o.status !== 'Received' && o.status !== 'Cancelled' && !!o.act && (i.activityPct[o.act] ?? 0) > 0).length;
  const shortfall = bomShortfall(i.parts, pos, project.shortCode);
  const touching = i.ecos.filter((e) => ecoOpen(ecoStatus(e)) && pos.some((o) => o.lines.some((l) => e.parts.includes(l[0])))).length;
  return {
    ...greeting(i.persona),
    kpis: [
      kpi('Awaiting approval', awaiting, 'Blocks ordering', awaiting > 0),
      // The prototype reads poKpis[4], which does not exist (docs/spec/03 Q-1); "Late deliveries" (poKpis[2]) is shown instead.
      kpi('Late deliveries', late, 'See Deliveries for goods receipt', late > 0),
      kpi('BOM not yet ordered', shortfall.length, project.name, shortfall.length > 0),
      kpi('ECOs touching open POs', touching, 'Hold ordering until released', false),
    ],
    left: {
      title: 'Purchase orders to act on',
      rows: pos
        .filter((o) => o.status !== 'Received' && o.status !== 'Cancelled')
        .map((o) =>
          row(`${o.id} · ${o.supplier}`, o.lines.map((l) => l[0]).join(', ') + ' · ' + money(poValue(o, parts) / 1000, lang), o.status, poTag(o.status), homeHref('orders', { code, params: { po: o.id } })),
        ),
    },
    right: {
      title: { tpl: 'Still to order — {name}', p: { name: project.name } },
      // Quantity grouped per language ("6,200" / "6 200"): the FR rule `^(\d+) to order$` misses grouped numbers.
      rows: shortfall.map((s) =>
        row(s.part.ref, `${s.part.name} · ${s.part.mfr}`, { tpl: '{n} to order', p: { n: s.need.toLocaleString(lang === 'fr' ? 'fr-FR' : 'en-US') } }, TAG.outline, homeHref('orders', { code })),
      ),
    },
  };
}

// ── Client ───────────────────────────────────────────────────────────────────────────────────────────────

export interface ClientInput {
  lang: Lang;
  persona: Persona;
  project: CurrentProject;
  evm: EvmSeries | null;
  schedule: ScheduleHeader | null;
  /** Change requests of the current project. */
  changeRequests: ChangeRequest[];
  /** Deliverables awaiting / past client acceptance (current project). */
  deliverables: ClientDeliverable[];
  /** Open invoice of the billing plan (INV-2026-003, "M3", "Structure topped out", 1380 k€, "10 Nov"), null when none. */
  invoice: { invoiceNumber: string | null; milestoneNumber: string | null; name: string; amount: number; due: string | null } | null;
}

export function clientHome(i: ClientInput): HomeView {
  const { lang, project } = i;
  const code = project.code;
  const s = i.schedule;
  const cpHref = (tab: string) => homeHref('client', { code, params: { tab } });
  const crs = i.changeRequests.filter((c) => crAwaiting(c, 'client'));
  const crAmount = crs.reduce((a, c) => a + c.amount, 0);
  const submitted = i.deliverables.filter((d) => d.status === 'Submitted').length;
  const next = s?.milestones.find((m) => m.statusLabel !== 'Done');
  const progress = i.evm ? Math.round((evmAtDate(i.evm).ev / i.evm.bac) * 100) + '%' : '—';
  const crSub = (c: ChangeRequest): Txt => {
    const p = { amt: money(c.amount, lang, { signed: true }), n: Math.abs(c.days), date: c.date };
    if (c.days < 0) return { tpl: '{amt} · schedule recovery {n} days · submitted {date}', p };
    if (c.days > 0) return { tpl: '{amt} · handover +{n} days · submitted {date}', p };
    return { tpl: '{amt} · submitted {date}', p };
  };
  return {
    ...greeting(i.persona),
    kpis: [
      kpi('Progress', progress, i.evm ? { tpl: 'Work completed · {name}', p: { name: project.name } } : NO_DATA, false),
      // Template, not 'Next: ' + name: the FR dictionary only knows "Next: Structure topped out".
      kpi('Milestones reached', s ? s.milesText : '—', next ? { tpl: 'Next: {name}', p: { name: next.name } } : s ? '—' : NO_DATA, false),
      kpi('Change requests to approve', crs.length, crs.length ? `${crs.map((c) => c.id).join(', ')} · ${money(crAmount, lang)}` : 'None', crs.length > 0),
      kpi('Deliverables to accept', submitted, 'Acceptance due within 10 days', false),
    ],
    left: {
      title: 'Milestones',
      rows: (s?.milestones ?? []).map((m) =>
        row(
          m.name,
          { tpl: 'Baseline {b} · Forecast {f}', p: { b: dateOf(m.baselineMonth + s!.start), f: dateOf(m.forecastMonth + s!.start) } },
          m.statusLabel,
          m.statusLabel === 'Done' ? TAG.neutral : m.statusLabel === 'Late' ? TAG.accent : TAG.outline,
          cpHref('progress'),
        ),
      ),
    },
    right: {
      title: 'Waiting for your decision',
      rows: [
        ...crs.map((c) => row(`${c.id} — ${shortTitle(c.title)}`, crSub(c), 'Approve / reject', TAG.accent, cpHref('decisions'))),
        ...i.deliverables.map((d) =>
          row(`${d.id} · ${d.title}`, { tpl: '{type} · {note}', p: { type: d.type, note: d.note } }, d.status, d.status === 'Submitted' ? TAG.accent : d.status === 'Accepted' ? TAG.neutral : TAG.outline, cpHref('decisions')),
        ),
        // The open invoice of the billing plan (the prototype's static "Milestone 4 invoice €640k · due 15 Oct", A-5).
        ...(i.invoice
          ? [row('Invoices', invoiceSub(i.invoice, lang), 'Open', TAG.outline, cpHref('invoices'))]
          : []),
      ],
    },
  };
}

/** Roles with the "New project" primary action on Home (docs/spec/03 §0.2). */
export const HOME_PRIMARY_ROLES: RoleKey[] = ['director', 'pm'];
