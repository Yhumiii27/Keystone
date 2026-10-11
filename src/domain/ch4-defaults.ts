// Chapter 4 defaults (delivery 6) — the product owner confirms them in the chapter-5 questionnaire. Every rule that a
// questionnaire answer may change lives here (or is re-exported from here) so it is changed in one place. Pure module:
// importable by Server Components, client islands, the DAL and the tests.
//
// Feature modules keep their own defaults next to their logic and reference the questionnaire id in a comment; add a
// constant here only for rules shared by several modules.
import { STATUS_ISO, type CalendarCode, type StoredFilePurpose } from '@/server/db/codes';
import { BUILTIN_CALENDARS } from './calendar';
import { DEFAULT_CPM_OPTIONS, type CpmOptions } from './cpm';

// ── S-1 CPM engine ────────────────────────────────────────────────────────────────────────────────────────────────────
/** Recalculation is MANUAL ("Reschedule", like F9 in P6): seeded data is never recalculated silently. */
export const RECALCULATION_MODE: 'manual' | 'automatic' = 'manual';
/** Engine options: critical = total float ≤ 0, remaining = round(d × (1 − %)), retained logic, lag on the predecessor's calendar. */
export const CPM_DEFAULTS: CpmOptions = DEFAULT_CPM_OPTIONS;

// ── S-4 data date ─────────────────────────────────────────────────────────────────────────────────────────────────────
/** Data date of a project whose `projects.data_date` is null: the frozen status date of the data set (Fri 25 Sep 2026). */
export const DEFAULT_DATA_DATE = STATUS_ISO;
export const projectDataDate = (p: { dataDate?: string | null }) => p.dataDate || DEFAULT_DATA_DATE;

// ── S-2 calendars ─────────────────────────────────────────────────────────────────────────────────────────────────────
/** Calendar of a project whose `projects.calendar` is null (the seed): Standard 5d · 8h. */
export const DEFAULT_PROJECT_CALENDAR: CalendarCode = 'standard_5x8';
/**
 * Built-in calendars: Standard 5d · 8h, Atelier 5d · 8h, Chantier 6d · 10h (Mon–Sat), Continu 24h / 7d. Documentation
 * only: the definitions live in src/domain/calendar.ts (BUILTIN_CALENDARS, which reads DEFAULT_HOLIDAY_SET below); this
 * re-export lets the questionnaire reader find them from here.
 */
export const DEFAULT_CALENDARS = BUILTIN_CALENDARS;
/** Public-holiday set of the built-in calendars (metropolitan France, computed per year) — Settings holidays are added. */
export { DEFAULT_HOLIDAY_SET } from './calendar';
export const projectCalendarCode = (p: { calendar?: string | null }) => p.calendar || DEFAULT_PROJECT_CALENDAR;

// ── S-3 baselines ─────────────────────────────────────────────────────────────────────────────────────────────────────
/** Baseline shown when the project has not chosen one (`projects.displayed_baseline_code` null). */
export const DEFAULT_DISPLAYED_BASELINE = 'BL1';
export const BASELINE_PREFIX = 'BL';
export const displayedBaselineCode = (p: { displayedBaselineCode?: string | null }) => p.displayedBaselineCode || DEFAULT_DISPLAYED_BASELINE;
/** Next free baseline code: BL0, BL1, BL2… → max + 1 ("BL3"); "BL0" when none. */
export function nextBaselineCode(existing: readonly string[]): string {
  let max = -1;
  for (const c of existing) {
    const m = /^BL(\d+)$/i.exec(c.trim());
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `${BASELINE_PREFIX}${max + 1}`;
}

// ── S-8 units ─────────────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * Durations, lags, floats and slips are in working days of the activity's calendar. Documentation only: the CPM engine
 * (src/domain/cpm.ts) and the calendars count working days by construction, nothing reads this constant.
 */
export const DURATION_UNIT = 'working_days' as const;

// ── Files stored by Keystone (task attachments, transcripts, imports) ──────────────────────────────────────────────
/** Maximum size of one stored file. */
export const MAX_FILE_BYTES = 20 * 1024 * 1024;
/** Allowed file extensions per purpose (lower case, without the dot). */
export const FILE_EXTENSIONS: Readonly<Record<StoredFilePurpose, readonly string[]>> = {
  attachment: ['pdf', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'txt', 'csv', 'xlsx', 'xls', 'docx', 'doc', 'pptx', 'dwg', 'dxf', 'zip', 'msg', 'eml'],
  transcript: ['txt', 'vtt', 'srt'],
  import: ['xml', 'xer', 'csv', 'xlsx', 'txt'],
  export: ['csv', 'xlsx', 'pdf', 'xml'],
  /** Photos of goods receipts, site daily reports and punch items (R-126, X-15 / SC-4a): images browsers display. */
  photo: ['jpg', 'jpeg', 'png', 'webp', 'gif'],
};
/** `accept` attribute of a file input for a purpose (".pdf,.png,…"). */
export const acceptOf = (purpose: StoredFilePurpose) => FILE_EXTENSIONS[purpose].map((e) => '.' + e).join(',');
/** "20 MB" for messages. */
export const MAX_FILE_TEXT = '20 MB';

// ── Exports ───────────────────────────────────────────────────────────────────────────────────────────────────────────
/** CSV dialect per language: French Excel expects ';' and a decimal comma; English ',' and a decimal point. UTF-8 with BOM. */
export const CSV_DIALECT = {
  fr: { separator: ';', decimal: ',' },
  en: { separator: ',', decimal: '.' },
} as const;
/**
 * PDFs are French by default. The export route renders every file in the viewer's language (`ks-lang` cookie); a viewer
 * without that cookie gets the session default, i18n DEFAULT_LANG — ch4-defaults.test.ts keeps both equal, so changing the
 * PDF default means changing DEFAULT_LANG (or reading this constant in src/app/api/export/[screen]/route.ts).
 */
export const PDF_DEFAULT_LANG: 'fr' | 'en' = 'fr';

// ── D-7b imports, D-7a connector settings ─────────────────────────────────────────────────────────────────────────────
/**
 * D-7b ("Ne traite rien pour le moment concernant les imports"): the import cards of Activity & integrations (MS Project
 * XML, Primavera P6 XER, Excel / CSV) are hidden and the upload route and the import Server Functions refuse every import.
 * The importers (src/server/interchange) and their tests stay; the tests turn this flag on with `vi.mock`. Turn it on here
 * when the owner asks for the one-time import at project start (S-9b). The "Export — …" cards are not imports and stay.
 */
export const IMPORTS_ENABLED: boolean = false;
/** EN refusal of the import steps while IMPORTS_ENABLED is off (FR in src/i18n/extra/ch4-interchange.json). */
export const IMPORTS_OFF_MESSAGE = 'Imports are not available for now';
/**
 * D-7a ("Par l'informatique, en dehors de l'application"): connectors are configured by IT outside Keystone. The
 * connector "Configure" dialog shows the stored settings read-only and the save Server Function refuses every change.
 */
export const CONNECTOR_SETTINGS_BY_IT = true;

// ── Task attachments (R-8) ────────────────────────────────────────────────────────────────────────────────────────────
/** Maximum number of files on one task. */
export const MAX_ATTACHMENTS_PER_TASK = 20;
/** "48 KB" / "2.4 MB" / "512 B" (attachment meta, as the prototype's FILES). */
export function fileSizeText(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ── A-13 health, A-14 Settings, A-2 / L-3 wizard (settings feature) — defined next to their logic, re-exported here ──
export { DEFAULT_HEALTH_THRESHOLDS, HEALTH_CPI_CLAMP } from './health';
export { CUSTOM_STATUSES_ALLOWED, REQUIRED_STAGES, SETTINGS_COST_TYPE, SETTINGS_EDIT_ROLES, removalModeOf } from './settings-rules';
export {
  DEFAULT_PLANNED_FINISH, DEFAULT_PLANNED_START, TEMPLATE_ACTIVITIES_PER_PHASE, TEMPLATE_ACTIVITY_DAYS, TEMPLATE_LINK, WIZARD_REQUIRED,
} from './project-template';
