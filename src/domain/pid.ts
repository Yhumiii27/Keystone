// P&ID — tags, overlay & process validation: the read-side rules of the screen (docs/spec/09 §6; prototype `tagStatus`,
// `pidRows`, `pidList`, `pidChips`, `pidScopeSeg`, `pidKpis`, `pidSteps`, `overlay`, `pidCands`, `pidTagVals` and the nav
// badge, logic 4762–4782 and 5150). Keystone owns the tag list and its mapping to the project BOM; every tag in our
// scope (Keystone + Overlay) must map to a validated BOM reference before release for construction.
// No I/O, no translation: labels are the prototype's English source strings (the feature translates them).
// Golden values: src/domain/pid.test.ts (the prototype's own render values, src/features/pid/pid.golden.json).
// Fixed prototype defects (docs/spec/00 §7.16 spirit):
// - "Unknown ref" has its own status chip (the prototype's chip list omitted it, so such tags were unreachable by filter);
// - a tag whose reference is not in the catalogue can be unlinked (the prototype offered Unlink only with a resolved part);
// - no nav badge "0" when the project has no tag in our scope (coverage 0 % with nothing to link);
// - the sheet label uses the P&ID's own document number (the prototype hard-coded "PID-HLT-026").
import {
  PART_STATUS_TAG, bomScope, partStatus, pidTagKind, pidTagStatus, plcType, stepState,
  type BomScope, type PartStatus, type PartType, type PidRole, type PidTagKind, type PidTagStatus, type PlcType, type StepState,
} from '@/server/db/codes';

export type { BomScope, PidRole, PidTagKind, PidTagStatus, PlcType, StepState };

// ── Status ───────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Derived tag status (`tagStatus` 4766): Client scope → Client; no reference → Unmapped; reference not in the
 * catalogue → Unknown ref; not in the project BOM → Not in BOM; part not Validated → "Part <status>"; else Linked.
 */
export function pidTagStatusOf(scope: BomScope, ref: string | null | undefined, part: { status: PartStatus } | null | undefined, inBom: boolean): PidTagStatus {
  if (scope === 'client') return 'client';
  if (!ref) return 'unmapped';
  if (!part) return 'unknown_ref';
  if (!inBom) return 'not_in_bom';
  if (part.status !== 'validated') return `part_${part.status}` as PidTagStatus;
  return 'linked';
}

/**
 * Status chip order (`pidStatuses` 4771) — "Unknown ref" inserted after Unmapped (the prototype left it out, so a tag
 * with an unknown reference had no chip).
 */
export const PID_STATUS_ORDER: readonly PidTagStatus[] = ['linked', 'unmapped', 'unknown_ref', 'not_in_bom', 'part_not_validated', 'part_outdated', 'part_obsolete', 'client'];

/** Status tag (`tsTag` 4767): Linked / Client neutral, Unmapped / Unknown ref accent, reference issues outline. */
export const pidStatusTag = (s: PidTagStatus) =>
  s === 'linked' || s === 'client' ? 'tag tag-neutral' : s === 'unmapped' || s === 'unknown_ref' ? 'tag tag-accent' : 'tag tag-outline';

/** Scope tag (4768): Overlay accent, Client outline, Keystone neutral. */
export const pidScopeTag = (s: BomScope) => (s === 'overlay' ? 'tag tag-accent' : s === 'client' ? 'tag tag-outline' : 'tag tag-neutral');

/** Scope segment (`pidScopeSeg` 4772): All scopes / Keystone / Overlay (surcouche) / Client. */
export const PID_SCOPE_SEG: readonly { value: BomScope | null; label: string }[] = [
  { value: null, label: 'All scopes' }, { value: 'keystone', label: 'Keystone' }, { value: 'overlay', label: 'Overlay (surcouche)' }, { value: 'client', label: 'Client' },
];

/** `?status=` value → status code (unknown → null = All). */
export const pidStatusFilterOf = (v: unknown): PidTagStatus | null => (pidTagStatus.isCode(v) ? v : null);
/** `?scope=` value → scope code (unknown → null = All scopes). */
export const pidScopeFilterOf = (v: unknown): BomScope | null => (bomScope.isCode(v) ? v : null);

// ── Tag rows ─────────────────────────────────────────────────────────────────────────────────────────────

/** A tag as the data layer reads it (`PidTagRow` of src/server/dal/pid.ts). */
export interface PidTagLike {
  tag: string;
  description: string;
  kind: PidTagKind;
  scope: BomScope;
  /** Mapped reference; null = unmapped. */
  partRef: string | null;
  /** Catalogue name of the reference; null when unmapped or not in the catalogue. */
  partName: string | null;
  partStatus: PartStatus | null;
  note: string;
  activityCode: string;
  activityName: string | null;
  plcType: PlcType | null;
  stateFeedback: string;
  role: PidRole;
  status: PidTagStatus;
  sheet: number;
}

/** Wired to the process or the safety PLC. */
export const isPlcWired = (plc: PlcType | null | undefined) => plc === 'P' || plc === 'S';

/** PLC cell (4768): P / S → tag (Process PLC neutral, Safety PLC accent); L → plain "Local"; none → plain "—". */
export function plcView(plc: PlcType | null): { text: string; asTag: boolean; tagClass: string } {
  return { text: plc ? plcType.label(plc) : '—', asTag: isPlcWired(plc), tagClass: plc === 'S' ? 'tag tag-accent' : 'tag tag-neutral' };
}

/** Actuator wired to the process / safety PLC without state feedback (`fbWarn`). */
export const feedbackMissing = (t: Pick<PidTagLike, 'role' | 'plcType' | 'stateFeedback'>) => t.role === 'actuator' && isPlcWired(t.plcType) && !t.stateFeedback;

/** State feedback cell: the feedback text, "Missing" (warning, accent-300) or "—" (neutral-500). */
export function feedbackView(t: Pick<PidTagLike, 'role' | 'plcType' | 'stateFeedback'>): { text: string; tone: 'warn' | 'text' | 'muted' } {
  if (t.stateFeedback) return { text: t.stateFeedback, tone: 'text' };
  if (t.role === 'actuator' && isPlcWired(t.plcType)) return { text: 'Missing', tone: 'warn' };
  return { text: '—', tone: 'muted' };
}

/** BOM reference cell: the reference or "—". */
export const refText = (t: Pick<PidTagLike, 'partRef'>) => t.partRef || '—';

/** Second line of the reference cell: the part name, or the note of a client tag ("Client scope — free issue"). */
export const partLine = (t: Pick<PidTagLike, 'partName' | 'scope' | 'note'>) => t.partName ?? (t.scope === 'client' ? t.note : '');

/** Activity text "A1410 · HV connection & switchgear" (the code alone when the activity is unknown; "—" when none). */
export const activityText = (code: string, name: string | null | undefined) => (code ? code + (name ? ` · ${name}` : '') : '—');

/** Drawer "Sheet" value: "PID-HLT-026 · sheet 3". */
export const sheetText = (documentNumber: string, sheet: number) => `${documentNumber} · sheet ${sheet}`;

/** Drawer "Scope" value. */
export const scopeNote = (s: BomScope) =>
  s === 'overlay' ? 'Overlay — Keystone sensor on client equipment' : s === 'client' ? 'Client-supplied equipment (free issue)' : 'Keystone supply';

/** English search text of a row (`pidList` 4770): tag, description, reference, PLC label and feedback text. */
export function pidSearchText(t: PidTagLike): string {
  return `${t.tag} ${t.description} ${t.partRef ?? ''} ${plcView(t.plcType).text} ${feedbackView(t).text}`;
}

export interface PidFilter {
  status: PidTagStatus | null;
  scope: BomScope | null;
  q: string;
}

/**
 * Register rows (`pidList` 4770): status chip ∧ scope ∧ search, tag order. The search is case-insensitive on the English
 * text and, when given, on the displayed (translated) text of the row (`displayed(t)`).
 */
export function filterPidTags<T extends PidTagLike>(tags: readonly T[], f: PidFilter, displayed?: (t: T) => string): T[] {
  const q = f.q.trim().toLowerCase();
  return tags.filter(
    (t) =>
      (!f.status || t.status === f.status) &&
      (!f.scope || t.scope === f.scope) &&
      (!q || pidSearchText(t).toLowerCase().includes(q) || (!!displayed && displayed(t).toLowerCase().includes(q))),
  );
}

export interface PidChip {
  value: PidTagStatus | null;
  label: string;
  count: number;
}

/** "All" + the statuses present, in chip order, with their counts over every tag (`pidChips` 4771). */
export function pidChips(tags: readonly Pick<PidTagLike, 'status'>[]): PidChip[] {
  return [
    { value: null, label: 'All', count: tags.length },
    ...PID_STATUS_ORDER.filter((s) => tags.some((t) => t.status === s)).map((s) => ({ value: s, label: pidTagStatus.label(s), count: tags.filter((t) => t.status === s).length })),
  ];
}

/** Overlay card rows (`overlay` 4779): tags supplied with or by the client (Overlay, Client), tag order. */
export const overlayTags = <T extends Pick<PidTagLike, 'scope'>>(tags: readonly T[]): T[] => tags.filter((t) => t.scope === 'overlay' || t.scope === 'client');

// ── Coverage, KPIs, badge ────────────────────────────────────────────────────────────────────────────────

export interface PidCoverage {
  /** Tags in our scope (Keystone + Overlay). */
  inScope: number;
  linked: number;
  /** round(linked / inScope × 100); 0 when nothing is in scope. */
  pct: number;
  unmapped: number;
  /** In scope, neither Linked nor Unmapped (Unknown ref, Not in BOM, Part …). */
  referenceIssues: number;
  overlay: number;
  client: number;
}

export function pidCoverage(tags: readonly Pick<PidTagLike, 'scope' | 'status'>[]): PidCoverage {
  const ks = tags.filter((t) => t.scope !== 'client');
  const linked = ks.filter((t) => t.status === 'linked').length;
  return {
    inScope: ks.length,
    linked,
    pct: ks.length ? Math.round((linked / ks.length) * 100) : 0,
    unmapped: ks.filter((t) => t.status === 'unmapped').length,
    referenceIssues: ks.filter((t) => t.status !== 'linked' && t.status !== 'unmapped').length,
    overlay: tags.filter((t) => t.scope === 'overlay').length,
    client: tags.filter((t) => t.scope === 'client').length,
  };
}

/** The P&ID sheet as the KPI tile shows it. */
export interface PidSheetLike {
  documentNumber: string;
  revision: string;
  sheetCount: number;
  /** "Under review" (EN label of the drawing state). */
  statusLabel: string;
  /** ISO date of issue. */
  issuedOn: string;
}

export type PidKpiKey = 'pid' | 'scope' | 'linked' | 'unmapped' | 'issues';

/** KPI tile: English label, value and the parameters of its sub-line (the feature builds the sentences). */
export interface PidKpi {
  key: PidKpiKey;
  label: string;
  value: string | number;
  /** LO colour (`pidKpis` 4776): coverage < 100, unmapped > 0, issues > 0. */
  lo: boolean;
}

/** `pidKpis` 4776: P&ID · Tags in our scope · Linked to a BOM reference · Unmapped tags · Reference issues. */
export function pidKpis(sheet: Pick<PidSheetLike, 'documentNumber' | 'revision'>, c: PidCoverage): PidKpi[] {
  return [
    { key: 'pid', label: 'P&ID', value: `${sheet.documentNumber} rev ${sheet.revision}`, lo: false },
    { key: 'scope', label: 'Tags in our scope', value: c.inScope, lo: false },
    { key: 'linked', label: 'Linked to a BOM reference', value: `${c.pct}%`, lo: c.pct < 100 },
    { key: 'unmapped', label: 'Unmapped tags', value: c.unmapped, lo: c.unmapped > 0 },
    { key: 'issues', label: 'Reference issues', value: c.referenceIssues, lo: c.referenceIssues > 0 },
  ];
}

/** Sidebar badge (`navEng` 5150): tags in our scope not Linked while the coverage is below 100 % (none when 0). */
export const pidNavBadge = (c: PidCoverage): number | null => (c.pct < 100 && c.inScope - c.linked > 0 ? c.inScope - c.linked : null);

// ── Validation steps ─────────────────────────────────────────────────────────────────────────────────────

/** Step row look (`pidSteps` 4777): dot colour, label colour, state label and tag. */
export function pidStepView(state: StepState): { dot: string; color: string; label: string; tagClass: string } {
  return {
    dot: state === 'done' ? 'var(--color-accent)' : state === 'doing' ? 'var(--color-accent-600)' : 'var(--color-neutral-700)',
    color: state === 'todo' ? 'var(--color-neutral-500)' : 'var(--color-text)',
    label: stepState.label(state),
    tagClass: state === 'done' ? 'tag tag-neutral' : state === 'doing' ? 'tag tag-accent' : 'tag tag-outline',
  };
}

/** Step 1 label for a revision ("Tags extracted from P&ID rev C"). */
export const extractedStepLabel = (rev: string) => `Tags extracted from P&ID rev ${rev}`;

/** Next drawing revision: C → D, 02 → 03, Z → Z1, anything else → "<rev>+". */
export function nextRevision(rev: string): string {
  if (/^[A-Y]$/.test(rev)) return String.fromCharCode(rev.charCodeAt(0) + 1);
  if (/^\d+$/.test(rev)) return String(Number(rev) + 1).padStart(rev.length, '0');
  if (rev === 'Z') return 'Z1';
  return `${rev}+`;
}

/** Last step label: the release revision is the one after the validated revision ("P&ID released for construction (rev D)"). */
export const releasedStepLabel = (rev: string) => `P&ID released for construction (rev ${nextRevision(rev)})`;

// ── Tag drawer ───────────────────────────────────────────────────────────────────────────────────────────

/** Part types a tag kind maps to (`pidCands` 4780): instruments → Electronics, Electrical, Fire & safety; equipment → Electrical, Mechanical, Heavy equipment, Assembly. */
export const PID_COMPATIBLE_TYPES: Record<PidTagKind, readonly PartType[]> = {
  instrument: ['electronics', 'electrical', 'fire_safety'],
  equipment: ['electrical', 'mechanical', 'heavy_equipment', 'assembly'],
};
/** At most 8 candidates (09 OQ15 / E-6: candidate search UX still open). */
export const PID_MAX_CANDIDATES = 8;

/** Candidate references of a tag: BOM articles of a compatible type in catalogue order, at most 8. */
export function pidCandidatesOf<P extends { ref: string; type: PartType }>(kind: PidTagKind, catalogue: readonly P[], bomRefs: ReadonlySet<string>): P[] {
  const types = PID_COMPATIBLE_TYPES[kind];
  return catalogue.filter((p) => bomRefs.has(p.ref) && types.includes(p.type)).slice(0, PID_MAX_CANDIDATES);
}

/** Part status tag of a candidate (`partTag` 4176). */
export const candidateTag = (s: PartStatus) => `tag ${PART_STATUS_TAG[s]}`;
export const partStatusLabel = (s: PartStatus) => partStatus.label(s);

/** Tag record rows (`pidTagVals.meta` 4781), English keys and values. */
export function pidTagRecord(t: PidTagLike, documentNumber: string): [string, string][] {
  return [
    ['Reference', refText(t)],
    ['Part', partLine(t) || '—'],
    ['Activity', activityText(t.activityCode, t.activityName)],
    ['PLC', plcView(t.plcType).text],
    ['State feedback', feedbackView(t).text],
    ['Sheet', sheetText(documentNumber, t.sheet)],
    ['Scope', scopeNote(t.scope)],
  ];
}

/** What the drawer offers for a tag (`pidTagVals` 4781), before the viewer's edit right. */
export function pidTagActions(t: Pick<PidTagLike, 'scope' | 'partRef' | 'partName' | 'status'>): { canMap: boolean; isClient: boolean; hasPart: boolean; canUnlink: boolean; notInBom: boolean } {
  return {
    canMap: t.scope !== 'client',
    isClient: t.scope === 'client',
    // A part resolved in the catalogue (Part record); Unlink for any mapped reference — Unknown ref included (fix).
    hasPart: t.partName != null,
    canUnlink: t.scope !== 'client' && !!t.partRef,
    notInBom: t.status === 'not_in_bom',
  };
}

/** Kind label ("Instrument" / "Equipment"). */
export const kindLabel = (k: PidTagKind) => pidTagKind.label(k);
/** Scope label ("Keystone" / "Overlay" / "Client"). */
export const scopeLabel = (s: BomScope) => bomScope.label(s);
/** Status label ("Part not validated"). */
export const statusLabel = (s: PidTagStatus) => pidTagStatus.label(s);
