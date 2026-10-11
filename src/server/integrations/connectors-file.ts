import 'server-only';
// The connectors file IT maintains outside Keystone (D-7a, R-020; format and rules in src/domain/connector-config.ts).
// KEYSTONE_CONNECTORS_FILE names a JSON file; it is read when Keystone first needs the connectors and again whenever the
// file changes (modification time or size), then applied by src/server/dal/connector-config.ts. Nothing in the app writes
// it. Without the variable the connectors keep their stored settings (initial data, or the last file applied).
import fs from 'node:fs';
import path from 'node:path';
import { CONNECTORS_FILE_ENV, parseConnectorsFile, type ConnectorFileEntry } from '@/domain/connector-config';

export type ConnectorsFileState =
  | { status: 'none' }
  /** Read and valid: `signature` changes whenever the file does. */
  | { status: 'ok'; file: string; signature: string; entries: ConnectorFileEntry[] }
  /** Missing, unreadable, not JSON or invalid: nothing is applied; `errors` are English lines for IT. */
  | { status: 'invalid'; file: string; signature: string; errors: string[] };

let cache: { key: string; state: ConnectorsFileState } | null = null;
const reported = new Set<string>();

/** The file named by KEYSTONE_CONNECTORS_FILE, parsed (cached until the file or the variable changes). */
export function readConnectorsFile(env: Readonly<Record<string, string | undefined>> = process.env): ConnectorsFileState {
  const raw = (env[CONNECTORS_FILE_ENV] ?? '').trim();
  if (!raw) return { status: 'none' };
  const file = path.resolve(raw);
  let stat: fs.Stats;
  try {
    stat = fs.statSync(file);
  } catch {
    return remember(`${file}|missing`, { status: 'invalid', file, signature: `${file}|missing`, errors: ['The file named by KEYSTONE_CONNECTORS_FILE does not exist'] });
  }
  const signature = `${file}|${stat.mtimeMs}|${stat.size}`;
  if (cache?.key === signature) return cache.state;
  if (!stat.isFile() || stat.size > 256 * 1024) {
    return remember(signature, { status: 'invalid', file, signature, errors: ['The connectors file must be a JSON file of 256 KB at most'] });
  }
  let json: unknown;
  try {
    json = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return remember(signature, { status: 'invalid', file, signature, errors: [`The connectors file is not valid JSON (${e instanceof Error ? e.message : String(e)})`] });
  }
  const r = parseConnectorsFile(json);
  return remember(signature, r.ok ? { status: 'ok', file, signature, entries: r.entries } : { status: 'invalid', file, signature, errors: r.errors });
}

function remember(key: string, state: ConnectorsFileState): ConnectorsFileState {
  cache = { key, state };
  if (state.status === 'invalid' && !reported.has(key)) {
    reported.add(key);
    console.error(`[connectors] ${CONNECTORS_FILE_ENV} not applied:\n  ${state.errors.join('\n  ')}`);
  }
  return state;
}

/** Name shown on screen for the file: its base name only (the server's directories are not shown). */
export const connectorsFileLabel = (s: ConnectorsFileState) => (s.status === 'none' ? null : path.basename(s.file));
