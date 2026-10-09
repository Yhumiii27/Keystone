// New project wizard — instantiation of the machine-type template (chapter 4, A-2 / L-3). Pure: the DAL inserts what
// this module plans. Every default the chapter-5 questionnaire may change is a named constant here.
//
//   WBS           root "1" (the project) + one work package per standard phase of the machine type ("1.1", "1.2"…),
//                 the phases being those of the Machine types screen (09 §9) — typed projects inherit the template.
//   Activities    TEMPLATE_ACTIVITIES_PER_PHASE per work package (named after the phase), codes A1010, A1020… (step 10,
//                 as P6 numbering); the working days between planned start and finish are shared evenly (remainder to
//                 the first phases) — with no planned finish (L-3b: optional), each activity lasts TEMPLATE_ACTIVITY_DAYS
//                 and the project's planned finish is the plan's finish; budgets share the cost-category total (without
//                 contingency) evenly.
//   Logic         a finish-to-start chain (lag 0) from the first activity to the last.
//   Dates         computed on the project calendar (holidays included), not rescheduled: the plan changes only at the
//                 next "Reschedule" (S-1, manual recalculation).
//   Also          cost categories of the budget step, the ITP plan of the machine type (its systems), the calendar,
//                 the PM chosen in the wizard, the planned start / finish, the currency and the site (L-3b: city and a
//                 country of the countries table — the zone comes from the country).
import type { WorkCalendar } from './calendar';

/** Activities created under each phase (the Machine types screen has no activity list yet). */
export const TEMPLATE_ACTIVITIES_PER_PHASE = 1;
/** Link between consecutive template activities. */
export const TEMPLATE_LINK = { type: 'FS' as const, lagDays: 0 };
/** First activity code and step ("A1010", "A1020"…). */
export const TEMPLATE_CODE_START = 1010;
export const TEMPLATE_CODE_STEP = 10;
/** Planned start / finish offered by the wizard (the prototype's static "11 Jan 2027" / "30 Sep 2027"). */
export const DEFAULT_PLANNED_START = '2027-01-11';
export const DEFAULT_PLANNED_FINISH = '2027-09-30';
/**
 * Required fields of the wizard. L-3b (owner's answer "a"): name, client, PM, type, start and location (site city + a
 * country of the countries table). The planned finish is optional: without it the finish comes from the instantiated plan.
 * PM and type always have a value in the wizard (a select / a segmented control); the Server Function checks them.
 */
export const WIZARD_REQUIRED = { name: true, client: true, pm: true, type: true, start: true, location: true, finish: false } as const;
/**
 * Working days of each template activity when the wizard has no planned finish (L-3b). 30 working days (6 weeks) per
 * phase: the 6 standard phases then span about 9 months, as the prototype's default window (11 Jan → 30 Sep 2027). To be
 * replaced by the per-phase durations of the owner's standard per machine type (A-2 / L-3a) when it arrives.
 */
export const TEMPLATE_ACTIVITY_DAYS = 30;
/** Planned finish must be after the planned start; the window is capped (typo guard). */
export const MAX_PROJECT_YEARS = 10;

export interface TemplatePackage {
  /** "1.1". */
  code: string;
  name: string;
}

export interface TemplateActivity {
  /** "A1010". */
  code: string;
  /** Work package code ("1.1"). */
  wbs: string;
  name: string;
  durationDays: number;
  startDate: string;
  finishDate: string;
  budgetKeur: number;
}

export interface TemplateLink {
  predecessor: string;
  successor: string;
  type: 'FS';
  lagDays: number;
}

export interface TemplatePlan {
  packages: TemplatePackage[];
  activities: TemplateActivity[];
  links: TemplateLink[];
  /** Earliest start / latest finish of the activities (the root's dates). */
  startDate: string | null;
  finishDate: string | null;
}

/** "6 phases · 6 work packages" (WBS copy item; was the prototype's static "6 phases · 14 lots"). */
export const templateWbsText = (phases: number) =>
  phases ? `${phases} ${phases === 1 ? 'phase' : 'phases'} · ${phases} ${phases === 1 ? 'work package' : 'work packages'}` : 'Empty';

/** "6 activities · 5 links" (Activities & logic copy item; was the prototype's static "38 activités · 52 liens"). */
export function templateActivitiesText(phases: number): string {
  const n = phases * TEMPLATE_ACTIVITIES_PER_PHASE;
  if (!n) return 'None';
  const links = Math.max(0, n - 1);
  return `${n} ${n === 1 ? 'activity' : 'activities'} · ${links} ${links === 1 ? 'link' : 'links'}`;
}

const isIso = (v: unknown): v is string =>
  typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(v + 'T00:00:00Z').toISOString().slice(0, 10) === v;

/** Wizard window (L-3b): the start is required, the finish optional (validated as a window when given). */
export function wizardWindowError(start: unknown, finish: unknown): string | null {
  if (finish == null || finish === '') return isIso(start) ? null : 'Enter the planned start date';
  return plannedWindowError(start, finish);
}

/** Site of the wizard (L-3b): a city and a country among `countries`; null when valid, else the English message. */
export function wizardSiteError(city: unknown, country: unknown, countries: readonly string[]): string | null {
  if (typeof city !== 'string' || !city.trim()) return 'Enter the site city';
  if (city.trim().length > 120) return 'The site city is too long';
  if (typeof country !== 'string' || !countries.includes(country)) return 'Choose the site country among the proposed countries';
  return null;
}

/** Validates the planned window; null when valid, else the English message. */
export function plannedWindowError(start: unknown, finish: unknown): string | null {
  if (!isIso(start) || !isIso(finish)) return 'Enter the planned start and finish dates';
  if (finish <= start) return 'The planned finish must be after the planned start';
  if (+finish.slice(0, 4) - +start.slice(0, 4) > MAX_PROJECT_YEARS) return 'The planned window is too long';
  return null;
}

/** "Jan 2027" and the month index since Jan 2026 (the register's month texts). */
export function monthOfIso(iso: string): { text: string; month: number } {
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const y = +iso.slice(0, 4);
  const m = +iso.slice(5, 7);
  return { text: `${MON[m - 1]} ${y}`, month: (y - 2026) * 12 + (m - 1) };
}

/** Shares `total` into `n` integer parts ≥ 1, the remainder going to the first parts. */
export function shareDays(total: number, n: number): number[] {
  if (n <= 0) return [];
  const base = Math.max(1, Math.floor(total / n));
  const rest = Math.max(0, total - base * n);
  return Array.from({ length: n }, (_, i) => base + (i < rest ? 1 : 0));
}

/**
 * Plans the WBS, activities and links of a template. `phases` = standard phases of the machine type, `budgetKeur` =
 * Σ cost categories (no contingency), `calendar` = the project calendar, `finish` = the planned finish (null: each
 * activity lasts TEMPLATE_ACTIVITY_DAYS, L-3b). Blank template (no phase) → empty plan.
 */
export function instantiateTemplate(input: { phases: readonly string[]; start: string; finish: string | null; calendar: WorkCalendar; budgetKeur: number }): TemplatePlan {
  const phases = input.phases.map((p) => p.trim()).filter(Boolean);
  if (!phases.length) return { packages: [], activities: [], links: [], startDate: null, finishDate: null };
  const cal = input.calendar;
  const packages = phases.map((name, i) => ({ code: `1.${i + 1}`, name }));
  const count = phases.length * TEMPLATE_ACTIVITIES_PER_PHASE;
  const days = input.finish ? shareDays(cal.durationOf(input.start, input.finish), count) : Array.from({ length: count }, () => TEMPLATE_ACTIVITY_DAYS);
  const each = count ? Math.round((input.budgetKeur / count) * 100) / 100 : 0;
  const activities: TemplateActivity[] = [];
  let next = cal.nextWorkDay(input.start);
  let k = 0;
  for (const [i, pkg] of packages.entries()) {
    for (let j = 0; j < TEMPLATE_ACTIVITIES_PER_PHASE; j++, k++) {
      const d = days[k];
      const finish = cal.finishOf(next, d);
      activities.push({
        code: `A${TEMPLATE_CODE_START + k * TEMPLATE_CODE_STEP}`, wbs: pkg.code,
        name: TEMPLATE_ACTIVITIES_PER_PHASE === 1 ? phases[i] : `${phases[i]} · ${j + 1}`,
        durationDays: d, startDate: next, finishDate: finish, budgetKeur: each,
      });
      next = cal.addWorkDays(finish, 1);
    }
  }
  const links = activities.slice(1).map((a, i) => ({ predecessor: activities[i].code, successor: a.code, ...TEMPLATE_LINK }));
  return { packages, activities, links, startDate: activities[0].startDate, finishDate: activities[activities.length - 1].finishDate };
}

// ── Wizard options ────────────────────────────────────────────────────────────────────────────────────────────────────
/** Calendars the wizard offers (S-2 built-ins); default = the machine type's calendar. Labels are EN source strings. */
export const WIZARD_CALENDAR_OPTIONS: readonly { value: 'standard_5x8' | 'standard_5x8_workshop' | 'site_6x10' | 'continuous_24h'; label: string }[] = [
  { value: 'standard_5x8', label: 'Standard 5d · 8h' },
  { value: 'standard_5x8_workshop', label: 'Standard 5d · 8h + Atelier' },
  { value: 'site_6x10', label: 'Site 6d · 10h' },
  { value: 'continuous_24h', label: '24h continuous' },
];

/** Working time of a calendar definition: "Mon–Fri · 8 h a day" / "Mon–Sat · 10 h a day" / "7 days · 24 h a day". */
export function workingTimeText(def: { workDays: readonly number[]; hoursPerDay: number }): string {
  const days = [...def.workDays].sort((a, b) => a - b);
  const NAMES = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const contiguous = days.every((d, i) => i === 0 || d === days[i - 1] + 1);
  const span = days.length === 7 ? '7 days' : contiguous && days.length > 1 ? `${NAMES[days[0]]}–${NAMES[days[days.length - 1]]}` : days.map((d) => NAMES[d]).join(', ');
  return `${span} · ${def.hoursPerDay} h a day`;
}

/** Holidays of a calendar definition (the wizard's static "US federal + site shutdown" replaced, S-2). */
export const holidaysText = (def: { holidaySet: string | null; useSettingsHolidays: boolean }) =>
  def.holidaySet === 'FR'
    ? def.useSettingsHolidays ? 'French public holidays + Settings holidays' : 'French public holidays'
    : def.useSettingsHolidays ? 'Settings holidays' : 'Holidays are worked';
