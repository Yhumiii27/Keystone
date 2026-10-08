// Engineering change orders — the read-side rules of Keystone's view of the ECOs Vigie manages (docs/spec/09 §4,
// prototype `ecoRow` / `ecoKpis` / `ecoVals`, logic 4339–4370). Vigie owns the ECOs (user decision, overrides 09 §4):
// it computes the status, the effectivity targets, their dispositions, the pending count and the release lock, and
// Keystone only shows them. What Keystone derives here: the KPI tiles, the status chips, the row texts and step
// buttons, the approval dots and key states (with the decisions recorded in Keystone and still pending sync with
// Vigie), the drawer's step indicator, interchangeability texts, disposition tags, the role hint, the nav badge and
// the My approvals items. No I/O, no translation: labels are the prototype's English source strings.
// Golden values: src/domain/eco.test.ts (prototype render values, src/features/eco/eco.golden.json).
// Type-only import: a value import of '@/domain/approvals' loads the screen registry (icons), which breaks scripts/db-check.ts.
import type { ApprovalItem } from '@/domain/approvals';
import type { Txt } from '@/domain/home';
import type { Lang } from '@/i18n/translate';
import { moneyEur } from '@/lib/format';
import {
  ECO_APPROVER_KEYS, ECO_APPROVER_SHORT, ECO_DECISION_TAG, ECO_FLOW_STEPS, ECO_STATUS_TAG, ECO_STEP_ADVANCE, ecoApproverKey, ecoDecision,
  ecoDisposition, ecoKeyOfRole, ecoStatus, interchangeability, INTERCHANGEABILITY_NOT_ASSESSED, isoOfDisplayDate, vigieSyncStatus,
  type EcoApproverKey, type EcoDecision, type EcoDisposition, type EcoStatus, type EcoTargetType, type Interchangeability, type VigieSyncStatus,
} from '@/server/db/codes';

export type { EcoApproverKey, EcoDecision, EcoDisposition, EcoStatus, Interchangeability, VigieSyncStatus };

/** Tag classes as the prototype writes them. */
const TAG = { accent: 'tag tag-accent', outline: 'tag tag-outline', neutral: 'tag tag-neutral' } as const;
const tagOf = (t: 'tag-accent' | 'tag-outline' | 'tag-neutral') => `tag ${t}`;

/** Colours of the prototype (LO 3135, dots 4342, steps 4358). */
export const ECO_COLOR = {
  text: 'var(--color-text)',
  lo: 'var(--color-accent-300)',
  accent: 'var(--color-accent)',
  dotPending: 'var(--color-neutral-700)',
  dotRejected: 'var(--color-neutral-100)',
  stepFuture: 'var(--color-neutral-500)',
} as const;

// ── Inputs (the connector's read model, structurally: src/server/integrations/vigie/types.ts VigieEco) ──

/** Progress recorded in Keystone and not yet reflected by Vigie. */
export interface EcoProgressLike {
  kind: 'approval' | 'step';
  approvalKey: EcoApproverKey | null;
  decision: 'ok' | 'rejected' | null;
  targetStatus: EcoStatus | null;
  syncStatus: VigieSyncStatus;
}

export interface EcoApprovalLike {
  key: EcoApproverKey;
  /** Decision as Vigie last reported it. */
  decision: EcoDecision;
  /** Who decides, as Vigie names them ("R. Aubert, C. Moreau"). */
  approver: string;
  /** The viewer's decision recorded in Keystone, pending sync with Vigie. */
  pending: EcoProgressLike | null;
}

export interface EcoTargetLike {
  targetType: EcoTargetType;
  targetRef: string;
  label: string;
  disposition: EcoDisposition | null;
  isAutomatic: boolean;
  note: string | null;
  fittedPartRef: string | null;
  fittedRevision: string | null;
}

export interface EcoLike {
  number: string;
  title: string;
  status: EcoStatus;
  interchangeability: Interchangeability | null;
  fromRevision: string;
  toRevision: string;
  costEur: number;
  scheduleDays: number;
  pendingDispositions: number;
  locked: boolean;
  parts: string[];
  /** Keystone project codes ("HLT-026"). */
  projects: string[];
  approvals: EcoApprovalLike[];
  /** Step advancement recorded in Keystone, pending sync with Vigie. */
  requestedStatus: EcoStatus | null;
  pendingProgress: EcoProgressLike[];
}

/** Open = neither released nor rejected (the prototype's `!['Released','Rejected'].includes(status)`). */
export const isOpenEco = (s: EcoStatus) => s !== 'released' && s !== 'rejected';

/** Sidebar badge of Change orders: ECOs in approval in Vigie (navs 5150); '' when none. */
export const ecoBadge = (ecos: Pick<EcoLike, 'status'>[]) => {
  const n = ecos.filter((e) => e.status === 'in_approval').length;
  return n ? String(n) : '';
};

// ── KPI tiles (ecoKpis 4350) ───────────────────────────────────────────────────────────────────────────

export interface EcoKpi {
  label: string;
  value: number;
  sub: Txt;
  /** Value in LO (accent-300) instead of OK. */
  lo: boolean;
}

/** "1 release blocked" / "2 releases blocked" / "No release blocked". */
export const releasesBlockedText = (n: number) => (n ? `${n} ${n === 1 ? 'release blocked' : 'releases blocked'}` : 'No release blocked');

/**
 * The six tiles. `awaitingMine` = the viewer's queue (ECOs in approval whose key of the viewer is still pending —
 * for a PM, on the projects they manage); `roleTitle` = the persona title (EN source, translated with the sentence).
 * "Released this month" counts every released ECO, as the prototype (no release date in the mirror, 09 OQ18).
 */
export function ecoKpis(ecos: EcoLike[], opts: { roleKey: EcoApproverKey | null; roleTitle: string; awaitingMine: number; lang: Lang }): EcoKpi[] {
  const open = ecos.filter((e) => isOpenEco(e.status));
  const released = ecos.filter((e) => e.status === 'released');
  const locked = ecos.filter((e) => e.locked).length;
  return [
    { label: 'Open ECOs', value: open.length, sub: `${ecos.length} in total`, lo: false },
    { label: 'Awaiting my approval', value: opts.roleKey ? opts.awaitingMine : 0, sub: opts.roleKey ? { tpl: 'As {role}', p: { role: opts.roleTitle } } : 'Switch to an approver role', lo: false },
    { label: 'Released this month', value: released.length, sub: `Cost impact ${moneyEur(released.reduce((a, e) => a + e.costEur, 0), opts.lang)}`, lo: false },
    { label: 'Projects impacted', value: new Set(open.flatMap((e) => e.projects)).size, sub: 'By open changes', lo: false },
    { label: 'Parts under change', value: new Set(open.flatMap((e) => e.parts)).size, sub: 'Frozen for new orders', lo: true },
    { label: 'Dispositions pending', value: open.reduce((a, e) => a + e.pendingDispositions, 0), sub: releasesBlockedText(locked), lo: locked > 0 },
  ];
}

// ── Status chips (ecoChips) ────────────────────────────────────────────────────────────────────────────

export interface EcoChip {
  /** null = All. */
  value: EcoStatus | null;
  label: string;
  count: number;
}

/** All + every ECO_FLOW status with its count (zero counts included, as the prototype). */
export function ecoChips(ecos: Pick<EcoLike, 'status'>[]): EcoChip[] {
  return [{ value: null, label: 'All', count: ecos.length }, ...ecoStatus.codes.map((s) => ({ value: s, label: ecoStatus.label(s), count: ecos.filter((e) => e.status === s).length }))];
}

/** `?status=` value → status code (unknown → null = All). */
export const ecoFilterOf = (v: unknown): EcoStatus | null => (ecoStatus.isCode(v) ? v : null);

// ── Rows (ecoRow 4342) ─────────────────────────────────────────────────────────────────────────────────

/** "ASM-RMG-250, EL-VFD-200 +2". */
export const partsSummary = (parts: string[]) => parts.slice(0, 2).join(', ') + (parts.length > 2 ? ` +${parts.length - 2}` : '');
/** Cost cell: "+€9,400" / "+9 400 €" or "—". */
export const costText = (cost: number, lang: Lang) => (cost ? `+${moneyEur(cost, lang)}` : '—');
/** Schedule cell: "+6 d" / "-6 d" (ASCII hyphen, as the prototype) or "—". */
export const schedText = (days: number) => (days ? `${days > 0 ? '+' : ''}${days} d` : '—');
/** Impact "Schedule delta": "-6 days" or "None". */
export const schedDeltaText = (days: number) => (days ? `${days > 0 ? '+' : ''}${days} days` : 'None');
/** Impact "Cost delta": "+€2,400" or "None" (LO above €5,000). */
export const costDeltaText = (cost: number, lang: Lang) => (cost ? `+${moneyEur(cost, lang)}` : 'None');
/** "3 dispositions pending" / "1 disposition pending". */
export const dispositionsPendingText = (n: number) => `${n} ${n === 1 ? 'disposition pending' : 'dispositions pending'}`;

/** Decision shown for a key: the one recorded in Keystone while it waits for Vigie, else Vigie's. */
export const effectiveDecision = (a: Pick<EcoApprovalLike, 'decision' | 'pending'>): EcoDecision => a.pending?.decision ?? a.decision;

export interface ApprovalDot {
  key: EcoApproverKey;
  /** "Eng.", "Quality", "PM". */
  label: string;
  /** ok → accent, rejected → neutral-100, pending → neutral-700. */
  dot: string;
  /** The decision is recorded in Keystone, pending sync with Vigie. */
  pendingSync: boolean;
  /** Delivery state of that decision (pending, sent, failed); null when Vigie's decision is shown. */
  sync: VigieSyncStatus | null;
}

/** The three dots of the Approvals column, in key order (englead, quality, pm). */
export function approvalDots(e: Pick<EcoLike, 'approvals'>): ApprovalDot[] {
  return ECO_APPROVER_KEYS.map((key) => {
    const a = e.approvals.find((x) => x.key === key);
    const d = a ? effectiveDecision(a) : 'pending';
    return {
      key, label: ECO_APPROVER_SHORT[key], dot: d === 'ok' ? ECO_COLOR.accent : d === 'rejected' ? ECO_COLOR.dotRejected : ECO_COLOR.dotPending,
      pendingSync: !!a?.pending, sync: a?.pending?.syncStatus ?? null,
    };
  });
}

/** Step button of a row (ecoRow canStart / canSubmit), or the "Set interchangeability" tag. */
export type EcoRowAction =
  | { kind: 'step'; target: EcoStatus; label: 'Start impact analysis' | 'Submit for approval'; variant: 'secondary' | 'primary' }
  | { kind: 'need-interchangeability'; label: 'Set interchangeability' }
  | null;

/**
 * The step a viewer may request now (sent to Vigie): Draft → "Start impact analysis", Impact analysis →
 * "Submit for approval" once Vigie reports the interchangeability decided. None while a step request already waits
 * for Vigie. Mirrors the server rule (src/server/integrations/vigie/progress.ts).
 */
export function nextStepOf(e: Pick<EcoLike, 'status' | 'interchangeability' | 'requestedStatus'>): EcoStatus | null {
  if (e.requestedStatus) return null;
  const target = ECO_STEP_ADVANCE[e.status] ?? null;
  if (target === 'in_approval' && !e.interchangeability) return null;
  return target;
}

/** Row action (prototype rules, plus: nothing while a step waits for Vigie). */
export function ecoRowAction(e: Pick<EcoLike, 'status' | 'interchangeability' | 'requestedStatus'>): EcoRowAction {
  if (e.requestedStatus) return null;
  if (e.status === 'impact_analysis' && !e.interchangeability) return { kind: 'need-interchangeability', label: 'Set interchangeability' };
  const target = nextStepOf(e);
  if (target === 'impact_analysis') return { kind: 'step', target, label: 'Start impact analysis', variant: 'secondary' };
  if (target === 'in_approval') return { kind: 'step', target, label: 'Submit for approval', variant: 'primary' };
  return null;
}

/** The pending-dispositions line under the status tag (hasPend): lock icon when the release is locked. */
export function pendingLine(e: Pick<EcoLike, 'status' | 'pendingDispositions' | 'locked'>): { icon: 'lock' | 'hourglass'; text: string } | null {
  if (!(e.pendingDispositions > 0) || e.status === 'draft' || e.status === 'rejected' || e.status === 'released') return null;
  return { icon: e.locked ? 'lock' : 'hourglass', text: dispositionsPendingText(e.pendingDispositions) };
}

/**
 * Delivery state of the progress not yet reflected by Vigie: failed wins over pending, pending over sent (delivered,
 * waiting for the next refresh of the mirror); null when nothing waits.
 */
export function syncStateOf(e: Pick<EcoLike, 'pendingProgress'>): VigieSyncStatus | null {
  if (!e.pendingProgress.length) return null;
  if (e.pendingProgress.some((p) => p.syncStatus === 'failed')) return 'failed';
  return e.pendingProgress.some((p) => p.syncStatus === 'pending') ? 'pending' : 'sent';
}
/** "Pending sync with Vigie" / "Sync with Vigie failed" / "Sent to Vigie"; null when nothing waits. */
export const syncLabelOf = (e: Pick<EcoLike, 'pendingProgress'>) => {
  const s = syncStateOf(e);
  return s ? vigieSyncStatus.label(s) : null;
};

/** Step requested in Keystone, as the row / drawer announce it ("Impact analysis requested"). */
export const requestedStepText = (target: EcoStatus) => (target === 'impact_analysis' ? 'Impact analysis requested' : 'Submitted for approval');

// ── Drawer (ecoVals 4352–4369) ─────────────────────────────────────────────────────────────────────────

export interface EcoStep {
  label: string;
  /** Index ≤ current and not rejected: accent dot, text label. */
  reached: boolean;
}

/** Draft → Impact analysis → In approval → Released; nothing reached when rejected (FlowStepper `rejected`). */
export function ecoSteps(status: EcoStatus): { steps: EcoStep[]; rejected: boolean } {
  const idx = ECO_FLOW_STEPS.indexOf(status);
  return { steps: ECO_FLOW_STEPS.map((s, i) => ({ label: ecoStatus.label(s), reached: i <= idx })), rejected: status === 'rejected' };
}

export const ecoStatusTag = (s: EcoStatus) => tagOf(ECO_STATUS_TAG[s]);

/** Interchangeability tag, label and hint (interchLabel / interchTag / interchHint). */
export function interchangeabilityView(inter: Interchangeability | null): { label: string; tagClass: string; hint: string } {
  if (inter === 'yes')
    return { label: interchangeability.label('yes'), tagClass: TAG.neutral, hint: 'Form-fit-function with the previous revision — fits every machine and BOM; each target still needs a disposition.' };
  if (inter === 'no')
    return { label: interchangeability.label('no'), tagClass: TAG.neutral, hint: 'Does not fit previous generations — machines in service keep their revision (pinned); open BOMs take the new one.' };
  return { label: INTERCHANGEABILITY_NOT_ASSESSED, tagClass: TAG.accent, hint: 'Decide interchangeability with the previous revision before submitting for approval.' };
}

/** "N dispositions pending" (accent) or "All dispositions set" (neutral). */
export const pendingDispositionsTag = (n: number) => (n ? { text: dispositionsPendingText(n), tagClass: TAG.accent } : { text: 'All dispositions set', tagClass: TAG.neutral });

/**
 * Controls the prototype offered and that Vigie now owns ("Manage in Vigie" links in Keystone): interchangeability
 * (englead, quality, director, while Draft / Impact analysis — canSetInterch), project dispositions (pm, director)
 * and machine dispositions (quality, englead, director) while the ECO is open (canDecide).
 */
export const canSetInterchangeability = (status: EcoStatus, role: string) => (status === 'draft' || status === 'impact_analysis') && ['englead', 'quality', 'director'].includes(role);
export const canDecideDisposition = (status: EcoStatus, targetType: EcoTargetType, role: string) =>
  isOpenEco(status) && (targetType === 'project' ? ['pm', 'director'] : ['quality', 'englead', 'director']).includes(role);

export interface DispositionView {
  /** "Update", "Pinned", "Retrofit", "Not applicable" or "Pending". */
  label: string;
  tagClass: string;
  /** Project: "B → C" (update), "—" (N/A), else "B". Machine: "ASM-RMG-250 rev B". */
  revText: string;
  /** Vigie's note, else the automatic note; '' when none. */
  note: string;
  /** "PM" / "Quality + Eng. lead". */
  decider: string;
}

/** A target row of "Effectivity & dispositions" (dispProjects / dispMachines). */
export function dispositionView(t: EcoTargetLike, e: Pick<EcoLike, 'fromRevision' | 'toRevision'>): DispositionView {
  const d = t.disposition;
  const label = d ? ecoDisposition.label(d) : 'Pending';
  if (t.targetType === 'project') {
    return {
      label,
      tagClass: d === 'update' || d === 'na' ? TAG.neutral : d === 'pinned' ? TAG.outline : TAG.accent,
      revText: d === 'update' ? `${e.fromRevision} → ${e.toRevision}` : d === 'na' ? '—' : e.fromRevision,
      note: t.note || (t.isAutomatic ? 'Design phase — updated automatically' : ''),
      decider: 'PM',
    };
  }
  return {
    label,
    tagClass: d === 'update' || d === 'na' ? TAG.neutral : d === 'pinned' || d === 'retrofit' ? TAG.outline : TAG.accent,
    revText: `${t.fittedPartRef ?? ''} rev ${t.fittedRevision ?? ''}`,
    note: t.note || (t.isAutomatic ? 'Not interchangeable — pinned automatically' : ''),
    decider: 'Quality + Eng. lead',
  };
}

/** "MCH-029 (ASM-RMG-250 rev B) · MCH-022 (ASM-RMG-250 rev A)" — pinned machines of the ECO. */
export const pinnedListText = (targets: EcoTargetLike[]) =>
  targets.filter((t) => t.targetType === 'machine' && t.disposition === 'pinned').map((t) => `${t.targetRef} (${t.fittedPartRef} rev ${t.fittedRevision})`).join(' · ');

/** The viewer as the approval rules see them: role, and the projects they manage (PM key). */
export interface EcoViewer {
  role: string;
  /** Codes of the projects the viewer manages (projects.pm). */
  managedProjects: string[];
}

export interface KeyStateView {
  key: EcoApproverKey;
  /** "Engineering lead", "Quality (ISO 9001)", "PM of impacted projects". */
  label: string;
  /** Who decides, as Vigie names them. */
  who: string;
  decision: EcoDecision;
  /** "Approved" / "Pending" / "Rejected". */
  state: string;
  tagClass: string;
  /** The decision shown was recorded in Keystone and waits for Vigie: its delivery state; null otherwise. */
  sync: VigieSyncStatus | null;
  /** Reject / Approve offered to the viewer. */
  canAct: boolean;
}

/**
 * May the viewer decide `key` now (canAct)? The ECO is in approval in Vigie, the key is still pending there and not
 * already decided in Keystone, the key is the viewer's (englead, quality, pm — the director holds none) and, for the
 * PM key, the viewer manages one of the ECO's projects. Same rule as the server (progress.ts).
 */
export function canActOnKey(e: Pick<EcoLike, 'status' | 'approvals' | 'projects'>, key: EcoApproverKey, viewer: EcoViewer): boolean {
  if (e.status !== 'in_approval' || ecoKeyOfRole(viewer.role) !== key) return false;
  const a = e.approvals.find((x) => x.key === key);
  if (!a || a.decision !== 'pending' || a.pending) return false;
  return key !== 'pm' || e.projects.some((c) => viewer.managedProjects.includes(c));
}

/** The three approval rows of the drawer. */
export function keyStates(e: Pick<EcoLike, 'status' | 'approvals' | 'projects'>, viewer: EcoViewer): KeyStateView[] {
  return ECO_APPROVER_KEYS.flatMap((key) => {
    const a = e.approvals.find((x) => x.key === key);
    if (!a) return [];
    const decision = effectiveDecision(a);
    return [{
      key, label: ecoApproverKey.label(key), who: a.approver, decision, state: ecoDecision.label(decision), tagClass: tagOf(ECO_DECISION_TAG[decision]),
      sync: a.pending ? a.pending.syncStatus : null, canAct: canActOnKey(e, key, viewer),
    }];
  });
}

/** Footer hint of the Approvals section (roleHint). */
export function approvalsHint(status: EcoStatus, role: string): string {
  if (status !== 'in_approval') return 'Approvals open once the impact analysis is submitted.';
  return ecoKeyOfRole(role) ? '' : 'Switch to Engineering lead, Quality or Project manager (bottom-left) to approve.';
}

// ── My approvals (apprItems 4724) ──────────────────────────────────────────────────────────────────────

export interface EcoQueueEntry {
  number: string;
  title: string;
  typeLabel: string;
  projectNames: string[];
  /** ISO date. */
  raisedOn: string;
  requestedBy: string;
  key: EcoApproverKey;
}

/**
 * Inbox items of the viewer's ECO queue: decided inline (recorded in Keystone, sent to Vigie), the row opens the ECO
 * in Keystone, and "Open in Vigie" links to the record in Vigie.
 */
export function ecoApprovalItems(queue: EcoQueueEntry[], links: { keystone: (n: string) => string; vigie: (n: string) => string }, fmtDay: (iso: string) => string): ApprovalItem[] {
  return queue.map((e) => {
    const when = fmtDay(e.raisedOn);
    return {
      kind: 'eco', id: e.number, title: e.title, sub: `${e.typeLabel} · ${e.projectNames.join(', ')}`, who: e.requestedBy, when, whenIso: isoOfDisplayDate(when) ?? e.raisedOn,
      href: links.keystone(e.number), decision: { mode: 'eco', number: e.number, key: e.key },
      external: { href: links.vigie(e.number), label: 'Open in Vigie' },
    } satisfies ApprovalItem;
  });
}
