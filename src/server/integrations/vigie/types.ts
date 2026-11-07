// Types of the Vigie ECO integration: the record Vigie sends (wire format of the mirror refresh), the read model the
// connector returns (mirror + progress not yet acknowledged by Vigie) and the progress Keystone records.
import type {
  EcoApproverKey, EcoDecision, EcoDisposition, EcoProgressKind, EcoStatus, EcoTargetType, EcoType, HseItemKind, HseStatus, Interchangeability, NcrProgressKind,
  NcrSeverity, NcrSource, NcrStatus, NcrVerificationDecision, VigieRequestOutcome, VigieResultCode, VigieSyncStatus,
} from '@/server/db/codes';

/** An ECO as Vigie publishes it (D12: vigie.pub_ordres_modification, pub_eco_approbations, pub_eco_effectivite). */
export interface VigieEcoRecord {
  number: string;
  title: string;
  type: EcoType;
  status: EcoStatus;
  interchangeability: Interchangeability | null;
  fromRevision: string;
  toRevision: string;
  costEur: number;
  scheduleDays: number;
  stockImpact: string;
  documentRefs: string[];
  requestedBy: string;
  /** ISO date. */
  raisedOn: string;
  pendingDispositions: number;
  locked: boolean;
  /** Catalogue references. */
  parts: string[];
  /** Keystone project codes ("HLT-026"). */
  projects: string[];
  approvals: { key: EcoApproverKey; decision: EcoDecision; approver: string; decidedBy: string | null; decidedAt: string | null }[];
  effectivity: {
    targetType: EcoTargetType;
    targetRef: string;
    label: string;
    disposition: EcoDisposition | null;
    isAutomatic: boolean;
    note: string | null;
    fittedPartRef: string | null;
    fittedRevision: string | null;
  }[];
  /** ISO timestamp of the last change in Vigie, when known. */
  updatedAt: string | null;
  /** ISO timestamp of the release in Vigie (D12, pub_ordres_modification.released_at), when published. */
  releasedAt?: string | null;
}

/** What Vigie's processing of a deposited request gave (D12 / D13, vigie.pub_demandes_recues); all null until read. */
export interface VigieRequestFields {
  /** Vigie's request number, returned by its pub_signaler_avancement_* function. */
  vigieRef: string | null;
  outcome: VigieRequestOutcome | null;
  resultCode: VigieResultCode | null;
  /** Vigie's message (the reason of a refusal). */
  result: string | null;
}

/** Progress recorded in Keystone, waiting for (or delivered to) Vigie. */
export interface EcoProgressEntry extends VigieRequestFields {
  id: string;
  ecoNumber: string;
  kind: EcoProgressKind;
  approvalKey: EcoApproverKey | null;
  decision: Exclude<EcoDecision, 'pending'> | null;
  targetStatus: EcoStatus | null;
  fromStatus: EcoStatus;
  comment: string | null;
  actorName: string;
  actorRole: string;
  /** ISO timestamp. */
  recordedAt: string;
  syncStatus: VigieSyncStatus;
  attempts: number;
  lastError: string | null;
}

export interface VigieEcoApproval {
  key: EcoApproverKey;
  /** Decision as Vigie last reported it. */
  decision: EcoDecision;
  approver: string;
  decidedBy: string | null;
  decidedAt: string | null;
  /** Decision recorded in Keystone and not yet reflected by Vigie ("pending sync with Vigie"); null when none (a refused one is not). */
  pending: EcoProgressEntry | null;
}

export type VigieEcoTarget = VigieEcoRecord['effectivity'][number];

/** Read model: the mirror row with the progress recorded in Keystone since the last refresh. */
export interface VigieEco {
  number: string;
  title: string;
  type: EcoType;
  /** Status as Vigie last reported it (a step advancement recorded in Keystone shows in `requestedStatus`). */
  status: EcoStatus;
  interchangeability: Interchangeability | null;
  fromRevision: string;
  toRevision: string;
  costEur: number;
  scheduleDays: number;
  stockImpact: string;
  documentRefs: string[];
  requestedBy: string;
  raisedOn: string;
  pendingDispositions: number;
  locked: boolean;
  parts: string[];
  projects: string[];
  approvals: VigieEcoApproval[];
  effectivity: VigieEcoTarget[];
  /** Step advancement recorded in Keystone, pending sync with Vigie; null when none. */
  requestedStatus: EcoStatus | null;
  /**
   * Progress entries not yet reflected by the mirror (oldest first): waiting ones (pending, sent and not processed), and the
   * latest entry when it failed or Vigie refused it, while the ECO is still where it was (so the refusal shows).
   */
  pendingProgress: EcoProgressEntry[];
  /** ISO timestamp of the last refresh from Vigie. */
  lastSyncedAt: string;
  /** The ECO in Vigie (links.ts). */
  vigieUrl: string;
}

/** What the viewer records: their decision on their approval key, or a step advancement. */
export type EcoProgressInput =
  | { key: EcoApproverKey; decision: 'ok' | 'rejected'; comment?: string | null }
  | { step: EcoStatus; comment?: string | null };

/** The viewer recording the progress (actors follow the viewer). */
export interface EcoProgressActor {
  /** Full name ("Romain Aubert"). */
  name: string;
  /** Role key of the "View as" persona. */
  role: string;
}

export interface EcoProgressReceipt {
  id: string;
  ecoNumber: string;
  kind: EcoProgressKind;
  syncStatus: VigieSyncStatus;
  recordedAt: string;
}

export interface EcoListFilter {
  /** ECOs affecting any of these parts. */
  partRefs?: string[];
  /** ECOs declared for any of these projects. */
  projectCodes?: string[];
  numbers?: string[];
}

/** The ECO connector (mock over the local mirror, or Vigie's views and function on the shared server). */
export interface VigieEcoConnector {
  readonly mode: 'mock' | 'sql';
  /** ECOs relevant to Keystone, in Vigie's order (filtered when asked). */
  listEcos(filter?: EcoListFilter): Promise<VigieEco[]>;
  getEco(number: string): Promise<VigieEco | null>;
  /** Validates and records progress in the outbox, then tries to deposit it in Vigie (sql mode). */
  recordProgress(number: string, input: EcoProgressInput, actor: EcoProgressActor): Promise<EcoProgressReceipt>;
  /** Deposits the outbox, reads the outcome of the requests and refreshes the mirror (no-op for the mock). */
  sync(): Promise<{ delivered: number; failed: number; pending: number; refreshed: number }>;
}

// ── Non-conformities (NCR) and site HSE — Vigie owns them (user decision, Delivery 5) ──────────────────

/** An NCR as Vigie publishes it (D13: vigie.pub_non_conformites). */
export interface VigieNcrRecord {
  /** Keystone project code ("HLT-026"). */
  projectCode: string;
  /**
   * The NCR's number: Vigie's EV-… reference (D13, CV-07: pub_non_conformites.number = vigie_ref, "EV-2026-130", unique).
   * Keystone never sends NCR numbers of its own (R-023); the demo data use EV-… references too (demoNcrNumber).
   */
  number: string;
  /** Vigie's own record id ("EV-2026-130") when Vigie gives it. */
  vigieRef: string | null;
  title: string;
  severity: NcrSeverity;
  source: NcrSource;
  status: NcrStatus;
  activityCode: string | null;
  partRef: string | null;
  deliverableNumber: string | null;
  supplierName: string | null;
  /** ITP inspection the NCR was reported from ("I-03"), when Vigie echoes Keystone's `inspection` prefill (R-112, V-3). */
  inspectionNumber?: string | null;
  raisedBy: string;
  /** ISO date. */
  raisedOn: string;
  owner: string;
  rootCause: string;
  action: string;
  /** ISO date; null = "—". */
  dueOn: string | null;
  costKeur: number;
  isoClause: string;
  updatedAt: string | null;
  /** D13 share: closure date in Vigie, the Cursus matricule of the owner, the supplier (suppliers.id) of a supplier NCR. */
  closedOn?: string | null;
  ownerMatricule?: string | null;
  supplierId?: string | null;
}

/** Progress recorded in Keystone on a Vigie NCR. */
export interface NcrProgressEntry extends VigieRequestFields {
  id: string;
  projectCode: string;
  ncrNumber: string;
  kind: NcrProgressKind;
  decision: NcrVerificationDecision | null;
  fromStatus: NcrStatus;
  targetStatus: NcrStatus;
  comment: string | null;
  actorName: string;
  actorRole: string;
  recordedAt: string;
  syncStatus: VigieSyncStatus;
  attempts: number;
  lastError: string | null;
}

/** Read model: the NCR as Vigie last reported it, with the progress recorded in Keystone since. */
export interface VigieNcr extends Omit<VigieNcrRecord, 'updatedAt'> {
  /** Status requested in Keystone and pending sync with Vigie (last pending entry); null when none. */
  requestedStatus: NcrStatus | null;
  pendingProgress: NcrProgressEntry[];
  lastSyncedAt: string;
  /** The NCR in Vigie (links.ts). */
  vigieUrl: string;
}

/** What the viewer records: one step forward, or the quality verification (approve → Closed, reject → Corrective action). */
export type NcrProgressInput =
  | { step: NcrStatus; comment?: string | null }
  | { verification: NcrVerificationDecision; comment?: string | null };

export interface NcrProgressReceipt {
  id: string;
  projectCode: string;
  ncrNumber: string;
  kind: NcrProgressKind;
  targetStatus: NcrStatus;
  syncStatus: VigieSyncStatus;
  recordedAt: string;
}

export interface NcrListFilter {
  projectCodes?: string[];
  /** NCRs on these parts. */
  partRefs?: string[];
}

/** A site HSE register item as Vigie publishes it (D13: vigie.pub_hse_projet — prevention plan, permit, near-miss register). */
export interface VigieHseRecord {
  projectCode: string;
  /** Vigie's id ("PP-2026-013", "PF-2026-030") when known. */
  vigieRef: string | null;
  kind: HseItemKind;
  title: string;
  status: HseStatus;
  /** Free status text when Vigie gives one ("0 déclaré"). */
  statusText: string | null;
  /** ISO date; null = "—". */
  dateOn: string | null;
}

export interface VigieHseItem extends VigieHseRecord {
  lastSyncedAt: string;
  vigieUrl: string;
}

/** The quality / HSE connector (mock over the local mirrors, or Vigie's views and function on the shared server). */
export interface VigieQualityConnector {
  readonly mode: 'mock' | 'sql';
  listNcrs(filter?: NcrListFilter): Promise<VigieNcr[]>;
  getNcr(projectCode: string, number: string): Promise<VigieNcr | null>;
  /** Validates and records the viewer's progress in the outbox, then tries to deposit it in Vigie (sql mode). */
  recordNcrProgress(projectCode: string, number: string, input: NcrProgressInput, actor: EcoProgressActor): Promise<NcrProgressReceipt>;
  listHse(projectCode: string): Promise<VigieHseItem[]>;
  /** Deposits the NCR outbox, reads the outcome of the requests and refreshes the NCR and HSE mirrors (no-op for the mock). */
  sync(): Promise<{ delivered: number; failed: number; pending: number; refreshed: number }>;
}
