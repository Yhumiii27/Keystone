// Project engineering register — the rules of the Engineering synthesis and the four discipline screens (docs/spec/09
// §7–8; prototype logic 4783–4816: `chk`, `docRows`, `inRows`, `outRows`, `engMatrix`, `engDiscCards`, `engKpis`,
// `engDKpis`, `engChkChips`, `engImpVals`, the presets of the header primary 5137 and the sidebar badges `engNav_`).
// Keystone owns the register: which revision of whose documents each discipline consumes, its own deliverables up to
// the BPE release (Codex records, statuses shared with the Documents screen), the lists it generates for the next
// service and the inconsistencies found at each import; the files stay in the business tools.
//   - `deriveRegister` turns stored records into the derived register (the data layer computes the same rows in
//     src/server/dal/engineering.ts, whose `EngineeringRegister` is structurally an `EngRegister`);
//   - `planImport` is the effect of the import wizard ("Import · freeze this revision as input");
//   - the view builders return the prototype's English values (labels, tag classes, colour tokens) — the screens
//     translate them with t(); `engBadges` gives the sidebar badges.
// No I/O, no translation. Golden values: src/domain/engineering.test.ts (src/features/eng/eng.golden.json).
import {
  DISCIPLINES, checkSeverity, checkStatus, docRecipient, documentStatus, inputState, isOpenCheck, outputState, shortDateOfIso,
  type CheckSeverity, type CheckStatus, type Discipline, type DocRecipient, type DocumentStatus, type ImportDeltaKind, type InputState, type OutputState,
} from '@/server/db/codes';

export type { CheckSeverity, CheckStatus, Discipline, DocRecipient, DocumentStatus, InputState, OutputState };
export { DISCIPLINES };

// ── Screens, routes ─────────────────────────────────────────────────────────────────────────────────────

export type EngScreen = 'eng' | 'eng-process' | 'eng-meca' | 'eng-elec' | 'eng-auto';
export const ENG_SCREENS: readonly EngScreen[] = ['eng', 'eng-process', 'eng-meca', 'eng-elec', 'eng-auto'];
export const SCREEN_OF_DISCIPLINE: Record<Discipline, EngScreen> = { process: 'eng-process', meca: 'eng-meca', elec: 'eng-elec', auto: 'eng-auto' };
export const disciplineOfScreen = (s: EngScreen): Discipline | null => DISCIPLINES.find((d) => SCREEN_OF_DISCIPLINE[d] === s) ?? null;
/** URL segment of each discipline screen (src/config/screens.ts slugs `engineering/<segment>`). */
export const DISCIPLINE_SEGMENT: Record<Discipline, string> = { process: 'process', meca: 'mechanical', elec: 'electrical', auto: 'automation' };
export const disciplineOfSegment = (seg: string | undefined): Discipline | null => DISCIPLINES.find((d) => DISCIPLINE_SEGMENT[d] === seg) ?? null;
export const isDiscipline = (v: unknown): v is Discipline => typeof v === 'string' && (DISCIPLINES as readonly string[]).includes(v);

// ── Colours and tags as the prototype writes them ───────────────────────────────────────────────────────

export const ENG_COLOR = {
  text: 'var(--color-text)',
  lo: 'var(--color-accent-300)',
  accent: 'var(--color-accent)',
  accent200: 'var(--color-accent-200)',
  accent700: 'var(--color-accent-700)',
  n200: 'var(--color-neutral-200)',
  n300: 'var(--color-neutral-300)',
  n400: 'var(--color-neutral-400)',
  n500: 'var(--color-neutral-500)',
  n600: 'var(--color-neutral-600)',
  n800: 'var(--color-neutral-800)',
  n900: 'var(--color-neutral-900)',
  cellEmpty: 'color-mix(in srgb, var(--color-neutral-900) 45%, transparent)',
  transparent: 'transparent',
} as const;
const TAG = { accent: 'tag tag-accent', outline: 'tag tag-outline', neutral: 'tag tag-neutral' } as const;
type TagClass = (typeof TAG)[keyof typeof TAG];
const okLo = (bad: boolean) => (bad ? ENG_COLOR.lo : ENG_COLOR.text);

/** Recipient / discipline label (ENG_RCP 3737): "Mechanical", "Purchasing". */
export const recipientLabel = (k: DocRecipient | Discipline) => docRecipient.label(k);
/** Recipients joined " · " (`rcpList`). */
export const recipientsText = (ks: readonly DocRecipient[]) => ks.map(recipientLabel).join(' · ');

// ── Pure rules ──────────────────────────────────────────────────────────────────────────────────────────

/** Previous revision letter (`prevRev`): "D" → "C"; "A" stays "A"; anything else unchanged. */
export const prevRev = (rev: string) => (/^[B-Z]$/.test(rev) ? String.fromCharCode(rev.charCodeAt(0) - 1) : rev);

/** "PID-HLT-026" → "PID", "LST-INS-026" → "LST-INS" (`shortDoc`: the project code, then its number, removed). */
export function shortDoc(id: string, projectCode: string): string {
  const num = projectCode.split('-')[1] ?? '';
  return id.replace(`-${projectCode}`, '').replace(num ? `-${num}` : '', '');
}

/**
 * Statuses whose current revision is a reference for the disciplines that consume the document (E-5 = a: "the latest
 * frozen or released revision"): Frozen, Release proposed (frozen, in the release circuit), Released, and Obsolete (a
 * withdrawn record was released at that revision). Only a Draft revision is still being written.
 */
export const REFERENCE_STATUSES: readonly DocumentStatus[] = ['frozen', 'release_proposed', 'released', 'obsolete'];
export const isReferenceStatus = (s: DocumentStatus) => REFERENCE_STATUSES.includes(s);

/**
 * Latest revision of an input (`inRows` 4794), E-5 = a: the provider document's current revision once it is frozen or
 * released, else (a Draft revision) the previous letter; a document outside the register (the client's basis of
 * design) is always up to date. The prototype (09 OQ12) only took a Released revision: a Frozen rev B read "latest
 * rev A", so LST-IO-026 rev B was reported outdated against rev A.
 */
export function inputLatest(revisionInUse: string, providerDoc: { revision: string; status: DocumentStatus } | null | undefined): string {
  if (!providerDoc) return revisionInUse;
  return isReferenceStatus(providerDoc.status) ? providerDoc.revision : prevRev(providerDoc.revision);
}

/** Outdated when the revision in use differs from the latest, else Up to date once confirmed, else To confirm. */
export const inputStateOf = (revisionInUse: string, latest: string, acknowledged: boolean): InputState =>
  revisionInUse !== latest ? 'outdated' : acknowledged ? 'up_to_date' : 'to_confirm';

/** An output recorded "Blocked" is Ready once its discipline has no open blocking check (`outRows` 4795). */
export const outputStateOf = (recorded: OutputState, openBlocking: number): OutputState => (recorded === 'blocked' && !openBlocking ? 'ready' : recorded);

/** Deliverable workflow (09 §11): Draft —Freeze→ Frozen —Propose release→ Release proposed —Validate release (PM)→ Released. */
export type DeliverableStep = 'freeze' | 'propose' | 'validate';
export const DELIVERABLE_STEP: Record<DeliverableStep, { from: DocumentStatus; to: DocumentStatus; label: string }> = {
  freeze: { from: 'draft', to: 'frozen', label: 'Freeze' },
  propose: { from: 'frozen', to: 'release_proposed', label: 'Propose release' },
  validate: { from: 'release_proposed', to: 'released', label: 'Validate release (PM)' },
};
export const isDeliverableStep = (v: unknown): v is DeliverableStep => v === 'freeze' || v === 'propose' || v === 'validate';

/** Who validates a release (09 OQ11; the prototype had no role check): the project's PM or the portfolio director. */
export const canValidateRelease = (viewer: { role: string }, managesProject: boolean) => viewer.role === 'director' || (viewer.role === 'pm' && managesProject);

/** Notes written on a check closed in Keystone (`resolve` / `sendBack` 4789) or by an import (`finish` 4813). */
export const CHECK_NOTE = {
  resolved: 'Resolved in Keystone',
  sent_back: 'Sent back to tool · closes on next import',
  imported: (rev: string) => `Closed by import of rev ${rev}`,
} as const;
export type CheckClose = 'resolved' | 'sent_back';
export const isCheckClose = (v: unknown): v is CheckClose => v === 'resolved' || v === 'sent_back';
/** Check statuses an import closes (revision-alignment checks): open, in progress, sent back ("closes on next import"). */
export const CLOSED_BY_IMPORT: readonly CheckStatus[] = ['open', 'in_progress', 'sent_back'];
export const closesOnImport = (s: CheckStatus) => CLOSED_BY_IMPORT.includes(s);

// ── Records and the derived register ────────────────────────────────────────────────────────────────────

export interface EngDisciplineLike { code: Discipline; icon: string; lead: string; tools: string }

/** An input as stored: the consumer, the document, the revision in use and the referent's confirmation. */
export interface EngInputRecord {
  consumer: Discipline;
  documentNumber: string;
  revisionInUse: string;
  acknowledged: boolean;
  /** External provider ("client") of a document outside the register. */
  providerParty?: DocRecipient | null;
  /** Title of an external document ("Client basis of design"). */
  externalTitle?: string | null;
}

/** An engineering deliverable (ENG_DOCS: a Codex record whose service is a discipline, with its recipients). */
export interface EngDocRecord {
  number: string;
  title: string;
  discipline: Discipline;
  revision: string;
  status: DocumentStatus;
  /** ISO date of the current revision. */
  issuedOn: string;
  /** Short name ("P. Noguès"). */
  author: string;
  recipients: DocRecipient[];
}

export interface EngCheckRecord {
  number: string;
  rulePair: string;
  ruleLabel: string;
  severity: CheckSeverity;
  title: string;
  detail: string;
  owner: Discipline;
  status: CheckStatus;
  /** '' when none. */
  note: string;
}

export interface EngOutputRecord {
  number: string;
  discipline: Discipline;
  name: string;
  recipients: DocRecipient[];
  source: string;
  /** State recorded for the list. */
  state: OutputState;
  /** ISO instant of the last generation. */
  generatedAt: string | null;
  generatedFormat: string | null;
}

export interface EngChangeLike { changedOn: string; text: string; recipients: DocRecipient[] }
export interface EngToolLike { position: number; label: string; discipline: Discipline }
export interface EngDeltaLike { kind: ImportDeltaKind; label: string }

export interface EngRaw {
  projectCode: string;
  disciplines: EngDisciplineLike[];
  inputs: EngInputRecord[];
  docs: EngDocRecord[];
  checks: EngCheckRecord[];
  outputs: EngOutputRecord[];
  changes: EngChangeLike[];
  tools: EngToolLike[];
  mappings: { sourceColumn: string; targetField: string }[];
  deltas: EngDeltaLike[];
}

export interface EngInputLike {
  consumer: Discipline;
  documentNumber: string;
  title: string;
  provider: DocRecipient;
  revisionInUse: string;
  latest: string;
  acknowledged: boolean;
  outdated: boolean;
  state: InputState;
}
export interface EngDeliverableLike extends EngDocRecord {
  /** Open blocking checks owned by the discipline (release gate). */
  blockingChecks: number;
  canFreeze: boolean;
  canPropose: boolean;
  proposeBlocked: boolean;
  /** Delivery 7 (P-7c): Release proposed and the Codex approval circuit not started ("Validate release (PM)" starts it). */
  canValidate: boolean;
  /** Delivery 7: circuit line under the status (EN source), from the data layer; absent in the prototype replay. */
  codexNote?: string | null;
}
export interface EngCheckLike extends Omit<EngCheckRecord, 'note'> {
  lead: string;
  open: boolean;
  note: string;
}
export interface EngOutputLike extends EngOutputRecord {
  /** Open blocking checks of the discipline when Blocked. */
  blockingChecks: number;
}

/** The derived register the screens show (structurally the data layer's `EngineeringRegister`). */
export interface EngRegister {
  projectCode: string;
  disciplines: EngDisciplineLike[];
  inputs: EngInputLike[];
  deliverables: EngDeliverableLike[];
  checks: EngCheckLike[];
  outputs: EngOutputLike[];
  changes: EngChangeLike[];
  tools: EngToolLike[];
  mappings: { sourceColumn: string; targetField: string }[];
  deltas: EngDeltaLike[];
}

/** Open blocking checks owned by `d` (or all disciplines). */
export const openBlocking = (checks: readonly { open: boolean; severity: CheckSeverity; owner: Discipline }[], d?: Discipline) =>
  checks.filter((c) => c.open && c.severity === 'blocking' && (!d || c.owner === d)).length;

/** Stored records → the derived register (`chk`, `docRows`, `inRows`, `outRows` 4789–4795). */
export function deriveRegister(raw: EngRaw): EngRegister {
  const lead = new Map(raw.disciplines.map((d) => [d.code, d.lead]));
  const checks: EngCheckLike[] = raw.checks.map((c) => ({ ...c, lead: lead.get(c.owner) ?? '', open: isOpenCheck(c.status) }));
  const docByNumber = new Map(raw.docs.map((d) => [d.number, d]));
  return {
    projectCode: raw.projectCode,
    disciplines: raw.disciplines,
    inputs: raw.inputs.map((i) => {
      const doc = docByNumber.get(i.documentNumber);
      const latest = inputLatest(i.revisionInUse, doc);
      return {
        consumer: i.consumer, documentNumber: i.documentNumber, title: doc?.title ?? i.externalTitle ?? i.documentNumber, provider: doc ? doc.discipline : (i.providerParty ?? 'client'),
        revisionInUse: i.revisionInUse, latest, acknowledged: i.acknowledged, outdated: i.revisionInUse !== latest, state: inputStateOf(i.revisionInUse, latest, i.acknowledged),
      };
    }),
    deliverables: raw.docs.map((d) => {
      const nb = openBlocking(checks, d.discipline);
      return { ...d, blockingChecks: nb, canFreeze: d.status === 'draft', canPropose: d.status === 'frozen' && !nb, proposeBlocked: d.status === 'frozen' && nb > 0, canValidate: d.status === 'release_proposed' };
    }),
    checks,
    outputs: raw.outputs.map((o) => {
      const nb = openBlocking(checks, o.discipline);
      const state = outputStateOf(o.state, nb);
      return { ...o, state, blockingChecks: state === 'blocked' ? nb : 0 };
    }),
    changes: raw.changes,
    tools: raw.tools,
    mappings: raw.mappings,
    deltas: raw.deltas,
  };
}

/**
 * Effect of the import wizard (`finish` 4813, data layer `importEngList`): the consumer's input of the document
 * becomes its current revision, to confirm (added when the discipline did not consume it yet — the prototype stored
 * it without listing it); an instrument list also refreshes the consumer's P&ID input; the consumer's revision-alignment
 * checks that are not resolved yet — open, in progress or sent back ("closes on next import") — close ("Closed by
 * import of rev D" — C-08 for Electrical, C-09 for Automation). A check already resolved keeps its own note (the
 * prototype overwrote it).
 */
export function planImport(raw: EngRaw, target: { consumer: Discipline; documentNumber: string }): EngRaw {
  const doc = raw.docs.find((d) => d.number === target.documentNumber);
  if (!doc) throw new Error(`Unknown document ${target.documentNumber}`);
  if (doc.discipline === target.consumer) throw new Error(`${doc.number} is a deliverable of ${target.consumer}, not an input`);
  const set =(inputs: EngInputRecord[], number: string, rev: string) =>
    inputs.some((i) => i.consumer === target.consumer && i.documentNumber === number)
      ? inputs.map((i) => (i.consumer === target.consumer && i.documentNumber === number ? { ...i, revisionInUse: rev, acknowledged: false } : i))
      : [...inputs, { consumer: target.consumer, documentNumber: number, revisionInUse: rev, acknowledged: false }];
  let inputs = set(raw.inputs, doc.number, doc.revision);
  const pidDoc = raw.docs.find((d) => d.number.startsWith('PID-'));
  if (doc.number.startsWith('LST-INS-') && pidDoc) inputs = set(inputs, pidDoc.number, pidDoc.revision);
  const checks = raw.checks.map((c) =>
    c.owner === target.consumer && c.rulePair === 'revision' && closesOnImport(c.status) ? { ...c, status: 'resolved' as const, note: CHECK_NOTE.imported(doc.revision) } : c,
  );
  return { ...raw, inputs, checks };
}

// ── Synthesis (eng) ─────────────────────────────────────────────────────────────────────────────────────

export interface KpiV { label: string; value: string | number; sub: string; color: string }

export interface PillV { doc: string; label: string; sub: string; color: string; border: string; dot: string; dotBorder: string }
export interface MatrixCellV { from: DocRecipient; bg: string; items: PillV[] }
export interface MatrixRowV { to: DocRecipient; label: string; cells: MatrixCellV[] }

export interface DiscCardV {
  disc: Discipline;
  label: string;
  icon: string;
  lead: string;
  tools: string;
  /** "67%" (released / total). */
  pct: string;
  relText: string;
  openText: string;
  openColor: string;
}

export interface GateItemV {
  number: string;
  /** Owning discipline: the item opens its screen. */
  owner: Discipline;
  title: string;
  ruleLabel: string;
  lead: string;
  status: string;
  stClass: TagClass;
  sevDot: string;
}

export interface SynthesisV {
  kpis: KpiV[];
  from: { code: DocRecipient; label: string }[];
  matrix: MatrixRowV[];
  discCards: DiscCardV[];
  gate: { cls: TagClass; text: string; items: GateItemV[] };
  changes: { date: string; text: string; impact: string }[];
}

/** Matrix columns (providers) and rows (receivers), `FROM` / `TO` 4800. */
export const MATRIX_FROM: readonly DocRecipient[] = ['client', 'process', 'meca', 'elec', 'auto'];
export const MATRIX_TO: readonly DocRecipient[] = ['process', 'meca', 'elec', 'auto', 'achats', 'site', 'client'];

const sevDot = (s: CheckSeverity) => (s === 'blocking' ? ENG_COLOR.accent : s === 'warning' ? ENG_COLOR.accent700 : ENG_COLOR.n600);
const checkStClass = (s: CheckStatus): TagClass => (s === 'resolved' ? TAG.neutral : s === 'open' ? TAG.accent : TAG.outline);

/** One pill per document in a matrix cell (`cellItems` 4800). */
function cellItems(reg: EngRegister, from: DocRecipient, to: DocRecipient): PillV[] {
  if ((DISCIPLINES as readonly string[]).includes(to)) {
    return reg.inputs
      .filter((r) => r.consumer === to && r.provider === from)
      .map((r) => ({
        doc: r.documentNumber,
        label: shortDoc(r.documentNumber, reg.projectCode),
        sub: r.outdated ? `rev ${r.revisionInUse} → ${r.latest}` : `rev ${r.revisionInUse}`,
        color: r.outdated ? ENG_COLOR.accent200 : r.acknowledged ? ENG_COLOR.n200 : ENG_COLOR.n400,
        border: r.outdated ? ENG_COLOR.accent700 : ENG_COLOR.n800,
        dot: r.outdated ? ENG_COLOR.accent : r.acknowledged ? ENG_COLOR.n300 : ENG_COLOR.n500,
        dotBorder: ENG_COLOR.transparent,
      }));
  }
  return reg.deliverables
    .filter((d) => d.discipline === from && d.recipients.includes(to))
    .map((d) => {
      const rel = d.status === 'released';
      return {
        doc: d.number,
        label: shortDoc(d.number, reg.projectCode),
        sub: rel ? `rev ${d.revision}` : documentStatus.label(d.status),
        color: rel ? ENG_COLOR.n200 : ENG_COLOR.n400,
        border: ENG_COLOR.n800,
        dot: rel ? ENG_COLOR.n300 : ENG_COLOR.transparent,
        dotBorder: rel ? ENG_COLOR.transparent : ENG_COLOR.n600,
      };
    });
}

/** Gate tag (5197); singular for one inconsistency (the prototype wrote "1 blocking inconsistencies"). */
export function gateText(blocking: number): string {
  if (!blocking) return 'Ready to pass';
  return blocking === 1 ? 'Blocked by 1 blocking inconsistency' : `Blocked by ${blocking} blocking inconsistencies`;
}

/** Synthesis values (`engKpis` 4803, `engMatrix` 4801, `engDiscCards` 4798, gate 5197, `engChanges`). */
export function synthesisView(reg: EngRegister): SynthesisV {
  const block = reg.checks.filter((c) => c.open && c.severity === 'blocking');
  const outdatedIn = reg.inputs.filter((r) => r.outdated).length;
  const relAll = reg.deliverables.filter((d) => d.status === 'released').length;
  const readyOut = reg.outputs.filter((o) => o.state === 'ready').length;
  const discByCode = new Map(reg.disciplines.map((d) => [d.code, d]));
  return {
    kpis: [
      { label: 'Blocking inconsistencies', value: block.length, sub: block.length ? 'block the gate «Plans & BOM frozen»' : 'gate «Plans & BOM frozen» can pass', color: okLo(block.length > 0) },
      { label: 'Outdated inputs', value: outdatedIn, sub: 'across the 4 disciplines', color: okLo(outdatedIn > 0) },
      {
        label: 'Deliverables released', value: `${relAll} / ${reg.deliverables.length}`,
        // Delivery 7 (P-7c): once the PM has started the Codex circuit, a deliverable no longer awaits the PM.
        sub: `${reg.deliverables.filter((d) => d.canValidate).length} awaiting PM validation`, color: ENG_COLOR.text,
      },
      {
        label: 'Outputs ready', value: `${readyOut} / ${reg.outputs.length}`, sub: `${reg.outputs.filter((o) => o.state === 'blocked').length} blocked by inconsistencies`,
        color: okLo(readyOut < reg.outputs.length),
      },
    ],
    from: MATRIX_FROM.map((code) => ({ code, label: recipientLabel(code) })),
    matrix: MATRIX_TO.map((to) => ({
      to,
      label: recipientLabel(to),
      cells: MATRIX_FROM.map((from) => {
        const items = from === to ? [] : cellItems(reg, from, to);
        return { from, items, bg: from === to ? ENG_COLOR.transparent : items.length ? ENG_COLOR.n900 : ENG_COLOR.cellEmpty };
      }),
    })),
    discCards: DISCIPLINES.map((k) => {
      const dd = reg.deliverables.filter((d) => d.discipline === k);
      const rel = dd.filter((d) => d.status === 'released').length;
      const op = reg.checks.filter((c) => c.open && c.owner === k);
      const nb = op.filter((c) => c.severity === 'blocking').length;
      const d = discByCode.get(k);
      return {
        disc: k, label: recipientLabel(k), icon: d?.icon ?? '', lead: d?.lead ?? '', tools: d?.tools ?? '',
        pct: `${dd.length ? Math.round((rel / dd.length) * 100) : 0}%`, relText: `${rel} / ${dd.length} released`, openText: `${op.length} open · ${nb} blocking`,
        openColor: nb ? ENG_COLOR.lo : ENG_COLOR.n400,
      };
    }),
    gate: {
      cls: block.length ? TAG.accent : TAG.neutral,
      text: gateText(block.length),
      items: block.slice(0, 6).map((c) => ({
        number: c.number, owner: c.owner, title: c.title, ruleLabel: c.ruleLabel, lead: c.lead, status: checkStatus.label(c.status), stClass: checkStClass(c.status), sevDot: sevDot(c.severity),
      })),
    },
    changes: reg.changes.map((c) => ({ date: shortDateOfIso(c.changedOn), text: c.text, impact: recipientsText(c.recipients) })),
  };
}

// ── Discipline screens (eng-process, eng-meca, eng-elec, eng-auto) ──────────────────────────────────────

/** Consistency-check chips (`engChkChips`): All, Open (Open + In progress), Sent back, Resolved. */
export type CheckFilter = 'all' | 'open' | 'sent_back' | 'resolved';
export const CHECK_FILTERS: readonly CheckFilter[] = ['all', 'open', 'sent_back', 'resolved'];
const CHECK_FILTER_LABEL: Record<CheckFilter, string> = { all: 'All', open: 'Open', sent_back: 'Sent back', resolved: 'Resolved' };
/** `?status=` → filter; unknown → All. */
export const checkFilterOf = (v: string | null | undefined): CheckFilter => (CHECK_FILTERS.includes(v as CheckFilter) ? (v as CheckFilter) : 'all');
const matchesFilter = (c: EngCheckLike, f: CheckFilter) => f === 'all' || (f === 'open' ? c.open : c.status === f);

export interface InputRowV {
  doc: string;
  title: string;
  from: string;
  /** Consuming discipline ("Import new rev" opens the wizard for it). */
  consumer: Discipline;
  revText: string;
  latestText: string;
  revColor: string;
  state: string;
  stClass: TagClass;
  canConfirm: boolean;
  canImport: boolean;
}
export interface DeliverableRowV {
  id: string;
  title: string;
  date: string;
  by: string;
  rev: string;
  status: string;
  stClass: TagClass;
  toText: string;
  canFreeze: boolean;
  canPropose: boolean;
  proposeBlocked: boolean;
  blockedText: string;
  canValidate: boolean;
}
export interface OutputRowV {
  id: string;
  name: string;
  toText: string;
  source: string;
  /** "Generated today · xlsx" ('' when never generated); see `generatedText`. */
  generated: { on: 'today' | string; format: string } | null;
  state: string;
  stateText: string;
  stClass: TagClass;
  canGen: boolean;
}
export interface CheckRowV {
  id: string;
  title: string;
  detail: string;
  ruleLabel: string;
  ownerLabel: string;
  lead: string;
  note: string;
  sevDot: string;
  sevLabel: string;
  sevClass: TagClass;
  status: string;
  stClass: TagClass;
  color: string;
  canAct: boolean;
}
export interface DisciplineV {
  disc: Discipline;
  head: { icon: string; lead: string; tools: string };
  kpis: KpiV[];
  inputs: InputRowV[];
  docs: DeliverableRowV[];
  outputs: OutputRowV[];
  checks: CheckRowV[];
  chips: { value: CheckFilter; label: string; count: number }[];
  filter: CheckFilter;
}

/** When the list was generated, relative to `todayIso` (Paris day of the real clock — generation is a real action). */
export function generatedOn(generatedAtIso: string | null, format: string | null, todayIso: string, parisDay: (iso: string) => string): OutputRowV['generated'] {
  if (!generatedAtIso) return null;
  const day = parisDay(generatedAtIso);
  return { on: day === todayIso ? 'today' : shortDateOfIso(day), format: format ?? 'xlsx' };
}
/** "Generated today · xlsx" (`gen` 4795) / "Generated 2 Oct · xlsx". */
export const generatedText = (g: OutputRowV['generated']) => (g ? `Generated ${g.on} · ${g.format}` : '');

export interface DisciplineOpts {
  filter?: CheckFilter;
  /** Today's date (ISO) for the generation stamp, and the Paris day of an instant. */
  todayIso?: string;
  parisDay?: (iso: string) => string;
}

/** Values of a discipline screen (`engD`, `engDKpis` 4811, `engDIn`, `engDDocs`, `engDOut`, `engDChk`, `engChkChips`). */
export function disciplineView(reg: EngRegister, disc: Discipline, opts: DisciplineOpts = {}): DisciplineV {
  const filter = opts.filter ?? 'all';
  const today = opts.todayIso ?? '';
  const parisDay = opts.parisDay ?? ((iso: string) => iso.slice(0, 10));
  const d = reg.disciplines.find((x) => x.code === disc);
  const ins = reg.inputs.filter((r) => r.consumer === disc);
  const docs = reg.deliverables.filter((x) => x.discipline === disc);
  const outs = reg.outputs.filter((o) => o.discipline === disc);
  const all = reg.checks.filter((c) => c.owner === disc || c.rulePair.split('-').includes(disc));
  const own = all.filter((c) => c.open && c.owner === disc);
  const ownBlocking = own.filter((c) => c.severity === 'blocking').length;
  const up = ins.filter((r) => !r.outdated).length;
  const rel = docs.filter((x) => x.status === 'released').length;
  const ready = outs.filter((o) => o.state === 'ready').length;
  return {
    disc,
    head: { icon: d?.icon ?? '', lead: d?.lead ?? '', tools: d?.tools ?? '' },
    kpis: [
      { label: 'Inputs up to date', value: `${up} / ${ins.length}`, sub: `${ins.filter((r) => r.state === 'to_confirm').length} to confirm`, color: okLo(up < ins.length) },
      { label: 'Deliverables released', value: `${rel} / ${docs.length}`, sub: `${docs.filter((x) => x.status === 'frozen').length} frozen`, color: ENG_COLOR.text },
      { label: 'Open inconsistencies', value: own.length, sub: `${ownBlocking} blocking`, color: okLo(ownBlocking > 0) },
      { label: 'Outputs ready', value: `${ready} / ${outs.length}`, sub: `${outs.filter((o) => o.state === 'blocked').length} blocked`, color: okLo(ready < outs.length) },
    ],
    inputs: ins.map((r) => ({
      doc: r.documentNumber, title: r.title, from: recipientLabel(r.provider), consumer: r.consumer, revText: `rev ${r.revisionInUse}`, latestText: `rev ${r.latest}`,
      revColor: r.outdated ? ENG_COLOR.lo : ENG_COLOR.text, state: inputState.label(r.state), stClass: r.outdated ? TAG.accent : r.acknowledged ? TAG.neutral : TAG.outline,
      canConfirm: !r.outdated && !r.acknowledged, canImport: r.outdated,
    })),
    docs: docs.map((x) => ({
      id: x.number, title: x.title, date: shortDateOfIso(x.issuedOn), by: x.author, rev: x.revision, status: documentStatus.label(x.status),
      stClass: x.status === 'released' ? TAG.neutral : x.status === 'release_proposed' ? TAG.accent : TAG.outline, toText: recipientsText(x.recipients),
      canFreeze: x.canFreeze, canPropose: x.canPropose, proposeBlocked: x.proposeBlocked, blockedText: `${x.blockingChecks} blocking`, canValidate: x.canValidate,
    })),
    outputs: outs.map((o) => ({
      id: o.number, name: o.name, toText: recipientsText(o.recipients), source: o.source, generated: generatedOn(o.generatedAt, o.generatedFormat, today, parisDay),
      state: outputState.label(o.state), stateText: o.state === 'blocked' ? `Blocked · ${o.blockingChecks} blocking` : outputState.label(o.state),
      stClass: o.state === 'ready' ? TAG.neutral : o.state === 'blocked' ? TAG.accent : TAG.outline, canGen: o.state !== 'blocked',
    })),
    checks: all.filter((c) => matchesFilter(c, filter)).map((c) => ({
      id: c.number, title: c.title, detail: c.detail, ruleLabel: c.ruleLabel, ownerLabel: recipientLabel(c.owner), lead: c.lead, note: c.note, sevDot: sevDot(c.severity),
      sevLabel: checkSeverity.label(c.severity), sevClass: c.severity === 'blocking' ? TAG.accent : c.severity === 'warning' ? TAG.outline : TAG.neutral,
      status: checkStatus.label(c.status), stClass: checkStClass(c.status), color: c.open ? ENG_COLOR.text : ENG_COLOR.n500, canAct: c.open,
    })),
    chips: CHECK_FILTERS.map((value) => ({ value, label: CHECK_FILTER_LABEL[value], count: all.filter((c) => matchesFilter(c, value)).length })).filter(
      (o) => o.value === 'all' || o.count,
    ),
    filter,
  };
}

// ── Import wizard ───────────────────────────────────────────────────────────────────────────────────────

export interface ImportTarget { disc: Discipline; doc: string; tool: number }
export const IMPORT_STEPS = ['Source', 'Column mapping', 'Check & import'] as const;
/** Rows of the (simulated) export file (`engImpVals.file`, stats). */
export const IMPORT_ROWS = 27;

/** The project's instrument list / general arrangement (the prototype's 'LST-INS-026' / 'GA-HLT-026'). */
const docOfType = (reg: EngRegister, prefix: string) => reg.deliverables.find((d) => d.number.startsWith(prefix))?.number ?? null;
/** Tool exporting the document (`openImp`: ENG_TOOLS index of the document's discipline). */
const toolOfDoc = (reg: EngRegister, doc: string) => {
  const disc = reg.deliverables.find((d) => d.number === doc)?.discipline ?? 'process';
  const i = reg.tools.findIndex((t) => t.discipline === disc);
  return i < 0 ? 0 : reg.tools[i].position;
};

/** Body "Import a list" / "Import new rev" (`openImp(disc, doc)` 4793): the tool follows the document. */
export function importTargetFor(reg: EngRegister, disc: Discipline, doc?: string | null): ImportTarget | null {
  const d = doc ?? docOfType(reg, disc === 'process' ? 'GA-' : 'LST-INS-');
  return d ? { disc, doc: d, tool: toolOfDoc(reg, d) } : null;
}

/**
 * Header primary "Import a list" (5137): the synthesis opens the wizard as initially set (Electrical, instrument list,
 * SeeElectrical); each discipline screen presets it (Process: the general arrangement from SolidWorks 3DX; the others:
 * the instrument list from AutoCAD P&ID).
 */
export function primaryImportTarget(reg: EngRegister, screen: EngScreen): ImportTarget | null {
  const ins = docOfType(reg, 'LST-INS-');
  const ga = docOfType(reg, 'GA-');
  if (screen === 'eng') return ins ? { disc: 'elec', doc: ins, tool: 2 } : null;
  if (screen === 'eng-process') return ga ? { disc: 'process', doc: ga, tool: 1 } : null;
  return ins ? { disc: disciplineOfScreen(screen)!, doc: ins, tool: 0 } : null;
}

/**
 * A target from the URL: a known discipline, a deliverable of the register issued by another discipline (inputs are
 * "documents received from other disciplines"; the screens never offer a discipline its own deliverable), a listed tool
 * (else the document's).
 */
export function importTargetOf(reg: EngRegister, disc: string | undefined, doc: string | undefined, tool: string | undefined): ImportTarget | null {
  if (!isDiscipline(disc) || !doc) return null;
  const d = reg.deliverables.find((x) => x.number === doc.trim().toUpperCase());
  if (!d || d.discipline === disc) return null;
  const n = tool != null && /^\d+$/.test(tool) ? parseInt(tool, 10) : NaN;
  return { disc, doc: d.number, tool: reg.tools.some((t) => t.position === n) ? n : toolOfDoc(reg, d.number) };
}

export interface ImportWizardV {
  /** "Instrument list · rev D → Electrical". */
  target: string;
  /** "LST-INS-026_revD.xlsx · 27 rows". */
  file: string;
  revision: string;
  steps: { label: string; n: number; color: string; dot: string }[];
  tools: { position: number; label: string; disc: string; bg: string; border: string; dot: string; selected: boolean }[];
  map: { src: string; dst: string }[];
  stats: { value: number; label: string; color: string }[];
  deltas: { sym: '+' | '~'; label: string; kind: string; color: string }[];
  is1: boolean;
  is2: boolean;
  is3: boolean;
  canBack: boolean;
  canNext: boolean;
}

/** Stepper bubble of step `n` while at `step`: current accent-200, done text, future neutral-500; reached accent-600. */
export const importStepLook = (step: number, n: number) => ({
  color: step === n ? ENG_COLOR.accent200 : step > n ? ENG_COLOR.text : ENG_COLOR.n500,
  dot: step >= n ? 'var(--color-accent-600)' : 'var(--color-neutral-700)',
});
/** Source-tool choice: selected = accent-900 ground, accent-700 border, filled accent dot. */
export const importToolLook = (on: boolean) => ({
  bg: on ? 'var(--color-accent-900)' : ENG_COLOR.transparent,
  border: on ? ENG_COLOR.accent700 : ENG_COLOR.n800,
  dot: on ? ENG_COLOR.accent : ENG_COLOR.transparent,
});

/** Wizard values (`engImpVals` 4813) for a target at a step (1–3) with a selected tool. */
export function importWizardView(reg: EngRegister, target: ImportTarget, step: number): ImportWizardV {
  const doc = reg.deliverables.find((d) => d.number === target.doc);
  const newCount = reg.deltas.filter((d) => d.kind === 'new').length;
  const changed = reg.deltas.filter((d) => d.kind === 'changed').length;
  return {
    target: `${doc ? `${doc.title} · rev ${doc.revision}` : target.doc} → ${recipientLabel(target.disc)}`,
    file: `${target.doc}_rev${doc?.revision ?? ''}.xlsx · ${IMPORT_ROWS} rows`,
    revision: doc?.revision ?? '',
    steps: IMPORT_STEPS.map((label, i) => ({ label, n: i + 1, ...importStepLook(step, i + 1) })),
    tools: reg.tools.map((t) => {
      const on = t.position === target.tool;
      return { position: t.position, label: t.label, disc: recipientLabel(t.discipline), ...importToolLook(on), selected: on };
    }),
    map: reg.mappings.map((m) => ({ src: m.sourceColumn, dst: m.targetField })),
    stats: [
      { value: IMPORT_ROWS, label: 'rows', color: ENG_COLOR.text },
      { value: newCount, label: 'new tags', color: newCount ? ENG_COLOR.lo : ENG_COLOR.text },
      { value: changed, label: 'attribute changed', color: changed ? ENG_COLOR.lo : ENG_COLOR.text },
      { value: 0, label: 'unknown references', color: ENG_COLOR.text },
    ],
    deltas: reg.deltas.map((d) => ({
      sym: d.kind === 'new' ? '+' : '~', label: d.label, kind: d.kind === 'new' ? 'new tag' : 'attribute changed', color: d.kind === 'new' ? ENG_COLOR.lo : ENG_COLOR.text,
    })),
    is1: step === 1,
    is2: step === 2,
    is3: step === 3,
    canBack: step > 1,
    canNext: step < 3,
  };
}

// ── Sidebar badges ──────────────────────────────────────────────────────────────────────────────────────

/** Open blocking checks (Synthesis) and those owned by each discipline (`engNav_` 4815); '' when none or no register. */
export function engBadges(counts: Partial<Record<Discipline | 'total', number>> | null | undefined): Record<EngScreen, string> {
  const s = (n: number | undefined) => (n ? String(n) : '');
  return {
    eng: s(counts?.total),
    'eng-process': s(counts?.process),
    'eng-meca': s(counts?.meca),
    'eng-elec': s(counts?.elec),
    'eng-auto': s(counts?.auto),
  };
}

/** Badge counts of a register. */
export const blockingCounts = (reg: EngRegister | null): Record<Discipline | 'total', number> | null =>
  reg ? { total: openBlocking(reg.checks), process: openBlocking(reg.checks, 'process'), meca: openBlocking(reg.checks, 'meca'), elec: openBlocking(reg.checks, 'elec'), auto: openBlocking(reg.checks, 'auto') } : null;
