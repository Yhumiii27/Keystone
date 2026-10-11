// Site (chantier) — readiness, mobilisation & execution (docs/spec/10 §3; prototype logic 4739–4760, template
// 2268–2309, AF.site 3692). Pure part: the "Go chantier" rule and its five conditions, the late-prerequisite rule,
// the status tags of the site tables (`stTag`), the prerequisite / equipment steps, the collision targets, the KPI
// tiles of the three tabs (English source text, rendered through t() by the feature) and the "Daily report" form.
//
// System boundaries (user decision): the individual Go / No Go and clearances come from Cursus, the HSE register from
// Vigie; this module only reads their verdicts / statuses, as the prototype did.
//
// Deviations from the prototype (docs/spec/00 §7.16, 10 OQ5–OQ11, D-3…D-6):
// - a prerequisite is late when it is still pending at J-15 of its need date (the subtitle's rule) — the prototype
//   flagged a hard-coded list of dates ('12 Oct', '16 Oct');
// - "Team without collisions" counts the open (unresolved) collisions; "2 rotations" is the number of rotations of the
//   plan; "0 consumed" is the man-days reported on site since the start (daily-report headcounts); "0 incident" is
//   the incidents Vigie reports (chapter 4, A-12; the daily reports' count before) — the prototype showed literals;
// - the Go chantier tag follows `stTag` (GO neutral, NO GO accent) — the prototype always used the accent tag (10 OQ9);
// - the Daily report form is saved (dated at most on the status date, default the status date — the prototype's
//   default "30 Sep 2026" was after it) and listed with the other reports.
// Kept as constants (A-12, 10 OQ7): the site premium "×1.5 / ×2" and its calendar text.
// Chapter 4 (A-12, src/domain/kpis.ts): "Man-days planned" = Σ rotation crew × working days on the project calendar
// (`plannedManDays`, computed by the DAL); "Client decisions logged" = decisions of the project's meetings with the client
// (D-5, `clientDecisionCount` in src/domain/meetings.ts); the HSE tile counts the incidents Vigie reports on its registers (`vigieIncidentCount`) —
// the prototype showed 168, 3 and a literal "0 incident".
import type { Lang } from '@/i18n/translate';
import { money } from '@/lib/format';
import { vigieIncidentCount } from './kpis';
import {
  STATUS_ISO, addDaysIso, hseIncident, shortDateOfIso, weather,
  type CollisionKind, type ConfirmStatus, type CursusVerdict, type EquipmentSource, type HseIncident, type HseStatus, type PunchOwnerParty, type Weather,
} from '@/server/db/codes';

// ── Tabs ───────────────────────────────────────────────────────────────────────────────────────────────

/** `siteSeg` (4742), state `siteTab` → `?tab=`. */
export type SiteTab = 'ready' | 'team' | 'exec';
export const SITE_TABS: readonly SiteTab[] = ['ready', 'team', 'exec'];
export const SITE_TAB_LABEL: Record<SiteTab, string> = { ready: 'Readiness & go', team: 'Team & mobilisation', exec: 'Daily execution' };
/** `?tab=` value → tab (unknown → Readiness & go, the prototype default). */
export const siteTabOf = (v: string | null | undefined): SiteTab => ((SITE_TABS as readonly string[]).includes(v ?? '') ? (v as SiteTab) : 'ready');

// ── Status tags ────────────────────────────────────────────────────────────────────────────────────────

const CALM = ['Signed', 'Confirmed', 'OK', 'Closed', 'Ready', 'Approved', 'GO', 'Not required'];
const WATCH = ['Pending', 'Expiring', 'GO with reserve'];
const ALERT = ['Missing', 'Open', 'NO GO'];

/** `stTag` (4743) on the English status label: calm → neutral, watch → outline, alert → accent, anything else neutral. */
export function siteTagClass(label: string): string {
  if (CALM.includes(label)) return 'tag tag-neutral';
  if (WATCH.includes(label)) return 'tag tag-outline';
  if (ALERT.includes(label)) return 'tag tag-accent';
  return 'tag tag-neutral';
}

/** Equipment source tag (`srcClass`): shipped with the machine → outline, rented locally / client → neutral. */
export const equipmentSourceTagClass = (s: EquipmentSource) => (s === 'shipped' ? 'tag tag-outline' : 'tag tag-neutral');

/** Collision kind tag: Load → accent, Certificate / Document / Leave → outline. */
export const collisionTagClass = (k: CollisionKind) => (k === 'load' ? 'tag tag-accent' : 'tag tag-outline');

// ── Go chantier (goItems / goOk, 4747–4748) ───────────────────────────────────────────────────────────

export type GoKey = 'prerequisites' | 'cursus' | 'equipment' | 'collisions' | 'hse';
export interface GoCondition {
  key: GoKey;
  /** English label of the Go card. */
  label: string;
  ok: boolean;
  /** "Ready" when ok, else "2 pending", "2 NO GO", "2 unconfirmed", "4 collisions". */
  sub: string;
  /** Records keeping the condition open. */
  open: number;
}
export interface GoInput {
  prerequisites: readonly { status: ConfirmStatus }[];
  /** Cursus verdicts of the people mobilised. */
  people: readonly { verdict: CursusVerdict }[];
  equipment: readonly { status: ConfirmStatus }[];
  collisions: readonly { resolved: boolean }[];
  /** Vigie's HSE register. */
  hse: readonly { status: HseStatus }[];
}
export interface GoVerdict {
  ok: boolean;
  conditions: GoCondition[];
}
/** Number of Go chantier conditions ("{n} of 5 conditions open"). */
export const GO_CONDITION_COUNT = 5;

/**
 * GO ⇔ no client prerequisite pending ∧ no Cursus NO GO ∧ every equipment line confirmed ∧ no open collision ∧ no HSE
 * item pending (10 §3.4 b, `goItems` 4748). Otherwise NO GO (Readiness KPI, Go card, sidebar badge).
 */
export function goChantier(d: GoInput): GoVerdict {
  const c = (key: GoKey, label: string, open: number, sub: string): GoCondition => ({ key, label, ok: open === 0, sub: open ? sub : 'Ready', open });
  const pending = d.prerequisites.filter((p) => p.status === 'pending').length;
  const noGo = d.people.filter((p) => p.verdict === 'no_go').length;
  const unconfirmed = d.equipment.filter((e) => e.status !== 'confirmed').length;
  const collisions = d.collisions.filter((x) => !x.resolved).length;
  const hsePending = d.hse.filter((h) => h.status === 'pending').length;
  const conditions = [
    c('prerequisites', 'Client prerequisites', pending, `${pending} pending`),
    c('cursus', 'Individual go · Cursus', noGo, `${noGo} NO GO`),
    c('equipment', 'Equipment on site', unconfirmed, `${unconfirmed} unconfirmed`),
    // "1 collision" once collisions can be resolved (the prototype's 4 constant collisions never reach one).
    c('collisions', 'Team without collisions', collisions, `${collisions} ${collisions === 1 ? 'collision' : 'collisions'}`),
    c('hse', 'HSE permits', hsePending, `${hsePending} pending`),
  ];
  return { ok: conditions.every((x) => x.ok), conditions };
}

/** "GO" / "NO GO" (KPI value, Go card tag, sidebar badge). */
export const goLabel = (ok: boolean) => (ok ? 'GO' : 'NO GO');
/** Sidebar badge of Site: "NO GO" while Go chantier is not reached, else none. */
export const siteBadge = (v: { ok: boolean }) => (v.ok ? '' : 'NO GO');

// ── Client prerequisites ──────────────────────────────────────────────────────────────────────────────

/** A prerequisite still unconfirmed this many days before its need date raises the alert (J-15). */
export const PREREQUISITE_ALERT_DAYS = 15;

/** Late = still pending on or after J-15 of its need date (status date as "today"). */
export const isPrerequisiteLate = (p: { status: ConfirmStatus; neededBy: string }, today: string = STATUS_ISO, alertDays = PREREQUISITE_ALERT_DAYS) =>
  p.status === 'pending' && addDaysIso(p.neededBy, -alertDays) <= today;

/** Next step of a prerequisite: Pending → "Client confirms" → Confirmed → "Signed on site" → Signed. */
export function prerequisiteStep(status: ConfirmStatus): { to: 'confirmed' | 'signed'; label: string } | null {
  if (status === 'pending') return { to: 'confirmed', label: 'Client confirms' };
  if (status === 'confirmed') return { to: 'signed', label: 'Signed on site' };
  return null;
}

// ── Collisions ─────────────────────────────────────────────────────────────────────────────────────────

/** "Resolve" target (4753): Load → What-if levelling, Leave → Leave & calendar, Certificate → Skills matrix, Document → the Cursus table (Readiness tab). */
export const COLLISION_TARGET: Record<CollisionKind, 'whatif' | 'leave' | 'skills' | 'ready'> = { load: 'whatif', leave: 'leave', cert: 'skills', doc: 'ready' };

// ── KPI tiles (siteKpis 4750, teamKpis 4756, execKpis 4760) ──────────────────────────────────────────

/** Site data the KPI tiles read (the shape the DAL returns). */
export interface SiteFacts {
  startOn: string;
  planDays: number;
  doneDays: number;
  /** Σ rotation crew × working days (A-12, computed by the DAL). */
  manDaysPlanned: number;
  /** Change requests of the project whose client step is decided (A-12); 0 when absent. */
  clientDecisions?: number;
  prerequisites: readonly { status: ConfirmStatus; late: boolean }[];
  people: readonly { verdict: CursusVerdict }[];
  equipment: readonly { status: ConfirmStatus; source: EquipmentSource }[];
  collisions: readonly { resolved: boolean }[];
  rotation: readonly { rotationNo: number }[];
  missionCosts: readonly { budgetKeur: number; actualKeur: number }[];
  reports: readonly { reportOn: string; headcount: number | null; hseIncident: HseIncident | null }[];
  punch: readonly { open: boolean; ownerParty: PunchOwnerParty | null }[];
  /** Vigie's HSE register: `kind` and `statusText` give the incident counts of its registers ("0 déclaré"). */
  hse: readonly { status: HseStatus; kind?: string; statusText?: string | null }[];
  /** R-169: weekend premiums of the rate grid ("Site premium" tile). */
  premium?: SitePremium;
}

/** A KPI tile in English; `alert` = value in LO (accent-300), else plain text. */
export interface SiteKpi {
  label: string;
  value: string;
  sub: string;
  alert: boolean;
}

/** "19 Oct 2026" (SITE.start / SITE.end; English — translate with t()). */
export const siteDateText = (iso: string) => `${shortDateOfIso(iso)} ${iso.slice(0, 4)}`;

/** Man-days reported on site since the start (Σ daily-report headcount from the start date). */
export const manDaysConsumed = (f: Pick<SiteFacts, 'startOn' | 'reports'>) =>
  f.reports.filter((r) => r.reportOn >= f.startOn).reduce((s, r) => s + (r.headcount ?? 0), 0);

/** Incidents declared in the daily reports (HSE = Incident). */
export const declaredIncidents = (f: Pick<SiteFacts, 'reports'>) => f.reports.filter((r) => r.hseIncident === 'incident').length;

/** Rotations of the plan (distinct rotation numbers). */
export const rotationCount = (f: Pick<SiteFacts, 'rotation'>) => new Set(f.rotation.map((r) => r.rotationNo)).size;

/** Weekend premiums of the rate grid (Resources › Rates, rate_multipliers 'sat' and 'sun'); null when not in the grid. */
export interface SitePremium { sat: number | null; sun: number | null }

/** "×1.5": a premium factor as the Rates screen prints it; "—" when the grid has none. */
const factorText = (f: number | null) => (f == null ? '—' : `×${f}`);

/**
 * "Site premium" tile (R-169, D-5 context, A-12): the Saturday and Sunday / public holiday multipliers of the rate grid
 * (the prototype printed the constants "×1.5 / ×2" and "6d · 10h calendar"; the seeded grid gives the same ×1.5 / ×2).
 */
export function sitePremiumTile(p: SitePremium | undefined): { value: string; sub: string } {
  if (!p || (p.sat == null && p.sun == null)) return { value: '—', sub: 'No weekend rate in the rate grid' };
  return { value: `${factorText(p.sat)} / ${factorText(p.sun)}`, sub: 'Saturday / Sunday rates · rate grid' };
}

/** Readiness & go tiles: Go chantier, Client prerequisites, Individual go · Cursus, Equipment confirmed, Collisions. */
export function readinessKpis(f: SiteFacts, go: GoVerdict): SiteKpi[] {
  const late = f.prerequisites.filter((p) => p.late).length;
  const noGo = f.people.filter((p) => p.verdict === 'no_go').length;
  const shipped = f.equipment.filter((e) => e.source === 'shipped').length;
  const collisions = f.collisions.filter((c) => !c.resolved).length;
  return [
    { label: 'Go chantier', value: goLabel(go.ok), sub: `${go.conditions.filter((c) => !c.ok).length} of ${GO_CONDITION_COUNT} conditions open · start ${siteDateText(f.startOn)}`, alert: !go.ok },
    { label: 'Client prerequisites', value: `${f.prerequisites.filter((p) => p.status !== 'pending').length} / ${f.prerequisites.length}`, sub: `${late} late vs need date`, alert: late > 0 },
    {
      label: 'Individual go · Cursus', value: `${f.people.length - noGo} / ${f.people.length}`,
      sub: `${f.people.filter((p) => p.verdict === 'go_with_reserve').length} with reserve · approvals only`, alert: noGo > 0,
    },
    { label: 'Equipment confirmed', value: `${f.equipment.filter((e) => e.status === 'confirmed').length} / ${f.equipment.length}`, sub: `${shipped} shipped · ${f.equipment.length - shipped} local / client`, alert: false },
    { label: 'Collisions', value: String(collisions), sub: 'Load · leave · certificates · badges', alert: collisions > 0 },
  ];
}

/** Team & mobilisation tiles: People on rotation, Man-days planned, Collisions open, Mission budget, Site premium. */
export function teamKpis(f: SiteFacts, lang: Lang): SiteKpi[] {
  const rot = rotationCount(f);
  const collisions = f.collisions.filter((c) => !c.resolved).length;
  const b = f.missionCosts.reduce((s, c) => s + c.budgetKeur, 0);
  const a = f.missionCosts.reduce((s, c) => s + c.actualKeur, 0);
  return [
    { label: 'People on rotation', value: String(f.rotation.length), sub: `${rot} ${rot === 1 ? 'rotation' : 'rotations'} · ${f.planDays} working days`, alert: false },
    { label: 'Man-days planned', value: String(f.manDaysPlanned), sub: `${manDaysConsumed(f)} consumed · site starts ${siteDateText(f.startOn)}`, alert: false },
    { label: 'Collisions open', value: String(collisions), sub: 'Arbitrated by department heads', alert: collisions > 0 },
    { label: 'Mission budget', value: money(b, lang), sub: `${money(a, lang)} committed · ${b ? Math.round((a / b) * 100) : 0}%`, alert: false },
    { label: 'Site premium', ...sitePremiumTile(f.premium), alert: false },
  ];
}

/** Daily execution tiles: Progress on site, Daily reports, Punch list open, HSE, Client decisions logged. */
export function execKpis(f: SiteFacts): SiteKpi[] {
  const open = f.punch.filter((p) => p.open);
  // A-12: incidents as Vigie (HSE owner) reports them, not the daily reports' own field.
  const incidents = vigieIncidentCount(f.hse);
  return [
    { label: 'Progress on site', value: `${f.doneDays} / ${f.planDays} d`, sub: 'Daily reports feed the data date', alert: false },
    { label: 'Daily reports', value: String(f.reports.length), sub: 'Mobile · hours, %, photos, weather', alert: false },
    { label: 'Punch list open', value: String(open.length), sub: `${open.filter((p) => p.ownerParty === 'client').length} on the client`, alert: open.length > 0 },
    { label: 'HSE', value: `${incidents} ${incidents > 1 ? 'incidents' : 'incident'}`, sub: `${f.hse.filter((h) => h.status === 'pending').length} permits pending`, alert: false },
    { label: 'Client decisions logged', value: String(f.clientDecisions ?? 0), sub: 'Out-of-scope requests → change request', alert: false },
  ];
}

/** Mission cost row (4754): used share of the line (bar width, %), remaining (budget − actual). */
export const missionCostUse = (c: { budgetKeur: number; actualKeur: number }) => ({
  usedPct: c.budgetKeur ? Math.round(Math.min(1, c.actualKeur / c.budgetKeur) * 100) : 0,
  remainingKeur: +(c.budgetKeur - c.actualKeur).toFixed(3),
});

/** Footnote under the Daily reports while the site has not started (the prototype's text with the start date). */
export const preparationNote = (f: Pick<SiteFacts, 'startOn' | 'doneDays'>, today: string = STATUS_ISO) =>
  f.doneDays === 0 && today < f.startOn ? `Site starts ${shortDateOfIso(f.startOn)} — reports so far cover preparation visits.` : null;

/** A daily-report link that opens the Quality screen (NCR drawer): "NCR-029". */
export const isNcrLink = (link: string | null | undefined): link is string => !!link && /^NCR-\d+$/.test(link);

// ── Daily report form (AF.site 3692) ───────────────────────────────────────────────────────────────────

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

export interface DailyReportForm {
  /** ISO date, at most the status date. */
  date: string;
  weather: Weather;
  headcount: number | null;
  progress: string;
  incident: HseIncident;
}

export const DAILY_REPORT_DATE_ERROR = 'Enter a date such as 25 Sep 2026';
export const DAILY_REPORT_FUTURE_ERROR = 'A daily report cannot be dated after today';
export const HEADCOUNT_ERROR = 'Headcount must be a whole number';
export const PROGRESS_REQUIRED = 'Progress is required';
/** Longest progress text kept (the DAL bound). */
export const PROGRESS_MAX = 2000;

/** Default headcount of the form (prototype). */
export const DEFAULT_HEADCOUNT = 24;
export const WEATHER_OPTIONS: readonly Weather[] = weather.codes;
export const INCIDENT_OPTIONS: readonly HseIncident[] = hseIncident.codes;

/**
 * Validates the Daily report form (raw strings from the client): date (any format `parseDate` reads, not after
 * `today`; blank = `today`), weather and HSE codes, optional whole headcount, required progress text.
 */
export function parseDailyReportForm(
  v: Record<string, string | undefined>,
  opts: { today?: string; parseDate: (s: string) => string | null },
): ParseResult<DailyReportForm> {
  const today = opts.today ?? STATUS_ISO;
  const progress = (v.progress ?? '').trim();
  if (!progress) return { ok: false, error: PROGRESS_REQUIRED };
  if (progress.length > PROGRESS_MAX) return { ok: false, error: 'Progress is too long' };
  const rawDate = (v.date ?? '').trim();
  const date = rawDate ? opts.parseDate(rawDate) : today;
  if (!date) return { ok: false, error: DAILY_REPORT_DATE_ERROR };
  if (date > today) return { ok: false, error: DAILY_REPORT_FUTURE_ERROR };
  const w = (v.weather ?? '').trim() || WEATHER_OPTIONS[0];
  if (!weather.isCode(w)) return { ok: false, error: 'Invalid request' };
  const inc = (v.incident ?? '').trim() || INCIDENT_OPTIONS[0];
  if (!hseIncident.isCode(inc)) return { ok: false, error: 'Invalid request' };
  const hc = (v.headcount ?? '').trim();
  let headcount: number | null = null;
  if (hc) {
    if (!/^\d+$/.test(hc) || +hc > 10000) return { ok: false, error: HEADCOUNT_ERROR };
    headcount = +hc;
  }
  return { ok: true, value: { date, weather: w, headcount, progress, incident: inc } };
}
