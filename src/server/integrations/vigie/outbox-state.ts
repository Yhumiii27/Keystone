// State of the progress Keystone records on Vigie's ECOs and NCRs (outboxes vigie_eco_progress, vigie_ncr_progress), shared by both
// mirrors (D12, D13). Pure: no database.
//
// An entry is deposited in Vigie by its pub_signaler_avancement_* function (sync `sent`, Vigie's request number kept), then Vigie
// processes it within minutes; its outcome is read in vigie.pub_demandes_recues (applied, or rejected = sync `refused`). A function
// error P0V01 / P0V02 makes the entry `failed` (never sent again as is); any other failure keeps it `pending` with its last error.
import type { VigieRequestOutcome, VigieSyncStatus } from '@/server/db/codes';
import type { VigieRequestState } from '@/domain/vigie-views';

/** The fields of an outbox row the state rules read. */
export interface OutboxRowState {
  syncStatus: VigieSyncStatus;
  recordedAt: Date;
  vigieOutcome: VigieRequestOutcome | null;
  kind: string;
  fromStatus: string;
}

/**
 * Still waiting for Vigie (shown as requested, blocks a second request): not deposited yet; deposited and not processed
 * (`received`); deposited after the row's last refresh (the old rule, also when the request states cannot be read). A
 * verification proposal Vigie accepted stays waiting while the NCR is still in Verification (`held`, D13: Vigie's QHSE closes or
 * sends the NCR back itself).
 */
export function isWaiting(e: OutboxRowState, lastSyncedAt: Date, held = false): boolean {
  if (e.syncStatus === 'pending') return true;
  if (e.syncStatus !== 'sent') return false;
  if (e.vigieOutcome === 'received') return true;
  if (held && e.vigieOutcome === 'applied') return true;
  return e.vigieOutcome !== 'applied' && e.recordedAt.getTime() > lastSyncedAt.getTime();
}

/**
 * Shown on the record: the waiting entries, and the latest entry when it failed or Vigie refused it while the record is still
 * where the entry left it (the refusal is visible until something else happens; it never blocks a new request).
 */
export function shownEntries<T extends OutboxRowState>(entries: readonly T[], lastSyncedAt: Date, status: string, held: (e: T) => boolean = () => false): T[] {
  const last = entries.at(-1);
  return entries.filter((e) =>
    isWaiting(e, lastSyncedAt, held(e)) || (e === last && (e.syncStatus === 'failed' || e.syncStatus === 'refused') && e.fromStatus === status));
}

/** SQLSTATE of a database error (the driver's error, or the cause Drizzle wraps it in). */
export function sqlStateOf(e: unknown): string | null {
  for (let x: unknown = e, i = 0; x && typeof x === 'object' && i < 4; x = (x as { cause?: unknown }).cause, i++) {
    const code = (x as { code?: unknown }).code;
    if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) return code;
  }
  return null;
}

/** The message of a database error (the driver's own when Drizzle wraps it: "Failed query: …" hides it). */
export function sqlMessageOf(e: unknown): string {
  for (let x: unknown = e, i = 0; x && typeof x === 'object' && i < 4; x = (x as { cause?: unknown }).cause, i++)
    if (typeof (x as { code?: unknown }).code === 'string' && typeof (x as { message?: unknown }).message === 'string') return (x as { message: string }).message;
  return e instanceof Error ? e.message : String(e);
}

/** Vigie's function refused the arguments or the caller (P0V01 caller not admitted, P0V02 invalid argument): never resent as is. */
export const isPermanentVigieError = (e: unknown): boolean => {
  const s = sqlStateOf(e);
  return s === 'P0V01' || s === 'P0V02';
};

/** The outcome update of an outbox entry from the state Vigie published (null = nothing new). */
export function outcomeUpdate(current: { vigieOutcome: VigieRequestOutcome | null; syncStatus: VigieSyncStatus }, st: VigieRequestState) {
  if (current.syncStatus !== 'sent' || current.vigieOutcome === st.outcome) return null;
  return {
    syncStatus: (st.outcome === 'rejected' ? 'refused' : 'sent') as VigieSyncStatus,
    vigieOutcome: st.outcome, vigieResultCode: st.resultCode, vigieResult: st.result, vigieProcessedAt: st.processedAt ? new Date(st.processedAt) : null,
  };
}
