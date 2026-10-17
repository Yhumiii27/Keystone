// Risk register: pure business logic (docs/spec/07 §2.1, §3 AF `risks`, §4.1; prototype logic 4570–4590 and the
// `risks` branch of afSubmit 5121). Score / level / cost if it occurs and EMV, register order and category filter, the
// five KPI figures, the category chips, the 5×5 heat-map placement, the sidebar badge rule and the parsing of the
// "New risk" form. No I/O and no translation: labels are the prototype's English source strings.
// Delivery 7 (R-072, owner decision Q-1 "Coût saisi, EMV = coût × P/5"): the cost if the risk occurs is entered and stored;
// the EMV is derived from it and the probability (P = 1 → 20 %, P = 5 → 100 %), so it follows every change of P.
// Golden values: src/domain/risk.test.ts.
import {
  riskCategory, riskLevel as riskLevelCodec, riskLevelOf, riskResponse, riskScore,
  type RiskCategory, type RiskLevel, type RiskResponse, type RiskStatus, type RiskTrend,
} from '@/server/db/codes';

export type { RiskCategory, RiskLevel, RiskResponse, RiskStatus, RiskTrend };

/** The subset of a risk the register logic reads (DAL RiskRow is compatible). */
export interface RiskFacts {
  /** "R-03". */
  id: string;
  category: RiskCategory;
  /** 1–5. */
  probability: number;
  /** 1–5. */
  impact: number;
  /** Expected monetary value, k€ — derived: cost if it occurs × P / 5 (Q-1, `emvOf`). */
  emv: number;
  status: RiskStatus;
  trend: RiskTrend;
  /** Linked schedule activity and its total float in days (null float = complete / unknown). */
  activity: { code: string; totalFloat: number | null } | null;
}

// ── Score, level, cost (rScore / rLevel / rTag 4573–4575, riskVals 4586) ──────────────────────────────

/** Level thresholds: Critical ≥ 15, High ≥ 8, Medium ≥ 4, else Low. */
export const RISK_CRITICAL = 15;
export const RISK_HIGH = 8;
export const RISK_MEDIUM = 4;

/** Score = probability × impact (1–25). */
export const scoreOf = (r: Pick<RiskFacts, 'probability' | 'impact'>) => riskScore(r.probability, r.impact);

/** Level of a score (`rLevel`). */
export const levelOf = (score: number): RiskLevel => riskLevelOf(score);

/** English level label: 'Critical' | 'High' | 'Medium' | 'Low'. */
export const levelLabel = (level: RiskLevel) => riskLevelCodec.label(level);

/** Tag tone of a level (`rTag`): Critical → accent, High → outline, Medium / Low → neutral. */
export const levelTone = (level: RiskLevel): 'accent' | 'outline' | 'neutral' =>
  level === 'critical' ? 'accent' : level === 'high' ? 'outline' : 'neutral';

/** Drawer tag text "Critical · 16" (English; translate per segment). */
export const levelTagText = (r: Pick<RiskFacts, 'probability' | 'impact'>) => `${levelLabel(levelOf(scoreOf(r)))} · ${scoreOf(r)}`;

/** Probability scale of the EMV (Q-1): P = 1 → 20 %, …, P = 5 → 100 %. */
export const probabilityShare = (probability: number) => Math.max(1, Math.min(5, probability)) / 5;

const round2 = (v: number) => Math.round(v * 100) / 100;

/** EMV = cost if it occurs × P / 5 (Q-1), k€ to two decimals. */
export const emvOf = (costKeur: number | null | undefined, probability: number) =>
  costKeur && costKeur > 0 ? round2((costKeur * Math.max(1, Math.min(5, probability))) / 5) : 0;

/** "Contingency draw if it occurs" = the cost entered for the risk; null when none (shown "—"). */
export const costIfOccurs = (costKeur: number | null | undefined): number | null => (costKeur && costKeur > 0 ? costKeur : null);

/**
 * Cost of a risk recorded before Q-1, when only its EMV was stored: EMV × 5 / P to two decimals — `emvOf` gives the EMV
 * back exactly (for whole k€), so the EMV the screens showed is unchanged after the migration (backfill of `risks.cost_keur`).
 */
export const costOfLegacyEmv = (emvKeur: number | null | undefined, probability: number) =>
  emvKeur && emvKeur > 0 ? round2((emvKeur * 5) / Math.max(1, Math.min(5, probability))) : 0;

/** Status tag tone: Open → outline, Closed → neutral. */
export const statusTone = (status: RiskStatus): 'outline' | 'neutral' => (status === 'open' ? 'outline' : 'neutral');

/** The linked activity is on the critical path: total float ≤ 0 (`ALL_BYID[act].tf <= 0`, KPI "On critical path"). */
export const onCriticalPath = (r: Pick<RiskFacts, 'activity'>) => r.activity?.totalFloat != null && r.activity.totalFloat <= 0;

// ── Register rows (riskRows 4579) ─────────────────────────────────────────────────────────────────────

/** Rows of the register: filtered by category (null = all), sorted by score descending (stable), closed included. */
export function registerRows<R extends RiskFacts>(risks: readonly R[], category: RiskCategory | null): R[] {
  return risks
    .map((r, i) => ({ r, i, s: scoreOf(r) }))
    .filter(({ r }) => !category || r.category === category)
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map(({ r }) => r);
}

// ── KPI tiles (riskKpis 4582) ─────────────────────────────────────────────────────────────────────────

export interface RiskKpis {
  /** Open risks and the closed count of the sub-line ("1 closed"). */
  open: number;
  closed: number;
  /** Open risks with score ≥ 8 ("Critical / high"); alert when any. */
  criticalHigh: number;
  /** Σ EMV of open risks, k€. */
  exposure: number;
  /** round(exposure / contingency × 100); 0 when there is no contingency to compare with. */
  exposurePct: number;
  /** Exposure above 80 % of the contingency → LO. */
  exposureAlert: boolean;
  /** Open risks tied to an activity with total float ≤ 0. */
  onCriticalPath: number;
  /** Open risks trending up since the last review; alert when any. */
  trendingUp: number;
}

/** KPI figures of the register; `contingency` is the reserve the exposure is compared with (PD.recon.cont), k€. */
export function riskKpis(risks: readonly RiskFacts[], contingency: number): RiskKpis {
  const open = risks.filter((r) => r.status === 'open');
  const exposure = open.reduce((a, r) => a + (r.emv || 0), 0);
  return {
    open: open.length,
    closed: risks.length - open.length,
    criticalHigh: open.filter((r) => scoreOf(r) >= RISK_HIGH).length,
    exposure,
    exposurePct: contingency > 0 ? Math.round((exposure / contingency) * 100) : 0,
    exposureAlert: exposure > contingency * 0.8,
    onCriticalPath: open.filter(onCriticalPath).length,
    trendingUp: open.filter((r) => r.trend === 'up').length,
  };
}

// ── Category chips (riskChips 4583) ───────────────────────────────────────────────────────────────────

export interface RiskChip {
  /** null = "All". */
  value: RiskCategory | null;
  /** English label ("All", "Supplier / delivery"). */
  label: string;
  count: number;
}

/**
 * "All" (every risk, closed included) + one chip per category in Settings order (`ST.riskCats`) that has at least
 * one risk. `order` defaults to the Settings list; categories added in Settings (chapter 4, A-14) follow, in order of
 * appearance, labelled with the risk's own `categoryLabel` (the DAL resolves it from Settings).
 */
export function riskChips(
  risks: readonly (Pick<RiskFacts, 'category'> & { categoryLabel?: string })[],
  order: readonly RiskCategory[] = riskCategory.codes,
): RiskChip[] {
  const codes = [...order];
  for (const r of risks) if (!codes.includes(r.category)) codes.push(r.category);
  const labelOf = (c: RiskCategory) => risks.find((r) => r.category === c && r.categoryLabel)?.categoryLabel ?? (riskCategory.isCode(c) ? riskCategory.label(c) : c);
  return [
    { value: null, label: 'All', count: risks.length },
    ...codes
      .map((c) => ({ value: c, label: labelOf(c), count: risks.filter((r) => r.category === c).length }))
      .filter((c) => c.count > 0),
  ];
}

/**
 * Category filter from a URL value (code or English label); unknown → null (All). `known` = codes of Settings ›
 * Risk categories (custom categories included, A-14).
 */
export function parseCategory(v: string | null | undefined, known: readonly string[] = []): RiskCategory | null {
  if (!v) return null;
  if (riskCategory.isCode(v) || known.includes(v)) return v;
  try {
    return riskCategory.code(v);
  } catch {
    return null;
  }
}

// ── Heat map (matrix 4580) ────────────────────────────────────────────────────────────────────────────

export interface MatrixCell {
  /** Probability 1–5 (column). */
  p: number;
  /** Impact 1–5 (row). */
  i: number;
  /** p × i. */
  score: number;
  /** Ids of the OPEN risks at exactly (p, i), register source order. */
  ids: string[];
}

export interface MatrixRow {
  i: number;
  cells: MatrixCell[];
}

/** Five rows for impact 5 → 1, five cells for probability 1 → 5; only open risks are plotted. */
export function riskMatrix(risks: readonly RiskFacts[]): MatrixRow[] {
  const open = risks.filter((r) => r.status === 'open');
  return [5, 4, 3, 2, 1].map((i) => ({
    i,
    cells: [1, 2, 3, 4, 5].map((p) => ({ p, i, score: p * i, ids: open.filter((r) => r.probability === p && r.impact === i).map((r) => r.id) })),
  }));
}

/** Heat-map cell band (rCell 4576): ≥ 15 critical · ≥ 8 high · ≥ 4 medium · else low (colours live in the UI). */
export const cellLevel = (p: number, i: number): RiskLevel => levelOf(p * i);

// ── Sidebar badge (logic 5146) ────────────────────────────────────────────────────────────────────────

/** Nav badge of the Risk register: number of open risks with score ≥ 15. */
export const criticalOpenCount = (risks: readonly Pick<RiskFacts, 'status' | 'probability' | 'impact'>[]) =>
  risks.filter((r) => r.status === 'open' && scoreOf(r) >= RISK_CRITICAL).length;

/** Badge text: the count, or '' when 0 (badge hidden). */
export const badgeText = (n: number) => (n > 0 ? String(n) : '');

// ── "New risk" form (AF.risks; afSubmit `risks` branch 5121) ─────────────────────────────────────────

/** Response options of the form, in the prototype's order (default Mitigate). */
export const FORM_RESPONSES: RiskResponse[] = ['mitigate', 'accept', 'transfer', 'avoid'];

/**
 * Category options of the form (`RCAT` = distinct categories of the seed register, first-appearance order;
 * default "Supplier / delivery"). Every Settings category appears once (07 OQ21).
 */
export const FORM_CATEGORIES: RiskCategory[] = [
  'supplier_delivery', 'technical', 'regulatory_permits', 'resources_skills', 'hse', 'contractual_client', 'financial_currency',
];

/** `Math.max(1, Math.min(5, parseInt(v, 10) || 3))` — "0", "" and text give 3, as in the prototype. */
export function parseScale(raw: string | null | undefined): number {
  const n = parseInt(String(raw ?? ''), 10);
  return Math.max(1, Math.min(5, n || 3));
}

/** Upper bound of a risk cost (k€) — guards typing slips such as an amount in euros. */
export const MAX_COST = 100_000;

/**
 * "Cost if it occurs (k€)" (Q-1): blank → 0 (no cost known yet); a number ≥ 0 with a decimal point or comma, two decimals
 * kept; anything else is refused (null).
 */
export function parseCost(raw: string | null | undefined): number | null {
  const v = String(raw ?? '').trim().replace(/\s/g, '').replace(',', '.');
  if (!v) return 0;
  if (!/^\d+(\.\d+)?$/.test(v)) return null;
  const n = Math.round(parseFloat(v) * 100) / 100;
  return Number.isFinite(n) && n <= MAX_COST ? n : null;
}

export interface NewRisk {
  title: string;
  category: RiskCategory;
  probability: number;
  impact: number;
  /** Owner name from the team list; null when the team is empty. */
  owner: string | null;
  response: RiskResponse;
  /** Cost if it occurs, k€ (Q-1); the EMV is derived from it. */
  costKeur: number;
  /** '—' when blank (the prototype's placeholder). */
  plan: string;
}

/**
 * "New risk" owner options: the project's list (team, else the resource pool) with the project's PM of record added at the end
 * when absent — owner's answer to R-121 question 3 (17 Oct 2026, « Ajouter le CP aux propriétaires de risque proposés : Oui »).
 * At the end, so the form's first (default) owner does not change.
 */
export const riskOwnersWithPm = (owners: readonly string[], pmName: string | null): string[] =>
  pmName && !owners.includes(pmName) ? [...owners, pmName] : [...owners];

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

export const MAX_TITLE = 200;
export const MAX_PLAN = 2000;

/**
 * Validates the raw "New risk" values (field ids title · cat · p · i · owner · resp · cost · plan). Selects must hold
 * one of the offered values (blank → first option, as the dialog submits); errors are English source strings.
 * `categories` = the category codes the form offers (Settings › Risk categories, active — A-14); omitted = the defaults.
 */
export function parseNewRisk(values: Record<string, string | undefined>, team: readonly string[], categories?: readonly string[]): ParseResult<NewRisk> {
  const title = (values.title ?? '').trim();
  if (!title) return { ok: false, error: 'Title is required' };
  if (title.length > MAX_TITLE) return { ok: false, error: 'Title is too long' };
  const cat = values.cat || (categories ?? FORM_CATEGORIES)[0];
  const category = parseCategory(cat, categories);
  if (!category || (categories && !categories.includes(category))) return { ok: false, error: 'Unknown category' };
  const resp = values.resp || FORM_RESPONSES[0];
  const response = riskResponse.isCode(resp) ? resp : (riskResponse.labels as string[]).includes(resp) ? riskResponse.code(resp) : null;
  if (!response) return { ok: false, error: 'Unknown response' };
  const ownerRaw = (values.owner ?? '').trim() || team[0] || '';
  if (ownerRaw && !team.includes(ownerRaw)) return { ok: false, error: 'Unknown owner' };
  const plan = (values.plan ?? '').trim();
  if (plan.length > MAX_PLAN) return { ok: false, error: 'Response plan is too long' };
  const cost = parseCost(values.cost);
  if (cost == null) return { ok: false, error: 'Enter a cost of 0 or more (k€)' };
  return {
    ok: true,
    value: {
      title, category, probability: parseScale(values.p), impact: parseScale(values.i), owner: ownerRaw || null, response,
      costKeur: cost, plan: plan || '—',
    },
  };
}

// ── Drawer edits (riskOv: p, i, resp, status; delivery 7: the cost if it occurs, Q-1) ─────────────────────

export interface RiskEdit {
  probability?: number;
  impact?: number;
  response?: RiskResponse;
  status?: RiskStatus;
  /** Cost if it occurs, k€ (0 ≤ cost ≤ MAX_COST). */
  costKeur?: number;
}

/** Validates a drawer edit: P / I integers 1–5, a response code, a status code, a cost; at least one field. */
export function parseRiskEdit(patch: unknown): ParseResult<RiskEdit> {
  if (!patch || typeof patch !== 'object') return { ok: false, error: 'Invalid request' };
  const p = patch as Record<string, unknown>;
  const out: RiskEdit = {};
  const scale = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 5 ? v : null);
  if (p.probability !== undefined) {
    const v = scale(p.probability);
    if (v == null) return { ok: false, error: 'Invalid request' };
    out.probability = v;
  }
  if (p.impact !== undefined) {
    const v = scale(p.impact);
    if (v == null) return { ok: false, error: 'Invalid request' };
    out.impact = v;
  }
  if (p.response !== undefined) {
    if (!riskResponse.isCode(p.response)) return { ok: false, error: 'Invalid request' };
    out.response = p.response;
  }
  if (p.status !== undefined) {
    if (p.status !== 'open' && p.status !== 'closed') return { ok: false, error: 'Invalid request' };
    out.status = p.status;
  }
  if (p.costKeur !== undefined) {
    const c = p.costKeur;
    if (typeof c !== 'number' || !Number.isFinite(c) || c < 0 || c > MAX_COST) return { ok: false, error: 'Enter a cost of 0 or more (k€)' };
    out.costKeur = Math.round(c * 100) / 100;
  }
  if (!Object.keys(out).length) return { ok: false, error: 'Invalid request' };
  return { ok: true, value: out };
}

/** "Close risk" when open, "Reopen" when closed — and the status the button sets. */
export const toggleOf = (status: RiskStatus): { label: string; next: RiskStatus } =>
  status === 'open' ? { label: 'Close risk', next: 'closed' } : { label: 'Reopen', next: 'open' };
