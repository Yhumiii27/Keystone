// Contingency register: pure business logic (docs/spec/04 §5; prototype logic 4959–4967 and the `contingency`
// bucket of afSubmit 5121). Initial provision (default round(BAC × 3 %)), drawn / remaining, use vs project
// progress, open-risk exposure, the three bar widths, the draw-down list order and the "Contingency draw-down"
// form parsing. No I/O, no translation. Golden values: src/domain/contingency.test.ts.

/** Default provision of a project without a register: round(BAC × 3 %) (`CONTINGENCY[project] || {initial: …}`). */
export const defaultProvision = (bac: number) => Math.round(bac * 0.03);

export interface ContingencyFacts {
  /** Initial provision, k€. */
  initial: number;
  /** Draw-downs in stored order (oldest first), k€. */
  draws: readonly { amount: number }[];
  /** Σ EMV of the open risks of the Risk register, k€. */
  exposure: number;
  /** Project progress 0–1. */
  progress: number;
  /** Budget at completion, k€. */
  bac: number;
}

export interface ContingencySummary {
  initial: number;
  /** round(initial / BAC × 100) — "3 % of budget". */
  initialPctOfBudget: number;
  drawn: number;
  /** round(drawn / initial × 100). */
  usedPct: number;
  /** round(progress × 100). */
  progPct: number;
  /** Drawn faster than the project progresses → LO. */
  drawnAlert: boolean;
  remaining: number;
  drawCount: number;
  exposure: number;
  /** Exposure above the remaining provision → "exceeds remaining provision", LO. */
  exposureExceeds: boolean;
  /** Bar widths in % (integers, clamped at 100): drawn layer, exposure hatch (drawn + EMV), progress. */
  barUsed: number;
  barExposure: number;
  barProgress: number;
}

const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);
const bar = (v: number) => Math.max(0, Math.min(100, v));

/** KPI and bar figures of the Contingency register (cgKpis, cgBar*). */
export function contingencySummary(c: ContingencyFacts): ContingencySummary {
  const drawn = c.draws.reduce((a, d) => a + (d.amount || 0), 0);
  const usedPct = pct(drawn, c.initial);
  const progPct = Math.round(c.progress * 100);
  const remaining = c.initial - drawn;
  return {
    initial: c.initial,
    initialPctOfBudget: pct(c.initial, c.bac),
    drawn,
    usedPct,
    progPct,
    drawnAlert: usedPct > progPct,
    remaining,
    drawCount: c.draws.length,
    exposure: c.exposure,
    exposureExceeds: c.exposure > remaining,
    barUsed: bar(usedPct),
    barExposure: bar(pct(drawn + c.exposure, c.initial)),
    barProgress: bar(progPct),
  };
}

/** Draw-down table order: most recent first (`cgDraws.slice().reverse()`). */
export const drawRows = <D,>(draws: readonly D[]): D[] => draws.slice().reverse();

/** English sub-line of the "Remaining" tile: "3 draw-downs" ("1 draw-down" — the prototype says "1 draw-downs"). */
export const drawCountText = (n: number) => (n === 1 ? '1 draw-down' : `${n} draw-downs`);

// ── "Contingency draw-down" form (AF.contingency) ─────────────────────────────────────────────────────

export interface Approver {
  /** Stored / displayed name ("R. Aubert"). */
  name: string;
  /** English role title ("Project manager"). */
  title: string;
}

/** Select option label "R. Aubert · Project manager" (English; translated per segment). */
export const approverLabel = (a: Approver) => `${a.name} · ${a.title}`;

/**
 * Approvers offered by the form: the project's manager and the portfolio director (the prototype hard-codes
 * "R. Aubert · Project manager" / "M. Lefebvre · Portfolio director", Harbor Line's PM — 00 §7.16).
 */
export function approversOf(pm: string | null | undefined, director: string): Approver[] {
  const out: Approver[] = [];
  if (pm && pm !== '—') out.push({ name: pm, title: 'Project manager' });
  if (director && director !== pm) out.push({ name: director, title: 'Portfolio director' });
  return out;
}

export interface DrawDown {
  amountKeur: number;
  reason: string;
  /** Free-text reference ("CR-004", "R-03", "NCR-026"); null when blank. */
  linkRef: string | null;
  /** Approver name; null when no approver is offered. */
  approvedBy: string | null;
}

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

export const MAX_REASON = 500;
export const MAX_LINK = 40;
/** Upper bound of a single draw-down (k€) — guards typing slips such as an amount in euros. */
export const MAX_DRAW = 100_000;

/** Amount as the prototype reads it (`parseFloat(amount) || 0`), accepting a French decimal comma. */
export function parseAmount(raw: string | null | undefined): number {
  const n = parseFloat(String(raw ?? '').trim().replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

/**
 * Validates the raw form values (amount · reason · link · approver). The amount must be a positive number of k€
 * (the prototype stored 0 for anything unparsable); the approver must be one of the offered names (value or label).
 */
export function parseDrawDown(values: Record<string, string | undefined>, approvers: readonly Approver[]): ParseResult<DrawDown> {
  const amount = Math.round(parseAmount(values.amount) * 100) / 100;
  if (!(amount > 0)) return { ok: false, error: 'Enter an amount greater than 0' };
  if (amount > MAX_DRAW) return { ok: false, error: 'Amount is too large' };
  const reason = (values.reason ?? '').trim();
  if (!reason) return { ok: false, error: 'Reason is required' };
  if (reason.length > MAX_REASON) return { ok: false, error: 'Reason is too long' };
  const link = (values.link ?? '').trim();
  if (link.length > MAX_LINK) return { ok: false, error: 'Reference is too long' };
  const raw = (values.approver ?? '').trim();
  const a = raw ? approvers.find((x) => x.name === raw || approverLabel(x) === raw) : approvers[0];
  if (raw && !a) return { ok: false, error: 'Unknown approver' };
  return { ok: true, value: { amountKeur: amount, reason, linkRef: link || null, approvedBy: a?.name ?? null } };
}
