// Matrix D21: the group's subsidiaries as Matrix publishes them (matrix.pub_filiales), and what they mean for Keystone's clients.
// Pure rules of the subsidiaries connector (src/server/integrations/matrix/subsidiaries.ts), of the Contract screen's "Client" card
// (R-190) and of the client code of a new project (clients.code3, the New project wizard, the schedule import):
// - a row of pub_filiales is checked before it is mirrored (`parseSubsidiaryRow`);
// - the subsidiaries offered come from Matrix; while Matrix publishes none, from the CAPEX application's mirror (R-190's source),
//   kept as a fallback only (`subsidiaryChoices`);
// - an internal client's code3 is its subsidiary's code; a code3 equal to the code of an active subsidiary is reserved to that
//   subsidiary (`reservedCodeHolder`).
import { SUBSIDIARY_CODE_RE } from './internal-client';

export interface SubsidiaryRecord {
  code: string;
  name: string;
  countryIso2: string | null;
  zoneCode: string | null;
  currency: string | null;
  position: number | null;
  active: boolean;
}

type Row = Record<string, unknown>;

const text = (v: unknown, max = 200): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);

/**
 * One row of matrix.pub_filiales (code, nom, pays_iso2, zone_code, devise, ordre, actif — a column added at the end of the view
 * is ignored). Null when malformed: a code that is not three capitals, no name, or no `actif` flag.
 */
export function parseSubsidiaryRow(r: Row): SubsidiaryRecord | null {
  const code = typeof r.code === 'string' ? r.code.trim() : '';
  const name = text(r.nom);
  if (!SUBSIDIARY_CODE_RE.test(code) || !name || typeof r.actif !== 'boolean') return null;
  const ordre = typeof r.ordre === 'number' ? r.ordre : typeof r.ordre === 'string' && /^-?\d+$/.test(r.ordre) ? Number(r.ordre) : null;
  return {
    code, name, countryIso2: text(r.pays_iso2, 2), zoneCode: text(r.zone_code, 20), currency: text(r.devise, 3),
    position: ordre != null && Number.isSafeInteger(ordre) ? ordre : null, active: r.actif,
  };
}

/** The checked rows of one read: malformed rows and repeated codes (the first one read is kept) are skipped and counted. */
export function subsidiarySnapshot(rows: readonly Row[]): { subsidiaries: SubsidiaryRecord[]; skipped: number } {
  const byCode = new Map<string, SubsidiaryRecord>();
  for (const r of rows) {
    const s = parseSubsidiaryRow(r);
    if (s && !byCode.has(s.code)) byCode.set(s.code, s);
  }
  return { subsidiaries: [...byCode.values()], skipped: rows.length - byCode.size };
}

/**
 * D21: the error of a new project whose client code (proposed from the client's name) is the code of a group subsidiary the client
 * is not (EN source string, translated by the caller).
 */
export const RESERVED_CLIENT_CODE = 'This client code is reserved for a group subsidiary: choose the subsidiary’s client or another client name';

export type SubsidiarySource = 'matrix' | 'capex';

export interface SubsidiaryChoices {
  /** `matrix` = Matrix's active subsidiaries; `capex` = fallback while Matrix publishes none (R-190's list). */
  source: SubsidiarySource;
  /** code → name, in display order. */
  list: { code: string; name: string }[];
}

/**
 * The subsidiaries a client may be: Matrix's active ones in Matrix's order (then code) as soon as Matrix publishes any subsidiary
 * (even inactive ones only); otherwise the CAPEX mirror's subsidiaries and the codes already set on a client (`fallback`, code order).
 */
export function subsidiaryChoices(matrix: readonly SubsidiaryRecord[], fallback: readonly { code: string; name: string }[]): SubsidiaryChoices {
  if (matrix.length) {
    const list = matrix.filter((s) => s.active)
      .sort((a, b) => (a.position ?? Number.MAX_SAFE_INTEGER) - (b.position ?? Number.MAX_SAFE_INTEGER) || a.code.localeCompare(b.code))
      .map((s) => ({ code: s.code, name: s.name }));
    return { source: 'matrix', list };
  }
  const byCode = new Map<string, string>();
  for (const s of fallback) if (!byCode.has(s.code)) byCode.set(s.code, s.name);
  return { source: 'capex', list: [...byCode].map(([code, name]) => ({ code, name })).sort((a, b) => a.code.localeCompare(b.code)) };
}

/**
 * D21: the subsidiary that holds a client code, when the client may not use it — `code3` is the code a client would get (its
 * registered code3, or the code proposed from its name), `client` = that client's subsidiary code when it is an internal client.
 * A code equal to the code of an offered subsidiary is reserved to it: any other client (an external one, or the internal client
 * of another subsidiary) is refused. Null = the code is free for this client.
 */
export function reservedCodeHolder(code3: string, client: { subsidiaryCode: string | null } | null, reserved: readonly { code: string; name: string }[]): { code: string; name: string } | null {
  const holder = reserved.find((s) => s.code === code3);
  if (!holder || client?.subsidiaryCode === holder.code) return null;
  return holder;
}
