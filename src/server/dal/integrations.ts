import 'server-only';
// Activity & integrations DAL (docs/spec/10 §2): connectors, import / export formats, and the KPI inputs of the screen
// (the activity feed and the audit trail are notifications.ts `listActivity` / `listAudit`). The Vigie and Cursus rows
// show the live state of Keystone's connector layer (mock or HTTP, outbox waiting for delivery, last refresh).
// R-021 (A-15, D-7a, NEW-CURSUS-4): every row says how Keystone is really linked to the system (src/domain/connectors.ts) —
// a connector that does not exist is "Not connected" (no seeded status, last sync or volume), a mock is "Mock" (no last
// sync), Lucca is no longer listed; "Sync now" runs live and mock connectors only, a mock run being recorded as simulated.
// R-020 (D-7a): IT configures the connectors outside Keystone — the connectors file is applied before the connectors are
// read (connector-config.ts); "Add connector" is gone from the app.
// Delivery 8 (R-033): the Codex row is live once CODEX_API_URL is set — its approval outbox (pending / failed), the last read
// of Codex's index as its last sync, "Sync now" exchanging with Codex (outbox, then index) and dating a successful run.
import { and, asc, desc, eq, gte, sql } from 'drizzle-orm';
import { getDb } from '@/server/db/client';
import { STATUS_ISO, addDaysIso, parisInstant, stampText, type ConnectorDirection, type ConnectorKind, type ConnectorStatus } from '@/server/db/codes';
import {
  auditEntries, connectorSyncRuns, connectors, cursusClearances, cursusRequests, cursusSyncRuns, documentIndexSyncs, importFormats, siteSheets, projects, vigieEcoProgress,
  vigieEcos, vigieHseItems, vigieNcrProgress, vigieNcrs,
} from '@/server/db/schema';
import { codexConnectorMode } from '@/server/integrations/codex/config';
import { undeliveredCodexEntries } from '@/server/integrations/codex/outbox';
import { CODEX_CONNECTOR_NAME } from '@/server/integrations/connector-enabled';
import { cursusConnectorMode } from '@/server/integrations/cursus/connection';
import { getCursusConnector } from '@/server/integrations/cursus/connector';
import { cursusInboxState } from '@/server/integrations/cursus/inbox';
import { recordFailedSync } from '@/server/integrations/cursus/mirror';
import { vigieConnectorMode } from '@/server/integrations/vigie/connection';
import { getVigieEcoConnector } from '@/server/integrations/vigie/eco-connector';
import { getVigieQualityConnector } from '@/server/integrations/vigie/quality-connector';
import {
  CONNECTOR_STATE_LABEL, connectorCanSync, connectorLink, connectorState, connectorStateNeedsAttention, isRetiredConnector, isSimulatedSync, showsLastSync,
  showsVolume, type ConnectorLink, type ConnectorState,
} from '@/domain/connectors';
import { fmt } from '@/server/interchange/messages';
import { ensureConnectorsFileApplied } from './connector-config';
import { directoryRunSummary, runDirectoryImport } from './persons-directory';
import { log } from '@/server/log';
import { eventsToday } from './kpis';
import { requireWorkspace, trace, whoIs, type Actor } from './ops-common';

export type { Actor };


export interface ConnectorRow {
  name: string;
  kind: ConnectorKind;
  /** Connector-layer mode of Vigie / Cursus ("mock" = simulated over the local mirror); null for the others. */
  mode: 'mock' | 'http' | null;
  /** How Keystone is really linked to the system (R-021). */
  link: ConnectorLink;
  /** What the status column shows (R-021): the live status, Mock, Not connected, Ready (file exchange) or Disabled. */
  state: ConnectorState;
  /** "Sync now" offered and accepted (live and mock connectors, not disabled). */
  canSync: boolean;
  dataScope: string;
  frequency: string;
  direction: ConnectorDirection | null;
  /** Computed status of the connector layer (live connectors) or the stored one; `state` is what is shown. */
  status: ConnectorStatus;
  /** EN label of `state`. */
  statusLabel: string;
  /** Last successful real exchange (live connectors, file exports); null for mock and missing connectors. */
  lastSyncAt: string | null;
  /** Volume of the last exchange or the mirror's content; '' for a connector that does not exist. */
  lastVolume: string;
  /** Entries waiting for delivery (Vigie / Cursus outboxes) and failed ones. */
  pending: number;
  failed: number;
  owner: string | null;
  addedInKeystone: boolean;
  /** False when IT disabled the connector (D-7a): listed as "Disabled", "Sync now" refused. */
  enabled: boolean;
}

/** Live state of the Vigie connector: mirrors and outboxes. */
async function vigieState() {
  const db = await getDb();
  const [[ecos], [ncrs], [hse], ecoOut, ncrOut, [lastEco], [lastNcr]] = await Promise.all([
    db.select({ n: sql<number>`count(*)::int` }).from(vigieEcos),
    db.select({ n: sql<number>`count(*)::int` }).from(vigieNcrs),
    db.select({ n: sql<number>`count(*)::int` }).from(vigieHseItems),
    db.select({ s: vigieEcoProgress.syncStatus }).from(vigieEcoProgress),
    db.select({ s: vigieNcrProgress.syncStatus }).from(vigieNcrProgress),
    db.select({ at: vigieEcos.lastSyncedAt }).from(vigieEcos).orderBy(desc(vigieEcos.lastSyncedAt)).limit(1),
    db.select({ at: vigieNcrs.lastSyncedAt }).from(vigieNcrs).orderBy(desc(vigieNcrs.lastSyncedAt)).limit(1),
  ]);
  const out = [...ecoOut, ...ncrOut];
  const last = [lastEco?.at, lastNcr?.at].filter((x): x is Date => !!x).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
  return {
    volume: `${ecos.n} ECOs · ${ncrs.n} NCRs · ${hse.n} HSE items`, pending: out.filter((x) => x.s === 'pending').length, failed: out.filter((x) => x.s === 'failed').length,
    lastSyncAt: last,
  };
}

/**
 * Live state of the Cursus connector: people received per site, the outbox, the last successful refresh and whether
 * the latest refresh of a site failed (Cursus unreachable: the mirror is kept, the connector needs attention). R-029: the
 * events Cursus pushes — when the last one arrived and how many wait for a person or a site ("Last Cursus event · 12 Oct
 * 09:15 · Unresolved events · 2": key / value segments the bell's translator handles).
 */
async function cursusState() {
  const db = await getDb();
  const [people, out, runs, inbox] = await Promise.all([
    db.select({ code: cursusClearances.projectCode }).from(cursusClearances),
    db.select({ s: cursusRequests.syncStatus }).from(cursusRequests),
    db.select({ code: cursusSyncRuns.projectCode, at: cursusSyncRuns.syncedAt, ok: cursusSyncRuns.ok }).from(cursusSyncRuns).orderBy(desc(cursusSyncRuns.syncedAt)),
    cursusInboxState(db),
  ]);
  const byCode = new Map<string, number>();
  for (const p of people) byCode.set(p.code, (byCode.get(p.code) ?? 0) + 1);
  const events = inbox.lastReceivedAt
    ? [`Last Cursus event · ${stampText(inbox.lastReceivedAt)}`, ...(inbox.unresolved ? [`Unresolved events · ${inbox.unresolved}`] : [])]
    : [];
  const volume = [[...byCode].map(([code, n]) => `${n} people · ${code}`).join(' · ') || '0 people', ...events].join(' · ');
  const latest = new Map<string, boolean>();
  for (const r of runs) if (!latest.has(r.code)) latest.set(r.code, r.ok);
  return {
    volume, pending: out.filter((x) => x.s === 'pending').length, failed: out.filter((x) => x.s === 'failed').length,
    lastSyncAt: runs.find((r) => r.ok)?.at ?? null, lastRunFailed: [...latest.values()].some((ok) => !ok),
  };
}

/**
 * State of the Codex connector (R-033): its approval outbox (decisions and circuit starts waiting for delivery, failed ones)
 * and the last read of Codex's index by the HTTP connector (the seeded and mock syncs are not reads of Codex).
 */
async function codexState(lastVolume: string) {
  const db = await getDb();
  const [out, [read]] = await Promise.all([
    undeliveredCodexEntries(db),
    db.select({ at: documentIndexSyncs.syncedAt }).from(documentIndexSyncs).where(eq(documentIndexSyncs.source, 'codex')).orderBy(desc(documentIndexSyncs.syncedAt)).limit(1),
  ]);
  return {
    volume: lastVolume, pending: out.filter((e) => e.syncStatus === 'pending').length, failed: out.filter((e) => e.syncStatus === 'failed').length,
    lastSyncAt: read?.at ?? null,
  };
}

/** Connector-layer mode of a row: Vigie, Cursus and (R-033) Codex — mock, or http once their API URL is set; null otherwise. */
const modeOf = (c: { name: string; kind: ConnectorKind }): 'mock' | 'http' | null =>
  c.kind === 'vigie' ? vigieConnectorMode() : c.kind === 'cursus' ? cursusConnectorMode() : c.name === CODEX_CONNECTOR_NAME ? codexConnectorMode() : null;

/**
 * Connectors (CONNECTORS order, Vigie and connectors added in Keystone after) with the live Vigie / Cursus / Codex state and
 * the real link of each one (R-021); retired connectors (Lucca) are left out.
 */
export async function listConnectors(): Promise<ConnectorRow[]> {
  await ensureConnectorsFileApplied();
  const db = await getDb();
  const [rows, vigie, cursus] = await Promise.all([db.select().from(connectors).orderBy(asc(connectors.position)), vigieState(), cursusState()]);
  const listed = rows.filter((c) => !isRetiredConnector(c.name));
  const codexRow = listed.find((c) => c.name === CODEX_CONNECTOR_NAME && c.kind === 'static');
  const codex = codexRow ? await codexState(codexRow.lastVolume) : null;
  return listed.map((c) => {
    const live = c.kind === 'vigie' ? vigie : c.kind === 'cursus' ? cursus : c === codexRow ? codex : null;
    // Live connectors need attention when deliveries failed, when the latest Cursus refresh of a site failed, or (Vigie,
    // Codex) when the last "Sync now" failed (`syncConnector` records it on the row).
    const lastRunFailed = (c.kind === 'vigie' || c === codexRow) && (c.status === 'warning' || c.status === 'error');
    const attention = !!live && (live.failed > 0 || ('lastRunFailed' in live && live.lastRunFailed) || lastRunFailed);
    const status: ConnectorStatus = live ? (attention ? 'warning' : 'ok') : c.status;
    const mode = modeOf(c);
    const link = connectorLink({ name: c.name, kind: c.kind, mode });
    const state = connectorState(link, status, c.enabled);
    // Last successful sync: the connector layer's latest refresh, or a later successful "Sync now" — a real exchange only.
    const last = [live?.lastSyncAt, c.lastSyncAt].filter((d): d is Date => !!d).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
    return {
      name: c.name, kind: c.kind, mode, link, state, canSync: connectorCanSync(link, c.enabled), dataScope: c.dataScope, frequency: c.frequency,
      direction: c.direction, status, statusLabel: CONNECTOR_STATE_LABEL[state], lastSyncAt: showsLastSync(link) ? ((live ? last : c.lastSyncAt)?.toISOString() ?? null) : null,
      lastVolume: showsVolume(link) ? (live ? live.volume : c.lastVolume) : '', pending: live?.pending ?? 0, failed: live?.failed ?? 0, owner: c.ownerName,
      addedInKeystone: c.addedInKeystone, enabled: c.enabled,
    };
  });
}

/** "!" when a live connector needs attention (Activity & integrations nav badge); mock and missing connectors never do. */
export async function plumbingNavBadge(): Promise<string> {
  return (await listConnectors()).some((c) => connectorStateNeedsAttention(c.state)) ? '!' : '';
}

/** "Sync now" of a connector that does not exist, or exchanges files only: refused, nothing is simulated (R-021). */
export class ConnectorNotConnectedError extends Error {
  constructor(name: string, link: ConnectorLink) {
    // EN source sentences, translated by the Activity & integrations actions (src/features/admin/i18n.ts adminErrorT).
    super(link === 'file' ? `${name} exchanges files only — use the export cards` : `${name} is not connected — nothing to synchronise`);
    this.name = 'ConnectorNotConnectedError';
  }
}

/** "Sync now" of a connector disabled by IT (D-7a, `connectors.enabled`): refused before anything runs. */
export class ConnectorDisabledError extends Error {
  constructor(name: string) {
    super(fmt('Connector {0} is disabled — IT configures connectors outside Keystone', name));
    this.name = 'ConnectorDisabledError';
  }
}

/**
 * "Sync now": Vigie (ECO, NCR, HSE: deliver the outboxes, refresh the mirrors), Cursus (every project with a site sheet), or
 * Codex (Keystone's index). R-021: a live connector exchanges with its system and dates its last sync; a mock one runs over
 * the local mirror, nothing reaches the system, and the run is recorded as simulated without a last-sync date; a connector
 * that does not exist (or exchanges files only) throws ConnectorNotConnectedError, a retired one is unknown, and one disabled
 * by IT throws ConnectorDisabledError (every caller — Server Functions, Codex index sync — goes through here).
 */
export async function syncConnector(
  name: string, actor: Actor, opts: { exchange?: () => Promise<{ ok: boolean; volume: string; error: string | null }> } = {},
): Promise<{ ok: boolean; volume: string; error: string | null; simulated: boolean }> {
  requireWorkspace('plumbing', actor, 'Activity & integrations');
  await ensureConnectorsFileApplied();
  const db = await getDb();
  const [c] = await db.select().from(connectors).where(eq(connectors.name, name));
  if (!c || isRetiredConnector(c.name)) throw new Error(`Unknown connector ${name}`);
  if (!c.enabled) throw new ConnectorDisabledError(c.name);
  const link = connectorLink({ name: c.name, kind: c.kind, mode: modeOf(c) });
  if (!connectorCanSync(link, c.enabled)) throw new ConnectorNotConnectedError(c.name, link);
  const simulated = isSimulatedSync(link);
  const startedAt = new Date();
  let ok = true;
  let error: string | null = null;
  let volume = c.lastVolume;
  try {
    if (c.kind === 'vigie') {
      const [e, q] = await Promise.all([getVigieEcoConnector().sync(), getVigieQualityConnector().sync()]);
      volume = `${e.delivered + q.delivered} sent · ${e.pending + q.pending} pending · ${e.refreshed + q.refreshed} refreshed`;
      if (e.failed + q.failed) { ok = false; error = `${e.failed + q.failed} failed`; }
    } else if (c.kind === 'cursus') {
      const sites = await db.select({ code: projects.code }).from(siteSheets).innerJoin(projects, eq(projects.id, siteSheets.projectId));
      let received = 0;
      const errors: string[] = [];
      // R-027: the staff directory import runs first with "Sync now" once CURSUS_DIRECTORY is on (HTTP mode, connector
      // enabled), so the sites' refresh below already names the people it imported; its counts are in the activity feed and
      // the log, a failure in the run's error.
      try {
        const run = await runDirectoryImport();
        if (run.state === 'done') log.info('Cursus staff directory imported (Sync now)', { component: 'cursus', summary: directoryRunSummary(run) });
      } catch (e) {
        errors.push(`staff directory: ${e instanceof Error ? e.message : String(e)}`);
      }
      for (const s of sites) {
        try {
          received += (await getCursusConnector().sync(s.code)).received;
        } catch (e) {
          // Cursus unreachable or refusing: the site's mirror is kept and the failed refresh recorded (connector in warning).
          const msg = e instanceof Error ? e.message : String(e);
          errors.push(`${s.code}: ${msg}`);
          await recordFailedSync(db, s.code, new Date(), msg).catch(() => null);
        }
      }
      volume = `${received} approvals received`;
      if (errors.length) { ok = false; error = errors.join(' · '); }
    } else if (opts.exchange && link === 'live') {
      // R-033: a live static connector's exchange (Codex: outbox, then index read — admin-connectors.ts).
      ({ ok, volume, error } = await opts.exchange());
    }
  } catch (e) {
    ok = false;
    error = e instanceof Error ? e.message : String(e);
  }
  const finishedAt = new Date();
  const run = simulated ? 'sync (simulated)' : 'sync';
  await db.transaction(async (tx) => {
    const who = await whoIs(tx, actor);
    await tx.insert(connectorSyncRuns).values({ connectorId: c.id, startedAt, finishedAt, ok, volume, error, requestedByName: who.who });
    // A simulated run is no sync: the last-sync date only moves for a real exchange (R-033: a live Codex too).
    if (c.kind !== 'static' || link === 'live') {
      await tx.update(connectors).set({ lastSyncAt: ok && !simulated ? finishedAt : c.lastSyncAt, status: ok ? 'ok' : 'warning', updatedAt: finishedAt }).where(eq(connectors.id, c.id));
    }
    await trace(tx, who, {
      objectRef: `Connector ${c.name}`, change: ok ? (volume ? `${run} · ${volume}` : run) : `${run} failed · ${error}`, area: 'Integrations',
      activity: { text: ok ? (volume ? `${c.name} ${run} · ${volume}` : `${c.name} ${run}`) : `${c.name} ${run} · failed`, kind: 'sync' },
    });
  });
  return { ok, volume, error, simulated };
}

/** Import / export formats (IMPORTS order). */
export async function listImportFormats(): Promise<{ name: string; description: string; icon: string; direction: 'import' | 'export' }[]> {
  const db = await getDb();
  return (await db.select().from(importFormats).orderBy(asc(importFormats.position))).map((f) => ({ name: f.name, description: f.description, icon: f.icon, direction: f.direction }));
}

/**
 * KPI inputs of the screen: "Events today" = the activity events of the portfolio data date (Paris day — A-12, 10 OQ4:
 * the prototype counted "25 Sep" and "26 Sep" events, the rebuild before chapter 4 everything since the status date) and
 * audit entries of the last 7 days before the status date onwards.
 */
export async function getPlumbingCounts(): Promise<{ eventsToday: number; auditLast7Days: number }> {
  const db = await getDb();
  const week = parisInstant(addDaysIso(STATUS_ISO, -7), '00:00');
  const [events, [a]] = await Promise.all([
    eventsToday(),
    db.select({ n: sql<number>`count(*)::int` }).from(auditEntries).where(and(gte(auditEntries.occurredAt, week))),
  ]);
  return { eventsToday: events, auditLast7Days: a.n };
}
