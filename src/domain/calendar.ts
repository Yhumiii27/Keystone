// Working-time calendars (chapter 4, open question S-2; spec 05 §0, 06 §4). Pure — used by the CPM engine (domain/cpm.ts),
// the seed, the importers and the screens.
//
// Model: a calendar is a set of working weekdays, hours per day, a public-holiday set computed per year (metropolitan France:
// fixed days + Easter Monday, Ascension, Whit Monday) plus the company holidays of Settings and per-calendar exceptions
// (extra closures or exceptional working days). Durations, lags and floats are counted in WORKING DAYS (S-8).
//
// Time arithmetic uses "boundaries": the ordinal of a date is the number of working days strictly before it. A working day
// with ordinal k starts at boundary k and ends at boundary k + 1, so an activity of d days starting on working day s occupies
// [s, s + d) and finishes on the working day s + d − 1. Converting through calendar dates (00:00 instants) keeps different
// calendars consistent (see domain/cpm.ts).

export type IsoDate = string;

/** A calendar definition (built-in, Settings-driven or imported). */
export interface CalendarDef {
  code: string;
  /** EN source name ("Chantier 6d · 10h"). */
  name: string;
  /** Working weekdays, ISO numbering (1 = Monday … 7 = Sunday). */
  workDays: readonly number[];
  hoursPerDay: number;
  /** Public-holiday set ('FR' = metropolitan France); null = public holidays are worked (Continu 24h / 7d). */
  holidaySet: string | null;
  /** Company holidays of Settings › Public holidays apply. */
  useSettingsHolidays: boolean;
}

/** A calendar exception: an extra non-working day (`working: false`) or an exceptional working day (`working: true`). */
export interface CalendarException {
  date: IsoDate;
  working: boolean;
  name?: string;
}

export interface Holiday {
  date: IsoDate;
  /** French name ("Lundi de Pâques"): public holidays are French domain values. */
  name: string;
}

/** Public-holiday set of the built-in calendars (S-2: metropolitan France) — re-exported by src/domain/ch4-defaults.ts. */
export const DEFAULT_HOLIDAY_SET = 'FR';

/**
 * The four built-in calendars (S-2 default). Codes are `CalendarCode` (src/server/db/codes.ts): the template label
 * "Standard 5d · 8h + Atelier" is the Atelier calendar.
 */
export const BUILTIN_CALENDARS: readonly CalendarDef[] = [
  { code: 'standard_5x8', name: 'Standard 5d · 8h', workDays: [1, 2, 3, 4, 5], hoursPerDay: 8, holidaySet: DEFAULT_HOLIDAY_SET, useSettingsHolidays: true },
  { code: 'standard_5x8_workshop', name: 'Atelier 5d · 8h', workDays: [1, 2, 3, 4, 5], hoursPerDay: 8, holidaySet: DEFAULT_HOLIDAY_SET, useSettingsHolidays: true },
  { code: 'site_6x10', name: 'Chantier 6d · 10h', workDays: [1, 2, 3, 4, 5, 6], hoursPerDay: 10, holidaySet: DEFAULT_HOLIDAY_SET, useSettingsHolidays: true },
  { code: 'continuous_24h', name: 'Continu 24h / 7d', workDays: [1, 2, 3, 4, 5, 6, 7], hoursPerDay: 24, holidaySet: null, useSettingsHolidays: false },
];
export const BUILTIN_CALENDAR_BY_CODE: Readonly<Record<string, CalendarDef>> = Object.fromEntries(BUILTIN_CALENDARS.map((c) => [c.code, c]));

// ── Date helpers (UTC, no time zone involved) ─────────────────────────────────────────────────────────────────────
const DAY_MS = 86_400_000;
const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True for a valid 'YYYY-MM-DD' calendar date. */
export function isIsoDate(v: unknown): v is IsoDate {
  if (typeof v !== 'string') return false;
  const m = ISO_RE.exec(v);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}
function msOf(iso: IsoDate): number {
  const m = ISO_RE.exec(iso);
  if (!m) throw new RangeError(`Invalid date "${iso}"`);
  return Date.UTC(+m[1], +m[2] - 1, +m[3]);
}
const isoOfMs = (ms: number): IsoDate => new Date(ms).toISOString().slice(0, 10);
/** Adds calendar days. */
export const addCalendarDays = (iso: IsoDate, days: number): IsoDate => isoOfMs(msOf(iso) + days * DAY_MS);
/** Calendar days from `a` to `b`. */
export const calendarDaysBetween = (a: IsoDate, b: IsoDate): number => Math.round((msOf(b) - msOf(a)) / DAY_MS);
/** ISO weekday (1 = Monday … 7 = Sunday). */
export const isoWeekday = (iso: IsoDate): number => new Date(msOf(iso)).getUTCDay() || 7;
const pad2 = (n: number) => String(n).padStart(2, '0');
const isoOf = (y: number, m: number, d: number): IsoDate => `${y}-${pad2(m)}-${pad2(d)}`;

// ── Public holidays ─────────────────────────────────────────────────────────────────────────────────────────────────
/** Easter Sunday (Gregorian computus, anonymous algorithm — Meeus / Jones / Butcher). */
export function easterSunday(year: number): IsoDate {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return isoOf(year, month, day);
}

/** The 11 public holidays of metropolitan France for a year (Alsace-Moselle's two extra days are not included). */
export function frenchPublicHolidays(year: number): Holiday[] {
  const easter = easterSunday(year);
  return [
    { date: isoOf(year, 1, 1), name: 'Jour de l’an' },
    { date: addCalendarDays(easter, 1), name: 'Lundi de Pâques' },
    { date: isoOf(year, 5, 1), name: 'Fête du travail' },
    { date: isoOf(year, 5, 8), name: 'Victoire 1945' },
    { date: addCalendarDays(easter, 39), name: 'Ascension' },
    { date: addCalendarDays(easter, 50), name: 'Lundi de Pentecôte' },
    { date: isoOf(year, 7, 14), name: 'Fête nationale' },
    { date: isoOf(year, 8, 15), name: 'Assomption' },
    { date: isoOf(year, 11, 1), name: 'Toussaint' },
    { date: isoOf(year, 11, 11), name: 'Armistice' },
    { date: isoOf(year, 12, 25), name: 'Noël' },
  ].sort((x, y) => (x.date < y.date ? -1 : 1));
}

/** Holiday sets known to the engine. Add a country here to support it. */
export const HOLIDAY_SETS: Readonly<Record<string, (year: number) => Holiday[]>> = { FR: frenchPublicHolidays };

/** Public holidays of a set for a year ([] for null or an unknown set). */
export function holidaysOf(set: string | null | undefined, year: number): Holiday[] {
  const f = set ? HOLIDAY_SETS[set] : undefined;
  return f ? f(year) : [];
}

// ── Work calendar ───────────────────────────────────────────────────────────────────────────────────────────────────
/** First date the ordinal arithmetic covers (dates before it throw). */
export const CALENDAR_EPOCH: IsoDate = '1990-01-01';
const EPOCH_MS = msOf(CALENDAR_EPOCH);
const MAX_YEAR = 2200;

export interface WorkCalendarOptions {
  /** Company holidays (Settings › Public holidays, ISO dates), applied when the definition says so. */
  settingsHolidays?: readonly IsoDate[];
  exceptions?: readonly CalendarException[];
}

/**
 * Working-day arithmetic on one calendar. Ordinals are built lazily year by year from CALENDAR_EPOCH, so any date from
 * 1990 to 2200 works; a calendar must have at least one working weekday.
 */
export class WorkCalendar {
  readonly code: string;
  readonly name: string;
  readonly hoursPerDay: number;
  readonly def: CalendarDef;
  private readonly weekdays: Set<number>;
  private readonly settingsHolidays: Set<string>;
  private readonly offDays = new Map<string, string>();
  private readonly onDays = new Set<string>();
  private readonly holidayYears = new Set<number>();
  /** Working dates from the epoch, ascending, and the first date not yet covered. */
  private days: IsoDate[] = [];
  private coveredUntilMs = EPOCH_MS;

  constructor(def: CalendarDef, opts: WorkCalendarOptions = {}) {
    if (!def.workDays.some((d) => d >= 1 && d <= 7)) throw new RangeError(`Calendar ${def.code} has no working day`);
    if (!(def.hoursPerDay > 0 && def.hoursPerDay <= 24)) throw new RangeError(`Calendar ${def.code}: hours per day must be in ]0, 24]`);
    this.def = def;
    this.code = def.code;
    this.name = def.name;
    this.hoursPerDay = def.hoursPerDay;
    this.weekdays = new Set(def.workDays);
    this.settingsHolidays = new Set(def.useSettingsHolidays ? (opts.settingsHolidays ?? []).filter(isIsoDate) : []);
    for (const e of opts.exceptions ?? []) {
      if (!isIsoDate(e.date)) continue;
      if (e.working) this.onDays.add(e.date);
      else this.offDays.set(e.date, e.name ?? '');
    }
  }

  private loadHolidays(year: number): void {
    if (this.holidayYears.has(year)) return;
    this.holidayYears.add(year);
    for (const h of holidaysOf(this.def.holidaySet, year)) if (!this.offDays.has(h.date)) this.offDays.set(h.date, h.name);
  }

  /** True when `iso` is worked: an exceptional working day, else a working weekday that is no holiday or closure. */
  isWorkDay(iso: IsoDate): boolean {
    if (this.onDays.has(iso)) return true;
    this.loadHolidays(+iso.slice(0, 4));
    if (this.offDays.has(iso) || this.settingsHolidays.has(iso)) return false;
    return this.weekdays.has(isoWeekday(iso));
  }

  /** Non-working holidays and closures of a year on this calendar (for display). */
  holidays(year: number): Holiday[] {
    this.loadHolidays(year);
    const out: Holiday[] = [];
    for (const [date, name] of this.offDays) if (+date.slice(0, 4) === year && !this.onDays.has(date)) out.push({ date, name });
    for (const date of this.settingsHolidays) if (+date.slice(0, 4) === year && !this.offDays.has(date) && !this.onDays.has(date)) out.push({ date, name: '' });
    return out.sort((a, b) => (a.date < b.date ? -1 : 1));
  }

  private coverUntil(ms: number): void {
    while (this.coveredUntilMs <= ms) {
      const year = new Date(this.coveredUntilMs).getUTCFullYear();
      if (year > MAX_YEAR) throw new RangeError(`Calendar ${this.code}: date beyond ${MAX_YEAR}`);
      const end = Date.UTC(year + 1, 0, 1);
      for (let t = this.coveredUntilMs; t < end; t += DAY_MS) {
        const iso = isoOfMs(t);
        if (this.isWorkDay(iso)) this.days.push(iso);
      }
      this.coveredUntilMs = end;
    }
  }

  /** Number of working days strictly before `iso` (since the epoch): the boundary at 00:00 of `iso`. */
  ordinal(iso: IsoDate): number {
    const ms = msOf(iso);
    if (ms < EPOCH_MS) throw new RangeError(`Date ${iso} is before ${CALENDAR_EPOCH}`);
    this.coverUntil(ms);
    let lo = 0;
    let hi = this.days.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.days[mid] < iso) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  /** Date of the working day with ordinal `k` (k ≥ 0). */
  dateOf(k: number): IsoDate {
    if (!Number.isInteger(k) || k < 0) throw new RangeError(`Calendar ${this.code}: working-day ordinal ${k} is before ${CALENDAR_EPOCH}`);
    let guard = 0;
    while (this.days.length <= k) {
      this.coverUntil(this.coveredUntilMs);
      if (++guard > MAX_YEAR - 1990 + 1) throw new RangeError(`Calendar ${this.code}: ordinal ${k} beyond ${MAX_YEAR}`);
    }
    return this.days[k];
  }

  /** First working day on or after `iso`. */
  nextWorkDay(iso: IsoDate): IsoDate {
    return this.dateOf(this.ordinal(iso));
  }

  /** Last working day on or before `iso`. */
  previousWorkDay(iso: IsoDate): IsoDate {
    return this.dateOf(this.ordinal(addCalendarDays(iso, 1)) - 1);
  }

  /** Moves `n` working days from the working day on or after `iso` (n may be negative; 0 = that working day). */
  addWorkDays(iso: IsoDate, n: number): IsoDate {
    return this.dateOf(this.ordinal(iso) + Math.round(n));
  }

  /** Working days in [a, b) — negative when b < a. */
  workDaysBetween(a: IsoDate, b: IsoDate): number {
    return this.ordinal(b) - this.ordinal(a);
  }

  /** Working days from `start` to `finish`, both included (the duration of an activity with those dates; 0 if finish < start). */
  durationOf(start: IsoDate, finish: IsoDate): number {
    return Math.max(0, this.ordinal(addCalendarDays(finish, 1)) - this.ordinal(start));
  }

  /** Finish date of a `days`-long activity starting on (the working day on or after) `start`; days ≤ 0 → that start day. */
  finishOf(start: IsoDate, days: number): IsoDate {
    const s = this.ordinal(start);
    return this.dateOf(s + Math.max(1, Math.round(days)) - 1);
  }

  /** Start date of a `days`-long activity finishing on (the working day on or before) `finish`; days ≤ 0 → that finish day. */
  startOf(finish: IsoDate, days: number): IsoDate {
    const f = this.ordinal(addCalendarDays(finish, 1));
    return this.dateOf(Math.max(0, f - Math.max(1, Math.round(days))));
  }

  // Boundary helpers used by the CPM engine.
  /** Boundary at which work starting on (or after) `iso` begins. */
  startBoundary(iso: IsoDate): number {
    return this.ordinal(iso);
  }
  /** Boundary at which work finishing on (or before) `iso` ends. */
  finishBoundary(iso: IsoDate): number {
    return this.ordinal(addCalendarDays(iso, 1));
  }
  /** 00:00 instant (as a date) at which boundary `b` starts work: the date of working day b. */
  startInstant(b: number): IsoDate {
    return this.dateOf(b);
  }
  /** 00:00 instant (as a date) right after work ending at boundary `b`: the day after working day b − 1. */
  endInstant(b: number): IsoDate {
    return b <= 0 ? CALENDAR_EPOCH : addCalendarDays(this.dateOf(b - 1), 1);
  }
}

/** A built-in or custom calendar with the company holidays and its exceptions. Unknown codes fall back to `fallback`. */
export function makeCalendar(def: CalendarDef, opts: WorkCalendarOptions = {}): WorkCalendar {
  return new WorkCalendar(def, opts);
}

/** The built-in calendars as WorkCalendars (tests, previews, and the fallback when the database has none). */
export function builtinCalendars(opts: WorkCalendarOptions = {}): Record<string, WorkCalendar> {
  return Object.fromEntries(BUILTIN_CALENDARS.map((d) => [d.code, new WorkCalendar(d, opts)]));
}

/** Hours of work in `days` working days on a calendar (what-if levers convert durations ↔ hours). */
export const hoursOfDays = (cal: Pick<CalendarDef, 'hoursPerDay'>, days: number) => days * cal.hoursPerDay;
/** Working days needed for `hours` of work at `hoursPerDay` (rounded up). */
export const daysForHours = (hours: number, hoursPerDay: number) => (hoursPerDay > 0 ? Math.ceil(hours / hoursPerDay - 1e-9) : 0);
