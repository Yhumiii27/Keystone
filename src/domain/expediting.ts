// R-159 (P1, owner's answer D9-31, 10 Nov 2026: « Lancer : inspections, FAT et bons de libération sur les commandes ») —
// expediting of a purchase order. Pure and deterministic; `today` is always passed in (R-013).
//
// On each purchase order:
// - a fabrication follow-up: the supplier's progress (% complete) as reported on a date, and a note;
// - planned inspection milestones at the supplier's works (drawing review, material, in-process, FAT, pre-shipment, other),
//   each with a planned date, an inspector (a person or a third-party inspector as typed), a result (planned, passed, passed
//   with reserves, failed), the date of the result and a comment. A failed inspection is reported as an NCR in Vigie (deep link
//   with `inspection` = "PO-1078/I-2"; Vigie owns the NCR, Keystone shows the number Vigie echoes or the one typed). A FAT may be
//   tied to an ITP FAT point of the project (stage 'fat');
// - a release note (bon de libération) issued by quality: it authorises the supplier to ship. An order needs one as soon as it
//   has an inspection (`releaseRequired`); it cannot be issued while a failed inspection has no passing re-inspection of the
//   same kind, or while the order has a FAT and none passed (`releaseBlockers`). A delivery of such an order without a release
//   note issued on or before its date is FLAGGED, never blocked (`deliveryWithoutRelease`, conservative default).
// - alerts: a long-lead order (≥ LONG_LEAD_DAYS between the order date and the expected delivery) whose inspection is past its
//   planned date without a result is told to the buyer and quality (src/server/dal/expediting-notices.ts).
import { isIsoDate } from './clock';

export type PoInspectionKind = 'drawing_review' | 'material' | 'in_process' | 'fat' | 'pre_shipment' | 'other';
export const PO_INSPECTION_KINDS: readonly PoInspectionKind[] = ['drawing_review', 'material', 'in_process', 'fat', 'pre_shipment', 'other'];
/** EN labels (FR in src/i18n/extra/d9-expediting.json). */
export const PO_INSPECTION_KIND_LABEL: Record<PoInspectionKind, string> = {
  drawing_review: 'Drawing review', material: 'Material inspection', in_process: 'In-process inspection', fat: 'Factory acceptance test (FAT)',
  pre_shipment: 'Pre-shipment inspection', other: 'Other inspection',
};
export const isPoInspectionKind = (v: unknown): v is PoInspectionKind => typeof v === 'string' && (PO_INSPECTION_KINDS as readonly string[]).includes(v);

export type PoInspectionResult = 'planned' | 'passed' | 'passed_reserve' | 'failed';
export const PO_INSPECTION_RESULTS: readonly PoInspectionResult[] = ['planned', 'passed', 'passed_reserve', 'failed'];
/** Results a recorded inspection may take (planned = not recorded). */
export const RECORDED_RESULTS: readonly PoInspectionResult[] = ['passed', 'passed_reserve', 'failed'];
export const PO_INSPECTION_RESULT_LABEL: Record<PoInspectionResult, string> = {
  planned: 'Planned', passed: 'Passed', passed_reserve: 'Passed with reserves', failed: 'Failed',
};
export const isPoInspectionResult = (v: unknown): v is PoInspectionResult => typeof v === 'string' && (PO_INSPECTION_RESULTS as readonly string[]).includes(v);
export const isPassing = (r: PoInspectionResult) => r === 'passed' || r === 'passed_reserve';

/** Long-lead order: at least 12 weeks between the order date and the expected delivery (décision prise sans demander). */
export const LONG_LEAD_DAYS = 84;

export interface PoInspectionFacts {
  /** "I-1", "I-2"… per order. */
  number: string;
  kind: PoInspectionKind;
  plannedOn: string | null;
  result: PoInspectionResult;
  resultOn: string | null;
  /** Order of creation (a re-inspection comes after the failed one). */
  position: number;
}

export interface ReleaseNoteFacts {
  number: string;
  issuedOn: string;
  /** Withdrawn notes no longer authorise anything. */
  withdrawn: boolean;
}

// ── Input ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export type ExpeditingError =
  | 'kind' | 'name' | 'date' | 'pct' | 'result' | 'resultDate' | 'resultFuture' | 'inspector' | 'text' | 'blocked' | 'released' | 'reason' | 'noInspection';

/** EN source messages of the errors (FR in src/i18n/extra/d9-expediting.json). */
export const EXPEDITING_ERRORS: Record<ExpeditingError, string> = {
  kind: 'Choose the kind of inspection',
  name: 'Name the inspection (120 characters at most)',
  date: 'Enter a valid date',
  pct: 'Fabrication progress is a whole number from 0 to 100',
  result: 'Choose the result of the inspection',
  resultDate: 'Enter the date of the inspection',
  resultFuture: 'An inspection result cannot be dated in the future',
  inspector: 'Name the inspector (120 characters at most)',
  text: 'Text too long (2000 characters at most)',
  blocked: 'The release note cannot be issued yet',
  released: 'This order already has a release note in force',
  reason: 'Give the reason (2000 characters at most)',
  noInspection: 'Plan the order’s inspections before issuing a release note',
};

type Parsed<T> = { ok: true; value: T } | { ok: false; error: ExpeditingError };

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');
/** '' → null; a valid ISO date → it; anything else → undefined (invalid). */
function optDate(v: unknown): string | null | undefined {
  const s = str(v);
  if (!s) return null;
  return isIsoDate(s) ? s : undefined;
}
const optText = (v: unknown, max: number): string | null | undefined => {
  const s = str(v);
  if (!s) return null;
  return s.length > max ? undefined : s;
};

export interface InspectionPlanInput {
  kind: PoInspectionKind;
  name: string;
  location: string | null;
  plannedOn: string | null;
  inspector: string | null;
  /** ITP inspection number of the project ("I-07") a FAT is tied to; null when none. */
  itp: string | null;
}

/** "Plan inspection" / "Edit" form → the planned inspection. The name defaults to the kind's label. */
export function parseInspectionPlan(v: Record<string, unknown>): Parsed<InspectionPlanInput> {
  if (!isPoInspectionKind(v.kind)) return { ok: false, error: 'kind' };
  const name = str(v.name) || PO_INSPECTION_KIND_LABEL[v.kind];
  if (name.length > 120) return { ok: false, error: 'name' };
  const plannedOn = optDate(v.plannedOn);
  if (plannedOn === undefined) return { ok: false, error: 'date' };
  const location = optText(v.location, 120);
  if (location === undefined) return { ok: false, error: 'text' };
  const inspector = optText(v.inspector, 120);
  if (inspector === undefined) return { ok: false, error: 'inspector' };
  const itpRaw = str(v.itp);
  const itp = v.kind === 'fat' && itpRaw ? itpRaw : null;
  return { ok: true, value: { kind: v.kind, name, location, plannedOn, inspector, itp } };
}

export interface InspectionResultInput {
  result: Exclude<PoInspectionResult, 'planned'>;
  resultOn: string;
  inspector: string;
  comment: string | null;
  /** NCR number given by Vigie (typed), null when none. */
  ncr: string | null;
}

/** "Record result" form: a recorded result, its date (not after today), the inspector, a comment, an NCR number when failed. */
export function parseInspectionResult(v: Record<string, unknown>, today: string): Parsed<InspectionResultInput> {
  if (!isPoInspectionResult(v.result) || v.result === 'planned') return { ok: false, error: 'result' };
  const resultOn = optDate(v.resultOn);
  if (!resultOn) return { ok: false, error: 'resultDate' };
  if (resultOn > today) return { ok: false, error: 'resultFuture' };
  const inspector = str(v.inspector);
  if (!inspector || inspector.length > 120) return { ok: false, error: 'inspector' };
  const comment = optText(v.comment, 2000);
  if (comment === undefined) return { ok: false, error: 'text' };
  const ncrRaw = optText(v.ncr, 40);
  if (ncrRaw === undefined) return { ok: false, error: 'text' };
  return { ok: true, value: { result: v.result, resultOn, inspector, comment, ncr: v.result === 'failed' ? ncrRaw : null } };
}

export interface FabricationProgressInput {
  pct: number;
  reportedOn: string;
  note: string | null;
}

/** "Fabrication progress" form: a whole % 0–100, the date the supplier reported it (default today, not in the future). */
export function parseFabricationProgress(v: Record<string, unknown>, today: string): Parsed<FabricationProgressInput> {
  const raw = str(v.pct);
  if (!/^\d{1,3}$/.test(raw) || Number(raw) > 100) return { ok: false, error: 'pct' };
  const reportedOn = optDate(v.reportedOn);
  if (reportedOn === undefined) return { ok: false, error: 'date' };
  if (reportedOn && reportedOn > today) return { ok: false, error: 'resultFuture' };
  const note = optText(v.note, 2000);
  if (note === undefined) return { ok: false, error: 'text' };
  return { ok: true, value: { pct: Number(raw), reportedOn: reportedOn ?? today, note } };
}

export interface ReleaseNoteInput {
  scope: string;
  reserves: string | null;
  inspector: string | null;
}

/** "Issue release note" form: what is released (default the whole order), reserves, the inspector who signs it. */
export function parseReleaseNote(v: Record<string, unknown>): Parsed<ReleaseNoteInput> {
  const scope = str(v.scope) || 'Whole order';
  if (scope.length > 500) return { ok: false, error: 'text' };
  const reserves = optText(v.reserves, 2000);
  if (reserves === undefined) return { ok: false, error: 'text' };
  const inspector = optText(v.inspector, 120);
  if (inspector === undefined) return { ok: false, error: 'inspector' };
  return { ok: true, value: { scope, reserves, inspector } };
}

/** A reason (withdrawal of a release note): required, 2000 characters at most. */
export function parseReason(v: unknown): Parsed<string> {
  const s = str(v);
  return s && s.length <= 2000 ? { ok: true, value: s } : { ok: false, error: 'reason' };
}

// ── Rules ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Next inspection number of an order: "I-<max+1>". */
export function nextInspectionNumber(existing: readonly string[]): string {
  const max = existing.reduce((m, n) => Math.max(m, /^I-(\d+)$/.exec(n) ? Number(/^I-(\d+)$/.exec(n)![1]) : 0), 0);
  return `I-${max + 1}`;
}

/** Next release note number of an order: "PO-1078-RN1", "PO-1078-RN2"… (a withdrawn note keeps its number). */
export const nextReleaseNumber = (po: string, count: number) => `${po}-RN${count + 1}`;

/** The reference Vigie receives in its `inspection` prefill (and echoes on the NCR): "PO-1078/I-2". */
export const inspectionRef = (po: string, number: string) => `${po}/${number}`;

/** An inspection past its planned date without a result. */
export const inspectionLate = (i: Pick<PoInspectionFacts, 'plannedOn' | 'result'>, today: string) => i.result === 'planned' && !!i.plannedOn && i.plannedOn < today;

/** Days between two ISO dates (b − a). */
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/** A long-lead order: ordered on a date and expected ≥ LONG_LEAD_DAYS later. Unknown dates: not long lead. */
export function isLongLead(po: { orderedOn: string | null; expectedOn: string | null }, days = LONG_LEAD_DAYS): boolean {
  return !!po.orderedOn && !!po.expectedOn && daysBetween(po.orderedOn, po.expectedOn) >= days;
}

/** An order needs a release note before shipping once it has an inspection planned. */
export const releaseRequired = (inspections: readonly unknown[]) => inspections.length > 0;

/** The release note in force: the last one not withdrawn (null when none). */
export function activeRelease<T extends ReleaseNoteFacts>(notes: readonly T[]): T | null {
  return [...notes].reverse().find((n) => !n.withdrawn) ?? null;
}

export type ReleaseBlocker = { kind: 'failed'; numbers: string[] } | { kind: 'fat' };

/**
 * Why the release note cannot be issued: a failed inspection with no passing inspection of the same kind after it (a
 * re-inspection), or a FAT planned on the order and none passed. [] = it can.
 */
export function releaseBlockers(inspections: readonly PoInspectionFacts[]): ReleaseBlocker[] {
  const out: ReleaseBlocker[] = [];
  const failed = inspections.filter((i) => i.result === 'failed' && !inspections.some((j) => j.kind === i.kind && j.position > i.position && isPassing(j.result)));
  if (failed.length) out.push({ kind: 'failed', numbers: failed.map((i) => i.number) });
  const fats = inspections.filter((i) => i.kind === 'fat');
  if (fats.length && !fats.some((i) => isPassing(i.result))) out.push({ kind: 'fat' });
  return out;
}

/** EN text of a blocker. */
export const releaseBlockerText = (b: ReleaseBlocker) => (b.kind === 'fat' ? 'The FAT has not passed yet' : `Failed inspection without a passing re-inspection: ${b.numbers.join(', ')}`);

/**
 * A delivery of the order (announced or received) flagged for want of a release note: the order needs one and no note in force
 * was issued on or before the delivery's date (received date, else the announced date, else today).
 */
export function deliveryWithoutRelease(
  order: { required: boolean; notes: readonly ReleaseNoteFacts[] },
  delivery: { receivedOn: string | null; expectedOn: string | null },
  today: string,
): boolean {
  if (!order.required) return false;
  const on = delivery.receivedOn ?? delivery.expectedOn ?? today;
  const note = activeRelease(order.notes);
  return !note || note.issuedOn > on;
}

export type ExpeditingState = 'none' | 'in_progress' | 'late' | 'blocked' | 'released';
/** EN labels of the order's expediting state. */
export const EXPEDITING_STATE_LABEL: Record<ExpeditingState, string> = {
  none: 'No inspection planned', in_progress: 'Inspections in progress', late: 'Inspection late', blocked: 'Inspection failed', released: 'Released for shipment',
};

/** One state for the order (drawer tag, list flag): released, else a failure, else a late inspection, else in progress. */
export function expeditingState(inspections: readonly PoInspectionFacts[], notes: readonly ReleaseNoteFacts[], today: string): ExpeditingState {
  if (!inspections.length) return activeRelease(notes) ? 'released' : 'none';
  if (activeRelease(notes)) return 'released';
  if (releaseBlockers(inspections).some((b) => b.kind === 'failed')) return 'blocked';
  if (inspections.some((i) => inspectionLate(i, today))) return 'late';
  return 'in_progress';
}

/** The next inspection to hold: the earliest planned one with a date, else the first planned one; null when none. */
export function nextInspection<T extends PoInspectionFacts>(inspections: readonly T[]): T | null {
  const planned = inspections.filter((i) => i.result === 'planned');
  const dated = planned.filter((i) => i.plannedOn).sort((a, b) => a.plannedOn!.localeCompare(b.plannedOn!) || a.position - b.position);
  return dated[0] ?? planned[0] ?? null;
}

// ── Alerts ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Fixed EN title of the late-inspection alert (FR in d9-expediting.json); the reference and the days late follow after " · ". */
export const LATE_INSPECTION_TITLE = 'Supplier inspection late';
export const lateInspectionTitle = (ref: string, daysLate: number) => `${LATE_INSPECTION_TITLE} · ${ref} · +${daysLate} d`;

/**
 * The late inspections of a long-lead order to tell (order not cancelled nor fully received): one entry per inspection with its
 * days late at `today`.
 */
export function lateInspectionsToTell(
  po: { number: string; status: string; orderedOn: string | null; expectedOn: string | null },
  inspections: readonly PoInspectionFacts[],
  today: string,
): { ref: string; number: string; plannedOn: string; daysLate: number }[] {
  if (po.status === 'cancelled' || po.status === 'received' || po.status === 'draft' || !isLongLead(po)) return [];
  return inspections
    .filter((i) => inspectionLate(i, today))
    .map((i) => ({ ref: inspectionRef(po.number, i.number), number: i.number, plannedOn: i.plannedOn!, daysLate: daysBetween(i.plannedOn!, today) }));
}
