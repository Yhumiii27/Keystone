// Contingency register: pure business logic (docs/spec/04 §5; prototype logic 4959–4967 and the `contingency`
// bucket of afSubmit 5121). Initial provision (default round(BAC × 3 %)), drawn / remaining, use vs project
// progress, open-risk exposure, the three bar widths, the draw-down list order and the "Contingency draw-down"
// form parsing. No I/O, no translation. Golden values: src/domain/contingency.test.ts.
// Delivery 7 (R-070 / R-071, owner decisions A-8 and C-4): only VALIDATED draw-downs are drawn; a draw-down awaiting the
// director's validation shows apart ("pending"); the form links every draw-down to a change request, a risk or an NCR
// chosen from a list, and offers no approver any more (the portfolio director validates in My approvals).

/** Default provision of a project without a register: round(BAC × 3 %) (`CONTINGENCY[project] || {initial: …}`). */
export const defaultProvision = (bac: number) => Math.round(bac * 0.03);

export interface ContingencyFacts {
  /** Initial provision, k€. */
  initial: number;
  /** Draw-downs in stored order (oldest first), k€; only validated ones (or without a status: the prototype's) are drawn. */
  draws: readonly { amount: number; status?: 'submitted' | 'validated' | 'rejected' }[];
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
  /** Validated draw-downs. */
  drawCount: number;
  /** Draw-downs awaiting the director's validation (C-4): amount and count, not drawn yet. */
  pending: number;
  pendingCount: number;
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
  const validated = c.draws.filter((d) => !d.status || d.status === 'validated');
  const waiting = c.draws.filter((d) => d.status === 'submitted');
  const drawn = validated.reduce((a, d) => a + (d.amount || 0), 0);
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
    drawCount: validated.length,
    pending: waiting.reduce((a, d) => a + (d.amount || 0), 0),
    pendingCount: waiting.length,
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

// ── "Contingency draw-down" form (AF.contingency; delivery 7: C-4) ───────────────────────────────────

/** What a draw-down can be linked to (C-4): a change request, a risk or an NCR of the project. */
export type DrawLinkType = 'change_request' | 'risk' | 'ncr';

/** An item the form offers in "Linked to". */
export interface DrawLinkOption {
  /** Stored reference: "CR-004", "R-03", "NCR-026". */
  value: string;
  /** "CR-004 · Additional piling — soft ground at Bay 4" (English data text; translated per segment). */
  label: string;
  type: DrawLinkType;
}

/** Option label "CR-004 · Additional piling — soft ground at Bay 4". */
export const linkOptionLabel = (ref: string, title: string) => `${ref} · ${title}`;

export interface DrawDown {
  amountKeur: number;
  reason: string;
  /** Linked item ("CR-004", "R-03", "NCR-026") and its kind — required (C-4). */
  linkRef: string;
  linkType: DrawLinkType;
}

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

export const MAX_REASON = 500;
/** Upper bound of a single draw-down (k€) — guards typing slips such as an amount in euros. */
export const MAX_DRAW = 100_000;

/** Amount as the prototype reads it (`parseFloat(amount) || 0`), accepting a French decimal comma. */
export function parseAmount(raw: string | null | undefined): number {
  const n = parseFloat(String(raw ?? '').trim().replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

/**
 * Validates the raw form values (amount · reason · link). The amount must be a positive number of k€ (the prototype stored 0
 * for anything unparsable); the link is required and must be one of the offered change requests, risks or NCRs (C-4).
 */
export function parseDrawDown(values: Record<string, string | undefined>, links: readonly DrawLinkOption[]): ParseResult<DrawDown> {
  const amount = Math.round(parseAmount(values.amount) * 100) / 100;
  if (!(amount > 0)) return { ok: false, error: 'Enter an amount greater than 0' };
  if (amount > MAX_DRAW) return { ok: false, error: 'Amount is too large' };
  const reason = (values.reason ?? '').trim();
  if (!reason) return { ok: false, error: 'Reason is required' };
  if (reason.length > MAX_REASON) return { ok: false, error: 'Reason is too long' };
  const raw = (values.link ?? '').trim();
  if (!raw) return { ok: false, error: 'Choose the change request, risk or NCR the draw-down covers' };
  const link = links.find((l) => l.value === raw || l.label === raw);
  if (!link) return { ok: false, error: 'Unknown change request, risk or NCR' };
  return { ok: true, value: { amountKeur: amount, reason, linkRef: link.value, linkType: link.type } };
}
