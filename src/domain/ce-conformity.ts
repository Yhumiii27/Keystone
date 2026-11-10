// R-160 (P2, owner's answer D9-32 of 10 Nov 2026: « Lancer maintenant, avant janvier 2027 ») — the CE conformity file of each
// machine a project supplies, kept per equipment line (R-185: one line = one machine design × a quantity; its units are the
// installed-base machines of the line). Machinery Regulation (EU) 2023/1230, applicable from 20 Jan 2027.
//
// Pure rules: choice lists (regime, Annex I category, conformity assessment route — choice lists only, the app gives no legal
// advice), the default checklists (Annex III headings by number and short title, Annex IV technical-file headings — seeded in
// Settings, to be validated by QHSE), input parsing, the readiness of a file (computed, never stored), the date a line's machines
// are placed on the market, who edits what. No I/O; `today` is never needed here (the dates compared are the file's own).
import { monthEndOf } from './cost-control';

/** Date of application of Regulation (EU) 2023/1230 (Art. 54): machines placed on the market from this day fall under it. */
export const CE_APPLICATION_DATE = '2027-01-20';

// ── Choice lists ──────────────────────────────────────────────────────────────────────────────────────────────────────────

export const CE_REGIMES = ['machinery', 'partly_completed'] as const;
export type CeRegime = (typeof CE_REGIMES)[number];
export const CE_REGIME_LABEL: Record<CeRegime, string> = {
  machinery: 'Machinery',
  partly_completed: 'Partly completed machinery',
};

/** Annex I of the Regulation (the former Annex IV of Directive 2006/42/EC): listed in Part A, Part B, or not listed. */
export const CE_CATEGORIES = ['not_listed', 'annex_i_a', 'annex_i_b'] as const;
export type CeCategory = (typeof CE_CATEGORIES)[number];
export const CE_CATEGORY_LABEL: Record<CeCategory, string> = {
  not_listed: 'Not listed in Annex I',
  annex_i_a: 'Annex I · Part A',
  annex_i_b: 'Annex I · Part B',
};

/** Conformity assessment procedures of Art. 25 (modules of Annexes VI, VII + VIII, IX, XI). */
export const CE_ROUTES = ['module_a', 'module_b_c', 'module_h', 'module_g'] as const;
export type CeRoute = (typeof CE_ROUTES)[number];
export const CE_ROUTE_LABEL: Record<CeRoute, string> = {
  module_a: 'Internal production control (module A)',
  module_b_c: 'EU type-examination + conformity to type (modules B + C)',
  module_h: 'Full quality assurance (module H)',
  module_g: 'Unit verification (module G)',
};

/** Status of one essential health and safety requirement (EHSR) of Annex III for the machine. */
export const EHSR_STATUSES = ['todo', 'applies', 'met', 'na'] as const;
export type EhsrStatus = (typeof EHSR_STATUSES)[number];
export const EHSR_STATUS_LABEL: Record<EhsrStatus, string> = {
  todo: 'Not assessed',
  applies: 'Applicable · to demonstrate',
  met: 'Applicable · met',
  na: 'Not applicable',
};

/** Status of one heading of the technical file (Annex IV). */
export const TECH_STATUSES = ['todo', 'done', 'na'] as const;
export type TechStatus = (typeof TECH_STATUSES)[number];
export const TECH_STATUS_LABEL: Record<TechStatus, string> = {
  todo: 'To do',
  done: 'Done',
  na: 'Not applicable',
};

const isOf = <T extends string>(list: readonly T[]) => (v: unknown): v is T => typeof v === 'string' && (list as readonly string[]).includes(v);
export const isCeRegime = isOf(CE_REGIMES);
export const isCeCategory = isOf(CE_CATEGORIES);
export const isCeRoute = isOf(CE_ROUTES);
export const isEhsrStatus = isOf(EHSR_STATUSES);
export const isTechStatus = isOf(TECH_STATUSES);

// ── Reference checklists (Settings › CE conformity checklists) ─────────────────────────────────────────────────────────────

export const CE_CHECKLIST_KINDS = ['ehsr', 'techfile'] as const;
export type CeChecklistKind = (typeof CE_CHECKLIST_KINDS)[number];
export const isCeChecklistKind = isOf(CE_CHECKLIST_KINDS);
export const CE_CHECKLIST_TITLE: Record<CeChecklistKind, string> = {
  ehsr: 'Essential health and safety requirements (Annex III)',
  techfile: 'Technical file contents (Annex IV)',
};

export interface CeChecklistDefault {
  code: string;
  title: string;
}

/**
 * Annex III of Regulation (EU) 2023/1230 — headings by number and short title only (no text of the requirements). Sections 1, 3
 * and 4 at their second level, sections 2, 5 and 6 as a whole. To be validated by QHSE against the Official Journal (notes § 6).
 */
export const DEFAULT_EHSR: readonly CeChecklistDefault[] = [
  { code: '1.1', title: 'General remarks' },
  { code: '1.2', title: 'Control systems' },
  { code: '1.3', title: 'Protection against mechanical hazards' },
  { code: '1.4', title: 'Required characteristics of guards and protective devices' },
  { code: '1.5', title: 'Risks due to other hazards' },
  { code: '1.6', title: 'Maintenance' },
  { code: '1.7', title: 'Information' },
  { code: '2', title: 'Supplementary requirements for certain categories of machinery' },
  { code: '3.1', title: 'Mobility · General' },
  { code: '3.2', title: 'Mobility · Work positions' },
  { code: '3.3', title: 'Mobility · Control systems' },
  { code: '3.4', title: 'Mobility · Protection against mechanical hazards' },
  { code: '3.5', title: 'Mobility · Protection against other hazards' },
  { code: '3.6', title: 'Mobility · Information and indications' },
  { code: '4.1', title: 'Lifting · General' },
  { code: '4.2', title: 'Lifting · Machinery whose power source is other than manual effort' },
  { code: '4.3', title: 'Lifting · Information and markings' },
  { code: '4.4', title: 'Lifting · Instructions' },
  { code: '5', title: 'Machinery intended for underground work' },
  { code: '6', title: 'Machinery presenting particular hazards due to the lifting of persons' },
];

/** Annex IV (Part A) — the headings of the technical documentation, short titles. To be validated by QHSE (notes § 6). */
export const DEFAULT_TECHFILE: readonly CeChecklistDefault[] = [
  { code: 'description', title: 'General description of the machinery and its intended use' },
  { code: 'risk_assessment', title: 'Risk assessment and protective measures' },
  { code: 'drawings', title: 'Design and manufacturing drawings, calculation notes and circuit diagrams' },
  { code: 'explanations', title: 'Descriptions and explanations of the drawings and of the operation' },
  { code: 'standards', title: 'Harmonised standards and technical specifications applied' },
  { code: 'tests', title: 'Test reports and results' },
  { code: 'instructions', title: 'Instructions for use' },
  { code: 'incorporated', title: 'Declarations of incorporated partly completed machinery and products' },
  { code: 'declaration', title: 'Copy of the EU declaration of conformity' },
  { code: 'series', title: 'Measures ensuring the conformity of series production' },
  { code: 'software', title: 'Safety-related software (source code or programming logic)' },
];

export const CE_CHECKLIST_DEFAULTS: Record<CeChecklistKind, readonly CeChecklistDefault[]> = { ehsr: DEFAULT_EHSR, techfile: DEFAULT_TECHFILE };

/** A new checklist entry typed in Settings: code (Annex III number "1.1.9", or a short key) and short title. */
export function parseChecklistEntry(kind: unknown, code: unknown, title: unknown): { ok: true; value: { kind: CeChecklistKind; code: string; title: string } } | { ok: false; error: string } {
  if (!isCeChecklistKind(kind)) return { ok: false, error: 'Unknown list' };
  const c = typeof code === 'string' ? code.trim() : '';
  const tt = typeof title === 'string' ? title.trim() : '';
  if (!c) return { ok: false, error: 'Number is required' };
  if (kind === 'ehsr' ? !/^\d{1,2}(\.\d{1,2}){0,3}$/.test(c) : !/^[a-z][a-z0-9_]{0,39}$/.test(c)) {
    return { ok: false, error: kind === 'ehsr' ? 'A number reads "1.1.9"' : 'A key reads "lowercase_letters"' };
  }
  if (!tt) return { ok: false, error: 'Title is required' };
  if (tt.length > 160) return { ok: false, error: 'Title is too long' };
  return { ok: true, value: { kind, code: c, title: tt } };
}

// ── The CE file of an equipment line ────────────────────────────────────────────────────────────────────────────────────

export interface TechFileEntry {
  status: TechStatus;
  /** Project deliverable that holds the heading ("D-021"); null = none. */
  deliverable: string | null;
  /** Codex document reference ("MAN-HLT-015"); null = none. Keystone keeps the reference only, the document lives in Codex. */
  codexRef: string | null;
}

export interface CeFileValues {
  regime: CeRegime | null;
  category: CeCategory | null;
  route: CeRoute | null;
  /** Codex reference of the risk assessment. */
  riskAssessmentRef: string | null;
  /** Harmonised standards applied (free list, "EN ISO 12100:2010"). */
  standards: string[];
  /** Codex reference of the instructions (assembly instructions for partly completed machinery). */
  instructionsRef: string | null;
  /** EU declaration of conformity (machinery) or declaration of incorporation (partly completed machinery). */
  declarationSignatory: string | null;
  declarationOn: string | null;
  declarationRef: string | null;
  /** Date of the CE marking (machinery only: partly completed machinery bears none). */
  ceMarkingOn: string | null;
  ehsr: Record<string, EhsrStatus>;
  techFile: Record<string, TechFileEntry>;
}

export const EMPTY_CE_FILE: CeFileValues = {
  regime: null, category: null, route: null, riskAssessmentRef: null, standards: [], instructionsRef: null,
  declarationSignatory: null, declarationOn: null, declarationRef: null, ceMarkingOn: null, ehsr: {}, techFile: {},
};

/** The fields a project manager edits (the declaration and the marking); the rest is the engineering lead's and quality's. */
export const CE_PROJECT_FIELDS = ['declarationSignatory', 'declarationOn', 'declarationRef', 'ceMarkingOn'] as const;

/** The declaration a file carries, by regime (none chosen: the EU declaration of conformity). */
export const declarationKindOf = (regime: CeRegime | null) => (regime === 'partly_completed' ? 'Declaration of incorporation' : 'EU declaration of conformity');

export const MAX_STANDARDS = 40;
const CODEX_REF_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,59}$/;

const isIso = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

export interface CeParseContext {
  /** Active and inactive codes of the checklists (an answer kept on a removed heading stays valid). */
  ehsrCodes: readonly string[];
  techCodes: readonly string[];
  /** Deliverable numbers of the project. */
  deliverables: readonly string[];
}

export type CeParse = { ok: true; value: CeFileValues } | { ok: false; error: string };

/** Validates a CE file sent by the form (an untrusted value). Blank texts are null. */
export function parseCeFile(raw: unknown, ctx: CeParseContext): CeParse {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'Invalid request' };
  const r = raw as Record<string, unknown>;
  const pick = <T extends string>(v: unknown, ok: (x: unknown) => x is T, what: string): T | null | Error => {
    const s = str(v);
    if (!s) return null;
    return ok(s) ? s : new Error(`Unknown ${what}`);
  };
  const regime = pick(r.regime, isCeRegime, 'regime');
  const category = pick(r.category, isCeCategory, 'category');
  const route = pick(r.route, isCeRoute, 'conformity assessment route');
  if (regime instanceof Error) return { ok: false, error: regime.message };
  if (category instanceof Error) return { ok: false, error: category.message };
  if (route instanceof Error) return { ok: false, error: route.message };
  const ref = (v: unknown, what: string): string | null | Error => {
    const s = str(v);
    if (!s) return null;
    return CODEX_REF_RE.test(s) ? s : new Error(`${what} is not a Codex reference`);
  };
  const riskAssessmentRef = ref(r.riskAssessmentRef, 'Risk assessment');
  const instructionsRef = ref(r.instructionsRef, 'Instructions');
  const declarationRef = ref(r.declarationRef, 'Declaration');
  if (riskAssessmentRef instanceof Error) return { ok: false, error: riskAssessmentRef.message };
  if (instructionsRef instanceof Error) return { ok: false, error: instructionsRef.message };
  if (declarationRef instanceof Error) return { ok: false, error: declarationRef.message };
  const date = (v: unknown): string | null | Error => {
    const s = str(v);
    if (!s) return null;
    return isIso(s) ? s : new Error('Invalid date');
  };
  const declarationOn = date(r.declarationOn);
  const ceMarkingOn = date(r.ceMarkingOn);
  if (declarationOn instanceof Error) return { ok: false, error: declarationOn.message };
  if (ceMarkingOn instanceof Error) return { ok: false, error: ceMarkingOn.message };
  const signatory = str(r.declarationSignatory);
  if (signatory.length > 120) return { ok: false, error: 'Signatory is too long' };
  if (regime === 'partly_completed' && route) return { ok: false, error: 'Partly completed machinery has no conformity assessment route' };
  if (regime === 'partly_completed' && ceMarkingOn) return { ok: false, error: 'Partly completed machinery bears no CE marking' };

  const rawStandards = Array.isArray(r.standards) ? r.standards : typeof r.standards === 'string' ? r.standards.split('\n') : [];
  const standards: string[] = [];
  for (const s of rawStandards) {
    const v = str(s);
    if (!v) continue;
    if (v.length > 120) return { ok: false, error: 'A standard is too long' };
    if (!standards.some((x) => x.toLowerCase() === v.toLowerCase())) standards.push(v);
  }
  if (standards.length > MAX_STANDARDS) return { ok: false, error: 'Too many standards' };

  const ehsr: Record<string, EhsrStatus> = {};
  const rawEhsr = r.ehsr && typeof r.ehsr === 'object' ? (r.ehsr as Record<string, unknown>) : {};
  for (const [code, status] of Object.entries(rawEhsr)) {
    if (!ctx.ehsrCodes.includes(code)) return { ok: false, error: 'Unknown requirement' };
    if (!isEhsrStatus(status)) return { ok: false, error: 'Unknown requirement status' };
    if (status !== 'todo') ehsr[code] = status;
  }

  const techFile: Record<string, TechFileEntry> = {};
  const rawTech = r.techFile && typeof r.techFile === 'object' ? (r.techFile as Record<string, unknown>) : {};
  for (const [code, entry] of Object.entries(rawTech)) {
    if (!ctx.techCodes.includes(code)) return { ok: false, error: 'Unknown technical file heading' };
    const e = entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : {};
    const status = str(e.status) || 'todo';
    if (!isTechStatus(status)) return { ok: false, error: 'Unknown technical file status' };
    const deliverable = str(e.deliverable) || null;
    if (deliverable && !ctx.deliverables.includes(deliverable)) return { ok: false, error: 'Unknown deliverable' };
    const codexRef = ref(e.codexRef, 'Technical file document');
    if (codexRef instanceof Error) return { ok: false, error: codexRef.message };
    if (status === 'done' && !deliverable && !codexRef) return { ok: false, error: 'A heading marked done needs a deliverable or a Codex reference' };
    if (status !== 'todo' || deliverable || codexRef) techFile[code] = { status, deliverable, codexRef };
  }

  return {
    ok: true,
    value: {
      regime, category, route, riskAssessmentRef, standards, instructionsRef,
      declarationSignatory: signatory || null, declarationOn, declarationRef, ceMarkingOn, ehsr, techFile,
    },
  };
}

// ── Who edits what ────────────────────────────────────────────────────────────────────────────────────────────────────

/** 'technical' = every field; 'project' = the declaration and the marking (CE_PROJECT_FIELDS); 'none' = read. */
export type CeEditScope = 'technical' | 'project' | 'none';

/** Roles that keep the technical file (owner's brief, 10 Nov 2026): the engineering lead and quality. */
export const CE_TECHNICAL_ROLES = ['englead', 'quality'] as const;

/**
 * Who edits a CE file: the engineering lead and quality edit it all, a project manager (lead of the project) the project-level
 * fields; the director reads (brief of 10 Nov 2026, deliberately narrower than "the director edits all"); everybody else reads.
 * `canEditScreen` = the Commissioning screen is in the viewer's workspace and the project is not read-only for them.
 */
export function ceEditScope(role: string, facts: { lead: boolean; canEditScreen: boolean }): CeEditScope {
  if (!facts.canEditScreen) return 'none';
  if ((CE_TECHNICAL_ROLES as readonly string[]).includes(role)) return 'technical';
  if (role === 'pm' && facts.lead) return 'project';
  return 'none';
}

/** What a save writes: the new values within the editor's scope, the stored ones elsewhere. */
export function applyCeScope(before: CeFileValues, after: CeFileValues, scope: CeEditScope): CeFileValues {
  if (scope === 'technical') return after;
  if (scope === 'none') return before;
  const out: CeFileValues = { ...before };
  for (const k of CE_PROJECT_FIELDS) (out as unknown as Record<string, unknown>)[k] = after[k];
  // A partly completed machine bears no CE marking, whatever the PM typed.
  if (out.regime === 'partly_completed') out.ceMarkingOn = null;
  return out;
}

/** JSON with sorted object keys (a jsonb column comes back with its keys reordered). */
const stable = (v: unknown): string =>
  JSON.stringify(v, (_k, x: unknown) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))) : x));

/** The fields that differ between two files (audit before / after). */
export function ceChangedFields(before: CeFileValues, after: CeFileValues): { before: Record<string, unknown>; after: Record<string, unknown> } {
  const b: Record<string, unknown> = {};
  const a: Record<string, unknown> = {};
  for (const k of Object.keys(EMPTY_CE_FILE) as (keyof CeFileValues)[]) {
    if (stable(before[k]) !== stable(after[k])) {
      b[k] = before[k];
      a[k] = after[k];
    }
  }
  return { before: b, after: a };
}

// ── Readiness (computed, never stored) ─────────────────────────────────────────────────────────────────────────────────

export type CeCheckKey = 'regime' | 'category' | 'route' | 'riskAssessment' | 'ehsr' | 'techFile' | 'instructions' | 'declaration' | 'ceMarking';

export interface CeCheck {
  key: CeCheckKey;
  /** EN source label. */
  label: string;
  ok: boolean;
}

export type CeState = 'none' | 'in_progress' | 'complete';
export const CE_STATE_LABEL: Record<CeState, string> = { none: 'Not started', in_progress: 'In progress', complete: 'File complete' };

export interface CeReadiness {
  checks: CeCheck[];
  done: number;
  total: number;
  /** 0–100, rounded. */
  pct: number;
  complete: boolean;
  state: CeState;
  /** EN labels of the checks not met. */
  missing: string[];
  /** Requirements assessed / to assess; technical-file headings settled / to settle (active entries of the checklists). */
  ehsr: { settled: number; total: number; open: number };
  techFile: { settled: number; total: number };
}

/**
 * Readiness of a file against the active checklists. Machinery: regime, Annex I category, route, risk assessment, every active
 * requirement met or not applicable, every active technical-file heading done or not applicable, instructions, the declaration
 * (signatory, date, Codex reference) and the CE marking date. Partly completed machinery: no category, route nor marking.
 * Harmonised standards are listed when applied but never required (a machine may rely on none).
 */
export function ceReadiness(file: CeFileValues | null, lists: { ehsr: readonly string[]; techFile: readonly string[] }): CeReadiness {
  const f = file ?? EMPTY_CE_FILE;
  const partly = f.regime === 'partly_completed';
  const ehsrSettled = lists.ehsr.filter((c) => f.ehsr[c] === 'met' || f.ehsr[c] === 'na').length;
  const ehsrOpen = lists.ehsr.filter((c) => f.ehsr[c] === 'applies').length;
  const techSettled = lists.techFile.filter((c) => f.techFile[c]?.status === 'done' || f.techFile[c]?.status === 'na').length;
  const checks: CeCheck[] = [
    { key: 'regime', label: 'Regime chosen', ok: !!f.regime },
    ...(partly ? [] : [
      { key: 'category' as const, label: 'Annex I category chosen', ok: !!f.category },
      { key: 'route' as const, label: 'Conformity assessment route chosen', ok: !!f.route },
    ]),
    { key: 'riskAssessment', label: 'Risk assessment referenced', ok: !!f.riskAssessmentRef },
    { key: 'ehsr', label: 'Essential requirements assessed and met', ok: ehsrSettled === lists.ehsr.length },
    { key: 'techFile', label: 'Technical file complete', ok: techSettled === lists.techFile.length },
    { key: 'instructions', label: partly ? 'Assembly instructions referenced' : 'Instructions referenced', ok: !!f.instructionsRef },
    { key: 'declaration', label: partly ? 'Declaration of incorporation signed' : 'EU declaration of conformity signed', ok: !!(f.declarationSignatory && f.declarationOn && f.declarationRef) },
    ...(partly ? [] : [{ key: 'ceMarking' as const, label: 'CE marking dated', ok: !!f.ceMarkingOn }]),
  ];
  const done = checks.filter((c) => c.ok).length;
  const total = checks.length;
  const complete = !!file && done === total;
  return {
    checks, done, total, pct: Math.round((done / total) * 100), complete,
    state: !file ? 'none' : complete ? 'complete' : 'in_progress',
    missing: checks.filter((c) => !c.ok).map((c) => c.label),
    ehsr: { settled: ehsrSettled, total: lists.ehsr.length, open: ehsrOpen },
    techFile: { settled: techSettled, total: lists.techFile.length },
  };
}

// ── Placing on the market and the date of application ───────────────────────────────────────────────────────────────

export interface MarketDateInput {
  /** Machines of the line (units). */
  quantity: number;
  /** Delivery dates of the line's machines already in the installed base. */
  deliveredOn: readonly string[];
  /** Handover dates of the line's commissioning systems (done or planned), its own or common ones. */
  handoverOn: readonly (string | null)[];
  /** Planned finish of the project (date chosen in the wizard), else null. */
  plannedFinish: string | null;
  /** Finish month index since Jan 2026 (seeded projects), else null. */
  finishMonth: number | null;
}

/**
 * When the line's machines are placed on the market (or put into service): every unit delivered → the last delivery; else the
 * latest handover date of its systems; else the project's planned finish (date, else the end of its finish month); else unknown.
 */
export function ceMarketDate(m: MarketDateInput): string | null {
  const max = (xs: readonly (string | null)[]) => xs.filter((x): x is string => !!x).sort().at(-1) ?? null;
  if (m.quantity > 0 && m.deliveredOn.length >= m.quantity) return max(m.deliveredOn);
  return max(m.handoverOn) ?? m.plannedFinish ?? (m.finishMonth != null ? monthEndOf(Math.floor(m.finishMonth)) : null);
}

/** The Regulation applies to a machine placed on the market on that date (unknown date: assume it does — conservative). */
export const ceRegulationApplies = (marketDate: string | null) => marketDate == null || marketDate >= CE_APPLICATION_DATE;
