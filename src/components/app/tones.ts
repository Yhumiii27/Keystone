// Semantic tone system (docs/spec/02 DS-TONES): the product has no red/amber/green — severity is accent
// intensity. Pure functions, usable in Server and Client Components and in tests.
//
//   alert  → tag-accent  (filled accent-800 / accent-100), text LO = accent-300
//   watch  → tag-outline (accent outline)
//   calm   → tag-neutral (neutral-800 / neutral-100), text OK = text
//   n/a    → text-muted "—"
//
// Mappings take the stable enum codes of docs/spec/11 §2 (lower_snake). Lifecycle stages also accept the
// French domain labels stored on ProjectRow.status ('Fabrication & Assemblage'…).

/** Text colour for "bad" values (logic 3135). */
export const LO = 'var(--color-accent-300)';
/** Text colour for normal values. */
export const OK = 'var(--color-text)';

export type Tone = 'accent' | 'outline' | 'neutral' | 'muted';

/** Full class string the prototype logic produces for a tone. */
export const TAG_CLASS: Record<Tone, string> = {
  accent: 'tag tag-accent',
  outline: 'tag tag-outline',
  neutral: 'tag tag-neutral',
  muted: 'text-muted',
};

/** LO when `bad`, else OK (KPI values, metric cells). */
export const toneColor = (bad: boolean) => (bad ? LO : OK);

// ── Project health & lifecycle ───────────────────────────────────────────────────────────────────

export type HealthCode = 'on_track' | 'at_risk' | 'off_track';
export const HEALTH_TONE: Record<HealthCode, Tone> = { off_track: 'accent', at_risk: 'outline', on_track: 'neutral' };
/** Health tag tone; `null` (no actuals/progress) → muted "—". */
export const healthTone = (h: HealthCode | null | undefined): Tone => (h ? HEALTH_TONE[h] : 'muted');

export type LifecycleCode =
  | 'initiative' | 'aps' | 'apd' | 'etudes' | 'approvisionnements' | 'fabrication_assemblage' | 'fat'
  | 'expedition' | 'chantier' | 'mise_en_service_sat' | 'garantie' | 'clos' | 'annule';

/** Stage order (STATUSES, logic 3136) with the French domain labels (shown in both languages). */
export const LIFECYCLE: { code: LifecycleCode; label: string; short: string }[] = [
  { code: 'initiative', label: 'Initiative', short: 'Init.' },
  { code: 'aps', label: 'APS', short: 'APS' },
  { code: 'apd', label: 'APD', short: 'APD' },
  { code: 'etudes', label: 'Etudes', short: 'Études' },
  { code: 'approvisionnements', label: 'Approvisionnements', short: 'Appro.' },
  { code: 'fabrication_assemblage', label: 'Fabrication & Assemblage', short: 'Fab.' },
  { code: 'fat', label: 'FAT', short: 'FAT' },
  { code: 'expedition', label: 'Expédition', short: 'Expéd.' },
  { code: 'chantier', label: 'Chantier', short: 'Chantier' },
  { code: 'mise_en_service_sat', label: 'Mise Service & SAT', short: 'MES/SAT' },
  { code: 'garantie', label: 'Garantie', short: 'Garantie' },
  { code: 'clos', label: 'Clos', short: 'Clos' },
  { code: 'annule', label: 'Annulé', short: 'Annulé' },
];

const LIFECYCLE_BY_LABEL = new Map(LIFECYCLE.map((s) => [s.label, s.code]));
LIFECYCLE_BY_LABEL.set('Études', 'etudes');
LIFECYCLE_BY_LABEL.set('Mise en service & SAT', 'mise_en_service_sat');

/** Accepts a lifecycle code or the French domain label; unknown → null. */
export function lifecycleCode(status: string): LifecycleCode | null {
  if (LIFECYCLE.some((s) => s.code === status)) return status as LifecycleCode;
  return LIFECYCLE_BY_LABEL.get(status) ?? null;
}

export const PIPE_STAGES: LifecycleCode[] = ['initiative', 'aps', 'apd'];
export const EXEC_STAGES: LifecycleCode[] = ['etudes', 'approvisionnements', 'fabrication_assemblage', 'fat', 'expedition', 'chantier', 'mise_en_service_sat'];

/** statusTag (logic 3917): pipeline + Garantie → outline · execution → accent · Clos/Annulé → neutral. */
export function lifecycleTone(status: string): Tone {
  const c = lifecycleCode(status);
  if (!c) return 'neutral';
  if (EXEC_STAGES.includes(c)) return 'accent';
  if (c === 'clos' || c === 'annule') return 'neutral';
  return 'outline';
}

/** Lifecycle dots (logic 3943): exec accent · Clos neutral-500 · Annulé neutral-700 · others accent-700; Fabrication glows. */
export function lifecycleDot(status: string): { dot: string; ring: string } {
  const c = lifecycleCode(status);
  const dot =
    c && EXEC_STAGES.includes(c)
      ? 'var(--color-accent)'
      : c === 'clos'
        ? 'var(--color-neutral-500)'
        : c === 'annule'
          ? 'var(--color-neutral-700)'
          : 'var(--color-accent-700)';
  const ring = c === 'fabrication_assemblage' ? '0 0 10px color-mix(in srgb, var(--color-accent) 60%, transparent)' : 'none';
  return { dot, ring };
}

// ── Status → tone tables per object (DS-TONES "Status → tag mappings by object") ──────────────────

interface ToneTable {
  map: Record<string, Tone>;
  /** Tone for codes not in `map` (the prototype's "else" branch). */
  other: Tone;
}

const T = (map: Record<string, Tone>, other: Tone): ToneTable => ({ map, other });

export const STATUS_TONES = {
  /** Stage history mode (3941). */
  stageMode: T({ forced: 'accent', auto: 'neutral' }, 'neutral'),
  /** Plan activity row statusClass (4007). */
  activity: T({ behind: 'accent', in_progress: 'outline', completed: 'neutral', not_started: 'muted' }, 'muted'),
  /** Selected-activity drawer (4020) — inverted vs. the row (Q-6). */
  activityDetail: T({ in_progress: 'accent', not_started: 'outline', completed: 'neutral' }, 'outline'),
  /** Schedule milestone (3856). */
  milestone: T({ late: 'accent', done: 'neutral' }, 'outline'),
  /** Budget › Change requests list (4053) — differs from change control (Q-5). */
  budgetChange: T({ approved: 'accent', pending: 'outline', in_review: 'outline' }, 'neutral'),
  /** Change control crTag (4594). */
  change: T({ in_review: 'accent', approved: 'neutral' }, 'outline'),
  /** CR approval chain step (4609). */
  changeStep: T({ pending: 'accent', rejected: 'outline', ok: 'neutral', na: 'neutral' }, 'neutral'),
  /** Baselines (4605). */
  baseline: T({ current: 'accent', proposed: 'outline' }, 'neutral'),
  /** Part partTag (4176). */
  part: T({ validated: 'neutral', not_validated: 'outline' }, 'accent'),
  /** Wear / spare puTag (4181). */
  wearSpare: T({ PU: 'accent', PR: 'outline' }, 'neutral'),
  /** ECO ecoTag (4194). */
  eco: T({ in_approval: 'accent', rejected: 'outline', draft: 'outline', impact_analysis: 'outline', released: 'neutral' }, 'outline'),
  /** Drawing dwgTag (4373). */
  drawing: T({ released: 'neutral', obsolete: 'outline' }, 'accent'),
  /** Purchase order poTag (4313). */
  po: T({ partially_received: 'accent', awaiting_approval: 'outline', ordered: 'outline', received: 'neutral', cancelled: 'neutral', draft: 'neutral' }, 'outline'),
  /** Goods receipt / delivery dTag (4451). */
  receipt: T({ rejected: 'accent', partially_rejected: 'accent', received: 'outline', qc_pending: 'outline', accepted: 'neutral', announced: 'neutral' }, 'outline'),
  /** Stock source (4488). */
  stockSource: T({ local: 'accent', x3: 'neutral' }, 'neutral'),
  /** Risk level rTag (4575) — see riskLevel(). */
  riskLevel: T({ critical: 'accent', high: 'outline', medium: 'neutral', low: 'neutral' }, 'neutral'),
  /** NCR severity sevTag (4615). */
  ncrSeverity: T({ critical: 'accent', major: 'outline' }, 'neutral'),
  /** NCR status ncrTag (4616). */
  ncr: T({ open: 'accent', containment: 'outline', root_cause: 'outline', corrective_action: 'outline', verification: 'outline', closed: 'neutral' }, 'outline'),
  /** Quality deliverable dlvTag (4631). */
  deliverable: T({ rejected: 'accent', submitted: 'accent', in_progress: 'outline', internal_review: 'outline', accepted: 'neutral', planned: 'neutral' }, 'outline'),
  /** RFQ rfqTag (4649). */
  rfq: T({ comparing: 'accent', awarded: 'neutral', draft: 'neutral' }, 'outline'),
  /** Supplier invoice invTag (4660). */
  supplierInvoice: T({ blocked: 'accent', no_po: 'accent', paid: 'neutral', approved_for_payment: 'neutral' }, 'outline'),
  /** Supplier grade (4674). */
  supplierGrade: T({ A: 'neutral', B: 'outline' }, 'accent'),
  /** Client invoices / payment milestones (4686). */
  clientInvoice: T({ invoiced: 'accent', paid: 'neutral' }, 'outline'),
  /** Client issues (4688). */
  clientIssue: T({ open: 'accent', closed: 'neutral' }, 'outline'),
  /** Connectors (4714). */
  connector: T({ warning: 'accent', ok: 'neutral' }, 'outline'),
  /** Site status stTag (4743): Cursus visa/vaccination/clearance/verdict, equipment confirmations, prerequisites, HSE. */
  site: T(
    { missing: 'accent', open: 'accent', no_go: 'accent', pending: 'outline', expiring: 'outline', go_with_reserve: 'outline' },
    'neutral',
  ),
  /** Site equipment source (4745). */
  equipmentSource: T({ shipped: 'outline' }, 'neutral'),
  /** Site collisions (4753). */
  siteCollision: T({ load: 'accent', cert: 'outline', doc: 'outline', leave: 'outline' }, 'outline'),
  /** P&ID tag status tsTag (4767). */
  pidTag: T({ unmapped: 'accent', unknown_ref: 'accent', linked: 'neutral', client: 'neutral' }, 'outline'),
  /** P&ID steps (4777). */
  pidStep: T({ doing: 'accent', todo: 'outline', done: 'neutral' }, 'outline'),
  /** Meeting type (4857). */
  meetingType: T({ external: 'accent', internal: 'neutral' }, 'neutral'),
  /** Meeting status (4857). */
  meetingStatus: T({ notes_in_progress: 'accent', scheduled: 'outline', minutes_sent: 'neutral' }, 'outline'),
  /** Read receipts (4860). */
  readReceipt: T({ unread: 'outline', read: 'neutral' }, 'neutral'),
  /** Carried meeting actions (4838). */
  carriedAction: T({ open: 'accent', closed: 'neutral' }, 'neutral'),
  /** Client question bridge (4840). */
  clientQuestion: T({ open: 'accent', answered: 'neutral' }, 'neutral'),
  /** Contract amendment (4884). */
  amendment: T({ signed: 'neutral' }, 'accent'),
  /** ITP point type (4942). */
  itpType: T({ hold: 'accent', witness: 'outline' }, 'neutral'),
  /** ITP result (4942). */
  itpResult: T({ failed: 'accent', passed: 'neutral' }, 'outline'),
  /** Punch category (4946). */
  punchCategory: T({ A: 'accent', B: 'outline' }, 'neutral'),
  /** Punch status (4946). */
  punch: T({ in_progress: 'outline', closed: 'neutral' }, 'accent'),
  /** Interface status (4955). */
  interface: T({ late: 'accent', frozen: 'neutral', received: 'neutral' }, 'outline'),
} satisfies Record<string, ToneTable>;

export type StatusKind = keyof typeof STATUS_TONES;

/** Tone of `code` for an object kind (falls back to the prototype's "else" tone). */
export function statusTone(kind: StatusKind, code: string | null | undefined): Tone {
  const table: ToneTable = STATUS_TONES[kind];
  if (code == null || code === '') return 'muted';
  return table.map[code] ?? table.other;
}

/** `'tag tag-…'` class string for `code` of an object kind. */
export const statusTagClass = (kind: StatusKind, code: string | null | undefined) => TAG_CLASS[statusTone(kind, code)];

// ── Derived levels & heat colours ("Other tone helpers") ───────────────────────────────────────────

export type RiskLevel = 'critical' | 'high' | 'medium' | 'low';
/** rLevel (4574): score = probability × impact; ≥15 critical · ≥8 high · ≥4 medium · else low. */
export function riskLevel(score: number): RiskLevel {
  return score >= 15 ? 'critical' : score >= 8 ? 'high' : score >= 4 ? 'medium' : 'low';
}

/** rCell (4576): risk-matrix cell colours for probability p × impact i. */
export function riskCell(p: number, i: number): { bg: string; fg: string } {
  const sc = p * i;
  const bg = sc >= 15 ? 'var(--color-accent-500)' : sc >= 8 ? 'var(--color-accent-700)' : sc >= 4 ? 'var(--color-accent-900)' : 'var(--color-neutral-900)';
  return { bg, fg: sc >= 8 ? 'var(--color-accent-100)' : 'var(--color-neutral-300)' };
}

/** shade (3867): allocation % heat cell. >115 · >100 · ≥90 · ≥60 · else. */
export function shade(v: number): { bg: string; fg: string } {
  if (v > 115) return { bg: 'var(--color-accent-400)', fg: 'var(--color-bg)' };
  if (v > 100) return { bg: 'var(--color-accent-600)', fg: 'var(--color-accent-100)' };
  if (v >= 90) return { bg: 'var(--color-accent-800)', fg: 'var(--color-accent-200)' };
  if (v >= 60) return { bg: 'var(--color-accent-900)', fg: 'var(--color-neutral-300)' };
  return { bg: 'var(--color-neutral-900)', fg: 'var(--color-neutral-400)' };
}

/** The 5 heat-scale swatches (Under → Over), for legends. */
export const SHADE_SCALE = [50, 75, 95, 105, 120].map((v) => shade(v).bg);

/** lvColor (4392): skill level dot colour 0–4+ (empty dot track is neutral-900). */
export function levelColor(v: number): string {
  return v >= 4 ? 'var(--color-accent-400)' : v === 3 ? 'var(--color-accent-600)' : v === 2 ? 'var(--color-accent-800)' : v === 1 ? 'var(--color-neutral-800)' : 'transparent';
}

/** RACI cell (4935). */
export function raciCell(v: string | null | undefined): { color: string; bg: string; border: string } {
  return {
    color: v === 'A' ? 'var(--color-accent-100)' : v === 'R' ? 'var(--color-accent-300)' : v === 'C' ? 'var(--color-neutral-300)' : 'var(--color-neutral-500)',
    bg: v === 'A' ? 'var(--color-accent-800)' : v === 'R' ? 'var(--color-accent-900)' : 'transparent',
    border: v ? '1px solid var(--color-neutral-800)' : '1px dashed var(--color-neutral-900)',
  };
}

export type CommissioningCellStatus = 'planned' | 'in_progress' | 'done' | 'blocked';
/** cmStatus (4971); `icon` is the Phosphor component name to render. */
export function commissioningCell(st: CommissioningCellStatus | string): { bg: string; border: string; color: string; icon: 'Check' | 'LockSimple' | 'CircleHalf' | 'CircleDashed' } {
  if (st === 'done') return { bg: 'var(--color-accent-800)', border: '1px solid var(--color-accent-700)', color: 'var(--color-accent-100)', icon: 'Check' };
  if (st === 'blocked') return { bg: 'transparent', border: '1px dashed var(--color-accent)', color: LO, icon: 'LockSimple' };
  if (st === 'in_progress') return { bg: 'var(--color-accent-900)', border: '1px solid var(--color-neutral-800)', color: 'var(--color-accent-300)', icon: 'CircleHalf' };
  return { bg: 'transparent', border: '1px solid var(--color-neutral-800)', color: 'var(--color-neutral-400)', icon: 'CircleDashed' };
}

/** Approval dots (4343, 4600): ok accent · rejected neutral-100 · n/a hollow · pending neutral-700. */
export function approvalDot(decision: 'ok' | 'rejected' | 'na' | 'pending' | string): { dot: string; ring: string } {
  if (decision === 'ok') return { dot: 'var(--color-accent)', ring: 'none' };
  if (decision === 'rejected') return { dot: 'var(--color-neutral-100)', ring: 'none' };
  if (decision === 'na') return { dot: 'transparent', ring: 'inset 0 0 0 1px var(--color-neutral-700)' };
  return { dot: 'var(--color-neutral-700)', ring: 'none' };
}

/** Task / checklist check (todoLite 3896, checklist 4089). */
export function checkLook(done: boolean): { ring: string; fill: string; titleColor: string; deco: string } {
  return done
    ? { ring: 'var(--color-accent)', fill: 'var(--color-accent)', titleColor: 'var(--color-neutral-500)', deco: 'line-through' }
    : { ring: 'var(--color-neutral-600)', fill: 'transparent', titleColor: 'var(--color-text)', deco: 'none' };
}

/** Board column dot (4078): done neutral-500 · todo neutral-400 · doing/review accent. */
export function boardDot(status: 'todo' | 'doing' | 'review' | 'done' | string): string {
  return status === 'done' ? 'var(--color-neutral-500)' : status === 'todo' ? 'var(--color-neutral-400)' : 'var(--color-accent)';
}

/** Glow used on the current step of flow steppers. */
export const STEP_GLOW = '0 0 8px color-mix(in srgb, var(--color-accent) 60%, transparent)';
