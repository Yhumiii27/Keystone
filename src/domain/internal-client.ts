// R-190 (Arche K-05): a client may be a group subsidiary — an internal client. Pure rules of the Contract screen's "Client" card
// and of the creation of a project from a subsidiary's need (R-187). The database checks the same format
// (clients_subsidiary_code_check) and that a subsidiary code is only on an internal client (clients_subsidiary_internal_check).
// An internal client follows its projects in the CAPEX application, never in the client portal (R-179, I-2b): see
// `clientRefusedProject` / `projectAccess` (src/domain/rights.ts).
import type { RoleKey } from '@/config/screens';

/** A subsidiary's code as Arche (pub_capex.filiale_code) and Matrix (pub_filiales.code, D21) publish it: three capitals. */
export const SUBSIDIARY_CODE_RE = /^[A-Z]{3}$/;

export interface InternalClient {
  isInternal: boolean;
  subsidiaryCode: string | null;
}

export type InternalClientParse = { ok: true; value: InternalClient } | { ok: false; error: string };

/**
 * The flag and the subsidiary code as sent (EN error messages, translated by the caller): the code is trimmed and upper-cased,
 * empty = not known yet; an external client carries no code.
 */
export function parseInternalClient(input: { isInternal?: unknown; subsidiaryCode?: unknown }): InternalClientParse {
  if (typeof input.isInternal !== 'boolean') return { ok: false, error: 'Invalid request' };
  const raw = input.subsidiaryCode ?? '';
  if (typeof raw !== 'string') return { ok: false, error: 'Invalid request' };
  const code = raw.trim().toUpperCase() || null;
  if (!input.isInternal) return code ? { ok: false, error: 'Only an internal client has a subsidiary code' } : { ok: true, value: { isInternal: false, subsidiaryCode: null } };
  if (code && !SUBSIDIARY_CODE_RE.test(code)) return { ok: false, error: 'Choose a subsidiary code of three capital letters' };
  return { ok: true, value: { isInternal: true, subsidiaryCode: code } };
}

/**
 * Who flags a client as a group subsidiary: the portfolio director only — the flag is on the client, so it applies to every
 * project of that client (Keystone has no client-administration screen; the Contract screen hosts it).
 */
export const canSetInternalClient = (role: RoleKey) => role === 'director';

/**
 * R-187 + R-190: the client a project created from a subsidiary's need becomes internal when it is that subsidiary — registered
 * with its code, or named as Arche names it (case and spaces ignored). Anything else (the director typed another client) is
 * left as it is.
 */
export function isSubsidiaryClient(client: { name: string; subsidiaryCode: string | null }, subsidiary: { code: string | null; name: string | null }): boolean {
  if (subsidiary.code && client.subsidiaryCode === subsidiary.code) return true;
  const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();
  return !!subsidiary.name && norm(client.name) === norm(subsidiary.name);
}
