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

// ── Delivery 3 time model (docs/spec/00 §7.5) ─────────────────────────────────────────────────────────
/**
 * Month index of the prototype "now" used by the portfolio Gantt, meetings, interfaces, stakeholders and the
 * Billing late flag (`PG_NOW` 3671 ≈ 30 Sep 2026). Comparisons use `monthIndexOfIso(date) < PG_NOW` exactly like
 * the prototype's `mIdx(date) < PG_NOW`.
 */
export const PG_NOW = 8.97;
/** Prototype `NOWD` / literal "30 Sep": overdue invoices (due < NOWD) and the date stamped on invoices, payments, minutes and records created by the Contract, Billing, Meetings, Stakeholders and Interfaces writers. */
export const NOW_ISO = '2026-09-30';
/** Literal "29 Sep" of the Codex vault: downloads, deposits and automatic withdrawals. */
export const CODEX_TODAY_ISO = '2026-09-29';

/** Month index since 1 Jan 2026 of an ISO date (prototype `mIdx('14 Dec 2026')` = 11 + 13/30). */
export function monthIndexOfIso(iso: string): number {
  const [y, m, d] = iso.split('-').map((x) => parseInt(x, 10));
  return (y - 2026) * 12 + (m - 1) + (d - 1) / 30;
}
/** Prototype `mIdx(x) < PG_NOW` on an ISO date (null → false). */
export const beforePgNow = (iso: string | null | undefined) => !!iso && monthIndexOfIso(iso) < PG_NOW;

/** "12 Mar" (current year 2026) / "14 Jan 2027" — the prototype's short date with the year only when ≠ 2026 (`fmtInvD`). */
export function shortDateYearOfIso(iso: string): string {
  const [y] = iso.split('-');
  return y === '2026' ? shortDateOfIso(iso) : displayOfIso(iso);
}

// ── Documents — Codex index (docs/spec/11 §2.7, §3.10; 10 §4–5) ─────────────────────────────────────
/** Document families (DOC_FAM 3614). */
export type DocFamily = 'eng' | 'client' | 'quality' | 'purchasing' | 'site' | 'contracts' | 'photos';
export const docFamily = codec<DocFamily, string>([
  ['eng', 'Engineering'], ['client', 'Client deliverables'], ['quality', 'Quality'], ['purchasing', 'Purchasing'], ['site', 'Site'],
  ['contracts', 'Contracts & mail'], ['photos', 'Photos & reports'],
]);
/** Owning service of a document (DOC_SVC 3662). */
export type DocService = 'process' | 'meca' | 'elec' | 'auto' | 'quality' | 'procurement' | 'site' | 'pm';
export const docService = codec<DocService, string>([
  ['process', 'Process'], ['meca', 'Mechanical'], ['elec', 'Electrical'], ['auto', 'Automation'], ['quality', 'Quality'],
  ['procurement', 'Purchasing'], ['site', 'Site'], ['pm', 'Project management'],
]);
/** Document status (DOC_STATUSES 3664), shared with the engineering screens. */
export type DocumentStatus = 'draft' | 'frozen' | 'release_proposed' | 'released' | 'obsolete';
export const documentStatus = codec<DocumentStatus, string>([
  ['draft', 'Draft'], ['frozen', 'Frozen'], ['release_proposed', 'Release proposed'], ['released', 'Released'], ['obsolete', 'Obsolete'],
]);
/** Status tag class (`stClassDoc` 5024). */
export const DOCUMENT_STATUS_TAG: Record<DocumentStatus, 'tag-accent' | 'tag-outline' | 'tag-neutral'> = {
  draft: 'tag-outline', frozen: 'tag-outline', release_proposed: 'tag-accent', released: 'tag-neutral', obsolete: 'tag-outline',
};
/** Confidentiality (`DOCS.conf`). */
export type Confidentiality = 'internal' | 'client' | 'supplier';
export const confidentiality = codec<Confidentiality, string>([['internal', 'Internal'], ['client', 'Client'], ['supplier', 'Supplier']]);
export const CONFIDENTIALITY_TAG: Record<Confidentiality, 'tag-accent' | 'tag-outline' | 'tag-neutral'> = { client: 'tag-accent', supplier: 'tag-outline', internal: 'tag-neutral' };
/** Relation kinds of a document (`DOCS.links`). Only `article` opens a screen (PLM part drawer). */
export type DocLinkKind = 'deliverable' | 'article' | 'purchase_order' | 'punch_item' | 'change_request';
export const docLinkKind = codec<DocLinkKind, string>([
  ['deliverable', 'Deliverable'], ['article', 'Article'], ['purchase_order', 'Purchase order'], ['punch_item', 'Punch item'], ['change_request', 'Change request'],
]);
/** Distribution recipients (`DOCS.to`, ENG_RCP 3737). */
export type DocRecipient = 'process' | 'meca' | 'elec' | 'auto' | 'client' | 'achats' | 'site';
export const docRecipient = codec<DocRecipient, string>([
  ['process', 'Process'], ['meca', 'Mechanical'], ['elec', 'Electrical'], ['auto', 'Automation'], ['client', 'Client'], ['achats', 'Purchasing'], ['site', 'Site'],
]);
/** Saved views of the vault (DOC_VIEWS 3663) — UI filters, not stored. */
export type DocSavedView = 'all' | 'bpe' | 'audit' | 'client' | 'pending' | 'obsolete';
export const docSavedView = codec<DocSavedView, string>([
  ['all', 'All documents'], ['bpe', 'BPE dossier (released)'], ['audit', 'Quality records 2026 (ISO audit)'], ['client', 'Shared with client'],
  ['pending', 'Awaiting approval'], ['obsolete', 'Obsolete withdrawn'],
]);
/** Types counted by the "Quality records 2026 (ISO audit)" view (`viewFilter` 5030). */
export const AUDIT_VIEW_TYPES: readonly string[] = ['REC', 'NCR', 'AUD', 'PRO', 'FRM', 'CER', 'COC', 'PV', 'RPT'];
/** Types offered by the "Deposit in Codex" dialog, in DOC_TYPES order (5051). */
export const DEPOSIT_TYPES: readonly string[] = ['RPT', 'REC', 'NCR', 'CER', 'COC', 'PV', 'LET', 'MIN', 'PHO'];
/** Approval-circuit roles (DOC_TYPES circuits 3615, DOC_WHO 3617). */
export type ApproverRole =
  | 'author' | 'engineering_lead' | 'project_manager' | 'quality_manager' | 'direction' | 'client' | 'quality_verification'
  | 'hse_officer' | 'buyer' | 'site_manager' | 'auditor';
export const approverRole = codec<ApproverRole, string>([
  ['author', 'Author'], ['engineering_lead', 'Engineering lead'], ['project_manager', 'Project manager'], ['quality_manager', 'Quality manager'],
  ['direction', 'Direction'], ['client', 'Client'], ['quality_verification', 'Quality (verification)'], ['hse_officer', 'HSE officer'],
  ['buyer', 'Buyer'], ['site_manager', 'Site manager'], ['auditor', 'Auditor'],
]);
/** Where a download log entry comes from: made from Keystone, or synced from the Codex log. */
export type DocDownloadSource = 'keystone' | 'codex';
/** Hand-off state of a deposit to Codex (simulated: recorded at once, OPEN QUESTION D-1). */
export type DepositStatus = 'handed_off' | 'recorded';

// ── Contract & billing (docs/spec/11 §2.3, §3.5; 04 §3–4; 03 §7) ────────────────────────────────────
/** Contract types (CTR_FIELDS 4873). */
export type ContractType = 'lump_sum_epc' | 'unit_rates' | 'cost_plus' | 'framework';
export const contractType = codec<ContractType, string>([
  ['lump_sum_epc', 'Lump sum (EPC)'], ['unit_rates', 'Unit rates'], ['cost_plus', 'Cost plus'], ['framework', 'Framework agreement'],
]);
/** Amendment status (AF.amendment). Only `signed` adds to the contract value. */
export type AmendmentStatus = 'draft' | 'sent_for_signature' | 'awaiting_signature' | 'signed';
export const amendmentStatus = codec<AmendmentStatus, string>([
  ['draft', 'Draft'], ['sent_for_signature', 'Sent for signature'], ['awaiting_signature', 'Awaiting signature'], ['signed', 'Signed'],
]);
/** Bond / guarantee types (AF.bond). */
export type BondType = 'performance' | 'advance_payment' | 'retention' | 'warranty' | 'parent_company';
export const bondType = codec<BondType, string>([
  ['performance', 'Performance bond'], ['advance_payment', 'Advance payment bond'], ['retention', 'Retention bond'], ['warranty', 'Warranty bond'],
  ['parent_company', 'Parent company guarantee'],
]);
/** Payment milestone status (CONTRACTS.milestones, BILLING rows). */
export type PaymentMilestoneStatus = 'planned' | 'invoiced' | 'paid';
export const paymentMilestoneStatus = codec<PaymentMilestoneStatus, string>([['planned', 'Planned'], ['invoiced', 'Invoiced'], ['paid', 'Paid']]);
/** Customer invoice status (derived, `ctrInvoices` 4896). */
export type CustomerInvoiceStatus = 'awaiting_payment' | 'overdue' | 'paid';
export const customerInvoiceStatus = codec<CustomerInvoiceStatus, string>([['awaiting_payment', 'Awaiting payment'], ['overdue', 'Overdue'], ['paid', 'Paid']]);
/** Billing model of a project (BILLING[code][0]). */
export type BillingModel = 'client_milestones' | 'client_monthly_progress' | 'client_fixed_price' | 'internal_capex';
export const billingModel = codec<BillingModel, string>([
  ['client_milestones', 'Client · milestones'], ['client_monthly_progress', 'Client · monthly progress'], ['client_fixed_price', 'Client · fixed price'],
  ['internal_capex', 'Internal · capex'],
]);

// ── Prioritisation (docs/spec/11 §2.1 ScoreAxis, §3.2 PortfolioScore; 03 §6) ─────────────────────────
export type ScoreAxis = 'fit' | 'margin' | 'risk' | 'res' | 'client';
export const scoreAxis = codec<ScoreAxis, string>([
  ['fit', 'Strategic fit'], ['margin', 'Margin / NPV'], ['risk', 'Risk level'], ['res', 'Resource fit'], ['client', 'Client priority'],
]);
/** Obsolete project codes of `SCORES` (3540) and the projects they mean (11 §7 #12, 00 §7.16). */
export const SCORE_CODE_REMAP: Readonly<Record<string, string>> = { 'EWA-041': 'EWA-051', 'RBR-038': 'RBR-048', 'CER-045': 'CER-047' };

// ── Meetings, stakeholders (docs/spec/11 §2.2, §3.4; 05 §5–6) ───────────────────────────────────────
export type MeetingType = 'internal' | 'external';
export const meetingType = codec<MeetingType, string>([['internal', 'Internal'], ['external', 'External']]);
export type MeetingStatus = 'scheduled' | 'notes_in_progress' | 'minutes_sent';
export const meetingStatus = codec<MeetingStatus, string>([['scheduled', 'Scheduled'], ['notes_in_progress', 'Notes in progress'], ['minutes_sent', 'Minutes sent']]);
/** Meeting series (AF.meetings select). */
export type MeetingSeries = 'weekly_site' | 'steering_committee' | 'engineering_coordination' | 'supplier_review' | 'kick_off' | 'one_off';
export const meetingSeries = codec<MeetingSeries, string>([
  ['weekly_site', 'Weekly site meeting'], ['steering_committee', 'Steering committee'], ['engineering_coordination', 'Engineering coordination'],
  ['supplier_review', 'Supplier review'], ['kick_off', 'Kick-off'], ['one_off', 'One-off'],
]);
export type MeetingLineType = 'info' | 'decision' | 'action';
export const meetingLineType = codec<MeetingLineType, string>([['info', 'Info'], ['decision', 'Decision'], ['action', 'Action']]);
/** How a minutes line was created. */
export type MeetingLineOrigin = 'seed' | 'manual' | 'transcript';
export type ClientQuestionState = 'open' | 'answered';
export type StakeholderType = 'client' | 'internal' | 'supplier' | 'authority' | 'third_party';
export const stakeholderType = codec<StakeholderType, string>([
  ['client', 'Client'], ['internal', 'Internal'], ['supplier', 'Supplier'], ['authority', 'Authority'], ['third_party', 'Third party'],
]);
/** RACI codes (RACI 3715; deliverables add B = backup). */
export type RaciCode = 'R' | 'A' | 'C' | 'I' | 'B';
export const RACI_CODES: readonly RaciCode[] = ['R', 'A', 'C', 'I', 'B'];

// ── Interfaces (docs/spec/11 §3.7 Interface; 07 §2.5) ────────────────────────────────────────────────
/** Stored interface status; `late` is derived (open and needed before PG_NOW). */
export type InterfaceStatus = 'open' | 'received' | 'frozen';
export type InterfaceEffectiveStatus = InterfaceStatus | 'late';
export const interfaceStatus = codec<InterfaceEffectiveStatus, string>([['open', 'Open'], ['late', 'Late'], ['received', 'Received'], ['frozen', 'Frozen']]);
export type KeystoneSide = 'process' | 'mechanical' | 'electrical' | 'automation' | 'site';
export const keystoneSide = codec<KeystoneSide, string>([
  ['process', 'Process'], ['mechanical', 'Mechanical'], ['electrical', 'Electrical'], ['automation', 'Automation'], ['site', 'Site'],
]);

// ── Delivery 4 time helpers (docs/spec/08 §4.5, 09 §5) ───────────────────────────────────────────────
/**
 * Stamp of the n-th stock movement recorded in Keystone (`applyOp` 4480: '25 Sep 16:' + pad(10 + moves.length)):
 * the status date at 16:10 + n minutes (n = movements already listed), so new movements sort above the seed ones.
 */
export function stockMoveInstant(count: number): Date {
  const minutes = 16 * 60 + 10 + count;
  const hh = String(Math.min(23, Math.floor(minutes / 60))).padStart(2, '0');
  const mm = String(minutes >= 24 * 60 ? 59 : minutes % 60).padStart(2, '0');
  return parisInstant(STATUS_ISO, `${hh}:${mm}`);
}

/** "12 Mar" (2026) / "13 Feb ’27" — the prototype's `fmtD` on an ISO date (purchase orders, receipts generated in Keystone). */
export function fmtDOfIso(iso: string): string {
  const [y] = iso.split('-');
  return shortDateOfIso(iso) + (+y > 2026 ? ' ’' + y.slice(2) : '');
}

// ── Engineering & PLM (docs/spec/11 §2.7, §3.9; 09 §1–5) ─────────────────────────────────────────────
/** Make / buy (`PARTS.mb`). */
export type PartMakeBuy = 'manufactured' | 'purchased';
export const partMakeBuy = codec<PartMakeBuy, string>([['manufactured', 'Manufactured'], ['purchased', 'Purchased']]);
/** Part types (`PARTS.type`, 13 values in catalogue first-appearance order — the PLM type select order). */
export type PartType =
  | 'structural' | 'heavy_equipment' | 'electrical' | 'hvac' | 'fire_safety' | 'architectural' | 'medical' | 'mechanical'
  | 'electronics' | 'it_hardware' | 'assembly' | 'consumable' | 'software';
export const partType = codec<PartType, string>([
  ['structural', 'Structural'], ['heavy_equipment', 'Heavy equipment'], ['electrical', 'Electrical'], ['hvac', 'HVAC'], ['fire_safety', 'Fire & safety'],
  ['architectural', 'Architectural'], ['medical', 'Medical'], ['mechanical', 'Mechanical'], ['electronics', 'Electronics'], ['it_hardware', 'IT hardware'],
  ['assembly', 'Assembly'], ['consumable', 'Consumable'], ['software', 'Software'],
]);
/** "Family" of the New part form (AF.plm) and the catalogue type it creates (OPEN QUESTION E-1: two lists). */
export type PartFamily = 'structure' | 'mechanical' | 'electrical' | 'automation' | 'consumable';
export const partFamily = codec<PartFamily, string>([
  ['structure', 'Structure'], ['mechanical', 'Mechanical'], ['electrical', 'Electrical'], ['automation', 'Automation'], ['consumable', 'Consumable'],
]);
export const PART_FAMILY_TYPE: Record<PartFamily, PartType> = {
  structure: 'structural', mechanical: 'mechanical', electrical: 'electrical', automation: 'electronics', consumable: 'consumable',
};
/** Unit of measure (New part form; the seed parts are counted in pieces). */
export type PartUnit = 'pc' | 'm' | 'kg' | 'set';
export const PART_UNITS: readonly PartUnit[] = ['pc', 'm', 'kg', 'set'];
/** Qualification status (`PARTS.status`). */
export type PartStatus = 'validated' | 'not_validated' | 'outdated' | 'obsolete';
export const partStatus = codec<PartStatus, string>([
  ['validated', 'Validated'], ['not_validated', 'Not validated'], ['outdated', 'Outdated'], ['obsolete', 'Obsolete'],
]);
/** Part drawer banner per status (STATUS_NOTE 3405; EN source strings). */
export const PART_STATUS_NOTE: Partial<Record<PartStatus, string>> = {
  outdated: 'Superseded — replace in open designs before procurement.',
  obsolete: 'Discontinued by the manufacturer — no new orders; switch to the registered equivalent.',
  not_validated: 'Qualification pending — cannot be released to purchasing.',
};
/** Part status tag (`partTag` 4176). */
export const PART_STATUS_TAG: Record<PartStatus, 'tag-neutral' | 'tag-accent' | 'tag-outline'> = {
  validated: 'tag-neutral', not_validated: 'tag-outline', outdated: 'tag-accent', obsolete: 'tag-accent',
};
/** Wear / spare classification (WEAR_SPARE 3341, PU_LABEL 3342 — "—" when none). */
export type WearSpare = 'PU' | 'PR';
export const wearSpare = codec<WearSpare, string>([['PU', 'Wear part (PU)'], ['PR', 'Spare part (PR)']]);
/**
 * Export control family of a part (`PARTS.restr`): the restriction text stays on the part (EN source string, shown
 * as is); the code lets customs screens group the lines (BACKLOG §1 Expédition & transport, dual-use alert).
 */
export type ExportControl = 'dual_use' | 'encryption' | 'dangerous_goods' | 'medical_device' | 'anti_dumping';
export const exportControl = codec<ExportControl, string>([
  ['dual_use', 'Dual-use'], ['encryption', 'Encryption'], ['dangerous_goods', 'Dangerous goods'], ['medical_device', 'Medical device'], ['anti_dumping', 'Anti-dumping'],
]);
/** Export-control code of a restriction text ("Dual-use — export licence…" → dual_use); null for "None" / unknown. */
export function exportControlOf(restriction: string | null | undefined): ExportControl | null {
  const r = (restriction ?? '').toLowerCase();
  if (!r || r === 'none') return null;
  if (r.startsWith('dual-use')) return 'dual_use';
  if (r.startsWith('encryption')) return 'encryption';
  if (r.startsWith('dangerous goods')) return 'dangerous_goods';
  if (r.startsWith('medical device')) return 'medical_device';
  if (r.startsWith('anti-dumping')) return 'anti_dumping';
  return null;
}
/** BOM line scope (AF.bom). */
export type BomScope = 'keystone' | 'client' | 'overlay';
export const bomScope = codec<BomScope, string>([['keystone', 'Keystone'], ['client', 'Client'], ['overlay', 'Overlay']]);
/** Revision comparison line kind (REV_DIFF 3427). */
export type RevisionDiffKind = 'quantity' | 'substitution' | 'added';
export const revisionDiffKind = codec<RevisionDiffKind, string>([['quantity', 'Quantity'], ['substitution', 'Substitution'], ['added', 'Added']]);
/** "Open BOM" stages (OPEN_BOM 4185): design still open, ECOs update the BOM automatically. */
export const OPEN_BOM_STAGES: readonly StageCode[] = ['initiative', 'aps', 'apd', 'etudes'];

// ECOs are owned by Vigie (the group's QHSE application): Keystone keeps a read-only mirror of them and records
// progress (approval-key decisions, step advancement) that is sent to Vigie — src/server/integrations/vigie.
/** ECO types (ECO_TYPES 3430). */
export type EcoType = 'rev' | 'sub' | 'asm' | 'sup' | 'obs';
export const ecoType = codec<EcoType, string>([
  ['rev', 'Part revision'], ['sub', 'BOM substitution'], ['asm', 'Assembly structure'], ['sup', 'Supplier / make-buy'], ['obs', 'Obsolescence notice'],
]);
/** ECO status (ECO_FLOW 3431) as Vigie reports it (release is automatic in Vigie, 09 §11). */
export type EcoStatus = 'draft' | 'impact_analysis' | 'in_approval' | 'released' | 'rejected';
export const ecoStatus = codec<EcoStatus, string>([
  ['draft', 'Draft'], ['impact_analysis', 'Impact analysis'], ['in_approval', 'In approval'], ['released', 'Released'], ['rejected', 'Rejected'],
]);
/** Status tag (`ecoTag` 4194). */
export const ECO_STATUS_TAG: Record<EcoStatus, 'tag-neutral' | 'tag-accent' | 'tag-outline'> = {
  draft: 'tag-outline', impact_analysis: 'tag-outline', in_approval: 'tag-accent', released: 'tag-neutral', rejected: 'tag-outline',
};
/** Steps of the ECO drawer's indicator (ECO_FLOW.slice(0, 4)); a rejected ECO reaches none. */
export const ECO_FLOW_STEPS: readonly EcoStatus[] = ['draft', 'impact_analysis', 'in_approval', 'released'];
/** Index of a status in the step indicator (-1 for rejected). */
export const ecoStepIndex = (s: EcoStatus) => ECO_FLOW_STEPS.indexOf(s);
/**
 * Step advancements Keystone may record and send to Vigie ("Start impact analysis", "Submit for approval" — the
 * prototype's only step buttons, 09 §4.7). Submitting needs the interchangeability decided (in Vigie).
 */
export const ECO_STEP_ADVANCE: Partial<Record<EcoStatus, EcoStatus>> = { draft: 'impact_analysis', impact_analysis: 'in_approval' };
/** ECO approval keys (ECOS.appr, ecoRoleKey 4341) in drawer order, with the approver label and the table's short label. */
export type EcoApproverKey = 'englead' | 'quality' | 'pm';
export const ECO_APPROVER_KEYS: readonly EcoApproverKey[] = ['englead', 'quality', 'pm'];
export const ecoApproverKey = codec<EcoApproverKey, string>([
  ['englead', 'Engineering lead'], ['quality', 'Quality (ISO 9001)'], ['pm', 'PM of impacted projects'],
]);
export const ECO_APPROVER_SHORT: Record<EcoApproverKey, string> = { englead: 'Eng.', quality: 'Quality', pm: 'PM' };
/** ECO approval key of a role (ecoRoleKey 4341); the portfolio director holds none. */
export const ecoKeyOfRole = (role: string): EcoApproverKey | null => (role === 'englead' || role === 'quality' || role === 'pm' ? role : null);
/** Decision on an ECO approval key. */
export type EcoDecision = 'pending' | 'ok' | 'rejected';
export const ecoDecision = codec<EcoDecision, string>([['pending', 'Pending'], ['ok', 'Approved'], ['rejected', 'Rejected']]);
/** Approver-state tag (4363). */
export const ECO_DECISION_TAG: Record<EcoDecision, 'tag-neutral' | 'tag-accent' | 'tag-outline'> = { ok: 'tag-neutral', pending: 'tag-accent', rejected: 'tag-outline' };
/** Interchangeability with the previous revision (null = not assessed) — decided in Vigie. */
export type Interchangeability = 'yes' | 'no';
export const interchangeability = codec<Interchangeability, string>([['yes', 'Interchangeable'], ['no', 'Not interchangeable']]);
export const INTERCHANGEABILITY_NOT_ASSESSED = 'Interchangeability not assessed';
/** Disposition of an ECO target as Vigie reports it (DISP_L 4184; retrofit = machines only). Never edited in Keystone. */
export type EcoDisposition = 'update' | 'pinned' | 'retrofit' | 'na';
export const ecoDisposition = codec<EcoDisposition, string>([['update', 'Update'], ['pinned', 'Pinned'], ['retrofit', 'Retrofit'], ['na', 'Not applicable']]);
/** Effectivity target of an ECO: an open/frozen project BOM, or a machine of the installed base (Vigie's code). */
export type EcoTargetType = 'project' | 'machine';
/** What a progress entry records: the viewer's decision on their approval key, or a step advancement. */
export type EcoProgressKind = 'approval' | 'step';
/** Delivery state of a progress entry in the outbox towards Vigie. */
export type VigieSyncStatus = 'pending' | 'sent' | 'failed';
export const vigieSyncStatus = codec<VigieSyncStatus, string>([
  ['pending', 'Pending sync with Vigie'], ['sent', 'Sent to Vigie'], ['failed', 'Sync with Vigie failed'],
]);
/** State of a part fitted on a machine in service, derived from the ECO dispositions (part drawer, 09 §2.2). */
export type InstalledPartState = 'latest' | 'update_planned' | 'decision_pending' | 'retrofit_pending' | 'pinned';
export const installedPartState = codec<InstalledPartState, string>([
  ['latest', 'Latest'], ['update_planned', 'Update planned'], ['decision_pending', 'Decision pending'], ['retrofit_pending', 'Retrofit pending'], ['pinned', 'Pinned'],
]);
/** Drawing state mirrored from the PDM vault (DRAWINGS 3439). */
export type DrawingState = 'wip' | 'under_review' | 'released' | 'obsolete';
export const drawingState = codec<DrawingState, string>([['wip', 'WIP'], ['under_review', 'Under review'], ['released', 'Released'], ['obsolete', 'Obsolete']]);
/** Drawing state tag (`dwgTag` 4373). */
export const DRAWING_STATE_TAG: Record<DrawingState, 'tag-neutral' | 'tag-accent' | 'tag-outline'> = {
  wip: 'tag-accent', under_review: 'tag-accent', released: 'tag-neutral', obsolete: 'tag-outline',
};
/** "Sync vault" form (AF.drawings): source and scope. */
export type VaultSyncSource = 'solidworks_3dx' | 'see_electrical' | 'both';
export const vaultSyncSource = codec<VaultSyncSource, string>([['solidworks_3dx', 'SolidWorks 3DX vault'], ['see_electrical', 'SeeElectrical'], ['both', 'Both']]);
export type VaultSyncScope = 'current_project' | 'all_projects';
export const vaultSyncScope = codec<VaultSyncScope, string>([['current_project', 'Current project'], ['all_projects', 'All projects']]);

// ── Installed base (docs/spec/11 §2.4, §3.7 Machine; 09 §10.5) — not modelled before phase 8 ───────────
/** Warranty status (FLEET 3729, read from the prototype by dal/machines.ts); `extended` carries its end date. */
export type WarrantyStatus = 'in_warranty' | 'extended' | 'out_of_warranty';
export const warrantyStatus = codec<WarrantyStatus, string>([['in_warranty', 'In warranty'], ['extended', 'Extended'], ['out_of_warranty', 'Out of warranty']]);

// ── Supply chain (docs/spec/11 §2.5, §3.8; 08 §1–4) ──────────────────────────────────────────────────
/** Purchase order status (PO_FLOW 3414). */
export type PoStatus = 'draft' | 'awaiting_approval' | 'ordered' | 'partially_received' | 'received' | 'cancelled';
export const poStatus = codec<PoStatus, string>([
  ['draft', 'Draft'], ['awaiting_approval', 'Awaiting approval'], ['ordered', 'Ordered'], ['partially_received', 'Partially received'], ['received', 'Received'],
  ['cancelled', 'Cancelled'],
]);
/** PO status tag (`poTag` 4313). */
export const PO_STATUS_TAG: Record<PoStatus, 'tag-neutral' | 'tag-accent' | 'tag-outline'> = {
  draft: 'tag-neutral', awaiting_approval: 'tag-outline', ordered: 'tag-outline', partially_received: 'tag-accent', received: 'tag-neutral', cancelled: 'tag-neutral',
};
/** Where a purchase order comes from: Sage X3 (seed, genPOs), the BOM shortfall assistant, an RFQ award. */
export type PoOrigin = 'x3' | 'shortfall' | 'rfq';
/** Incoterms (AF.procurement); "DAP site" = DAP at the site gate. Codes are the Incoterm abbreviations. */
export type Incoterm = 'DAP' | 'EXW' | 'FCA' | 'DDP';
export const incoterm = codec<Incoterm, string>([['DAP', 'DAP site'], ['EXW', 'EXW'], ['FCA', 'FCA'], ['DDP', 'DDP']]);
/** RFQ status (RFQS 3526). */
export type RfqStatus = 'draft' | 'open' | 'comparing' | 'awarded';
export const rfqStatus = codec<RfqStatus, string>([['draft', 'Draft'], ['open', 'Open'], ['comparing', 'Comparing'], ['awarded', 'Awarded']]);
export const RFQ_STATUS_TAG: Record<RfqStatus, 'tag-neutral' | 'tag-accent' | 'tag-outline'> = {
  draft: 'tag-neutral', open: 'tag-outline', comparing: 'tag-accent', awarded: 'tag-neutral',
};
/** RFQ award rule (RFQS.rule). */
export type AwardRule = 'lowest_tco' | 'technical_first' | 'lowest_price' | 'pm_decides';
export const awardRule = codec<AwardRule, string>([
  ['lowest_tco', 'Lowest total cost of ownership'], ['technical_first', 'Technical compliance first'], ['lowest_price', 'Lowest price'], ['pm_decides', 'PM decides'],
]);
/** Roles allowed to award an RFQ (rfqVals.canAward 4655). */
export const RFQ_AWARD_ROLES: readonly string[] = ['pm', 'procurement', 'director'];
/** Supplier rating (SUPPLIERS 3538, RFQ quotes). */
export type SupplierGrade = 'A' | 'B' | 'C';
export const SUPPLIER_GRADES: readonly SupplierGrade[] = ['A', 'B', 'C'];
export const SUPPLIER_GRADE_TAG: Record<SupplierGrade, 'tag-neutral' | 'tag-accent' | 'tag-outline'> = { A: 'tag-neutral', B: 'tag-outline', C: 'tag-accent' };
/** Supplier invoice status (INVOICES 3531). */
export type SupplierInvoiceStatus = 'awaiting_receipt' | 'blocked' | 'no_po' | 'approved_for_payment' | 'paid' | 'rejected';
export const supplierInvoiceStatus = codec<SupplierInvoiceStatus, string>([
  ['awaiting_receipt', 'Awaiting receipt'], ['blocked', 'Blocked'], ['no_po', 'No PO'], ['approved_for_payment', 'Approved for payment'], ['paid', 'Paid'],
  ['rejected', 'Rejected'],
]);
export const SUPPLIER_INVOICE_STATUS_TAG: Record<SupplierInvoiceStatus, 'tag-neutral' | 'tag-accent' | 'tag-outline'> = {
  awaiting_receipt: 'tag-outline', blocked: 'tag-accent', no_po: 'tag-accent', approved_for_payment: 'tag-neutral', paid: 'tag-neutral', rejected: 'tag-outline',
};
/** 3-way match states (`match3` 4663): PO line (ok / diff / none) and goods receipt (ok / partial / pending / none). */
export type MatchState = 'ok' | 'diff' | 'partial' | 'pending' | 'none';
export const matchState = codec<MatchState, string>([
  ['ok', 'Matched'], ['partial', 'Partial receipt'], ['diff', 'Amount differs'], ['pending', 'Receipt pending'], ['none', 'Missing'],
]);
/** Goods receipt status (DELIV_FLOW 3474). */
export type ReceiptStatus = 'announced' | 'received' | 'qc_pending' | 'accepted' | 'partially_rejected' | 'rejected';
export const receiptStatus = codec<ReceiptStatus, string>([
  ['announced', 'Announced'], ['received', 'Received'], ['qc_pending', 'QC pending'], ['accepted', 'Accepted'], ['partially_rejected', 'Partially rejected'],
  ['rejected', 'Rejected'],
]);
/** Receipt status tag (`dTag` 4451). */
export const RECEIPT_STATUS_TAG: Record<ReceiptStatus, 'tag-neutral' | 'tag-accent' | 'tag-outline'> = {
  announced: 'tag-neutral', received: 'tag-outline', qc_pending: 'tag-outline', accepted: 'tag-neutral', partially_rejected: 'tag-accent', rejected: 'tag-accent',
};
export type ReceiptAttachmentKind = 'document' | 'photo';
/** Source of a stock position: imported from Sage X3, or changed in Keystone and not yet pushed back. */
export type StockSource = 'x3' | 'local';
export const stockSource = codec<StockSource, string>([['x3', 'X3'], ['local', 'Local']]);
/** Sage X3 exchanges recorded by Keystone (mock connector): stock import ("Import from X3"), push of local changes. */
export type X3SyncKind = 'stock_import' | 'stock_push';
/** Stock operations of the stock-line drawer (STOCK_OPS 3483), plus the system movement `receipt` (MOVES0 3484). */
export type StockOperation = 'adjust' | 'transfer' | 'reserve' | 'issue' | 'return' | 'scrap';
export type StockMovementType = StockOperation | 'receipt';
export const stockOperation = codec<StockOperation, string>([
  ['adjust', 'Adjust (count)'], ['transfer', 'Transfer'], ['reserve', 'Reserve for project'], ['issue', 'Issue to activity'], ['return', 'Return to stock'],
  ['scrap', 'Scrap / rework'],
]);
/** Movement type as the movement lists show it (MOVES0: "Transfer", "Receipt"…). */
export const stockMovementType = codec<StockMovementType, string>([
  ['adjust', 'Adjust'], ['transfer', 'Transfer'], ['reserve', 'Reserve'], ['issue', 'Issue'], ['return', 'Return'], ['scrap', 'Scrap'], ['receipt', 'Receipt'],
]);
/** Storage location types (SETTINGS0.locTypes). */
export type LocationType = 'central_warehouse' | 'workshop' | 'site_store' | 'consignment' | 'quarantine';
export const locationType = codec<LocationType, string>([
  ['central_warehouse', 'Central warehouse'], ['workshop', 'Workshop'], ['site_store', 'Site store'], ['consignment', 'Consignment at supplier'],
  ['quarantine', 'Quarantine (QC hold)'],
]);
