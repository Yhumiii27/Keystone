// Real state of the connectors of Activity & integrations (R-021; A-15 "real data only", D-7a, NEW-CURSUS-4). Pure.
//
// Each connector row says how Keystone is actually linked to the other system:
// - live — a connector layer talks to the system's API: Vigie, Cursus or Codex with their API URL set (mode "http"; Codex
//   since Delivery 8, R-033: CODEX_API_URL delivers the approval outbox and reads the index);
// - mock — Keystone runs the connector against a local mirror, nothing is exchanged with the system: Vigie, Cursus and
//   Codex without an API URL (Keystone's own Codex index);
// - file — exchange by files only: MS Project (the XML export works, imports are off by D-7b);
// - none — no connector exists in Keystone: Sage X3, SolidWorks PDM, Outlook / Exchange, Microsoft Teams, e-mail (SMTP)
//   and the connectors added with "Add connector", until IT builds them.
// Lucca is retired (NEW-CURSUS-4: leave and absences come from Cursus, "Lucca débranché"): it is no longer listed.
//
// What the row shows follows from it, instead of the prototype's seeded statuses and volumes ("OK", "Token expires in 3
// days", "9 sent today"):
// - live: its status (OK / Warning / Error / Ready), last successful sync and volume, "Sync now" runs it;
// - mock: "Mock", no last sync (none happened), the local mirror's content and outbox; "Sync now" runs the mock and says the
//   run is simulated;
// - file: "Ready", the last export; no "Sync now" (the export cards do the exchange);
// - none: "Not connected", no last sync, no volume, no "Sync now";
// - disabled by IT (D-7a) whatever the link: "Disabled", no "Sync now".
import type { ConnectorKind, ConnectorStatus } from '@/server/db/codes';

export type ConnectorLink = 'live' | 'mock' | 'file' | 'none';

/** What the status column shows. */
export type ConnectorState = ConnectorStatus | 'mock' | 'not_connected' | 'disabled';

/** Connectors no longer listed (NEW-CURSUS-4: Lucca unplugged, Cursus provides leave and absences). */
export const RETIRED_CONNECTORS: readonly string[] = ['Lucca'];
/**
 * Recorded connectors whose connector layer is a mock over Keystone's own index until their API URL is set (Codex:
 * CODEX_API_URL, R-033 — then live like Vigie and Cursus).
 */
export const MOCK_CONNECTORS: readonly string[] = ['Codex'];
/** Recorded connectors that exchange files only (MS Project XML export; imports off, D-7b). */
export const FILE_CONNECTORS: readonly string[] = ['MS Project'];

export const isRetiredConnector = (name: string) => RETIRED_CONNECTORS.includes(name);

// ── S-11 a, X-6b, I-3c (R-037): what the Microsoft 365 rows stand for ─────────────────────────────────────────────────────
/**
 * The prototype seeded "Outlook / Exchange" as a calendar sync of milestones and "Microsoft Teams" as notifications to project
 * channels. S-11: Outlook / Teams meetings carrying the project code come into Keystone (once IT registers Keystone in Microsoft
 * 365 with Graph access); X-6b: no notification goes to Teams channels; I-3c keeps Teams (meetings, in the same Microsoft app
 * as Outlook) — the row is requalified, not retired (owner to confirm). Both stay "Not connected". Applied at read time over
 * the seeded texts only: a scope IT set in the connectors file (R-020) is shown as set.
 */
const MICROSOFT_SCOPES: Readonly<Record<string, { seeded: string; scope: string }>> = {
  'Outlook / Exchange': { seeded: 'Calendar sync for milestones and approvals', scope: 'Meetings carrying the project code, Outlook / Teams → Keystone (S-11)' },
  'Microsoft Teams': { seeded: 'Notifications to project channels', scope: 'Teams meetings through the Microsoft 365 app with Outlook, no channel posts' },
};

/** Data scope shown for a connector row: the Microsoft 365 rows' requalified texts over their seeded ones (R-037), else as stored. */
export function connectorScopeText(name: string, stored: string): string {
  const m = Object.hasOwn(MICROSOFT_SCOPES, name) ? MICROSOFT_SCOPES[name] : null;
  return m && stored === m.seeded ? m.scope : stored;
}

/** How Keystone is linked to the system of a connector row (`mode`: Vigie / Cursus / Codex connector-layer mode). */
export function connectorLink(c: { name: string; kind: ConnectorKind; mode: 'mock' | 'http' | null }): ConnectorLink {
  if (c.kind === 'vigie' || c.kind === 'cursus') return c.mode === 'http' ? 'live' : 'mock';
  // R-033: Codex is live once its API URL is set (the outbox is delivered and the index read), a mock over the index otherwise.
  if (MOCK_CONNECTORS.includes(c.name)) return c.mode === 'http' ? 'live' : 'mock';
  if (FILE_CONNECTORS.includes(c.name)) return 'file';
  return 'none';
}

/** Status shown for a link, the stored / computed status and the IT switch. */
export function connectorState(link: ConnectorLink, status: ConnectorStatus, enabled: boolean): ConnectorState {
  if (!enabled) return 'disabled';
  if (link === 'none') return 'not_connected';
  if (link === 'mock') return 'mock';
  if (link === 'file') return 'ready';
  return status;
}

/** EN labels of the status column (translated by the screens). */
export const CONNECTOR_STATE_LABEL: Readonly<Record<ConnectorState, string>> = {
  ok: 'OK', warning: 'Warning', error: 'Error', ready: 'Ready', mock: 'Mock', not_connected: 'Not connected', disabled: 'Disabled',
};

/** Tag tone (mono-accent): alert for a failing live connector, watch for what is not really connected, calm otherwise. */
export const connectorStateTone = (s: ConnectorState): 'neutral' | 'accent' | 'outline' =>
  s === 'warning' || s === 'error' ? 'accent' : s === 'ok' || s === 'disabled' ? 'neutral' : 'outline';

/** A live connector that failed: nav badge "!", KPI colour. A mock or missing connector never "needs attention". */
export const connectorStateNeedsAttention = (s: ConnectorState) => s === 'warning' || s === 'error';

/** "Sync now" is offered (and accepted) for live and mock connectors that IT has not disabled. */
export const connectorCanSync = (link: ConnectorLink, enabled: boolean) => enabled && (link === 'live' || link === 'mock');

/** A run of a mock connector is simulated (nothing reaches the other system). */
export const isSimulatedSync = (link: ConnectorLink) => link === 'mock';

/** The last-sync column: only a real exchange (live connector, file export) has one. */
export const showsLastSync = (link: ConnectorLink) => link === 'live' || link === 'file';

/** The volume column: nothing for a connector that does not exist. */
export const showsVolume = (link: ConnectorLink) => link !== 'none';

/** "Connectors" KPI sub-line: "1 connected · 3 mock · 5 not connected" (+ " · 1 warning" when a live one failed). */
export function connectorsSummary(rows: readonly { link: ConnectorLink; state: ConnectorState }[]): { connected: number; mock: number; notConnected: number; warning: number } {
  return {
    connected: rows.filter((r) => (r.link === 'live' || r.link === 'file') && r.state !== 'disabled').length,
    mock: rows.filter((r) => r.link === 'mock' && r.state !== 'disabled').length,
    notConnected: rows.filter((r) => r.link === 'none' || r.state === 'disabled').length,
    warning: rows.filter((r) => connectorStateNeedsAttention(r.state)).length,
  };
}
