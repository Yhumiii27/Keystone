import 'server-only';
// Cursus connector (user decision, Delivery 5). Cursus owns individual site clearances and the people Go / No Go per
// site; Keystone shows them on the Site screen, opens Cursus (links.ts) and sends reminders and travel requests.
// Cursus's contract, version 1 (authoritative: Cursus docs/API-KEYSTONE.md and docs/keystone-openapi.json; the routes without
// /v1 are deprecated there):
//   GET  /api/integrations/keystone/v1/chantiers/:id/go-no-go → { chantier, evalue_le, statut, ressources: [{ matricule, statut,
//                                                             motifs: [{ code, niveau, libelle? }] }] }
//   POST /api/integrations/keystone/v1/demandes              { reference, matricule, chantier, destination?, depart, retour }
//                                                             → 201 { resultat: "cree", demande: { id, …, statut } }; a retry
//                                                             → 409 DEMANDE_EN_DOUBLE with the request already recorded (`demande`)
//   GET  /api/integrations/keystone/annuaire                 → [{ matricule, nom, prenom, email, equipe }]  TODO(cursus): Keystone's
//                                                             proposal (R-027) — Cursus has NO such route (off by default, CURSUS_DIRECTORY)
//   header X-Api-Key (Cursus's KEYSTONE_API_KEY, "demo-keystone" by default)
// What Cursus pushes to Keystone (POST /api/cursus/v1/evenements, R-029) is received by ./events.ts and ./inbox.ts.
// Two implementations behind one interface:
// - mock (default; tests and the default run never need Cursus): the local mirror seeded from the prototype's SITE_DOCS;
//   reminders and travel requests wait in the outbox ("pending sync with Cursus");
// - http (CURSUS_API_URL set): refreshes the mirror from the go-no-go endpoint and delivers travel requests. Cursus has
//   no reminder endpoint: reminders stay pending (TODO(cursus), OPEN QUESTION C-2).
import { and, eq, inArray } from 'drizzle-orm';
import { directoryEntryOf } from '@/domain/directory';
import { cursusSyncStatus, inWorkspace, type CursusClearance, type CursusVerdict } from '@/server/db/codes';
import { businessToday } from '@/server/clock';
import { getDb } from '@/server/db/client';
import { CURSUS_CONNECTOR_NAME, connectorEnabled } from '@/server/integrations/connector-enabled';
import { findPerson, nameOf, recordActivity, writeAudit } from '@/server/db/helpers';
import { cursusClearances, cursusRequests, persons, projects, siteSheets } from '@/server/db/schema';
import type { Tx } from '@/server/db/types';
import { logWarning } from '@/server/log';
import { cursusApiKey, cursusApiUrl, cursusConnectorMode } from './connection';
import { claimRequestDelivery, markRequestDelivery, readClearances, recordFailedSync, undeliveredRequests, upsertClearances } from './mirror';
import type {
  CursusActor, CursusClearanceRecord, CursusConnector, CursusDirectoryPayload, CursusGoNoGo, CursusGoNoGoPayload, CursusRequestReceipt, CursusTravelRequestInput,
} from './types';

export type {
  CursusActor, CursusClearanceView, CursusConnector, CursusDirectoryPayload, CursusGoNoGo, CursusRequestReceipt, CursusTravelRequestInput,
} from './types';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

async function chantierOf(tx: Tx, projectCode: string): Promise<{ projectId: string; chantierId: string | null }> {
  const [p] = await tx.select({ id: projects.id }).from(projects).where(eq(projects.code, projectCode));
  if (!p) throw new Error(`Unknown project ${projectCode}`);
  const [s] = await tx.select({ c: siteSheets.cursusChantierId }).from(siteSheets).where(eq(siteSheets.projectId, p.id));
  return { projectId: p.id, chantierId: s?.c ?? null };
}

async function queue(
  projectCode: string, kind: 'reminder' | 'travel_request', personName: string, payload: Record<string, unknown>, actor: CursusActor,
): Promise<CursusRequestReceipt> {
  if (!inWorkspace('site', actor.role)) throw new Error('Site is outside your workspace');
  const db = await getDb();
  // R-013: the request is dated on the business date (the prototype's status date).
  const requestedOn = await businessToday();
  return db.transaction(async (tx) => {
    const { projectId } = await chantierOf(tx, projectCode);
    const [row] = await tx.select().from(cursusClearances).where(and(eq(cursusClearances.projectCode, projectCode), eq(cursusClearances.personName, personName)));
    if (!row) throw new Error(`${personName} is not mobilised on ${projectCode} in Cursus`);
    if (kind === 'reminder') {
      if (row.verdict === 'go') throw new Error(`${personName} is GO: nothing to remind`);
      const [already] = await tx.select({ id: cursusRequests.id }).from(cursusRequests)
        .where(and(eq(cursusRequests.projectCode, projectCode), eq(cursusRequests.personName, personName), eq(cursusRequests.kind, 'reminder')));
      if (already) throw new Error(`A reminder was already sent for ${personName}`);
    }
    const person = await findPerson(tx, actor.name);
    const who = person ? nameOf(person) : actor.name;
    const at = new Date();
    const [r] = await tx.insert(cursusRequests).values({
      projectCode, kind, personName, matricule: row.matricule, clearanceId: row.id, payload, actorName: who, actorPersonId: person?.id ?? null, actorRole: actor.role,
      recordedAt: at, requestedOn, syncStatus: 'pending',
    }).returning();
    const label = kind === 'reminder' ? `Reminder sent via Cursus · ${personName}` : `Travel request sent to Cursus · ${personName}`;
    await writeAudit(tx, {
      actorName: who, actorPersonId: person?.id, objectRef: `Cursus · ${personName}`, change: `${kind === 'reminder' ? 'reminder' : 'travel request'} · ${cursusSyncStatus.label('pending')}`,
      area: 'Site', entityType: 'cursus_request', entityId: r.id, projectId,
    });
    await recordActivity(tx, { actorName: who, actorPersonId: person?.id, text: label, kind: 'sync', projectId });
    return { id: r.id, kind, personName, syncStatus: r.syncStatus, recordedAt: r.recordedAt.toISOString() };
  });
}

function travelPayload(input: CursusTravelRequestInput): Record<string, unknown> {
  const destination = input.destination?.trim().toUpperCase();
  if (!destination || !/^[A-Z]{2}$/.test(destination)) throw new Error('Destination must be a country code (e.g. MA)');
  if (!ISO_DATE.test(input.depart) || !ISO_DATE.test(input.retour)) throw new Error('Invalid travel dates');
  if (input.retour < input.depart) throw new Error('Return date is before departure');
  return { destination, depart: input.depart, retour: input.retour };
}

/** Mock connector: the local mirror is the source; what Keystone sends waits in the outbox (pending sync with Cursus). */
export const mockCursusConnector: CursusConnector = {
  mode: 'mock',
  async getGoNoGo(projectCode) {
    return readClearances(await getDb(), projectCode);
  },
  async sync(projectCode) {
    const db = await getDb();
    const current = await readClearances(db, projectCode);
    const pending = (await undeliveredRequests(db)).length;
    return { received: current.people.length, delivered: 0, failed: 0, pending };
  },
  remind: (projectCode, personName, actor) => queue(projectCode, 'reminder', personName, {}, actor),
  requestTravel: (projectCode, input, actor) => queue(projectCode, 'travel_request', input.personName, travelPayload(input), actor),
  // R-027: the mock has no staff directory ("not connected").
  listDirectory: async () => null,
};

// ── HTTP (Cursus's real contract) ───────────────────────────────────────────────────────────────────────

const HTTP_TIMEOUT_MS = 5000;
/** Reads refresh a project's verdicts at most once a minute (a failed refresh too: the mirror is used until the next attempt). */
const REFRESH_EVERY_MS = 60_000;
// Per server process (R-010): with several instances each refreshes a project at most once a minute (bounded load on
// Cursus); concurrent reads of one process share the refresh in flight instead of starting their own.
const g = globalThis as unknown as {
  __ksCursusRefreshedAt?: Map<string, number>; __ksCursusRefreshing?: Map<string, Promise<void>>; __ksCursusInFlight?: Map<string, Promise<number>>;
};
const refreshedAt = () => (g.__ksCursusRefreshedAt ??= new Map());
const refreshing = () => (g.__ksCursusRefreshing ??= new Map());
const inFlight = () => (g.__ksCursusInFlight ??= new Map());

/** Forgets the last refresh times (tests). */
export function resetCursusRefreshThrottle(): void {
  g.__ksCursusRefreshedAt = undefined;
  g.__ksCursusRefreshing = undefined;
  g.__ksCursusInFlight = undefined;
}

/** Base path of Cursus's API version 1 (Cursus docs/API-KEYSTONE.md). */
export const CURSUS_V1 = '/api/integrations/keystone/v1';

/** A refusal from Cursus: its HTTP status and its stable error code (`{ error, code }` body), when it gave one. */
export class CursusHttpError extends Error {
  constructor(readonly status: number, readonly code: string | null, readonly body: unknown, message: string) {
    super(message);
  }
}

async function cursusFetch(path: string, init?: RequestInit): Promise<Response> {
  const base = cursusApiUrl();
  if (!base) throw new Error('CURSUS_API_URL is not set');
  const apiKey = cursusApiKey();
  if (!apiKey) throw new Error('CURSUS_API_KEY is not set');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), HTTP_TIMEOUT_MS);
  try {
    const res = await fetch(`${base}${path}`, {
      ...init, signal: ctrl.signal,
      headers: { 'content-type': 'application/json', accept: 'application/json', 'x-api-key': apiKey, ...init?.headers },
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { code?: unknown } | null;
      const code = typeof body?.code === 'string' ? body.code : null;
      throw new CursusHttpError(res.status, code, body, `Cursus ${init?.method ?? 'GET'} ${path} → ${res.status}${code ? ` ${code}` : ''}`);
    }
    return res;
  } finally {
    clearTimeout(timer);
  }
}

const VERDICT: Record<CursusGoNoGoPayload['statut'], CursusVerdict> = { GO: 'go', GO_RESERVE: 'go_with_reserve', NO_GO: 'no_go' };

/**
 * Cursus payload → mirror records. Cursus sends matricules and reason codes only (no names, no documents): the person
 * keeps the name the mirror already has for that matricule, else the matricule. Approvals are derived from the reason
 * codes (HABILITATION / CERTIFICATION → clearance; FORMALITES_VOYAGE / DEPLACEMENT → visa and vaccinations).
 */
export function recordsOfPayload(projectCode: string, payload: CursusGoNoGoPayload, names: Map<string, string>): CursusClearanceRecord[] {
  return payload.ressources.map((r) => {
    const verdict = VERDICT[r.statut] ?? 'no_go';
    // v1: always { code, niveau, libelle? } (libelle in Cursus's detailed sharing only); a bare code from the deprecated route.
    const codes = r.motifs.map((m) => (typeof m === 'string' ? m : m.code));
    const labels = r.motifs.map((m) => (typeof m === 'string' ? m : (m.libelle ?? m.code)));
    const clearanceIssue = codes.some((c) => c === 'HABILITATION' || c === 'CERTIFICATION');
    const travelIssue = codes.some((c) => c === 'FORMALITES_VOYAGE' || c === 'DEPLACEMENT');
    const clearance: CursusClearance = !clearanceIssue ? 'ok' : verdict === 'no_go' ? 'missing' : 'expiring';
    return {
      projectCode, chantierId: payload.chantier, matricule: r.matricule, personName: names.get(r.matricule) ?? r.matricule,
      visa: travelIssue ? 'pending' : 'not_required', vaccination: travelIssue ? 'pending' : 'confirmed', clearance, clearanceNote: labels.join(' · '),
      verdict, reasonCodes: codes, receivedAt: payload.evalue_le,
    };
  });
}

async function refresh(projectCode: string): Promise<number> {
  if (!(await connectorEnabled(CURSUS_CONNECTOR_NAME))) return 0; // D-7a: disabled by IT — the local mirror is read
  const db = await getDb();
  const chantierId = await db.transaction(async (tx) => (await chantierOf(tx, projectCode)).chantierId);
  if (!chantierId) throw new Error(`No Cursus site is linked to ${projectCode}`);
  const res = await cursusFetch(`${CURSUS_V1}/chantiers/${encodeURIComponent(chantierId)}/go-no-go`);
  const payload = (await res.json()) as CursusGoNoGoPayload;
  if (!payload || !Array.isArray(payload.ressources)) throw new Error('Cursus: unexpected go-no-go payload');
  // R-027: a person imported from Cursus's staff directory names its matricule first; else the name the mirror already has.
  const known = await db.select({ m: cursusClearances.matricule, n: cursusClearances.personName }).from(cursusClearances).where(eq(cursusClearances.projectCode, projectCode));
  const names = new Map(known.filter((k) => k.m).map((k) => [k.m!, k.n]));
  const matricules = [...new Set(payload.ressources.map((r) => r.matricule).filter((m): m is string => typeof m === 'string' && !!m))];
  if (matricules.length)
    for (const p of await db.select({ m: persons.matricule, full: persons.fullName, short: persons.shortName }).from(persons).where(inArray(persons.matricule, matricules)))
      if (p.m) names.set(p.m, p.full ?? p.short);
  const n = await db.transaction((tx) => upsertClearances(tx, projectCode, recordsOfPayload(projectCode, payload, names), new Date(), 'http'));
  refreshedAt().set(projectCode, Date.now());
  return n;
}

/** One refresh of a project's verdicts at a time per process (R-010): concurrent callers share the one in flight. */
function refreshShared(projectCode: string): Promise<number> {
  let running = inFlight().get(projectCode);
  if (!running) {
    running = refresh(projectCode).finally(() => inFlight().delete(projectCode));
    inFlight().set(projectCode, running);
  }
  return running;
}

/**
 * R-029 (NEW-CURSUS-7): refreshes a project's verdicts now — Cursus pushed a "verdict.modifie" event — bypassing the
 * one-minute read throttle but sharing a refresh already in flight. HTTP mode only (the mock has nothing to refresh);
 * throws when Cursus is unreachable or the site is not linked.
 */
export async function refreshCursusSiteNow(projectCode: string): Promise<number> {
  if (cursusConnectorMode() !== 'http') return 0;
  return refreshShared(projectCode);
}

/**
 * R-027: Cursus's staff directory. TODO(cursus): GET /api/integrations/keystone/annuaire is Keystone's proposal (NEW-CURSUS-2:
 * Cursus needs a new access) — Cursus's API version 1 has no such route (a call answers 404 ROUTE_INCONNUE); field names, team
 * codes and paging may change when Cursus publishes it. Off by default (CURSUS_DIRECTORY).
 */
async function fetchDirectory(): Promise<CursusDirectoryPayload> {
  const res = await cursusFetch('/api/integrations/keystone/annuaire');
  const body = (await res.json()) as unknown;
  if (!Array.isArray(body)) throw new Error('Cursus: unexpected directory payload');
  const entries = body.map(directoryEntryOf);
  return { entries: entries.filter((e): e is NonNullable<typeof e> => !!e), invalid: entries.filter((e) => !e).length };
}

/** Cursus's id of a travel request: `demande.id` (v1, and the 409 of a retry), else `id` (deprecated route). */
export function cursusRequestId(body: unknown): string | null {
  const b = (body ?? {}) as { demande?: { id?: unknown }; id?: unknown };
  const id = b.demande && typeof b.demande === 'object' ? b.demande.id : b.id;
  return typeof id === 'number' || (typeof id === 'string' && id) ? String(id) : null;
}

/** Delivers the outbox: travel requests go to POST /v1/demandes; reminders have no Cursus endpoint (TODO(cursus), C-2). */
async function deliverOutbox(): Promise<{ delivered: number; failed: number; pending: number }> {
  const db = await getDb();
  // D-7a: a connector IT disabled exchanges nothing; the entries stay pending until it is enabled again.
  if (!(await connectorEnabled(CURSUS_CONNECTOR_NAME))) return { delivered: 0, failed: 0, pending: (await undeliveredRequests(db)).length };
  let delivered = 0;
  let failed = 0;
  for (const e of await undeliveredRequests(db)) {
    if (e.kind !== 'travel_request') continue;
    if (!(await claimRequestDelivery(db, e.id))) continue; // another delivery is sending it (R-010)
    try {
      if (!e.matricule) throw new Error(`No Cursus matricule for ${e.personName}`);
      const chantierId = await db.transaction(async (tx) => (await chantierOf(tx, e.projectCode)).chantierId);
      if (!chantierId) throw new Error(`No Cursus site is linked to ${e.projectCode}`);
      // v1: `reference` is required and unique — Keystone's request id, so a retry after a lost answer is recognised by Cursus.
      const body = JSON.stringify({ reference: e.id, matricule: e.matricule, chantier: chantierId, ...e.payload });
      let cursusRef: string | null;
      try {
        const res = await cursusFetch(`${CURSUS_V1}/demandes`, { method: 'POST', body });
        cursusRef = cursusRequestId(await res.json().catch(() => ({})));
      } catch (err) {
        // 409 DEMANDE_EN_DOUBLE: the request was already received (a retry) — `demande` is the one Cursus recorded.
        if (!(err instanceof CursusHttpError && err.status === 409 && err.code === 'DEMANDE_EN_DOUBLE')) throw err;
        cursusRef = cursusRequestId(err.body);
      }
      await markRequestDelivery(db, e.id, { ok: true, cursusRef });
      delivered++;
    } catch (err) {
      await markRequestDelivery(db, e.id, { ok: false, error: err instanceof Error ? err.message : String(err) });
      failed++;
    }
  }
  return { delivered, failed, pending: (await undeliveredRequests(db)).length };
}

/** HTTP connector: reads refresh the project's verdicts from Cursus (the mirror is used when Cursus is unreachable). */
export const httpCursusConnector: CursusConnector = {
  mode: 'http',
  async getGoNoGo(projectCode): Promise<CursusGoNoGo> {
    const db = await getDb();
    const last = refreshedAt().get(projectCode);
    if (last && Date.now() - last < REFRESH_EVERY_MS) return readClearances(db, projectCode);
    // A site not linked to a Cursus site has nothing to refresh: the mirror as received, no failed run per page view.
    const chantierId = await db.transaction(async (tx) => (await chantierOf(tx, projectCode)).chantierId).catch(() => null);
    if (!chantierId) return readClearances(db, projectCode);
    let running = refreshing().get(projectCode);
    if (!running) {
      running = refreshShared(projectCode)
        .then(
          () => undefined,
          async (e) => {
            const msg = e instanceof Error ? e.message : String(e);
            logWarning('Cursus go-no-go refresh (the local mirror is used)', e, { component: 'cursus', project: projectCode });
            // Retried after the same interval (the sidebar badge reads on every page: one timeout a minute, not one per view).
            refreshedAt().set(projectCode, Date.now());
            await recordFailedSync(db, projectCode, new Date(), msg).catch(() => null);
          },
        )
        .finally(() => refreshing().delete(projectCode));
      refreshing().set(projectCode, running);
    }
    await running;
    return readClearances(db, projectCode);
  },
  async sync(projectCode) {
    const received = await refresh(projectCode);
    const d = await deliverOutbox();
    return { received, ...d };
  },
  async remind(projectCode, personName, actor) {
    return queue(projectCode, 'reminder', personName, {}, actor);
  },
  async requestTravel(projectCode, input, actor) {
    const r = await queue(projectCode, 'travel_request', input.personName, travelPayload(input), actor);
    await deliverOutbox().catch(() => null);
    const db = await getDb();
    const [row] = await db.select({ s: cursusRequests.syncStatus }).from(cursusRequests).where(eq(cursusRequests.id, r.id));
    return { ...r, syncStatus: row?.s ?? r.syncStatus };
  },
  listDirectory: fetchDirectory,
};

/** The connector in use (http when CURSUS_API_URL is set, else the mock). */
export function getCursusConnector(): CursusConnector {
  return cursusConnectorMode() === 'http' ? httpCursusConnector : mockCursusConnector;
}

/**
 * Outbox redelivery of the worker (R-006, job "cursus-outbox"): with Cursus's API configured, the travel requests not yet
 * sent are delivered again (reminders have no Cursus endpoint and stay pending, C-2); the mock sends nothing and reports
 * what waits.
 */
export async function redeliverCursusOutbox(): Promise<{ mode: 'mock' | 'http'; delivered: number; failed: number; pending: number }> {
  if (cursusConnectorMode() === 'http') return { mode: 'http', ...(await deliverOutbox()) };
  return { mode: 'mock', delivered: 0, failed: 0, pending: (await undeliveredRequests(await getDb())).length };
}
