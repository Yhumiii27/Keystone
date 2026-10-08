// Types of the Vigie ECO integration: the record Vigie sends (wire format of the mirror refresh), the read model the
// connector returns (mirror + progress not yet acknowledged by Vigie) and the progress Keystone records.
import type {
  EcoApproverKey, EcoDecision, EcoDisposition, EcoProgressKind, EcoStatus, EcoTargetType, EcoType, Interchangeability, VigieSyncStatus,
} from '@/server/db/codes';

/** An ECO as Vigie reports it (OPEN QUESTION V-2: Vigie's API payload; this is the shape the mirror needs). */
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
}

/** Progress recorded in Keystone, waiting for (or delivered to) Vigie. */
export interface EcoProgressEntry {
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
  /** Decision recorded in Keystone and not yet reflected by Vigie ("pending sync with Vigie"); null when none. */
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
  /** Progress entries not yet reflected by the mirror (oldest first). */
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

/** The ECO connector (mock over the local mirror, or HTTP to Vigie). */
export interface VigieEcoConnector {
  readonly mode: 'mock' | 'http';
  /** ECOs relevant to Keystone, in Vigie's order (filtered when asked). */
  listEcos(filter?: EcoListFilter): Promise<VigieEco[]>;
  getEco(number: string): Promise<VigieEco | null>;
  /** Validates and records progress in the outbox, then tries to deliver it (HTTP mode). */
  recordProgress(number: string, input: EcoProgressInput, actor: EcoProgressActor): Promise<EcoProgressReceipt>;
  /** Delivers the outbox and refreshes the mirror (no-op for the mock: Vigie has no API yet). */
  sync(): Promise<{ delivered: number; failed: number; pending: number; refreshed: number }>;
}
