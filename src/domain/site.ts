// Site (chantier) — readiness, mobilisation & execution (docs/spec/10 §3; prototype logic 4739–4760, template
// 2268–2309, AF.site 3692). Pure part: the "Go chantier" rule and its five conditions, the late-prerequisite rule,
// the status tags of the site tables (`stTag`), the prerequisite / equipment steps, the site-team conflicts computed from
// the rotation plan and who arbitrates them (R-119, D-6b 'a'), the collision targets, the KPI tiles of the three tabs
// (English source text, rendered through t() by the feature) and the "Daily report" form.
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
// - the Daily report form is saved (dated at most on the business date, default the business date — R-013; the
//   prototype's default "30 Sep 2026" was after its status date) and listed with the other reports. NEW-SITE-2 'a' (R-122): it no longer asks for an
//   HSE incident — incidents are declared in Vigie (the form links to it); the reports' saved values are kept and shown.
// Kept as constants (A-12, 10 OQ7): the site premium "×1.5 / ×2" and its calendar text.
// Chapter 4 (A-12, src/domain/kpis.ts): "Man-days planned" = Σ rotation crew × working days on the project calendar
// (`plannedManDays`, computed by the DAL); "Client decisions logged" = decisions of the project's meetings with the client
// (D-5, `clientDecisionCount` in src/domain/meetings.ts); the HSE tile counts the incidents Vigie reports on its registers (`vigieIncidentCount`) —
// the prototype showed 168, 3 and a literal "0 incident".
import { ROLE_SCREENS } from '@/config/role-screens';
import type { RoleKey } from '@/config/screens';
import type { Lang } from '@/i18n/translate';
import { money } from '@/lib/format';
import { absenceOverlapsRotation } from './absences';
import { vigieIncidentCount } from './kpis';
import { OVER_ALLOCATED_PCT } from './resources';
import { canDecideDepartment } from './rights';
import { siteStamp } from './site-sheet';
import {
  addDaysIso, shortDateOfIso, weather,
  type CollisionKind, type ConfirmStatus, type CursusVerdict, type EquipmentSource, type HseStatus, type PunchOwnerParty, type Weather,
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

/** Sub-line of the Cursus condition while Cursus has sent no verdict for the site team (NEW-SITE-1). */
export const NO_CURSUS_VERDICT = 'No Cursus verdict received';

/**
 * GO ⇔ no client prerequisite pending ∧ at least one Cursus verdict received and no Cursus NO GO ∧ every equipment line
 * confirmed ∧ no open collision ∧ no HSE item pending (10 §3.4 b, `goItems` 4748). Otherwise NO GO (Readiness KPI, Go
 * card, sidebar badge). NEW-SITE-1 (owner's answer "a"): without any verdict the Cursus condition stays open ("No Cursus
 * verdict received", one open record) instead of "Ready"; a GO with reserve is still accepted, a NO GO blocks.
 */
export function goChantier(d: GoInput): GoVerdict {
  const c = (key: GoKey, label: string, open: number, sub: string): GoCondition => ({ key, label, ok: open === 0, sub: open ? sub : 'Ready', open });
  const pending = d.prerequisites.filter((p) => p.status === 'pending').length;
  const noGo = d.people.filter((p) => p.verdict === 'no_go').length;
  const noVerdict = d.people.length === 0;
  const unconfirmed = d.equipment.filter((e) => e.status !== 'confirmed').length;
  const collisions = d.collisions.filter((x) => !x.resolved).length;
  const hsePending = d.hse.filter((h) => h.status === 'pending').length;
  const conditions = [
    c('prerequisites', 'Client prerequisites', pending, `${pending} pending`),
    noVerdict ? c('cursus', 'Individual go · Cursus', 1, NO_CURSUS_VERDICT) : c('cursus', 'Individual go · Cursus', noGo, `${noGo} NO GO`),
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

/** Late = still pending on or after J-15 of its need date (`today` = the business date, R-013). */
export const isPrerequisiteLate = (p: { status: ConfirmStatus; neededBy: string }, today: string, alertDays = PREREQUISITE_ALERT_DAYS) =>
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

// ── Site-team conflicts (R-119, D-6b 'a': "mise à jour automatique + arbitrage manuel") ─────────────────────────────

/**
 * What causes a conflict of a person of the rotation plan (the description is built from it in the viewer's language):
 * - `pool`: a week of the mission where the person's load in the resource pool is above OVER_ALLOCATED_PCT (only the
 *   weeks the pool covers are checked — a mission week outside the window gives no Load conflict);
 * - `site`: the same person on another project's rotation with overlapping dates;
 * - `cert`: a clearance Cursus reports as expiring;
 * - `doc`: a clearance (badge, document) Cursus reports as pending or missing;
 * - `leave`: an absence received from Cursus (R-031) overlapping the mission — the demo's absences are seeded data until
 *   Cursus sends real ones; the type only (Leave / Absence), never the reason (NEW-CURSUS-4).
 */
export type ConflictCause =
  | { type: 'pool'; weeks: { start: string; pct: number }[] }
  | { type: 'site'; projectCode: string; fromOn: string; toOn: string }
  | { type: 'cert'; note: string; missionTo: string }
  | { type: 'doc'; clearance: 'pending' | 'missing'; note: string; missionFrom: string }
  | { type: 'leave'; leaveType: 'leave' | 'absence'; start: string; end: string };

/** A person of the rotation plan, with the mission dates and who they are (null for a contractor crew). */
export interface ConflictMission {
  person: string;
  personId: string | null;
  /** The person's department (Settings › departments); null for a contractor crew or a person without one. */
  department: string | null;
  fromOn: string;
  toOn: string;
}

export interface ConflictFacts {
  rotation: readonly ConflictMission[];
  /** The resource pool's window (Monday of each week) and each person's weekly loads (%), by full name. */
  pool: { weeks: readonly string[]; people: readonly { name: string; loads: readonly number[] }[] };
  /** The rotations of the other projects (same person: personId, else the name). */
  otherSites: readonly { person: string; personId: string | null; projectCode: string; fromOn: string; toOn: string }[];
  /** Cursus's clearances of the site team (matched to the rotation by person, else by name). */
  cursus: readonly { personName: string; personId?: string | null; clearance: 'ok' | 'pending' | 'expiring' | 'missing'; clearanceNote: string }[];
  /** Absences received from Cursus (leave_entries, one row per week), by person. */
  absences: readonly { personId: string; leaveType: 'leave' | 'absence'; start: string; end: string }[];
  /** Arbitrations recorded on the project, by conflict key. */
  arbitrations: readonly { key: string; comment: string; by: string; at: string }[];
}

export interface SiteConflict {
  /**
   * Stable key: kind, person and cause (weeks, dates, Cursus state and a hash of its note — Cursus's joined reason labels have no
   * bound, the key stays short enough to arbitrate) — never the load percentage.
   */
  key: string;
  person: string;
  personId: string | null;
  department: string | null;
  kind: CollisionKind;
  cause: ConflictCause;
  /** Generic proposed fix of the kind (Keystone vocabulary, English — translate with t()). */
  proposedFix: string;
  /** Arbitrated while the cause is unchanged (same key); null when open. */
  arbitration: { comment: string; by: string; at: string } | null;
}

/** Generic proposed fixes (D-6b: the prototype's authored fixes were the seed's; computed conflicts get one per kind). */
export const CONFLICT_FIX: Record<CollisionKind, string> = {
  load: 'Level the load in What-if or move the work',
  cert: 'Renew the clearance before the end of the mission',
  doc: 'Chase the missing clearance in Cursus before arrival',
  leave: 'Move the mission or plan a replacement during the absence',
};

/** Absences of a person merged into periods (the next one starts at most 3 days after: a weekend in between). */
function absencePeriods(rows: readonly { leaveType: 'leave' | 'absence'; start: string; end: string }[]) {
  const sorted = [...rows].sort((a, b) => a.start.localeCompare(b.start));
  const out: { leaveType: 'leave' | 'absence'; start: string; end: string }[] = [];
  for (const r of sorted) {
    const last = out.at(-1);
    if (last && last.leaveType === r.leaveType && r.start <= addDaysIso(last.end, 3)) {
      if (r.end > last.end) last.end = r.end;
    } else out.push({ leaveType: r.leaveType, start: r.start, end: r.end });
  }
  return out;
}

const overlaps = (a: { from: string; to: string }, b: { from: string; to: string }) => a.from <= b.to && b.from <= a.to;

/**
 * The conflicts of a site team, computed from its rotation plan (R-119, D-6b 'a'): a conflict exists while its cause does, and
 * disappears with it; an arbitration (comment by the department head, or for a contractor the director or the project's
 * leads — `canArbitrateConflict`) closes it while the cause is unchanged, since a changed cause has another key. Rotation
 * order, then Load, Certificate, Document, Leave.
 */
export function siteConflicts(f: ConflictFacts): SiteConflict[] {
  const out: SiteConflict[] = [];
  const arbitrated = new Map(f.arbitrations.map((a) => [a.key, a]));
  const push = (m: ConflictMission, kind: CollisionKind, cause: ConflictCause, key: string) => {
    if (out.some((c) => c.key === key)) return;
    const a = arbitrated.get(key);
    out.push({
      key, person: m.person, personId: m.personId, department: m.department, kind, cause, proposedFix: CONFLICT_FIX[kind],
      arbitration: a ? { comment: a.comment, by: a.by, at: a.at } : null,
    });
  };
  for (const m of f.rotation) {
    const who = m.personId ? `p:${m.personId}` : `n:${m.person}`;
    const mission = { from: m.fromOn, to: m.toOn };
    // Load — the resource pool, inside its window.
    const pool = f.pool.people.find((p) => p.name === m.person);
    if (pool) {
      const weeks = f.pool.weeks
        .map((start, i) => ({ start, pct: pool.loads[i] ?? 0 }))
        .filter((w) => overlaps({ from: w.start, to: addDaysIso(w.start, 6) }, mission) && w.pct > OVER_ALLOCATED_PCT);
      if (weeks.length) push(m, 'load', { type: 'pool', weeks }, `load:pool:${who}:${weeks.map((w) => w.start).join('+')}`);
    }
    // Load — another project's site at the same time.
    for (const o of f.otherSites) {
      const same = m.personId ? o.personId === m.personId : !o.personId && o.person === m.person;
      if (same && overlaps({ from: o.fromOn, to: o.toOn }, mission))
        push(m, 'load', { type: 'site', projectCode: o.projectCode, fromOn: o.fromOn, toOn: o.toOn }, `load:site:${who}:${o.projectCode}:${o.fromOn}:${o.toOn}`);
    }
    // Certificate / Document — Cursus.
    for (const c of f.cursus.filter((x) => (m.personId && x.personId ? x.personId === m.personId : x.personName === m.person))) {
      // The note is shown whole (`cause.note`); the key carries its FNV-1a hash (a changed note is another cause, R-119).
      const note = siteStamp([c.clearanceNote]);
      if (c.clearance === 'expiring') push(m, 'cert', { type: 'cert', note: c.clearanceNote, missionTo: m.toOn }, `cert:${who}:${note}`);
      if (c.clearance === 'pending' || c.clearance === 'missing')
        push(m, 'doc', { type: 'doc', clearance: c.clearance, note: c.clearanceNote, missionFrom: m.fromOn }, `doc:${who}:${c.clearance}:${note}`);
    }
    // Leave — the absences received from Cursus (R-031).
    if (m.personId) {
      for (const p of absencePeriods(f.absences.filter((a) => a.personId === m.personId)))
        if (absenceOverlapsRotation(p, mission)) push(m, 'leave', { type: 'leave', ...p }, `leave:${who}:${p.leaveType}:${p.start}:${p.end}`);
    }
  }
  return out;
}

/**
 * Who marks a conflict "arbitrated" (R-119; D-6b 'a' names the department head): the portfolio director, or the head of the
 * person's department (the requests' rule, `canDecideDepartment`); for a contractor crew or a person without a department —
 * nobody heads them —, the director and the project's leads (PM of record, co-PM, deputy). A default beyond D-6b, for the
 * owner to confirm. Not the Site's edit right: a department head off the project's team reads the Site (R-041).
 */
export function canArbitrateConflict(
  role: RoleKey,
  viewer: { headed: readonly string[]; lead: boolean },
  conflict: { department: string | null },
): boolean {
  if (!Object.hasOwn(ROLE_SCREENS, role) || role === 'client') return false;
  if (role === 'director') return true;
  if (conflict.department) return canDecideDepartment(role, viewer.headed, conflict.department);
  return viewer.lead;
}

/** Longest arbitration comment kept. */
export const ARBITRATION_COMMENT_MAX = 1000;

/** The arbitration form: the comment is required (D-6b "avec un commentaire"). */
export function parseArbitration(v: Record<string, string | undefined>): ParseResult<{ comment: string }> {
  const comment = (v.comment ?? '').trim();
  if (!comment) return { ok: false, error: 'A comment is required' };
  if (comment.length > ARBITRATION_COMMENT_MAX) return { ok: false, error: 'The comment is too long' };
  return { ok: true, value: { comment } };
}

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
  reports: readonly { reportOn: string; headcount: number | null }[];
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
export const preparationNote = (f: Pick<SiteFacts, 'startOn' | 'doneDays'>, today: string) =>
  f.doneDays === 0 && today < f.startOn ? `Site starts ${shortDateOfIso(f.startOn)} — reports so far cover preparation visits.` : null;

/** A daily-report link that opens the Quality screen (NCR drawer): "NCR-029". */
export const isNcrLink = (link: string | null | undefined): link is string => !!link && /^NCR-\d+$/.test(link);

// ── Daily report form (AF.site 3692) ───────────────────────────────────────────────────────────────────

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

/** NEW-SITE-2 'a' (R-122): no HSE incident field — incidents are declared in Vigie. */
export interface DailyReportForm {
  /** ISO date, at most the business date. */
  date: string;
  weather: Weather;
  headcount: number | null;
  progress: string;
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

/**
 * Validates the Daily report form (raw strings from the client): date (any format `parseDate` reads, not after
 * `today`; blank = `today`), weather code, optional whole headcount, required progress text. NEW-SITE-2 'a' (R-122): an
 * `incident` value sent by an older form is ignored — incidents are declared in Vigie.
 */
export function parseDailyReportForm(
  v: Record<string, string | undefined>,
  opts: { today: string; parseDate: (s: string) => string | null },
): ParseResult<DailyReportForm> {
  const today = opts.today;
  const progress = (v.progress ?? '').trim();
  if (!progress) return { ok: false, error: PROGRESS_REQUIRED };
  if (progress.length > PROGRESS_MAX) return { ok: false, error: 'Progress is too long' };
  const rawDate = (v.date ?? '').trim();
  const date = rawDate ? opts.parseDate(rawDate) : today;
  if (!date) return { ok: false, error: DAILY_REPORT_DATE_ERROR };
  if (date > today) return { ok: false, error: DAILY_REPORT_FUTURE_ERROR };
  const w = (v.weather ?? '').trim() || WEATHER_OPTIONS[0];
  if (!weather.isCode(w)) return { ok: false, error: 'Invalid request' };
  const hc = (v.headcount ?? '').trim();
  let headcount: number | null = null;
  if (hc) {
    if (!/^\d+$/.test(hc) || +hc > 10000) return { ok: false, error: HEADCOUNT_ERROR };
    headcount = +hc;
  }
  return { ok: true, value: { date, weather: w, headcount, progress } };
}
