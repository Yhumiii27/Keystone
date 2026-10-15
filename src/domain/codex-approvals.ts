// Codex approval circuits seen from Keystone (Delivery 7: P-7b = a, D-1b = a, P-7c = a; R-124, R-106). Codex owns the
// documents, their circuits and their status; the named approver decides in Keystone (document drawer, My approvals)
// and the decision goes to Codex through an outbox, "pending sync with Codex", as Vigie's ECO decisions do. Keystone
// never rewrites the mirrored status or approval proof: it shows its own decisions over them until Codex answers.
// An engineering deliverable's circuit starts with the PM's "Validate release (PM)", itself sent to Codex; the
// deliverable is Released once Codex has every step approved. Pure: fed by the DAL (src/server/dal/documents.ts).
import {
  DISCIPLINES, codexSyncStatus, type CodexDecision, type CodexOutboxKind, type CodexSyncStatus, type DocumentStatus,
} from '@/server/db/codes';
import { QMS } from './documents';

export type { CodexDecision, CodexOutboxKind, CodexSyncStatus };

/** An open outbox entry of a document (not yet reflected by Codex). */
export interface CodexEntryLike {
  kind: CodexOutboxKind;
  revision: string;
  /** Approval: the step decided (1…); null for a circuit start. */
  stepPosition: number | null;
  decision: CodexDecision | null;
  syncStatus: CodexSyncStatus;
  /** Who recorded it ("Gabriel Comte"). */
  actorName: string;
  /** ISO instant of the recording. */
  recordedAt: string;
}

export interface CircuitInput {
  status: DocumentStatus;
  /** Current revision of the index record. */
  revision: string;
  /** Circuit steps, the originator (step 0) included. */
  steps: number;
  /** Steps after the originator that Codex reports signed (the mirrored approval proof). */
  signed: readonly number[];
  /** Open outbox entries of the document, any revision (entries of another revision are ignored). */
  entries: readonly CodexEntryLike[];
  /** Engineering deliverable: the circuit starts with the PM's "Validate release (PM)" (P-7c). */
  needsStart: boolean;
}

export interface KeystoneDecision {
  step: number;
  decision: CodexDecision;
  actorName: string;
  recordedAt: string;
  syncStatus: CodexSyncStatus;
}

export interface CircuitState {
  /** The circuit runs: not an engineering deliverable, or the PM's validation was recorded / Codex already signed a step. */
  started: boolean;
  /** The PM's circuit start waits for Codex (no step signed yet). */
  startPending: KeystoneDecision | null;
  /** Steps approved in Keystone and not yet signed in Codex, in step order. */
  approved: KeystoneDecision[];
  /** A rejection recorded in Keystone and not yet applied by Codex: the circuit stops until Codex answers. */
  rejection: KeystoneDecision | null;
  /** First step after the originator open for a decision; null when none (not proposed, not started, rejected, all decided). */
  nextStep: number | null;
  /** Every step signed in Codex or approved in Keystone, at least one waiting for Codex: Codex releases on sync. */
  releaseRequested: boolean;
  /** Delivery state of the entries shown: failed before pending before sent; null when there are none. */
  sync: CodexSyncStatus | null;
}

const SYNC_ORDER: readonly CodexSyncStatus[] = ['failed', 'pending', 'sent'];
const worst = (xs: readonly CodexSyncStatus[]): CodexSyncStatus | null => SYNC_ORDER.find((s) => xs.includes(s)) ?? null;
const decisionOf = (e: CodexEntryLike, step: number): KeystoneDecision => ({
  step, decision: e.decision ?? 'approved', actorName: e.actorName, recordedAt: e.recordedAt, syncStatus: e.syncStatus,
});

/**
 * The circuit as Keystone shows it: Codex's signed steps, then the decisions recorded in Keystone that Codex has not
 * applied yet. Only a record in Release proposed has an open circuit; entries of another revision are stale.
 */
export function codexCircuitState(input: CircuitInput): CircuitState {
  const none: CircuitState = {
    started: input.status === 'released' || input.status === 'obsolete', startPending: null, approved: [], rejection: null, nextStep: null,
    releaseRequested: false, sync: null,
  };
  if (input.status !== 'release_proposed') return none;
  const signed = new Set(input.signed.filter((p) => p > 0));
  const entries = input.entries.filter((e) => e.revision === input.revision);
  const start = entries.find((e) => e.kind === 'circuit_start') ?? null;
  const started = !input.needsStart || signed.size > 0 || !!start;
  const approved: KeystoneDecision[] = [];
  let rejection: KeystoneDecision | null = null;
  for (const e of entries) {
    if (e.kind !== 'approval' || e.stepPosition == null || e.stepPosition < 1 || e.stepPosition >= input.steps || signed.has(e.stepPosition)) continue;
    if (e.decision === 'rejected') rejection ??= decisionOf(e, e.stepPosition);
    else if (!approved.some((a) => a.step === e.stepPosition)) approved.push(decisionOf(e, e.stepPosition));
  }
  approved.sort((a, b) => a.step - b.step);
  const startPending = start && signed.size === 0 ? decisionOf(start, 0) : null;
  let nextStep: number | null = null;
  if (started && !rejection)
    for (let p = 1; p < input.steps; p++)
      if (!signed.has(p) && !approved.some((a) => a.step === p)) {
        nextStep = p;
        break;
      }
  const shown = [...approved, ...(rejection ? [rejection] : []), ...(startPending ? [startPending] : [])];
  return {
    started, startPending, approved, rejection, nextStep, releaseRequested: started && !rejection && input.steps > 1 && nextStep === null && approved.length > 0,
    sync: worst(shown.map((d) => d.syncStatus)),
  };
}

/** "Pending sync with Codex" / "Sent to Codex" / "Sync with Codex failed". */
export const codexSyncText = (s: CodexSyncStatus) => codexSyncStatus.label(s);

/**
 * Line under the status of a record in Release proposed (EN source), or null: the PM's validation awaited, the
 * Keystone decisions waiting for Codex, or the circuit running in Codex (engineering deliverables only).
 */
export function circuitNoteText(state: CircuitState, needsStart: boolean, status: DocumentStatus): string | null {
  if (status !== 'release_proposed') return null;
  if (needsStart && !state.started) return 'Awaiting PM validation';
  const sync = codexSyncText(state.sync ?? 'pending');
  if (state.rejection) return `Rejected · ${sync}`;
  if (state.releaseRequested) return `Release approved · ${sync}`;
  if (state.approved.length) return `Approved · ${sync}`;
  if (state.startPending) return `Approval circuit started · ${sync}`;
  return needsStart ? 'Approval circuit in progress in Codex' : null;
}

/** Engineering deliverable of a project (`ENG_DOCS`): a discipline's record distributed to other services. */
export function isEngineeringDeliverable(d: { project: string; service: string; recipients: readonly string[] }): boolean {
  return d.project !== QMS && (DISCIPLINES as readonly string[]).includes(d.service) && d.recipients.length > 0;
}

/** Reason of a rejection: required (the author revises the document from it), at most 1000 characters. */
export const CODEX_REJECT_COMMENT_MAX = 1000;
export function parseRejectComment(v: unknown): { ok: true; value: string } | { ok: false; error: string } {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!s) return { ok: false, error: 'Give the reason for the rejection' };
  if (s.length > CODEX_REJECT_COMMENT_MAX) return { ok: false, error: 'The reason is too long' };
  return { ok: true, value: s };
}

/** Toast of a decision: "RPT-HLT-014 · Approved · Pending sync with Codex". */
export const codexDecisionToast = (number: string, decision: CodexDecision, sync: CodexSyncStatus) =>
  `${number} · ${decision === 'approved' ? 'Approved' : 'Rejected'} · ${codexSyncText(sync)}`;

/** Toast of a circuit start: "SCH-ELE-026 · Approval circuit started · Pending sync with Codex". */
export const circuitStartToast = (number: string, sync: CodexSyncStatus) => `${number} · Approval circuit started · ${codexSyncText(sync)}`;
