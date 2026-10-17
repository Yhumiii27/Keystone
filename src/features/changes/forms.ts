// Action forms of Change control and Trends (docs/spec/07 §3 AF `changes`, docs/spec/04 §2.5 AF `trends`):
// definitions (English source strings — FormDialog `translate`; select values are codes) and validation of the
// untrusted submitted values. Pure module shared by the client buttons and the Server Functions.
import type { FormDef, FormValues } from '@/components/app/form-def';
import { contractImpact, reportPeriod, reportPeriodLabel, type ChangeType, type ContractImpact, type ReportAudience, type ReportPeriod, type ReportSections } from '@/server/db/codes';

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const record = (v: unknown) => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});

// ── New change request (AF.changes) ─────────────────────────────────────────────────────────────────

export type CrFormType = 'scope' | 'budget' | 'schedule' | 'scope_budget';

/** Type options in the prototype's order; "Scope + budget" is the only combination offered (07 OQ17). */
export const CR_FORM_TYPES: { value: CrFormType; label: string; types: ChangeType[] }[] = [
  { value: 'scope', label: 'Scope', types: ['scope'] },
  { value: 'budget', label: 'Budget', types: ['budget'] },
  { value: 'schedule', label: 'Schedule', types: ['schedule'] },
  { value: 'scope_budget', label: 'Scope + budget', types: ['scope', 'budget'] },
];

/** Prototype default of the WBS field. */
export const CR_DEFAULT_WBS = '1.3';
export const CR_TITLE_MAX = 200;
export const CR_WHY_MAX = 2000;
/** Bounds of the numeric fields (k€, days) — the prototype accepts anything `+value` parses. */
export const CR_AMOUNT_MAX = 100_000;
export const CR_DAYS_MAX = 3650;
const WBS_RE = /^\d+(?:\.\d+)*$/;

/**
 * Delivery 8 (R-069, P-6c): the "Contractual impact" options; the empty first option makes the choice deliberate (refused when
 * left empty). "None (internal)" makes the client step not required.
 */
export const CR_IMPACT_OPTIONS: { value: ContractImpact | ''; label: string }[] = [
  { value: '', label: 'Choose the contractual impact' },
  ...contractImpact.codes.map((c) => ({ value: c, label: contractImpact.label(c) })),
];

/**
 * AF.changes; the WBS default is "1.3" when the project has that work package, else the project root "1". `proposeBaseline`
 * (S-3, Plan "Set baseline" after BL1): the same form titled "New baseline · change request". `withActivities` (Delivery 7,
 * NEW-D2-2, R-062 — the project team, not the client): the optional "Plan activities touched" field ("A1250=28, A1320": codes,
 * each with its new duration in working days if any; src/domain/change-activities.ts parses it). Delivery 8: the required
 * "Contractual impact" (R-069), the optional "Cost category" of the project (R-081 — `costCategories`, given to the project
 * team only: internal cost data, never offered to the client) and the justification's reminder that the client reads it (R-140).
 */
export function newChangeRequestForm(
  defaultWbs = CR_DEFAULT_WBS,
  opts?: { proposeBaseline?: boolean; withActivities?: boolean; costCategories?: { value: string; label: string }[] },
): FormDef {
  return {
    title: opts?.proposeBaseline ? 'New baseline · change request' : 'New change request',
    submit: 'Submit for review',
    kind: 'create',
    fields: [
      { id: 'title', label: 'Title', type: 'text', required: true },
      { id: 'type', label: 'Type', type: 'select', options: CR_FORM_TYPES.map(({ value, label }) => ({ value, label })) },
      { id: 'impact', label: 'Contractual impact', type: 'select', required: true, options: CR_IMPACT_OPTIONS },
      { id: 'amt', label: 'Amount (k€)', type: 'number', defaultValue: '0' },
      { id: 'days', label: 'Delay (days)', type: 'number', defaultValue: '0' },
      { id: 'wbs', label: 'WBS', type: 'text', defaultValue: defaultWbs },
      ...(opts?.costCategories?.length
        ? [{ id: 'cat', label: 'Cost category', type: 'select' as const, options: [{ value: '', label: 'No category — BAC and work packages only' }, ...opts.costCategories] }]
        : []),
      ...(opts?.withActivities
        ? [{ id: 'acts', label: 'Plan activities touched (optional)', type: 'text' as const, placeholder: 'A1250=28, A1320', span: 'full' as const }]
        : []),
      { id: 'why', label: 'Justification', type: 'textarea', required: true, placeholder: 'Shown to the client with the change request' },
    ],
  };
}

/**
 * The change-request form in the viewer's language (the dialog's `translate`, done here): Keystone's labels through `t`, but the
 * cost categories' names as typed ("C03 · Steel works", R-148 — `t` would alter them; the page builds them with dataText).
 */
export function translatedChangeRequestForm(def: FormDef, t: (english: string) => string): FormDef {
  return {
    ...def, title: t(def.title), submit: t(def.submit),
    fields: def.fields.map((f) => ({
      ...f, label: t(f.label), placeholder: f.placeholder ? t(f.placeholder) : f.placeholder,
      options: f.options?.map((o) => (typeof o === 'string' ? t(o) : { value: o.value, label: f.id === 'cat' && o.value ? o.label : t(o.label) })),
    })),
  };
}

export interface NewChangeRequest {
  title: string;
  types: ChangeType[];
  amountKeur: number;
  scheduleDays: number;
  wbsCodes: string[];
  justification: string;
  /** R-069 (P-6c). */
  contractImpact: ContractImpact;
  /** R-081: the cost category code as sent ("C03"), null when none; the Server Function checks it belongs to the project. */
  costCategoryCode: string | null;
}

/** "C03": a project cost category code (budget-categories.ts numbering). */
const CATEGORY_RE = /^C\d{1,4}$/;

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

/** A number field: blank → 0 (prototype `+get(id) || 0`), else a finite number. */
function numberField(v: unknown): number | null {
  const s = str(v).replace(',', '.').replace('−', '-');
  if (!s) return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Validates the AF.changes values. Errors are EN source strings (render through t()). */
export function parseNewChangeRequest(values: FormValues | unknown): Parsed<NewChangeRequest> {
  const v = record(values);
  const title = str(v.title);
  const why = str(v.why);
  const type = CR_FORM_TYPES.find((o) => o.value === (str(v.type) || 'scope'));
  const amt = numberField(v.amt);
  const days = numberField(v.days);
  if (!title) return { ok: false, error: 'Title is required' };
  if (title.length > CR_TITLE_MAX) return { ok: false, error: 'Title is too long' };
  if (!type) return { ok: false, error: 'Unknown change type' };
  if (amt == null || Math.abs(amt) > CR_AMOUNT_MAX) return { ok: false, error: 'Enter an amount in k€' };
  if (days == null || Math.abs(days) > CR_DAYS_MAX) return { ok: false, error: 'Enter a delay in days' };
  const codes = [...new Set(str(v.wbs).split(/[\s,;]+/).filter(Boolean))];
  if (codes.some((c) => !WBS_RE.test(c)) || codes.length > 20) return { ok: false, error: 'Enter WBS codes such as 1.3 or 1.3, 1.4' };
  if (!why) return { ok: false, error: 'Justification is required' };
  if (why.length > CR_WHY_MAX) return { ok: false, error: 'Justification is too long' };
  const impact = str(v.impact);
  if (!contractImpact.isCode(impact)) return { ok: false, error: 'Choose the contractual impact' };
  const cat = str(v.cat);
  if (cat && !CATEGORY_RE.test(cat)) return { ok: false, error: 'Unknown cost category' };
  return {
    ok: true,
    value: {
      title, types: type.types, amountKeur: Math.round(amt), scheduleDays: Math.round(days), wbsCodes: codes.length ? codes : ['1'], justification: why,
      contractImpact: impact, costCategoryCode: cat || null,
    },
  };
}

/** AF_RESULT.changes, after the new number: "CR-011 · Change request submitted for review". */
export const NEW_CR_RESULT = 'Change request submitted for review';

// ── Generate status report (AF.trends) ─────────────────────────────────────────────────────────────

/** Period options at the business date `today` (R-013: "September 2026" / "Q3 2026" on the demo data set's date). */
export const reportPeriodOptions = (today: string): { value: ReportPeriod; label: string }[] =>
  reportPeriod.codes.map((value) => ({ value, label: reportPeriodLabel(value, today) }));
export const REPORT_AUDIENCES: { value: ReportAudience; label: string }[] = [
  { value: 'steering', label: 'Steering committee' },
  { value: 'client', label: 'Client' },
  { value: 'internal', label: 'Internal' },
];
export const REPORT_SECTIONS: { value: ReportSections; label: string }[] = [
  { value: 'full', label: 'Full report' },
  { value: 'summary', label: 'Summary + KPIs' },
  { value: 'kpis', label: 'KPIs only' },
];
export const REPORT_NOTE_MAX = 2000;

/** AF.trends at the business date `today` (the period labels). */
export const statusReportForm = (today: string): FormDef => ({
  title: 'Generate status report',
  submit: 'Generate PDF',
  kind: 'run',
  fields: [
    { id: 'period', label: 'Period', type: 'select', options: reportPeriodOptions(today) },
    { id: 'audience', label: 'Audience', type: 'select', options: REPORT_AUDIENCES },
    { id: 'sections', label: 'Sections', type: 'select', options: REPORT_SECTIONS },
    { id: 'note', label: 'Manager note', type: 'textarea' },
  ],
});

export interface StatusReportRequest {
  period: ReportPeriod;
  audience: ReportAudience;
  sections: ReportSections;
  note: string;
}

const pick = <T extends string>(opts: { value: T }[], v: unknown): T | null => {
  const s = str(v);
  if (!s) return opts[0].value;
  return opts.find((o) => o.value === s)?.value ?? null;
};

/** Validates the AF.trends values (blank selects → first option, as afOpen). */
export function parseStatusReport(values: FormValues | unknown): Parsed<StatusReportRequest> {
  const v = record(values);
  const period = pick(reportPeriod.codes.map((value) => ({ value })), v.period);
  const audience = pick(REPORT_AUDIENCES, v.audience);
  const sections = pick(REPORT_SECTIONS, v.sections);
  const note = str(v.note);
  if (!period) return { ok: false, error: 'Unknown period' };
  if (!audience) return { ok: false, error: 'Unknown audience' };
  if (!sections) return { ok: false, error: 'Unknown sections' };
  if (note.length > REPORT_NOTE_MAX) return { ok: false, error: 'Manager note is too long' };
  return { ok: true, value: { period, audience, sections, note } };
}

/** AF_RESULT.trends. */
export const STATUS_REPORT_RESULT = 'Status report generated · PDF ready';
