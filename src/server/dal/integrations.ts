import 'server-only';
// Activity & integrations DAL (docs/spec/10 §2): connectors, import / export formats, and the KPI inputs of the screen
// (the activity feed and the audit trail are notifications.ts `listActivity` / `listAudit`). The Vigie and Cursus rows
// show the live state of Keystone's connector layer (mock or HTTP, outbox waiting for delivery, last refresh); the other
// connectors keep the state of their last (simulated) sync. "Sync now" runs the Vigie / Cursus connectors for real and
// records a simulated run for the others; "Add connector" records a connector waiting for its first sync.
import { and, asc, desc, eq, gte, sql } from 'drizzle-orm';
import { getDb } from '@/server/db/client';
import { STATUS_ISO, addDaysIso, connectorDirection, connectorStatus, parisInstant, type ConnectorDirection, type ConnectorKind, type ConnectorStatus } from '@/server/db/codes';
import {
  auditEntries, connectorSyncRuns, connectors, cursusClearances, cursusRequests, cursusSyncRuns, importFormats, siteSheets, projects, vigieEcoProgress, vigieEcos,
  vigieHseItems, vigieNcrProgress, vigieNcrs,
} from '@/server/db/schema';
import { cursusConnectorMode } from '@/server/integrations/cursus/connection';
import { getCursusConnector } from '@/server/integrations/cursus/connector';
import { recordFailedSync } from '@/server/integrations/cursus/mirror';
import { vigieConnectorMode } from '@/server/integrations/vigie/connection';
import { getVigieEcoConnector } from '@/server/integrations/vigie/eco-connector';
import { getVigieQualityConnector } from '@/server/integrations/vigie/quality-connector';
import { fmt } from '@/server/interchange/messages';
import { eventsToday } from './kpis';
import { requireWorkspace, requiredText, trace, whoIs, type Actor } from './ops-common';

export type { Actor };

/** Systems offered by "Add connector" (AF.plumbing). */
export const ADDABLE_SYSTEMS: readonly string[] = ['Sage X3', 'Lucca', 'SharePoint', 'SeeElectrical', 'SolidWorks 3DX', 'TIA Portal'];
/** Last-volume note of a connector added in Keystone until its first sync. */
const FIRST_SYNC_SCHEDULED = 'First sync scheduled';
/** Frequencies offered by "Add connector". */
export const CONNECTOR_FREQUENCIES: readonly string[] = ['Real time', 'Hourly', 'Daily', 'Manual'];

export interface ConnectorRow {
  name: string;
  kind: ConnectorKind;
  /** Connector-layer mode of Vigie / Cursus ("mock" = simulated over the local mirror); null for the others. */
  mode: 'mock' | 'http' | null;
  dataScope: string;
  frequency: string;
  direction: ConnectorDirection | null;
  status: ConnectorStatus;
  statusLabel: string;
  lastSyncAt: string | null;
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
 * the latest refresh of a site failed (Cursus unreachable: the mirror is kept, the connector needs attention).
 */
async function cursusState() {
  const db = await getDb();
  const [people, out, runs] = await Promise.all([
    db.select({ code: cursusClearances.projectCode }).from(cursusClearances),
    db.select({ s: cursusRequests.syncStatus }).from(cursusRequests),
    db.select({ code: cursusSyncRuns.projectCode, at: cursusSyncRuns.syncedAt, ok: cursusSyncRuns.ok }).from(cursusSyncRuns).orderBy(desc(cursusSyncRuns.syncedAt)),
  ]);
  const byCode = new Map<string, number>();
  for (const p of people) byCode.set(p.code, (byCode.get(p.code) ?? 0) + 1);
  const volume = [...byCode].map(([code, n]) => `${n} people · ${code}`).join(' · ') || '0 people';
  const latest = new Map<string, boolean>();
  for (const r of runs) if (!latest.has(r.code)) latest.set(r.code, r.ok);
  return {
    volume, pending: out.filter((x) => x.s === 'pending').length, failed: out.filter((x) => x.s === 'failed').length,
    lastSyncAt: runs.find((r) => r.ok)?.at ?? null, lastRunFailed: [...latest.values()].some((ok) => !ok),
  };
}

/** Connectors (CONNECTORS order, Vigie and connectors added in Keystone after) with the live Vigie / Cursus state. */
export async function listConnectors(): Promise<ConnectorRow[]> {
  const db = await getDb();
  const [rows, vigie, cursus] = await Promise.all([db.select().from(connectors).orderBy(asc(connectors.position)), vigieState(), cursusState()]);
  return rows.map((c) => {
    const live = c.kind === 'vigie' ? vigie : c.kind === 'cursus' ? cursus : null;
    // Live connectors need attention when deliveries failed, when the latest Cursus refresh of a site failed, or (Vigie)
    // when the last "Sync now" failed (`syncConnector` records it on the row).
    const attention = !!live && (live.failed > 0 || ('lastRunFailed' in live && live.lastRunFailed) || (c.kind === 'vigie' && (c.status === 'warning' || c.status === 'error')));
    const status: ConnectorStatus = live ? (attention ? 'warning' : 'ok') : c.status;
    // Last successful sync: the connector layer's latest refresh, or a later successful "Sync now".
    const last = [live?.lastSyncAt, c.lastSyncAt].filter((d): d is Date => !!d).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
    return {
      name: c.name, kind: c.kind, mode: c.kind === 'vigie' ? vigieConnectorMode() : c.kind === 'cursus' ? cursusConnectorMode() : null, dataScope: c.dataScope, frequency: c.frequency,
      direction: c.direction, status, statusLabel: connectorStatus.label(status), lastSyncAt: (live ? last : c.lastSyncAt)?.toISOString() ?? null,
      lastVolume: live ? live.volume : c.lastVolume, pending: live?.pending ?? 0, failed: live?.failed ?? 0, owner: c.ownerName, addedInKeystone: c.addedInKeystone,
      enabled: c.enabled,
    };
  });
}

/** "!" when a connector needs attention (Activity & integrations nav badge). */
export async function plumbingNavBadge(): Promise<string> {
  return (await listConnectors()).some((c) => c.status === 'warning' || c.status === 'error') ? '!' : '';
}

/** "Sync now" of a connector disabled by IT (D-7a, `connectors.enabled`): refused before anything runs. */
export class ConnectorDisabledError extends Error {
  constructor(name: string) {
    super(fmt('Connector {0} is disabled — IT configures connectors outside Keystone', name));
    this.name = 'ConnectorDisabledError';
  }
}

/**
 * "Sync now": Vigie (ECO, NCR, HSE: deliver the outboxes, refresh the mirrors), Cursus (every project with a site sheet),
 * or a simulated run for the other connectors (their last sync becomes now). Returns the volume text of the run. A connector
 * disabled by IT throws ConnectorDisabledError (every caller — Server Functions, Codex index sync — goes through here).
 */
export async function syncConnector(name: string, actor: Actor): Promise<{ ok: boolean; volume: string; error: string | null }> {
  requireWorkspace('plumbing', actor, 'Activity & integrations');
  const db = await getDb();
  const [c] = await db.select().from(connectors).where(eq(connectors.name, name));
  if (!c) throw new Error(`Unknown connector ${name}`);
  if (!c.enabled) throw new ConnectorDisabledError(c.name);
  const startedAt = new Date();
  let ok = true;
  let error: string | null = null;
  // A connector added in Keystone has exchanged nothing yet: its "First sync scheduled" note ends with its first run.
  let volume = c.addedInKeystone && c.lastVolume === FIRST_SYNC_SCHEDULED ? '' : c.lastVolume;
  try {
    if (c.kind === 'vigie') {
      const [e, q] = await Promise.all([getVigieEcoConnector().sync(), getVigieQualityConnector().sync()]);
      volume = `${e.delivered + q.delivered} sent · ${e.pending + q.pending} pending · ${e.refreshed + q.refreshed} refreshed`;
      if (e.failed + q.failed) { ok = false; error = `${e.failed + q.failed} failed`; }
    } else if (c.kind === 'cursus') {
      const sites = await db.select({ code: projects.code }).from(siteSheets).innerJoin(projects, eq(projects.id, siteSheets.projectId));
      let received = 0;
      const errors: string[] = [];
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
    }
  } catch (e) {
    ok = false;
    error = e instanceof Error ? e.message : String(e);
  }
  const finishedAt = new Date();
  await db.transaction(async (tx) => {
    const who = await whoIs(tx, actor);
    await tx.insert(connectorSyncRuns).values({ connectorId: c.id, startedAt, finishedAt, ok, volume, error, requestedByName: who.who });
    if (c.kind === 'static' && ok) {
      await tx.update(connectors).set({ lastSyncAt: finishedAt, status: c.addedInKeystone ? 'ok' : c.status, lastVolume: volume, updatedAt: finishedAt }).where(eq(connectors.id, c.id));
    }
    if (c.kind !== 'static') await tx.update(connectors).set({ lastSyncAt: ok ? finishedAt : c.lastSyncAt, status: ok ? 'ok' : 'warning', updatedAt: finishedAt }).where(eq(connectors.id, c.id));
    await trace(tx, who, {
      objectRef: `Connector ${c.name}`, change: ok ? (volume ? `sync · ${volume}` : 'sync') : `sync failed · ${error}`, area: 'Integrations',
      activity: { text: ok ? (volume ? `${c.name} sync · ${volume}` : `${c.name} sync`) : `${c.name} sync · failed`, kind: 'sync' },
    });
  });
  return { ok, volume, error };
}

export interface NewConnectorInput {
  system: string;
  direction: ConnectorDirection;
  frequency: string;
  owner?: string | null;
}

/** "Add connector" (AF.plumbing): listed at once, Ready, "First sync scheduled" (the prototype only toasted). */
export async function addConnector(input: NewConnectorInput, actor: Actor): Promise<void> {
  requireWorkspace('plumbing', actor, 'Activity & integrations');
  const system = requiredText(input.system, 'System', 80);
  if (!connectorDirection.isCode(input.direction)) throw new Error('Invalid direction');
  if (!CONNECTOR_FREQUENCIES.includes(input.frequency)) throw new Error('Invalid frequency');
  const db = await getDb();
  await db.transaction(async (tx) => {
    const all = await tx.select({ name: connectors.name, position: connectors.position }).from(connectors);
    if (all.some((c) => c.name.toLowerCase() === system.toLowerCase())) throw new Error(`${system} is already connected`);
    const owner = (input.owner ?? '').trim().slice(0, 120) || null;
    await tx.insert(connectors).values({
      name: system, kind: 'static', dataScope: '', frequency: input.frequency, direction: input.direction, status: 'ready', lastSyncAt: null, lastVolume: FIRST_SYNC_SCHEDULED,
      ownerName: owner, addedInKeystone: true, position: all.reduce((m, c) => Math.max(m, c.position + 1), 0),
    });
    await trace(tx, await whoIs(tx, actor), {
      objectRef: `Connector ${system}`, change: `added · ${connectorDirection.label(input.direction)} · ${input.frequency}${owner ? ` · ${owner}` : ''}`, area: 'Integrations',
      activity: { text: `Connector ${system} added · first sync scheduled`, kind: 'sync' },
    });
  });
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
