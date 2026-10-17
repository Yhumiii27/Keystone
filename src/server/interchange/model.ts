// Interchange model (chapter 4, S-9): the neutral schedule that the MS Project XML (MSPDI) and Primavera P6 XER readers
// produce and the MSPDI writer consumes, plus the small date / number helpers the importers share. Pure — no database, no
// server-only import — so the parsers and their tests run anywhere.
//
// Units: durations, lags and floats in WORKING DAYS of the activity's calendar (S-8); money in k€; dates ISO 'YYYY-MM-DD'.
import type { LinkType } from '@/server/db/codes';

export type IsoDate = string;
export type ScheduleFormat = 'mspdi' | 'xer';

/** A work calendar read from the file. Weekdays use ISO numbering (1 = Monday … 7 = Sunday). */
export interface ImportedCalendar {
  uid: string;
  name: string;
  workDays: number[];
  hoursPerDay: number;
  /** Exceptions: extra non-working days (holidays, closures) or exceptional working days. */
  exceptions: { date: IsoDate; working: boolean; name: string }[];
}

/** A WBS element (MS Project summary task, P6 WBS node). `parentUid` null = directly under the project. */
export interface ImportedWbs {
  uid: string;
  /** WBS code as written in the file ("1.3", "2.1.4", "HLT.DES"). */
  code: string;
  name: string;
  parentUid: string | null;
  /** Position in the file (outline order). */
  position: number;
}

/** One baseline value of an activity (MSPDI Baseline 0–10). */
export interface ImportedBaselineValue {
  number: number;
  start: IsoDate | null;
  finish: IsoDate | null;
  durationDays: number | null;
  costKeur: number | null;
}

export interface ImportedActivity {
  /** UID in the file (MS Project UID, P6 task_id) — the update key "UID". */
  uid: string;
  /** Activity ID (P6 task_code; MS Project: the text field aliased "Activity ID") — the update key "Activity ID". */
  activityId: string | null;
  name: string;
  /** WBS element the activity belongs to (null: directly under the project). */
  wbsUid: string | null;
  durationDays: number;
  start: IsoDate | null;
  finish: IsoDate | null;
  actualStart: IsoDate | null;
  actualFinish: IsoDate | null;
  /** 0–100. */
  percentComplete: number;
  /** Remaining duration (working days) when the file gives one. */
  remainingDays: number | null;
  milestone: boolean;
  /** Constraint in Keystone codes (ASAP, SNET, SNLT, FNET, FNLT, MSO, MFO); null = none. */
  constraint: { type: string; date: IsoDate | null } | null;
  /** Calendar UID (null = the project calendar). */
  calendarUid: string | null;
  totalFloatDays: number | null;
  critical: boolean | null;
  /** Total cost (EAC), actual cost, budget (baseline / planned cost), k€. */
  costKeur: number | null;
  actualCostKeur: number | null;
  budgetKeur: number | null;
  notes: string | null;
  /** P6 activity codes ("Discipline: MEC"). */
  codes: string[];
  baselines: ImportedBaselineValue[];
  /** 1-based position among the file's activities (preview line). */
  line: number;
}

export interface ImportedLink {
  predUid: string;
  succUid: string;
  type: LinkType;
  /** Working days, may be negative. */
  lagDays: number;
}

export type ImportedResourceType = 'work' | 'material' | 'cost' | 'equipment';

export interface ImportedResource {
  uid: string;
  name: string;
  type: ImportedResourceType;
}

export interface ImportedAssignment {
  activityUid: string;
  resourceUid: string;
  /** Units (1 = one full-time resource). */
  units: number;
  plannedHours: number | null;
  actualHours: number | null;
}

/** A schedule read from a file. Messages are EN source sentences (see ./messages.ts). */
export interface ImportedSchedule {
  format: ScheduleFormat;
  /** Project name in the file. */
  name: string;
  /** Company / client named in the file (MSPDI Company), when any. */
  company: string | null;
  start: IsoDate | null;
  finish: IsoDate | null;
  /** Status (data) date of the file. */
  statusDate: IsoDate | null;
  /** Project calendar UID. */
  calendarUid: string | null;
  /** Working hours per day used to convert durations (MSPDI MinutesPerDay / 60, P6 calendar hours). */
  hoursPerDay: number;
  calendars: ImportedCalendar[];
  wbs: ImportedWbs[];
  activities: ImportedActivity[];
  links: ImportedLink[];
  resources: ImportedResource[];
  assignments: ImportedAssignment[];
  /** Fields and elements of the file that Keystone does not import (EN sentences, one per kind). */
  unmapped: string[];
  /** File-level warnings (EN sentences). */
  warnings: string[];
}

/** Maximum number of activities / rows an import handles (protects the preview and the write transaction). */
export const MAX_IMPORT_ACTIVITIES = 10_000;
export const MAX_IMPORT_ROWS = 20_000;

// ── Dates ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** ISO date of a file timestamp ("2026-09-25T08:00:00", "2026-09-25 08:00", "2026-09-25"); null when not a date. */
export function isoOfStamp(v: unknown): IsoDate | null {
  if (typeof v !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v.trim());
  if (!m) return null;
  const y = +m[1];
  const mo = +m[2];
  const d = +m[3];
  if (y < 1990 || y > 2199 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCMonth() === mo - 1 ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/**
 * Plan display text of an ISO date: "05 Oct" in the business year `year`, "14 Jan ’27" otherwise (the prototype's ACTS format,
 * wbsFmtDate, which compared with 2026; R-013).
 */
export function planDateText(iso: IsoDate, year: number): string {
  const [y, m, d] = iso.split('-');
  return `${d} ${MON[+m - 1]}${+y !== year ? ' ’' + y.slice(2) : ''}`;
}

/** "14 Jan 2027" (project header texts). */
export function longDateText(iso: IsoDate): string {
  const [y, m, d] = iso.split('-');
  return `${+d} ${MON[+m - 1]} ${y}`;
}

/** "Jan 2027" (project register month texts). */
export function monthText(iso: IsoDate): string {
  const [y, m] = iso.split('-');
  return `${MON[+m - 1]} ${y}`;
}

/** Fractional month index since Jan 2026 (25 Sep 2026 → 8.8), as the prototype's `mIdx` + day / 30. */
export function monthIndex(iso: IsoDate): number {
  const [y, m, d] = iso.split('-').map((x) => parseInt(x, 10));
  return (y - 2026) * 12 + (m - 1) + Math.min(29, d - 1) / 30;
}

export const round1 = (n: number) => Math.round(n * 10) / 10;
export const round2 = (n: number) => Math.round(n * 100) / 100;

/** Excel serial date (days since 1899-12-30, P6 calendar exceptions) → ISO. */
export function isoOfSerial(serial: number): IsoDate | null {
  if (!Number.isFinite(serial) || serial < 1 || serial > 120_000) return null;
  const ms = Date.UTC(1899, 11, 30) + Math.floor(serial) * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

/** ISO → Excel serial date. */
export function serialOfIso(iso: IsoDate): number {
  const [y, m, d] = iso.split('-').map((x) => parseInt(x, 10));
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86_400_000);
}

// ── Numbers ───────────────────────────────────────────────────────────────────────────────────────────────────────────
/** Number of a file value ("12", "12.5", " -3 "); null when blank or not a number. */
export function numOf(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string' || !v.trim()) return null;
  const n = Number(v.trim());
  return Number.isFinite(n) ? n : null;
}

/** Working days of a number of hours (rounded to the nearest day; 0 for milestones). */
export const daysOfHours = (hours: number, hoursPerDay: number) => (hoursPerDay > 0 ? Math.round(hours / hoursPerDay) : 0);

/** Text of a value for messages (≤ 60 characters). */
export const clip = (v: unknown, max = 60) => {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim();
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
};
