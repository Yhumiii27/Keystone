// Action forms of Change control and Trends (docs/spec/07 §3 AF `changes`, docs/spec/04 §2.5 AF `trends`):
// definitions (English source strings — FormDialog `translate`; select values are codes) and validation of the
// untrusted submitted values. Pure module shared by the client buttons and the Server Functions.
import type { FormDef, FormValues } from '@/components/app/form-def';
import type { ChangeType, ReportAudience, ReportPeriod, ReportSections } from '@/server/db/codes';

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
 * AF.changes; the WBS default is "1.3" when the project has that work package, else the project root "1". `proposeBaseline`
 * (S-3, Plan "Set baseline" after BL1): the same form titled "New baseline · change request". `withActivities` (Delivery 7,
 * NEW-D2-2, R-062 — the project team, not the client): the optional "Plan activities touched" field ("A1250=28, A1320": codes,
 * each with its new duration in working days if any; src/domain/change-activities.ts parses it).
 */
export function newChangeRequestForm(defaultWbs = CR_DEFAULT_WBS, opts?: { proposeBaseline?: boolean; withActivities?: boolean }): FormDef {
  return {
    title: opts?.proposeBaseline ? 'New baseline · change request' : 'New change request',
    submit: 'Submit for review',
    kind: 'create',
    fields: [
      { id: 'title', label: 'Title', type: 'text', required: true },
      { id: 'type', label: 'Type', type: 'select', options: CR_FORM_TYPES.map(({ value, label }) => ({ value, label })) },
      { id: 'amt', label: 'Amount (k€)', type: 'number', defaultValue: '0' },
      { id: 'days', label: 'Delay (days)', type: 'number', defaultValue: '0' },
      { id: 'wbs', label: 'WBS', type: 'text', defaultValue: defaultWbs },
      ...(opts?.withActivities
        ? [{ id: 'acts', label: 'Plan activities touched (optional)', type: 'text' as const, placeholder: 'A1250=28, A1320', span: 'full' as const }]
        : []),
      { id: 'why', label: 'Justification', type: 'textarea', required: true },
    ],
  };
}

export interface NewChangeRequest {
  title: string;
  types: ChangeType[];
  amountKeur: number;
  scheduleDays: number;
  wbsCodes: string[];
  justification: string;
}

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
  return {
    ok: true,
    value: { title, types: type.types, amountKeur: Math.round(amt), scheduleDays: Math.round(days), wbsCodes: codes.length ? codes : ['1'], justification: why },
  };
}

/** AF_RESULT.changes, after the new number: "CR-011 · Change request submitted for review". */
export const NEW_CR_RESULT = 'Change request submitted for review';

// ── Generate status report (AF.trends) ─────────────────────────────────────────────────────────────

export const REPORT_PERIODS: { value: ReportPeriod; label: string }[] = [
  { value: 'month', label: 'September 2026' },
  { value: 'quarter', label: 'Q3 2026' },
  { value: 'since_start', label: 'Since project start' },
];
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

export const STATUS_REPORT_FORM: FormDef = {
  title: 'Generate status report',
  submit: 'Generate PDF',
  kind: 'run',
  fields: [
    { id: 'period', label: 'Period', type: 'select', options: REPORT_PERIODS },
    { id: 'audience', label: 'Audience', type: 'select', options: REPORT_AUDIENCES },
    { id: 'sections', label: 'Sections', type: 'select', options: REPORT_SECTIONS },
    { id: 'note', label: 'Manager note', type: 'textarea' },
  ],
};

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
  const period = pick(REPORT_PERIODS, v.period);
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
