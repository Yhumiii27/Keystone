// Connector configuration by IT, outside Keystone (D-7a = "Par l'informatique, en dehors de l'application"; R-020).
// Pure module: the file format, its validation and what each connector reads from the server environment.
//
// The connectors file (JSON) is named by the server variable KEYSTONE_CONNECTORS_FILE. Keystone reads it when it starts
// and again whenever the file changes; nothing in the app edits it. Example (config/connectors.example.json):
//
//   { "connectors": {
//       "Sage X3":          { "enabled": true, "frequency": "Every 2 h", "direction": "both", "owner": "IT · L. Fontaine" },
//       "Microsoft Teams":  { "enabled": false },
//       "SolidWorks 3DX":   { "enabled": true, "frequency": "Daily", "direction": "import", "dataScope": "Parts and BOM revisions" } } }
//
//   enabled     false = listed as "Disabled", "Sync now" refused (true by default)
//   frequency   text shown in the list ("Every 2 h", "Daily 06:30"), 60 characters at most
//   direction   "import" | "export" | "both"
//   dataScope   what the connector exchanges, 300 characters at most
//   owner       technical owner, 120 characters at most
// A name that is not yet a connector adds it (Ready, "First sync scheduled"). Addresses, keys and tokens never go in this
// file: they stay in the server environment (below) and in the remote system — a key such as "apiKey", "password",
// "token" or "secret" is refused.
import { connectorDirection, type ConnectorDirection } from '@/server/db/codes';

/** Server variable naming the connectors file. */
export const CONNECTORS_FILE_ENV = 'KEYSTONE_CONNECTORS_FILE';

/** Settings of one connector in the file (only the keys given). */
export interface ConnectorFileEntry {
  name: string;
  enabled?: boolean;
  frequency?: string;
  direction?: ConnectorDirection;
  dataScope?: string;
  owner?: string | null;
}

export type ConnectorsFileResult = { ok: true; entries: ConnectorFileEntry[] } | { ok: false; errors: string[] };

const KEYS = ['enabled', 'frequency', 'direction', 'dataScope', 'owner'] as const;
const SECRET_KEY = /key|secret|password|passwd|token|credential/i;
const MAX = { name: 80, frequency: 60, dataScope: 300, owner: 120 } as const;

const text = (v: unknown, max: number): v is string => typeof v === 'string' && v.trim().length > 0 && v.trim().length <= max;

/**
 * Validates the parsed file. Every problem is reported (one line each, English); a file with any error is not applied at
 * all, so a typo never half-configures the connectors.
 */
export function parseConnectorsFile(json: unknown): ConnectorsFileResult {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return { ok: false, errors: ['The file must be a JSON object with a "connectors" object'] };
  const top = json as Record<string, unknown>;
  const extra = Object.keys(top).filter((k) => k !== 'connectors');
  const errors: string[] = extra.map((k) => `Unknown setting "${k}" (only "connectors")`);
  const list = top.connectors;
  if (!list || typeof list !== 'object' || Array.isArray(list)) return { ok: false, errors: [...errors, '"connectors" must be an object keyed by connector name'] };
  const entries: ConnectorFileEntry[] = [];
  const seen = new Set<string>();
  for (const [rawName, raw] of Object.entries(list as Record<string, unknown>)) {
    const name = rawName.trim();
    if (!text(name, MAX.name)) { errors.push(`Connector name "${rawName}" must be 1 to ${MAX.name} characters`); continue; }
    if (seen.has(name.toLowerCase())) { errors.push(`${name}: listed twice`); continue; }
    seen.add(name.toLowerCase());
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) { errors.push(`${name}: settings must be an object`); continue; }
    const v = raw as Record<string, unknown>;
    const e: ConnectorFileEntry = { name };
    for (const k of Object.keys(v)) {
      if (SECRET_KEY.test(k)) errors.push(`${name}: "${k}" looks like a credential — keep addresses, keys and tokens in the server environment`);
      else if (!(KEYS as readonly string[]).includes(k)) errors.push(`${name}: unknown setting "${k}"`);
    }
    if (v.enabled !== undefined) {
      if (typeof v.enabled === 'boolean') e.enabled = v.enabled;
      else errors.push(`${name}: "enabled" must be true or false`);
    }
    if (v.frequency !== undefined) {
      if (text(v.frequency, MAX.frequency)) e.frequency = v.frequency.trim();
      else errors.push(`${name}: "frequency" must be 1 to ${MAX.frequency} characters`);
    }
    if (v.direction !== undefined) {
      if (typeof v.direction === 'string' && connectorDirection.isCode(v.direction)) e.direction = v.direction;
      else errors.push(`${name}: "direction" must be "import", "export" or "both"`);
    }
    if (v.dataScope !== undefined) {
      if (text(v.dataScope, MAX.dataScope)) e.dataScope = v.dataScope.trim();
      else errors.push(`${name}: "dataScope" must be 1 to ${MAX.dataScope} characters`);
    }
    if (v.owner !== undefined) {
      if (v.owner === null || (typeof v.owner === 'string' && v.owner.trim().length <= MAX.owner)) e.owner = typeof v.owner === 'string' && v.owner.trim() ? v.owner.trim() : null;
      else errors.push(`${name}: "owner" must be at most ${MAX.owner} characters`);
    }
    entries.push(e);
  }
  return errors.length ? { ok: false, errors } : { ok: true, entries };
}

/** What changes on a connector row when the file is applied ("field: old → new" lines; empty when nothing changes). */
export function connectorChanges(
  row: { enabled: boolean; frequency: string; direction: ConnectorDirection | null; dataScope: string; ownerName: string | null },
  e: ConnectorFileEntry,
): { set: Partial<{ enabled: boolean; frequency: string; direction: ConnectorDirection; dataScope: string; ownerName: string | null }>; changes: string[] } {
  const set: ReturnType<typeof connectorChanges>['set'] = {};
  const changes: string[] = [];
  if (e.enabled !== undefined && e.enabled !== row.enabled) { set.enabled = e.enabled; changes.push(e.enabled ? 'enabled' : 'disabled'); }
  if (e.frequency !== undefined && e.frequency !== row.frequency) { set.frequency = e.frequency; changes.push(`frequency: ${row.frequency || '—'} → ${e.frequency}`); }
  if (e.direction !== undefined && e.direction !== row.direction) { set.direction = e.direction; changes.push(`direction: ${row.direction ?? '—'} → ${e.direction}`); }
  if (e.dataScope !== undefined && e.dataScope !== row.dataScope) { set.dataScope = e.dataScope; changes.push('data scope changed'); }
  if (e.owner !== undefined && e.owner !== row.ownerName) { set.ownerName = e.owner; changes.push(`owner: ${row.ownerName ?? '—'} → ${e.owner ?? '—'}`); }
  return { set, changes };
}

// ── Server environment per connector (read-only display) ───────────────────────────────────────────────────────────────

/** One server variable a connector reads: its name, whether it is set, and what applies when it is not. */
export interface EnvSetting {
  name: string;
  /** EN source: what the variable gives. */
  purpose: string;
  /** Secret (API key): never displayed, only "set" / "not set". */
  secret: boolean;
  /** EN source: what Keystone does when the variable is not set. */
  whenUnset: string;
}

/** The server variables each connector of Keystone's connector layer reads (src/server/integrations/<app>/config.ts). */
export const CONNECTOR_ENV: Readonly<Record<string, readonly EnvSetting[]>> = {
  Vigie: [
    { name: 'VIGIE_API_URL', purpose: "Vigie's API (ECOs, NCRs, site HSE)", secret: false, whenUnset: 'Simulated over the local mirror' },
    { name: 'NEXT_PUBLIC_VIGIE_URL', purpose: 'Vigie web app the links open', secret: false, whenUnset: 'Local development address' },
  ],
  Cursus: [
    { name: 'CURSUS_API_URL', purpose: "Cursus's API (site clearances, Go / No Go)", secret: false, whenUnset: 'Simulated over the local mirror' },
    { name: 'CURSUS_API_KEY', purpose: 'Key Keystone presents to Cursus', secret: true, whenUnset: 'Demo key' },
    { name: 'NEXT_PUBLIC_CURSUS_URL', purpose: 'Cursus web app the links open', secret: false, whenUnset: 'Local development address' },
  ],
  Codex: [
    { name: 'NEXT_PUBLIC_CODEX_URL', purpose: 'Codex web app the links open', secret: false, whenUnset: 'Local development address' },
  ],
};

/** Server variables of a connector with their state; `env` = the server environment (process.env). */
export function connectorEnvState(name: string, env: Readonly<Record<string, string | undefined>>): { name: string; purpose: string; set: boolean; whenUnset: string }[] {
  return (CONNECTOR_ENV[name] ?? []).map((s) => ({ name: s.name, purpose: s.purpose, set: !!(env[s.name] ?? '').trim(), whenUnset: s.whenUnset }));
}
