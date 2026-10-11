// Warranty claims followed end to end (R-143, owner's answer Q-8 "a": full follow-up driven by after-sales — statuses Open →
// Diagnosed → Intervention planned → Closed, coverage decided (warranty, extended warranty, chargeable), a design cause
// linked to a Vigie ECO) and the as-built configuration of delivered machines (R-144, E-8 "a": created at the project's
// delivery from its bill of materials, then kept up to date by each after-sales intervention). Pure rules: the steps a
// claim offers, the forms (claim update, diagnosis, intervention planned / done, machines registered at delivery), the
// warranty end of a delivered machine and the machine names. No I/O, no translation (English source strings).
import { NOW_ISO, STAGES, claimCoverage, interventionType, type ClaimCoverage, type ClaimStatus, type InterventionType, type StageCode } from '@/server/db/codes';
import { parseDateInput } from './contract';
import { parsePastDate } from './itpcom';

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * Who drives claims (Q-8): there is no "after-sales manager" persona — the roles whose workspace holds Warranty claims
 * (director, project manager, quality, procurement) do, as for "New claim" (the server checks the workspace).
 */
export const CLAIM_FLOW: readonly ClaimStatus[] = ['open', 'diagnosed', 'intervention_planned', 'closed'];

export type ClaimStep = 'diagnose' | 'close';

export interface ClaimStepFacts {
  status: ClaimStatus;
  diagnosis: string | null;
  /** Interventions of the claim still planned (not done). */
  plannedInterventions: number;
}

/**
 * Steps a claim offers: "Mark diagnosed" (Open → Diagnosed, the diagnosis is entered with it); "Close claim" once a
 * diagnosis exists and no intervention is still planned (Diagnosed or Intervention planned; an Open claim is diagnosed
 * first). Planning an intervention moves a Diagnosed claim to Intervention planned (`statusAfterPlanning`). Closed: none.
 */
export function claimSteps(c: ClaimStepFacts): ClaimStep[] {
  if (c.status === 'closed') return [];
  const out: ClaimStep[] = [];
  if (c.status === 'open') out.push('diagnose');
  if (c.status !== 'open' && !!c.diagnosis?.trim() && c.plannedInterventions === 0) out.push('close');
  return out;
}

/** Why "Close claim" is not offered on an open claim (EN), or null when it is. */
export function closeBlocker(c: ClaimStepFacts): string | null {
  if (c.status === 'closed') return null;
  if (c.status === 'open' || !c.diagnosis?.trim()) return 'Diagnose the claim before closing it';
  if (c.plannedInterventions > 0) return 'An intervention is still planned';
  return null;
}

/** Status of a claim once an intervention is planned on it: a Diagnosed claim moves to Intervention planned. */
export const statusAfterPlanning = (s: ClaimStatus): ClaimStatus => (s === 'diagnosed' ? 'intervention_planned' : s);

/** Number as typed ("8", "8.5", "8,5"); NaN otherwise. */
const num = (raw: string | undefined) => {
  const s = (raw ?? '').trim().replace(/\s/g, '').replace(',', '.');
  return /^\d+(\.\d+)?$/.test(s) ? Number(s) : NaN;
};
const text = (v: string | undefined) => (v ?? '').trim();

/** Upper bound of a claim cost (k€): guards a cost typed in euros. */
export const MAX_CLAIM_COST_KEUR = 10_000;
/** "ECO-031", "ECO-2026-015" (a Vigie ECO number, typed). */
export const ECO_NUMBER = /^ECO-[A-Z0-9][A-Z0-9-]{0,30}$/;

export interface ClaimUpdateValues {
  coverage: ClaimCoverage;
  owner: string;
  costKeur: number;
  nextStep: string;
  diagnosis: string | null;
  /** Linked design ECO (Vigie); null = none. */
  ecoNumber: string | null;
}

/**
 * "Edit claim": coverage (code or label), owner (after-sales owners), cost in k€ (≥ 0, decimals allowed, bounded), next
 * step (≤ 300; '' → "—"), diagnosis (≤ 2000), design ECO ("ECO-031"; '' → none).
 */
export function parseClaimUpdate(values: Record<string, string | undefined>, owners: readonly string[]): ParseResult<ClaimUpdateValues> {
  const rawCover = text(values.cover);
  const coverage = claimCoverage.isCode(rawCover) ? rawCover : claimCoverage.labels.includes(rawCover) ? claimCoverage.code(rawCover) : null;
  if (!coverage) return { ok: false, error: 'Invalid coverage' };
  const owner = text(values.owner);
  if (!owners.includes(owner)) return { ok: false, error: 'Unknown owner' };
  const costRaw = text(values.cost);
  const costKeur = costRaw === '' ? 0 : num(costRaw);
  if (!Number.isFinite(costKeur)) return { ok: false, error: 'Enter the cost in k€, e.g. 8.5' };
  if (costKeur > MAX_CLAIM_COST_KEUR) return { ok: false, error: 'The cost is too high (k€)' };
  const nextStep = text(values.next) || '—';
  const diagnosis = text(values.diagnosis);
  if (nextStep.length > 300 || diagnosis.length > 2000) return { ok: false, error: 'Text is too long' };
  const eco = text(values.eco).toUpperCase();
  if (eco && !ECO_NUMBER.test(eco)) return { ok: false, error: 'Enter the ECO number as in Vigie, e.g. ECO-031' };
  return { ok: true, value: { coverage, owner, costKeur: Math.round(costKeur * 100) / 100, nextStep, diagnosis: diagnosis || null, ecoNumber: eco || null } };
}

/** "Mark diagnosed": the diagnosis is required (≤ 2000). */
export function parseDiagnosis(values: Record<string, string | undefined>): ParseResult<string> {
  const d = text(values.diagnosis);
  if (!d) return { ok: false, error: 'Enter the diagnosis' };
  if (d.length > 2000) return { ok: false, error: 'Text is too long' };
  return { ok: true, value: d };
}

export interface PlanInterventionValues {
  machineNumber: string;
  claimNumber: string | null;
  type: InterventionType;
  /** ISO date. */
  scheduledOn: string;
  technicians: string;
  durationDays: number;
  detail: string | null;
}

/**
 * "Plan intervention": the machine (from the claim, or chosen), type (code or label), date (required, a date), technicians
 * (required), duration in days (0.5 to 30, by half days), detail (≤ 200).
 */
export function parsePlanIntervention(
  values: Record<string, string | undefined>, opts: { machines: readonly string[]; claimMachine?: string | null },
): ParseResult<Omit<PlanInterventionValues, 'claimNumber'>> {
  const machineNumber = opts.claimMachine ?? (text(values.machine) || opts.machines[0] || '');
  if (!opts.claimMachine && !opts.machines.includes(machineNumber)) return { ok: false, error: 'Unknown machine' };
  const rawType = text(values.ivtype) || 'corrective';
  const type = interventionType.isCode(rawType) ? rawType : interventionType.labels.includes(rawType) ? interventionType.code(rawType) : null;
  if (!type) return { ok: false, error: 'Unknown intervention type' };
  const date = text(values.date);
  if (!date) return { ok: false, error: 'Date is required' };
  const scheduledOn = parseDateInput(date);
  if (!scheduledOn) return { ok: false, error: 'Enter the date as a date, e.g. 8 Oct' };
  const technicians = text(values.tech);
  if (!technicians) return { ok: false, error: 'Technicians are required' };
  const durationDays = num(values.duration || '1');
  if (!Number.isFinite(durationDays) || durationDays <= 0 || durationDays > 30 || Math.round(durationDays * 2) !== durationDays * 2) {
    return { ok: false, error: 'Enter the duration in days (0.5 to 30)' };
  }
  const detail = text(values.detail);
  if (technicians.length > 200 || detail.length > 200) return { ok: false, error: 'Text is too long' };
  return { ok: true, value: { machineNumber, type, scheduledOn, technicians, durationDays, detail: detail || null } };
}

export interface InterventionDoneValues {
  /** ISO date, not after the business date. */
  doneOn: string;
  report: string | null;
  /** Part replaced or upgraded and the revision fitted (updates the machine's configuration, E-8); null = none. */
  partRef: string | null;
  revision: string | null;
}

/** "—" option of the part select (no configuration change). */
export const NO_PART = '—';

/**
 * "Mark done": the date (required, not after the business date), a report (≤ 2000), and optionally the part replaced or
 * upgraded — one of the parts offered (the machine's configuration and the catalogue) — with the revision fitted (required
 * then, ≤ 10 characters).
 */
export function parseInterventionDone(values: Record<string, string | undefined>, parts: readonly string[], today = NOW_ISO): ParseResult<InterventionDoneValues> {
  const date = text(values.date);
  if (!date) return { ok: false, error: 'Date is required' };
  const doneOn = parsePastDate(date, today);
  if (!doneOn) return { ok: false, error: 'Enter the date as a date, e.g. 8 Oct' };
  if (doneOn > today) return { ok: false, error: 'An intervention cannot be done in the future' };
  const report = text(values.report);
  if (report.length > 2000) return { ok: false, error: 'Text is too long' };
  const part = text(values.part);
  const partRef = part && part !== NO_PART ? part : null;
  if (partRef && !parts.includes(partRef)) return { ok: false, error: 'Unknown part' };
  const revision = text(values.rev).toUpperCase();
  if (partRef && !revision) return { ok: false, error: 'Enter the revision fitted' };
  if (revision.length > 10) return { ok: false, error: 'Text is too long' };
  return { ok: true, value: { doneOn, report: report || null, partRef, revision: partRef ? revision : null } };
}

// ── Machines registered at the project's delivery (R-144, E-8) ───────────────────────────────────────────

const SHIPPING_SEQ = STAGES.find((x) => x.code === 'expedition')!.seq!;
/** A project is delivered (its machines may be registered) from the shipping stage on: Expédition … Garantie, Clos (not Annulé). */
export const isDeliveredStage = (s: StageCode) => (STAGES.find((x) => x.code === s)?.seq ?? 0) >= SHIPPING_SEQ;

/** Default warranty length when the contract's warranty text gives none ("24 months from SAT" gives 24). */
export const DEFAULT_WARRANTY_MONTHS = 24;
/** At most this many machines in one registration. */
export const MAX_MACHINES_PER_DELIVERY = 20;

/** Months of a contract's warranty text: "24 months from SAT" → 24, "2 ans" → 24, "18 mois" → 18; null when none. */
export function warrantyMonthsOf(text: string | null | undefined): number | null {
  const s = (text ?? '').toLowerCase();
  let m = /(\d+)\s*(months?|mois)\b/.exec(s);
  if (m) return +m[1] || null;
  m = /(\d+)\s*(years?|ans?)\b/.exec(s);
  if (m) return +m[1] ? +m[1] * 12 : null;
  return null;
}

/** Warranty end of a machine delivered on `deliveredOn` with `months` of warranty: the day before the anniversary (14 Dec 2025 + 24 → 13 Dec 2027). */
export function warrantyEndOf(deliveredOn: string, months: number): string {
  const [y, m, d] = deliveredOn.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  const end = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), Math.min(d, last)) - 86_400_000);
  return end.toISOString().slice(0, 10);
}

/** Names of the machines of one registration: the base name, numbered "#1", "#2"… when there are several. */
export const machineNames = (base: string, count: number) => (count === 1 ? [base] : Array.from({ length: count }, (_, i) => `${base} #${i + 1}`));

export interface RegisterMachinesValues {
  projectCode: string;
  count: number;
  name: string;
  site: string;
  deliveredOn: string;
  warrantyEndOn: string;
}

/**
 * "Register delivered machines": a project offered, the number of machines (1–20), a base name (required, ≤ 160), the site
 * (≤ 200), the delivery date (required, not after the business date) and the warranty end (required, after the delivery).
 */
export function parseRegisterMachines(values: Record<string, string | undefined>, projects: readonly string[], today = NOW_ISO): ParseResult<RegisterMachinesValues> {
  const projectCode = text(values.project) || projects[0] || '';
  if (!projects.includes(projectCode)) return { ok: false, error: 'Unknown project' };
  const count = num(values.count || '1');
  if (!Number.isInteger(count) || count < 1 || count > MAX_MACHINES_PER_DELIVERY) return { ok: false, error: `Enter a number of machines from 1 to ${MAX_MACHINES_PER_DELIVERY}` };
  const name = text(values.name);
  if (!name) return { ok: false, error: 'Machine is required' };
  const site = text(values.site);
  if (name.length > 160 || site.length > 200) return { ok: false, error: 'Text is too long' };
  const delivered = text(values.delivered);
  if (!delivered) return { ok: false, error: 'Enter the delivery date' };
  const deliveredOn = parsePastDate(delivered, today);
  if (!deliveredOn) return { ok: false, error: 'Enter the delivery date as a date, e.g. 30 Sep 2026' };
  if (deliveredOn > today) return { ok: false, error: 'The delivery date cannot be in the future' };
  const w = text(values.warranty);
  const warrantyEndOn = w ? parseDateInput(w) : null;
  if (!warrantyEndOn) return { ok: false, error: 'Enter the warranty end as a date, e.g. 29 Sep 2028' };
  if (warrantyEndOn <= deliveredOn) return { ok: false, error: 'Warranty end is before delivery' };
  return { ok: true, value: { projectCode, count, name, site, deliveredOn, warrantyEndOn } };
}

/**
 * The as-built configuration recorded at delivery: one line per part of the project's bill of materials that carries a
 * revision (software and parts without a revision are not tracked), in BOM order, each part once.
 */
export function asBuiltConfiguration(bom: readonly { ref: string; revision: string | null }[]): { ref: string; revision: string }[] {
  const seen = new Set<string>();
  const out: { ref: string; revision: string }[] = [];
  for (const b of bom) {
    if (!b.revision?.trim() || seen.has(b.ref)) continue;
    seen.add(b.ref);
    out.push({ ref: b.ref, revision: b.revision.trim() });
  }
  return out;
}
