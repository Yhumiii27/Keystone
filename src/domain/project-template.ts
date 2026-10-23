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
import { addDaysIso } from '@/server/db/codes';
import type { WorkCalendar } from './calendar';
import { nextMondayIso } from './form-dates';

/** Activities created under each phase (the Machine types screen has no activity list yet). */
export const TEMPLATE_ACTIVITIES_PER_PHASE = 1;
/** Link between consecutive template activities. */
export const TEMPLATE_LINK = { type: 'FS' as const, lagDays: 0 };
/** First activity code and step ("A1010", "A1020"…). */
export const TEMPLATE_CODE_START = 1010;
export const TEMPLATE_CODE_STEP = 10;
/**
 * Planned start offered by the wizard, from the business date `today` (R-013): the Monday after today + 15 weeks — the
 * prototype's static "11 Jan 2027" on Fri 25 Sep 2026 (+ 105 days = Fri 8 Jan → Mon 11 Jan).
 */
export const defaultPlannedStart = (today: string) => nextMondayIso(addDaysIso(today, 105));
/**
 * Planned finish of the wizard when none is typed: the last day of the business date's month one year later (R-013) — the
 * prototype's static "30 Sep 2027" on 25 Sep 2026.
 */
export function defaultPlannedFinish(today: string): string {
  const y = +today.slice(0, 4) + 1;
  const m = +today.slice(5, 7);
  return addDaysIso(`${m === 12 ? y + 1 : y}-${String((m % 12) + 1).padStart(2, '0')}-01`, -1);
}
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
  /** R-185: the equipment line ("EQ-02") of a lot specific to an equipment; absent = common to the project. */
  equipment?: string;
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
  /** R-185: the equipment line of the activity's lot; absent = common. */
  equipment?: string;
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

/**
 * "6 phases · 6 work packages" (WBS copy item; was the prototype's static "6 phases · 14 lots"). R-185: `packages` = the work
 * packages of the plan when the lots specific to an equipment are generated per line (default: one per phase).
 */
export const templateWbsText = (phases: number, packages = phases) =>
  phases ? `${phases} ${phases === 1 ? 'phase' : 'phases'} · ${packages} ${packages === 1 ? 'work package' : 'work packages'}` : 'Empty';

/**
 * "6 activities · 5 links" (Activities & logic copy item; was the prototype's static "38 activités · 52 liens"). R-185: `shape`
 * = the activities and links of a plan with lots per equipment line (default: a chain of one activity per phase).
 */
export function templateActivitiesText(phases: number, shape?: { activities: number; links: number }): string {
  const n = shape ? shape.activities : phases * TEMPLATE_ACTIVITIES_PER_PHASE;
  if (!n) return 'None';
  const links = shape ? shape.links : Math.max(0, n - 1);
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

/** A standard phase of the main type; `perEquipment` (R-185): a lot generated once per equipment line. */
export interface TemplatePhase {
  name: string;
  perEquipment?: boolean;
}

/**
 * R-185: an equipment line of the project as the planner reads it — its reference, the suffix of its lots' names when the
 * project has several lines ("EQ-02 · 3 × MEMU", equipmentLotLabel) and the phases specific to an equipment of ITS type.
 */
export interface TemplateEquipment {
  ref: string;
  label: string;
  phases: readonly string[];
}

export interface TemplatePlanInput {
  phases: readonly (string | TemplatePhase)[];
  /** R-185: the project's equipment lines; absent = every phase common to the project (the plan before R-185). */
  equipments?: readonly TemplateEquipment[];
}

/** One work package of a plan's structure and the time slots of its activities. */
interface PlannedPackage extends TemplatePackage {
  /** Index of the package's first time slot. */
  slot: number;
}

interface PlanStructure {
  packages: PlannedPackage[];
  /** Time slots of the plan (each lasts the same share of the window). */
  slots: number;
  links: [number, number][];
}

/**
 * Structure of a template plan (R-185, owner's choice 2 of 23 Oct 2026). The main type's phases common to the project come in
 * their order, the lots specific to an equipment form one block, placed where the main type's first such phase is (at the
 * end when the main type has none): in this block every line gets ITS type's phases specific to an equipment, one work package
 * each, the lines in parallel (same time slots) and each line's lots chained. Logic: the common phase before the block precedes
 * each line's first lot, each line's last lot precedes the common phase after the block. One line → the plan before R-185 (the
 * same packages, activities, dates and links), its lots marked with the line. Links are activity indexes.
 */
function planStructure(input: TemplatePlanInput): PlanStructure {
  const phases = input.phases
    .map((p) => (typeof p === 'string' ? { name: p.trim(), perEquipment: false } : { name: p.name.trim(), perEquipment: !!p.perEquipment }))
    .filter((p) => p.name);
  const eqs = input.equipments?.map((e) => ({ ...e, phases: e.phases.map((x) => x.trim()).filter(Boolean) }));
  type Step = { common: string } | { block: true };
  let steps: Step[];
  if (!eqs) steps = phases.map((p) => ({ common: p.name }));
  else {
    const common = phases.filter((p) => !p.perEquipment).map((p) => ({ common: p.name }));
    const first = phases.findIndex((p) => p.perEquipment);
    const at = first < 0 ? common.length : phases.slice(0, first).filter((p) => !p.perEquipment).length;
    steps = [...common.slice(0, at), { block: true }, ...common.slice(at)];
  }
  const blockLen = eqs ? Math.max(0, ...eqs.map((e) => e.phases.length)) : 0;
  const several = (eqs?.length ?? 0) > 1;
  const per = TEMPLATE_ACTIVITIES_PER_PHASE;
  const packages: PlannedPackage[] = [];
  const links: [number, number][] = [];
  let slot = 0;
  let act = 0;
  let frontier: number[] = [];
  const add = (name: string, at: number, equipment?: string) => {
    const pkg: PlannedPackage = { code: `1.${packages.length + 1}`, name, slot: at, ...(equipment ? { equipment } : {}) };
    packages.push(pkg);
    const first = act;
    act += per;
    // The activities of a package are chained (TEMPLATE_ACTIVITIES_PER_PHASE > 1).
    for (let j = first + 1; j < act; j++) links.push([j - 1, j]);
    return { first, last: act - 1 };
  };
  for (const step of steps) {
    if ('common' in step) {
      const { first, last } = add(step.common, slot);
      for (const f of frontier) links.push([f, first]);
      frontier = [last];
      slot += per;
    } else if (blockLen) {
      const next: number[] = [];
      for (const e of eqs!) {
        let prev: number | null = null;
        e.phases.forEach((name, j) => {
          const { first, last } = add(several ? `${name} — ${e.label}` : name, slot + j * per, e.ref);
          if (prev == null) for (const f of frontier) links.push([f, first]);
          else links.push([prev, first]);
          prev = last;
        });
        if (prev != null) next.push(prev);
      }
      frontier = next;
      slot += blockLen * per;
    }
  }
  return { packages, slots: slot, links };
}

/** R-185: the size of a template plan — what the wizard's copy items count before creation. */
export function templatePlanShape(input: TemplatePlanInput): { packages: number; activities: number; links: number } {
  const s = planStructure(input);
  return { packages: s.packages.length, activities: s.packages.length * TEMPLATE_ACTIVITIES_PER_PHASE, links: s.links.length };
}

/**
 * Plans the WBS, activities and links of a template. `phases` = standard phases of the machine type, `budgetKeur` =
 * Σ cost categories (no contingency), `calendar` = the project calendar, `finish` = the planned finish (null: each
 * activity lasts TEMPLATE_ACTIVITY_DAYS, L-3b). Blank template (no phase) → empty plan. R-185: with `equipments`, the
 * lots specific to an equipment are generated per line (planStructure); the window is shared between the time slots (a block
 * of lots in parallel counts its longest line) and the budget evenly between the activities.
 */
export function instantiateTemplate(input: TemplatePlanInput & { start: string; finish: string | null; calendar: WorkCalendar; budgetKeur: number }): TemplatePlan {
  const structure = planStructure(input);
  if (!structure.packages.length) return { packages: [], activities: [], links: [], startDate: null, finishDate: null };
  const cal = input.calendar;
  const days = input.finish ? shareDays(cal.durationOf(input.start, input.finish), structure.slots) : Array.from({ length: structure.slots }, () => TEMPLATE_ACTIVITY_DAYS);
  // Dates of each time slot, one after the other on the project calendar.
  const slots: { start: string; finish: string; days: number }[] = [];
  let next = cal.nextWorkDay(input.start);
  for (const d of days) {
    const finish = cal.finishOf(next, d);
    slots.push({ start: next, finish, days: d });
    next = cal.addWorkDays(finish, 1);
  }
  const per = TEMPLATE_ACTIVITIES_PER_PHASE;
  const count = structure.packages.length * per;
  const each = count ? Math.round((input.budgetKeur / count) * 100) / 100 : 0;
  const activities: TemplateActivity[] = [];
  for (const pkg of structure.packages)
    for (let j = 0; j < per; j++) {
      const s = slots[pkg.slot + j];
      activities.push({
        code: `A${TEMPLATE_CODE_START + activities.length * TEMPLATE_CODE_STEP}`, wbs: pkg.code,
        name: per === 1 ? pkg.name : `${pkg.name} · ${j + 1}`,
        durationDays: s.days, startDate: s.start, finishDate: s.finish, budgetKeur: each,
        ...(pkg.equipment ? { equipment: pkg.equipment } : {}),
      });
    }
  const links = structure.links.map(([p, s]) => ({ predecessor: activities[p].code, successor: activities[s].code, ...TEMPLATE_LINK }));
  const packages: TemplatePackage[] = structure.packages.map((p) => ({ code: p.code, name: p.name, ...(p.equipment ? { equipment: p.equipment } : {}) }));
  return {
    packages, activities, links,
    startDate: activities.map((a) => a.startDate).sort()[0], finishDate: activities.map((a) => a.finishDate).sort().at(-1)!,
  };
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
