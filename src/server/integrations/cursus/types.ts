// Types of the Cursus integration: what Cursus reports (its real Go / No Go payload and the mirror record), the read
// model the connector returns and what Keystone sends (reminders, travel requests).
import type { CursusClearance, CursusRequestKind, CursusSyncStatus, CursusVaccination, CursusVerdict, CursusVisa } from '@/server/db/codes';

/**
 * Cursus's answer to GET /api/integrations/keystone/chantiers/:id/go-no-go (Cursus shared/domain.ts `keystonePayload`):
 * matricules and reason codes only; reason labels when Cursus shares the detailed mode.
 */
export interface CursusGoNoGoPayload {
  chantier: string;
  evalue_le: string;
  statut: 'GO' | 'GO_RESERVE' | 'NO_GO';
  ressources: { matricule: string; statut: 'GO' | 'GO_RESERVE' | 'NO_GO'; motifs: (string | { code: string; libelle: string })[] }[];
}

/** One person's approvals as the mirror stores them (SITE_DOCS shape, no personal data). */
export interface CursusClearanceRecord {
  projectCode: string;
  chantierId: string | null;
  matricule: string | null;
  personName: string;
  visa: CursusVisa;
  vaccination: CursusVaccination;
  clearance: CursusClearance;
  clearanceNote: string;
  verdict: CursusVerdict;
  reasonCodes: string[];
  /** ISO timestamp of Cursus's verdict. */
  receivedAt: string;
}

/** Read model of a person's go / no go, with what Keystone sent to Cursus about them. */
export interface CursusClearanceView extends CursusClearanceRecord {
  id: string;
  /** A reminder was sent from Keystone ("Reminder sent"); its delivery state. */
  reminded: boolean;
  reminderSyncStatus: CursusSyncStatus | null;
  lastSyncedAt: string;
}

export interface CursusGoNoGo {
  projectCode: string;
  chantierId: string | null;
  /** Overall verdict: NO GO when anyone is NO GO, GO with reserve when anyone has a reserve, else GO (Cursus's rule). */
  verdict: CursusVerdict | null;
  people: CursusClearanceView[];
  /** Last refresh from Cursus (ISO); null when nothing was ever received. */
  lastSyncedAt: string | null;
}

export interface CursusActor {
  name: string;
  role: string;
}

export interface CursusTravelRequestInput {
  personName: string;
  /** Cursus destination code (country, "MA"). */
  destination: string;
  /** ISO dates. */
  depart: string;
  retour: string;
}

export interface CursusRequestReceipt {
  id: string;
  kind: CursusRequestKind;
  personName: string;
  syncStatus: CursusSyncStatus;
  recordedAt: string;
}

/** The Cursus connector (mock over the local mirror, or HTTP to Cursus). */
export interface CursusConnector {
  readonly mode: 'mock' | 'http';
  /** The people Go / No Go of a project's site (refreshed from Cursus in HTTP mode). */
  getGoNoGo(projectCode: string): Promise<CursusGoNoGo>;
  /** "Sync Cursus": refreshes the project's verdicts (HTTP) and delivers the outbox; returns the approvals received. */
  sync(projectCode: string): Promise<{ received: number; delivered: number; failed: number; pending: number }>;
  /** "Remind in Cursus" on a person whose verdict is not GO (one reminder per person). */
  remind(projectCode: string, personName: string, actor: CursusActor): Promise<CursusRequestReceipt>;
  /** Travel request for a person of the site (Cursus POST /api/integrations/keystone/demandes). */
  requestTravel(projectCode: string, input: CursusTravelRequestInput, actor: CursusActor): Promise<CursusRequestReceipt>;
}
