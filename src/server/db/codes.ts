// Stable codes stored in the database and the prototype's domain labels they map to (docs/spec/11 §0, §2).
// Pure module (no server-only): used by the schema ($type), the seed loader and the DAL. Labels are the
// prototype's source strings — render them through t() (lifecycle labels are French domain values).

/** Bidirectional code ⇄ label map. `code()` also accepts extra aliases (e.g. UI variants of a label). */
function codec<C extends string, L extends string>(pairs: readonly (readonly [C, L])[], aliases: Record<string, C> = {}) {
  const toLabel = new Map<string, L>(pairs.map(([c, l]) => [c, l]));
  const toCode = new Map<string, C>(pairs.map(([c, l]) => [l, c]));
  for (const [a, c] of Object.entries(aliases)) toCode.set(a, c);
  return {
    codes: pairs.map(([c]) => c) as C[],
    labels: pairs.map(([, l]) => l) as L[],
    label(code: C | string): L {
      const l = toLabel.get(code);
      if (l === undefined) throw new Error(`Unknown code "${code}"`);
      return l;
    },
    code(label: string): C {
      const c = toCode.get(label) ?? (toLabel.has(label) ? (label as C) : undefined);
      if (c === undefined) throw new Error(`Unknown label "${label}"`);
      return c;
    },
    isCode: (v: unknown): v is C => typeof v === 'string' && toLabel.has(v),
  };
}

// ── Lifecycle (STATUSES 3136, STAGE_ORDER 3137, ST_SHORT 3905) ─────────────────────────────────────────
export type StageCode =
  | 'initiative' | 'aps' | 'apd' | 'etudes' | 'approvisionnements' | 'fabrication_assemblage' | 'fat'
  | 'expedition' | 'chantier' | 'mise_en_service_sat' | 'garantie' | 'clos' | 'annule';
export type StageGroup = 'pipeline' | 'execution' | 'warranty' | 'terminal';

export interface StageDef {
  code: StageCode;
  /** Prototype value (French domain label, both languages): 'Fabrication & Assemblage'. */
  label: string;
  /** Slider short label (ST_SHORT). */
  short: string;
  /** Position in STAGE_ORDER (1–12); null for 'annule' (outside the order). */
  seq: number | null;
  group: StageGroup;
}

export const STAGES: readonly StageDef[] = [
  { code: 'initiative', label: 'Initiative', short: 'Init.', seq: 1, group: 'pipeline' },
  { code: 'aps', label: 'APS', short: 'APS', seq: 2, group: 'pipeline' },
  { code: 'apd', label: 'APD', short: 'APD', seq: 3, group: 'pipeline' },
  { code: 'etudes', label: 'Etudes', short: 'Études', seq: 4, group: 'execution' },
  { code: 'approvisionnements', label: 'Approvisionnements', short: 'Appro.', seq: 5, group: 'execution' },
  { code: 'fabrication_assemblage', label: 'Fabrication & Assemblage', short: 'Fab.', seq: 6, group: 'execution' },
  { code: 'fat', label: 'FAT', short: 'FAT', seq: 7, group: 'execution' },
  { code: 'expedition', label: 'Expédition', short: 'Expéd.', seq: 8, group: 'execution' },
  { code: 'chantier', label: 'Chantier', short: 'Chantier', seq: 9, group: 'execution' },
  { code: 'mise_en_service_sat', label: 'Mise Service & SAT', short: 'MES/SAT', seq: 10, group: 'execution' },
  { code: 'garantie', label: 'Garantie', short: 'Garantie', seq: 11, group: 'warranty' },
  { code: 'clos', label: 'Clos', short: 'Clos', seq: 12, group: 'terminal' },
  { code: 'annule', label: 'Annulé', short: 'Annulé', seq: null, group: 'terminal' },
];
export const stage = codec<StageCode, string>(STAGES.map((s) => [s.code, s.label] as const));
/** Next stage in STAGE_ORDER, or null (Clos, Annulé). */
export function nextStageOf(code: StageCode): StageCode | null {
  const s = STAGES.find((x) => x.code === code);
  return (s?.seq && STAGES.find((x) => x.seq === s.seq! + 1)?.code) || null;
}

/** Legacy portfolio statuses of `EXTRA` (STATUS_MAP_OLD 3143) — migration only, never stored. */
export const LEGACY_STATUS: Record<string, StageCode> = {
  Proposed: 'initiative', Approved: 'aps', Planning: 'apd', Active: 'fabrication_assemblage',
  'On hold': 'approvisionnements', Closing: 'garantie', Closed: 'clos', Cancelled: 'annule',
};

export type TransitionMode = 'auto' | 'forced';
export type ValidationStatus = 'pending' | 'approved' | 'rejected';

// ── Organisation / portfolio ───────────────────────────────────────────────────────────────────────────
export type ZoneCode = 'euna' | 'afr' | 'apac';
export const ZONE_CODES: readonly ZoneCode[] = ['euna', 'afr', 'apac'];

/** Machine types (MACHINE_TYPES 3166). 'R&D' is stored as 'rnd' (11 §2.1). Custom codes allowed. */
export type MachineTypeCode = 'EMP' | 'MEMU' | 'SPUR' | 'AUTRE' | 'rnd' | (string & {});
export const machineType = codec<MachineTypeCode, string>([
  ['EMP', 'EMP'], ['MEMU', 'MEMU'], ['SPUR', 'SPUR'], ['AUTRE', 'AUTRE'], ['rnd', 'R&D'],
]);

/** Project calendars (NP_TEMPLATES.cal, wizard `np.cal`). Labels are the template data values. */
export type CalendarCode = 'standard_5x8' | 'standard_5x8_workshop' | 'site_6x10' | 'continuous_24h';
export const calendar = codec<CalendarCode, string>(
  [
    ['standard_5x8', 'Standard 5d · 8h'],
    ['standard_5x8_workshop', 'Standard 5d · 8h + Atelier'],
    ['site_6x10', 'Chantier 6d · 10h'],
    ['continuous_24h', '24h continuous'],
  ],
  { 'Site 6d · 10h': 'site_6x10' },
);

// ── Planning ───────────────────────────────────────────────────────────────────────────────────────────
export type LinkType = 'FS' | 'SS' | 'FF' | 'SF';
export type ConstraintType = 'FNLT' | 'SNET' | (string & {});

export type MilestoneStatus = 'done' | 'late' | 'at_risk' | 'on_track';
export const milestoneStatus = codec<MilestoneStatus, string>([
  ['done', 'Done'], ['late', 'Late'], ['at_risk', 'At risk'], ['on_track', 'On track'],
]);

export type BaselineState = 'superseded' | 'current' | 'proposed';
export const baselineState = codec<BaselineState, string>([
  ['superseded', 'Superseded'], ['current', 'Current'], ['proposed', 'Proposed'],
]);

/** PIPE_PLAN windows (3665). */
export type PipelineWindow = 'initiative' | 'board' | 'aps' | 'apd';
export const pipelineWindow = codec<PipelineWindow, string>([
  ['initiative', 'Initiative'], ['board', 'Board'], ['aps', 'APS'], ['apd', 'APD'],
]);

// ── Cost & change ──────────────────────────────────────────────────────────────────────────────────────
export type CostType = 'labor' | 'material' | 'equipment' | 'subcontract' | 'fees' | 'reserve';
export const costType = codec<CostType, string>([
  ['labor', 'Labor'], ['material', 'Material'], ['equipment', 'Equipment'],
  ['subcontract', 'Subcontract'], ['fees', 'Fees'], ['reserve', 'Reserve'],
]);
/** Actuals source per cost type (SRC_OF 3302) — derived, not stored. */
export const ACTUALS_SOURCE: Record<CostType, string> = {
  labor: 'Timesheets × role rate',
  material: 'Purchase orders + receipts',
  equipment: 'Plant hire invoices',
  subcontract: 'Certified payment claims',
  fees: 'Direct invoices',
  reserve: 'Drawn by change request',
};

export type ChangeType = 'budget' | 'scope' | 'schedule';
export type ChangeStatus = 'draft' | 'in_review' | 'approved' | 'rejected';
export const changeStatus = codec<ChangeStatus, string>([
  ['draft', 'Draft'], ['in_review', 'In review'], ['approved', 'Approved'], ['rejected', 'Rejected'],
]);
/** Status of the Budget screen's change lines (`projectData().CRS`, HCRS 3193). */
export type BudgetChangeStatus = 'approved' | 'pending' | 'rejected';
export const budgetChangeStatus = codec<BudgetChangeStatus, string>([
  ['approved', 'Approved'], ['pending', 'Pending'], ['rejected', 'Rejected'],
]);
export type ChangeStep = 'pm' | 'director' | 'client' | 'ccb';
export const CHANGE_STEPS: readonly ChangeStep[] = ['pm', 'director', 'client', 'ccb'];
export type StepDecision = 'pending' | 'ok' | 'rejected' | 'na';
export const stepDecision = codec<StepDecision, string>([
  ['pending', 'pending'], ['ok', 'ok'], ['rejected', 'rejected'], ['na', 'n/a'],
]);

// ── Dates ──────────────────────────────────────────────────────────────────────────────────────────────
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n: number) => String(n).padStart(2, '0');

/**
 * Prototype display date → ISO 'YYYY-MM-DD'. Accepts "05 Jan", "3 Apr", "14 Jan ’27", "12 Mar 2026" and the
 * activity " A" (actual) suffix. Year defaults to 2026 (the data set's year). Returns null when unparseable.
 */
export function isoOfDisplayDate(text: string | null | undefined, defaultYear = 2026): string | null {
  const parts = splitActual(text ?? '').text.split(/\s+/).filter(Boolean);
  if (parts.length < 2) return null;
  const d = parseInt(parts[0], 10);
  const m = MON.indexOf(parts[1].slice(0, 3));
  let y = defaultYear;
  if (parts[2]) {
    const yy = parts[2].replace(/^[’']/, '');
    y = parseInt(yy, 10) + (yy.length === 2 ? 2000 : 0);
  }
  if (isNaN(d) || m < 0 || isNaN(y) || d < 1 || d > 31) return null;
  return `${y}-${pad(m + 1)}-${pad(d)}`;
}

/** ISO date → "12 Jan 2026" (fmtDY form, no zero padding; English — translate with t()). */
export function displayOfIso(iso: string): string {
  const [y, m, d] = iso.split('-').map((x) => parseInt(x, 10));
  return `${d} ${MON[m - 1]} ${y}`;
}

/** "17 Aug A" → { text: '17 Aug', actual: true }. */
export function splitActual(s: string): { text: string; actual: boolean } {
  const t = s.trim();
  return /\sA$/.test(t) ? { text: t.slice(0, -2).trimEnd(), actual: true } : { text: t, actual: false };
}

/** "FNLT 17 Apr" → { type: 'FNLT', date: '17 Apr' }; '' → null. */
export function parseConstraint(c: string | null | undefined): { type: ConstraintType; date: string } | null {
  const t = (c ?? '').trim();
  if (!t) return null;
  const i = t.indexOf(' ');
  return i < 0 ? { type: t, date: '' } : { type: t.slice(0, i), date: t.slice(i + 1).trim() };
}

/** Inverse of parseConstraint: the prototype's `c` string ('' when none). */
export const constraintText = (type: string | null, date: string | null) => (type ? (date ? `${type} ${date}` : type) : '');

/**
 * Client 3-letter code (clientCode3 3176): the registered code, else the first 3 letters upper-cased padded
 * with X ("Logistics business unit" → "LOG", '' → "XXX").
 */
export function clientCode3(name: string | null | undefined, registered?: string | null): string {
  if (registered) return registered;
  return (name || 'XXX').replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase().padEnd(3, 'X');
}

// ── Risk (docs/spec/11 §2.3, 07 §2.1) ─────────────────────────────────────────────────────────────────
/** Risk categories, in Settings order (SETTINGS0.riskCats 3467 — the chip order of the register). */
export type RiskCategory =
  | 'technical' | 'supplier_delivery' | 'hse' | 'contractual_client' | 'financial_currency' | 'regulatory_permits' | 'resources_skills';
export const riskCategory = codec<RiskCategory, string>([
  ['technical', 'Technical'], ['supplier_delivery', 'Supplier / delivery'], ['hse', 'HSE (safety)'],
  ['contractual_client', 'Contractual / client'], ['financial_currency', 'Financial / currency'],
  ['regulatory_permits', 'Regulatory / permits'], ['resources_skills', 'Resources / skills'],
]);
/** Response strategies (RESPONSES 3496). */
export type RiskResponse = 'avoid' | 'mitigate' | 'transfer' | 'accept';
export const riskResponse = codec<RiskResponse, string>([
  ['avoid', 'Avoid'], ['mitigate', 'Mitigate'], ['transfer', 'Transfer'], ['accept', 'Accept'],
]);
export type RiskStatus = 'open' | 'closed';
export const riskStatus = codec<RiskStatus, string>([['open', 'Open'], ['closed', 'Closed']]);
/** Trend since the last review. */
export type RiskTrend = 'up' | 'flat' | 'down';
/** Derived level (07 §2.1): critical ≥ 15, high ≥ 8, medium ≥ 4, else low. */
export type RiskLevel = 'critical' | 'high' | 'medium' | 'low';
export const riskLevel = codec<RiskLevel, string>([['critical', 'Critical'], ['high', 'High'], ['medium', 'Medium'], ['low', 'Low']]);
/** Score = probability × impact (1–5 each). */
export const riskScore = (probability: number, impact: number) => probability * impact;
export const riskLevelOf = (score: number): RiskLevel => (score >= 15 ? 'critical' : score >= 8 ? 'high' : score >= 4 ? 'medium' : 'low');
/** "Contingency draw if it occurs" = round(EMV / (P/5)); null when the EMV is 0 (prototype shows "—"). */
export const riskCostIfOccurs = (emvKeur: number, probability: number): number | null => (emvKeur ? Math.round(emvKeur / (probability / 5)) : null);

// ── Status report (AF.trends, 04 §2.5) ────────────────────────────────────────────────────────────────
export type ReportPeriod = 'month' | 'quarter' | 'since_start';
export const reportPeriod = codec<ReportPeriod, string>([['month', 'September 2026'], ['quarter', 'Q3 2026'], ['since_start', 'Since project start']]);
export type ReportAudience = 'steering' | 'client' | 'internal';
export const reportAudience = codec<ReportAudience, string>([['steering', 'Steering committee'], ['client', 'Client'], ['internal', 'Internal']]);
export type ReportSections = 'full' | 'summary' | 'kpis';
export const reportSections = codec<ReportSections, string>([['full', 'Full report'], ['summary', 'Summary + KPIs'], ['kpis', 'KPIs only']]);

// ── Contingency (04 §5) ───────────────────────────────────────────────────────────────────────────────
/** What a draw-down is linked to, parsed from its free-text reference ("CR-004", "R-03", "NCR-026"; OPEN QUESTION C-4). */
export type ContingencyLinkType = 'change_request' | 'risk' | 'ncr';
export function contingencyLinkTypeOf(ref: string | null | undefined): ContingencyLinkType | null {
  const r = (ref ?? '').trim();
  return /^CR-\d+$/.test(r) ? 'change_request' : /^R-\d+$/.test(r) ? 'risk' : /^NCR-\d+$/.test(r) ? 'ncr' : null;
}

// ── Tasks, requests (docs/spec/11 §2.2, §2.5; 08 §5–6, 10 §6–7) ──────────────────────────────────────
export type TaskStatus = 'todo' | 'doing' | 'review' | 'done';
/** STATUS_L 3264. */
export const taskStatus = codec<TaskStatus, string>([['todo', 'To do'], ['doing', 'In progress'], ['review', 'In review'], ['done', 'Done']]);
export type Priority = 'low' | 'med' | 'high';
export const priority = codec<Priority, string>([['low', 'Low'], ['med', 'Medium'], ['high', 'High']]);
/** Resource request status (REQ_STATUS 3282): the codes are the prototype's values. */
export type RequestStatus = 'pending' | 'approved' | 'reschedule' | 'rejected' | 'withdrawn';
export const requestStatus = codec<RequestStatus, string>([
  ['pending', 'Pending review'], ['approved', 'Approved · assigned'], ['reschedule', 'Reschedule proposed'], ['rejected', 'Rejected'], ['withdrawn', 'Withdrawn'],
]);
/** Status tag variant of a request (REQ_STATUS 3282 classes). */
export const REQUEST_STATUS_TAG: Record<RequestStatus, 'tag-outline' | 'tag-accent' | 'tag-neutral'> = {
  pending: 'tag-outline', approved: 'tag-accent', reschedule: 'tag-outline', rejected: 'tag-neutral', withdrawn: 'tag-neutral',
};
/** Decision trail of a resource request. */
export type RequestEventAction = 'sent' | 'approved' | 'reschedule' | 'rejected' | 'withdrawn' | 'accepted' | 'resent';
/** Where a time entry comes from (keystone = logged on the Task screen, lucca = HRIS import). */
export type TimeEntrySource = 'keystone' | 'lucca';
/** File icon of a task attachment (FILES 3259: ph-file-xls / ph-image / ph-file-pdf). */
export type AttachmentKind = 'xls' | 'image' | 'pdf' | 'doc' | 'other';
export const ATTACHMENT_ICON: Record<AttachmentKind, string> = {
  xls: 'ph ph-file-xls', image: 'ph ph-image', pdf: 'ph ph-file-pdf', doc: 'ph ph-file-doc', other: 'ph ph-file',
};

// ── Resources and HR (docs/spec/11 §2.6, 06) ──────────────────────────────────────────────────────────
/** Leave types (LEAVE_DAYS 3460: working days lost in the week). Labels are Lucca codes (no FR). */
export type LeaveType = 'cp' | 'rtt' | 'sick' | 'training';
export const leaveType = codec<LeaveType, string>([['cp', 'CP'], ['rtt', 'RTT'], ['sick', 'Sick'], ['training', 'Training']]);
/** Rate multipliers (MULTS 3455). */
export type RateMultiplierKey = 'ot' | 'sat' | 'sun' | 'night' | 'oncall' | (string & {});
/** Lucca hours matching mode (AF.hours). */
export type HoursMatching = 'resource_wp' | 'resource';
export const hoursMatching = codec<HoursMatching, string>([['resource_wp', 'Resource × work package (planning)'], ['resource', 'Resource only']]);
/** What-if priorities (AUTO 3463) and levers (LEVERS 3462). */
export type WhatIfPriority = 'date' | 'budget' | 'people';
export const whatIfPriority = codec<WhatIfPriority, string>([['date', 'Protect date'], ['budget', 'Protect budget'], ['people', 'Protect people']]);
export type WhatIfLeverCode = 'delay' | 'contractor' | 'overtime' | 'split' | 'move' | (string & {});

// ── Platform (docs/spec/11 §2.2, §2.8) ─────────────────────────────────────────────────────────────────
export type NotificationKind = 'approval' | 'alert' | 'quality' | 'delivery' | 'eco' | 'mention' | 'request' | 'invoice' | 'task' | 'sync';
/** Bell-panel icon per kind (NOTIF_ICON 3556). */
export const NOTIFICATION_ICON: Record<NotificationKind, string> = {
  approval: 'ph ph-seal-check', alert: 'ph ph-warning', quality: 'ph ph-shield-warning', delivery: 'ph ph-truck', eco: 'ph ph-git-branch',
  mention: 'ph ph-at', request: 'ph ph-paper-plane-tilt', invoice: 'ph ph-receipt', task: 'ph ph-check-square', sync: 'ph ph-arrows-clockwise',
};
export type ActivityKind = 'sync' | 'stock' | 'comment' | 'change' | 'snapshot' | 'quality' | 'request' | 'delivery' | 'invoice' | 'eco' | 'client';

// ── Day / week / time helpers (time model: docs/spec/00 §8, 10 §6.4) ──────────────────────────────────
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_MS = 86_400_000;
const utcOf = (iso: string) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
const isoOfUtc = (ms: number) => new Date(ms).toISOString().slice(0, 10);
/** Day 0 of the prototype's working-day axis: Mon 21 Sep 2026 (`dayDate`, 3266). */
export const DAY_ZERO = '2026-09-21';
/** Status date of the frozen data set (Fri 25 Sep 2026, TODAY = 4): the business date stamped on writes. */
export const STATUS_ISO = '2026-09-25';

/** Prototype working-day offset → ISO date (dayDate: 5 working days per week from Mon 21 Sep 2026). */
export function isoOfDayOffset(o: number): string {
  return isoOfUtc(utcOf(DAY_ZERO) + (Math.floor(o / 5) * 7 + (o % 5)) * DAY_MS);
}
/** ISO date → working-day offset (inverse of isoOfDayOffset); null for a Saturday or Sunday. */
export function dayOffsetOfIso(iso: string): number | null {
  const d = Math.round((utcOf(iso) - utcOf(DAY_ZERO)) / DAY_MS);
  const w = Math.floor(d / 7);
  const dow = d - w * 7;
  return dow > 4 ? null : w * 5 + dow;
}
/** Adds calendar days to an ISO date. */
export const addDaysIso = (iso: string, days: number) => isoOfUtc(utcOf(iso) + days * DAY_MS);
/** Calendar days from `a` to `b`. */
export const daysBetweenIso = (a: string, b: string) => Math.round((utcOf(b) - utcOf(a)) / DAY_MS);
/** Day of week (0 = Sunday). */
export const dowOfIso = (iso: string) => new Date(utcOf(iso)).getUTCDay();
/** "Fri 25 Sep" (dayLabel; English — translate with t()). */
export function dayLabelOfIso(iso: string): string {
  const d = new Date(utcOf(iso));
  return `${DOW[d.getUTCDay()]} ${d.getUTCDate()} ${MON[d.getUTCMonth()]}`;
}
/** "18 Jun" (day without padding; English). */
export function shortDateOfIso(iso: string): string {
  const d = new Date(utcOf(iso));
  return `${d.getUTCDate()} ${MON[d.getUTCMonth()]}`;
}
/** "Sep 28" — week column label of the resource screens (weeks / weekLabels 5182). */
export function weekLabelOfIso(iso: string): string {
  const d = new Date(utcOf(iso));
  return `${MON[d.getUTCMonth()]} ${d.getUTCDate()}`;
}
/** ISO-8601 week number: '2026-09-25' → 39. */
export function isoWeekOf(iso: string): number {
  const t = new Date(utcOf(iso));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y0 = Date.UTC(t.getUTCFullYear(), 0, 1);
  return Math.ceil(((t.getTime() - y0) / DAY_MS + 1) / 7);
}

/** Wall-clock parts of an instant in Europe/Paris (the data set's time zone). */
export function parisParts(at: Date): { iso: string; hh: string; mm: string } {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(at)
      .map((x) => [x.type, x.value]),
  );
  return { iso: `${p.year}-${p.month}-${p.day}`, hh: p.hour, mm: p.minute };
}
/** Instant of a Paris wall-clock time: ('2026-09-25', '09:12') → 2026-09-25T07:12:00Z (CEST). */
export function parisInstant(iso: string, hhmm: string): Date {
  const guess = new Date(`${iso}T${hhmm}:00Z`);
  const p = parisParts(guess);
  const shown = Date.UTC(+p.iso.slice(0, 4), +p.iso.slice(5, 7) - 1, +p.iso.slice(8, 10), +p.hh, +p.mm);
  return new Date(guess.getTime() - (shown - guess.getTime()));
}
/** "25 Sep 09:12" (notifications, activity feed, audit trail; English). */
export function stampText(at: Date): string {
  const p = parisParts(at);
  return `${shortDateOfIso(p.iso)} ${p.hh}:${p.mm}`;
}
/** "25 Sep 09:12" (current year) → instant; also "Yesterday 16:40" / "Today 08:15" relative to `today`. */
export function parseStampText(text: string, today = STATUS_ISO): Date {
  const m = /^(Today|Yesterday|\d{1,2} \w{3}) (\d{2}:\d{2})$/.exec(text.trim());
  if (!m) throw new Error(`Unparseable timestamp "${text}"`);
  const iso = m[1] === 'Today' ? today : m[1] === 'Yesterday' ? addDaysIso(today, -1) : isoOfDisplayDate(m[1], +today.slice(0, 4))!;
  return parisInstant(iso, m[2]);
}
/** Comment time as the Task screen shows it: "Today 08:15" / "Yesterday 16:40" relative to `today`, else "8 Oct 14:05". */
export function relativeStampText(at: Date, today = STATUS_ISO): string {
  const p = parisParts(at);
  const day = p.iso === today ? 'Today' : p.iso === addDaysIso(today, -1) ? 'Yesterday' : shortDateOfIso(p.iso);
  return `${day} ${p.hh}:${p.mm}`;
}
/** "today" / "yesterday" / "18 Sep" relative to `today` (attachment meta). */
export const relativeDayText = (iso: string, today = STATUS_ISO) =>
  iso === today ? 'today' : iso === addDaysIso(today, -1) ? 'yesterday' : shortDateOfIso(iso);

/** Next business number of a "PREFIX-nnn" sequence: max(existing, floor) + 1, zero-padded (OPEN QUESTION Q-7). */
export function nextBusinessNumber(existing: readonly string[], prefix: string, pad: number, floor = 0): string {
  let max = floor;
  for (const s of existing) {
    if (!s.startsWith(prefix)) continue;
    const n = parseInt(s.slice(prefix.length), 10);
    if (!isNaN(n) && n > max) max = n;
  }
  return prefix + String(max + 1).padStart(pad, '0');
}
