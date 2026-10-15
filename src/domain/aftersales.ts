// Warranty & after-sales — Installed base and Warranty claims & interventions: pure business logic (docs/spec/07 §2.8–
// §2.9; prototype logic 4979–4995, `machineCfg` 4197, AF `fleet` / `sav` of afSubmit 5121). Warranty state and the
// "ending < 90 days" rule, the configuration tags (Vigie ECO effectivity counts), the open / cost figures per machine,
// the KPI tiles of both screens, the claim ordering, the costs-per-machine bar, the zone filters and their empty-state
// rules, the nav badge and the parsing of the two add-forms. No I/O, no translation: labels are the prototype's English
// source strings (the feature's view model translates them). Golden values: src/domain/aftersales.test.ts
// (src/domain/aftersales.golden.json, scripts/proto-golden-aftersales.ts).
// Defects of the prototype not reproduced (docs/spec/00 §7.16, 07 OQ7, 07 A.1): the zone-empty notice of the claims
// screen tests the list on show (claims, interventions or cost rows of the zone), not the machine list; counts agree in
// number ("1 client", not "1 clients"); a machine added with a warranty end already past is Out of warranty (the
// prototype stamped every added machine "In warranty").
import type { Lang } from '@/i18n/translate';
import { money } from '@/lib/format';
import {
  NOW_ISO, PG_NOW, claimCoverage, displayOfIso, monthIndexOfIso, ncrSeverity, warrantyStatus,
  type ClaimCoverage, type ClaimStatus, type InterventionStatus, type NcrSeverity, type WarrantyStatus, type ZoneCode,
} from '@/server/db/codes';
import { parseNeedDate } from './team';

export type { ClaimCoverage, ClaimStatus, InterventionStatus, NcrSeverity, WarrantyStatus, ZoneCode };

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };
export type Tone = 'accent' | 'outline' | 'neutral';

// ── Views of the claims screen (`savView`, `?view=`) ────────────────────────────────────────────────────

export const SAV_VIEWS = ['claims', 'interventions', 'costs'] as const;
export type SavView = (typeof SAV_VIEWS)[number];
/** `?view=` → view; anything else is the default "Claims". */
export const savViewOf = (v: string | null | undefined): SavView => ((SAV_VIEWS as readonly string[]).includes(v ?? '') ? (v as SavView) : 'claims');
/** Segmented control labels (savSeg 4990). */
export const SAV_VIEW_LABEL: Record<SavView, string> = { claims: 'Claims', interventions: 'Interventions', costs: 'Costs per machine' };

// ── Facts read from the data layer ──────────────────────────────────────────────────────────────────────

/** Configuration of a machine against Vigie's non-rejected ECOs (`machineCfg` 4197). */
export interface ConfigFacts {
  pending: number;
  retrofit: number;
  pinned: number;
  /** First ECO counted (the tags open it). */
  firstEco: string | null;
  ecos: readonly string[];
}

export interface MachineFacts {
  number: string;
  client: string;
  zone: ZoneCode;
  warrantyStatus: WarrantyStatus;
  warrantyEndOn: string | null;
  /** R-145: end of a recorded warranty extension (ISO); absent / null = none. */
  extendedUntil?: string | null;
}

export interface ClaimFacts {
  number: string;
  machineNumber: string;
  /** ISO date the claim was reported (R-145: the year's warranty cost counts the claims reported this calendar year). */
  reportedOn: string;
  severity: NcrSeverity;
  status: ClaimStatus;
  coverage: ClaimCoverage;
  costKeur: number;
  ecoNumber: string | null;
}

export interface InterventionFacts {
  number: string;
  machineNumber: string;
  /** ISO date. */
  scheduledOn: string;
  status: InterventionStatus;
}

// ── Tags ────────────────────────────────────────────────────────────────────────────────────────────────

/** Warranty status tag (`stClass` 4985): Out of warranty → outline; Extended → accent; In warranty → neutral. */
export const WARRANTY_TONE: Record<WarrantyStatus, Tone> = { in_warranty: 'neutral', extended: 'accent', out_of_warranty: 'outline' };
/** Severity tag (`sevClass` 4987): Critical → accent; Major → outline; Minor → neutral. */
export const SEVERITY_TONE: Record<NcrSeverity, Tone> = { critical: 'accent', major: 'outline', minor: 'neutral' };
/** Claim status tag: Closed → neutral; Open → accent; Diagnosed / Intervention planned → outline. */
export const claimStatusTone = (s: ClaimStatus): Tone => (s === 'closed' ? 'neutral' : s === 'open' ? 'accent' : 'outline');
/** Coverage tag: Chargeable → outline; Warranty / Extended warranty → neutral. */
export const coverageTone = (c: ClaimCoverage): Tone => (c === 'chargeable' ? 'outline' : 'neutral');
/** Intervention status tag: Done → neutral; Planned → outline. */
export const interventionTone = (s: InterventionStatus): Tone => (s === 'done' ? 'neutral' : 'outline');

/** "In warranty" / "Out of warranty" / "Extended → 4 Jun 2027" (FLEET status text). */
export function warrantyStatusText(status: WarrantyStatus, extendedUntil: string | null): string {
  return status === 'extended' && extendedUntil ? `Extended → ${displayOfIso(extendedUntil)}` : warrantyStatus.label(status);
}

/**
 * Warranty ending within the next three months (`wendSub` 4985): end in the future, at most 3 months after the prototype's
 * now (PG_NOW ≈ 30 Sep 2026); days = round((mIdx(end) − now) × 30). "Warranty ending < 90 days" counts these machines.
 */
export function warrantyEnding(endIso: string | null, now = PG_NOW): { soon: boolean; days: number | null } {
  if (!endIso) return { soon: false, days: null };
  const wm = monthIndexOfIso(endIso);
  const soon = wm > now && wm - now <= 3;
  return { soon, days: soon ? Math.round((wm - now) * 30) : null };
}

/**
 * The warranty in force on `today` (R-145, NEW-D5-2 = a), computed on read: "Extended" while a recorded extension runs (its
 * end later than the contractual end — or no contractual end — and not past; default: also before the contractual end has
 * passed, no prototype precedent); else "In warranty" while the end in force (the extension's once it is the later one) is not
 * past; "Out of warranty" once it has passed. Without any date, the stored status. `endOn` = the end in force (the warranty
 * ending alert and its days count from it); the "Warranty end" column keeps the contractual date.
 */
export function warrantyInForce(m: { warrantyEndOn: string | null; extendedUntil?: string | null; warrantyStatus: WarrantyStatus }, today = NOW_ISO): { status: WarrantyStatus; endOn: string | null } {
  const ext = m.extendedUntil && (!m.warrantyEndOn || m.extendedUntil > m.warrantyEndOn) ? m.extendedUntil : null;
  if (ext && ext >= today) return { status: 'extended', endOn: ext };
  const endOn = ext ?? m.warrantyEndOn;
  if (!endOn) return { status: m.warrantyStatus, endOn: null };
  return { status: endOn >= today ? 'in_warranty' : 'out_of_warranty', endOn };
}

/**
 * Warranty state of a machine added in Keystone ("Add machine"): Out of warranty when its warranty end is already past
 * (before the prototype's today, 30 Sep 2026), else In warranty — also without a warranty end, as the prototype.
 */
export const addedWarrantyStatus = (warrantyEndOn: string | null, todayIso = NOW_ISO): WarrantyStatus =>
  warrantyInForce({ warrantyEndOn, extendedUntil: null, warrantyStatus: 'in_warranty' }, todayIso).status;

// ── Configuration (as-maintained vs ECOs) ───────────────────────────────────────────────────────────────

export type ConfigKind = 'pending' | 'retrofit' | 'pinned';
export interface ConfigItem {
  kind: ConfigKind;
  count: number;
  /** "3 pending", "1 retrofit", "1 pinned". */
  text: string;
  tone: Tone;
}

/** Configuration tags (`machineCfg` 4197): pending (accent), retrofit (outline), pinned (neutral) — the non-zero ones. */
export function configItems(c: Pick<ConfigFacts, ConfigKind> | null | undefined): ConfigItem[] {
  if (!c) return [];
  const tones: Record<ConfigKind, Tone> = { pending: 'accent', retrofit: 'outline', pinned: 'neutral' };
  return (['pending', 'retrofit', 'pinned'] as const).filter((k) => c[k] > 0).map((k) => ({ kind: k, count: c[k], text: `${c[k]} ${k}`, tone: tones[k] }));
}

// ── Claims per machine ──────────────────────────────────────────────────────────────────────────────────

export interface MachineClaimStats {
  claims: number;
  /** Claims not Closed. */
  open: number;
  /** Σ cost of the claims not Chargeable (warranty + extended warranty), k€. */
  warrantyKeur: number;
  /** Σ cost of the Chargeable claims, k€. */
  chargeableKeur: number;
}

export function machineClaimStats(machineNumber: string, claims: readonly ClaimFacts[]): MachineClaimStats {
  const mine = claims.filter((c) => c.machineNumber === machineNumber);
  return {
    claims: mine.length,
    open: mine.filter((c) => c.status !== 'closed').length,
    warrantyKeur: mine.filter((c) => c.coverage !== 'chargeable').reduce((s, c) => s + c.costKeur, 0),
    chargeableKeur: mine.filter((c) => c.coverage === 'chargeable').reduce((s, c) => s + c.costKeur, 0),
  };
}

/** Open claims first, then the closed ones, each group in register order (`claimRows` sort 4987, stable). */
export function openFirst<C extends Pick<ClaimFacts, 'status'>>(claims: readonly C[]): C[] {
  return [...claims.filter((c) => c.status !== 'closed'), ...claims.filter((c) => c.status === 'closed')];
}

/** Open Major or Critical claims, every zone (`savBadge` 4994); '' when none. */
export function savBadge(claims: readonly Pick<ClaimFacts, 'status' | 'severity'>[]): string {
  const n = claims.filter((c) => c.status !== 'closed' && (c.severity === 'major' || c.severity === 'critical')).length;
  return n ? String(n) : '';
}

/** 25 k€ of warranty cost fills the Costs-per-machine bar (`barW` 4989). */
export const COST_BAR_FULL_KEUR = 25;
export const costBarPct = (warrantyKeur: number) => Math.min(100, Math.round((warrantyKeur / COST_BAR_FULL_KEUR) * 100));

export interface MachineCostRow<M> extends MachineClaimStats {
  machine: M;
  barPct: number;
}

/** Costs per machine (`savCostRows` 4989): the machines with at least one claim, in machine order. */
export function claimCostRows<M extends { number: string }>(machines: readonly M[], claims: readonly ClaimFacts[]): MachineCostRow<M>[] {
  return machines
    .map((machine) => {
      const st = machineClaimStats(machine.number, claims);
      return { machine, ...st, barPct: costBarPct(st.warrantyKeur) };
    })
    .filter((r) => r.claims > 0);
}

/** Earliest planned intervention (KPI "next · …"); null when none is planned. */
export function nextPlanned(ivs: readonly InterventionFacts[]): InterventionFacts | null {
  return [...ivs].filter((i) => i.status === 'planned').sort((a, b) => a.scheduledOn.localeCompare(b.scheduledOn))[0] ?? null;
}

// ── Zones ───────────────────────────────────────────────────────────────────────────────────────────────

/** Machines of the selected zone (`fleetZ` 4982); every machine when no zone is selected. */
export function machinesInZone<M extends Pick<MachineFacts, 'zone'>>(machines: readonly M[], zone: ZoneCode | null): M[] {
  return machines.filter((m) => !zone || m.zone === zone);
}

/** Claims or interventions of the machines in the zone (`inFleetZ` 4982). */
export function ofMachinesInZone<R extends { machineNumber: string }>(rows: readonly R[], machines: readonly Pick<MachineFacts, 'number' | 'zone'>[], zone: ZoneCode | null): R[] {
  if (!zone) return [...rows];
  const inZone = new Set(machines.filter((m) => m.zone === zone).map((m) => m.number));
  return rows.filter((r) => inZone.has(r.machineNumber));
}

/** Installed base zone notice (`zoneEmptyFleet` 5211): a zone is selected and has no machine. */
export const fleetZoneEmpty = (zone: ZoneCode | null, machinesShown: number) => !!zone && machinesShown === 0;

/**
 * Claims screen zone notice. The prototype (`zoneEmptySav` 5211, 07 A.1) tested the machine list, so a zone with machines
 * but no claim showed an empty register without the notice. Here: a zone is selected and the list of the current view
 * (claims, interventions or cost rows of that zone) is empty.
 */
export const savZoneEmpty = (zone: ZoneCode | null, rowsShown: number) => !!zone && rowsShown === 0;

// ── KPI tiles ───────────────────────────────────────────────────────────────────────────────────────────

/** Parameterised count sub-lines; the view model gives them their French agreement. */
export type CountKind = 'clients' | 'extended' | 'open' | 'major';
export const countTextEn = (kind: CountKind, n: number) => (kind === 'clients' ? `${n} ${n === 1 ? 'client' : 'clients'}` : `${n} ${kind}`);

export interface KpiCard {
  label: string;
  value: string;
  /** English sub-line. */
  sub: string;
  /** The count the sub-line states (FR agreement). */
  count?: { kind: CountKind; n: number };
  /** Value in the attention colour (LO). */
  alert: boolean;
  /** Value in neutral-200 ("Warranty cost YTD"). */
  muted?: boolean;
}

export interface FleetKpiFacts extends MachineFacts {
  openClaims: number;
}

/**
 * Installed base tiles (`fleetKpis` 4993) over the machines shown (zone filter applied). R-145 (NEW-D5-2 = a): the tiles
 * read the warranty in force on `today` (`warrantyInForce`), and "Warranty ending < 90 days" counts from the end in force —
 * an extension ending within three months is ending soon.
 */
export function fleetKpis(machines: readonly FleetKpiFacts[], today = NOW_ISO): KpiCard[] {
  const clients = new Set(machines.map((m) => m.client)).size;
  const inForce = machines.map((m) => ({ number: m.number, ...warrantyInForce(m, today) }));
  const extended = inForce.filter((w) => w.status === 'extended').length;
  const ending = inForce.filter((w) => warrantyEnding(w.endOn).soon).map((w) => w.number);
  return [
    { label: 'Machines in service', value: String(machines.length), sub: countTextEn('clients', clients), count: { kind: 'clients', n: clients }, alert: false },
    { label: 'In warranty', value: String(inForce.filter((w) => w.status === 'in_warranty').length), sub: countTextEn('extended', extended), count: { kind: 'extended', n: extended }, alert: false },
    { label: 'Warranty ending < 90 days', value: String(ending.length), sub: ending.join(' · ') || '—', alert: ending.length > 0 },
    { label: 'Machines with open claims', value: String(machines.filter((m) => m.openClaims > 0).length), sub: 'see warranty claims', alert: false },
  ];
}

/**
 * Warranty claims tiles (`savKpis` 4992) over the claims and interventions shown (zone filter applied); the same in
 * every view. Amounts in k€ (`money`); "Warranty cost YTD" sums the claims not Chargeable and its sub-line the Chargeable
 * ones — R-145 (NEW-D5-2 = a): of the calendar year of `today` only (the claim's report date; no upper bound, so a claim
 * dated after the frozen business date still counts in its year). Two clocks until R-013: `today` (NOW_ISO) here, PG_NOW for
 * the warranty ending alert — they agree on 30 Sep 2026 and must move together.
 */
export function savKpis(claims: readonly ClaimFacts[], ivs: readonly InterventionFacts[], lang: Lang, today = NOW_ISO): KpiCard[] {
  const open = claims.filter((c) => c.status !== 'closed');
  const major = open.filter((c) => c.severity === 'major' || c.severity === 'critical').length;
  const planned = ivs.filter((i) => i.status === 'planned').length;
  const next = nextPlanned(ivs);
  const year = claims.filter((c) => c.reportedOn.slice(0, 4) === today.slice(0, 4));
  const warranty = year.filter((c) => c.coverage !== 'chargeable').reduce((s, c) => s + c.costKeur, 0);
  const chargeable = year.filter((c) => c.coverage === 'chargeable').reduce((s, c) => s + c.costKeur, 0);
  return [
    { label: 'Open claims', value: String(open.length), sub: countTextEn('major', major), count: { kind: 'major', n: major }, alert: major > 0 },
    { label: 'Interventions planned', value: String(planned), sub: `next · ${next ? displayOfIso(next.scheduledOn) : '—'}`, alert: false },
    { label: 'Warranty cost YTD', value: money(warranty, lang), sub: `${money(chargeable, lang)} chargeable`, alert: false, muted: true },
    { label: 'Design-related', value: String(claims.filter((c) => c.ecoNumber).length), sub: 'claims linked to an ECO', alert: false },
  ];
}

// ── Add-forms ───────────────────────────────────────────────────────────────────────────────────────────

const MAX_NAME = 200;
const MAX_ISSUE = 300;
const MAX_DESC = 1000;
const text = (v: string | undefined) => (v ?? '').trim();

export interface NewMachineValues {
  name: string;
  /** Machine type code ("EMP"). */
  machineType: string;
  client: string;
  site: string | null;
  deliveredOn: string | null;
  warrantyEndOn: string | null;
}

/**
 * "Add machine" (AF `fleet`): machine and client required; type among `machineTypes` (default the first); site free
 * text; "Delivered" and "Warranty end" optional dates as typed ("14 Dec 2025", "14/12/2025", "2025-12-14"; the year
 * defaults to 2026). The prototype stored any text; a date that cannot be read is refused here, as is a warranty end
 * before delivery.
 */
export function parseNewMachine(values: Record<string, string | undefined>, machineTypes: readonly string[]): ParseResult<NewMachineValues> {
  const name = text(values.name);
  if (!name) return { ok: false, error: 'Machine is required' };
  const client = text(values.client);
  if (!client) return { ok: false, error: 'Client is required' };
  const site = text(values.site);
  if ([name, client, site].some((x) => x.length > MAX_NAME)) return { ok: false, error: 'Text is too long' };
  const type = text(values.type) || machineTypes[0];
  if (!type || !machineTypes.includes(type)) return { ok: false, error: 'Unknown machine type' };
  const deliveredText = text(values.delivered);
  const deliveredOn = deliveredText ? parseNeedDate(deliveredText) : null;
  if (deliveredText && !deliveredOn) return { ok: false, error: 'Enter the delivery date as a date, e.g. 14 Dec 2025' };
  const warrantyText = text(values.warranty);
  const warrantyEndOn = warrantyText ? parseNeedDate(warrantyText) : null;
  if (warrantyText && !warrantyEndOn) return { ok: false, error: 'Enter the warranty end as a date, e.g. 13 Dec 2027' };
  if (deliveredOn && warrantyEndOn && warrantyEndOn < deliveredOn) return { ok: false, error: 'Warranty end is before delivery' };
  return { ok: true, value: { name, machineType: type, client, site: site || null, deliveredOn, warrantyEndOn } };
}

export interface NewClaimValues {
  machineNumber: string;
  issue: string;
  severity: NcrSeverity;
  coverage: ClaimCoverage;
  owner: string;
  description: string | null;
}

/**
 * "New warranty claim" (AF `sav`): machine among the installed base (default the first; machines added in Keystone are
 * offered too, 07 OQ20), issue required, severity (default Minor), coverage (default Warranty), owner among the after-sales
 * owners (default the first), optional description.
 */
export function parseNewClaim(
  values: Record<string, string | undefined>, machines: readonly string[], owners: readonly string[],
): ParseResult<NewClaimValues> {
  const machineNumber = text(values.machine) || machines[0];
  if (!machineNumber || !machines.includes(machineNumber)) return { ok: false, error: 'Unknown machine' };
  const issue = text(values.issue);
  if (!issue) return { ok: false, error: 'Issue is required' };
  if (issue.length > MAX_ISSUE) return { ok: false, error: 'Text is too long' };
  const sev = text(values.sev) || 'minor';
  if (!ncrSeverity.isCode(sev)) return { ok: false, error: 'Unknown severity' };
  const cover = text(values.cover) || 'warranty';
  if (!claimCoverage.isCode(cover)) return { ok: false, error: 'Unknown coverage' };
  const owner = text(values.owner) || owners[0];
  if (!owner || !owners.includes(owner)) return { ok: false, error: 'Unknown owner' };
  const description = text(values.desc);
  if (description.length > MAX_DESC) return { ok: false, error: 'Text is too long' };
  return { ok: true, value: { machineNumber, issue, severity: sev, coverage: cover, owner, description: description || null } };
}
