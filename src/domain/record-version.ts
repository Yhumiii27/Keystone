// R-010 — optimistic locking of edited records ("Fiche modifiée entre-temps"). Pure rules, shared by the server (the writers'
// check) and the browser (the token travels with the form as a hidden value).
//
// - A record carries a version (`version` column, bumped by a database trigger on every change of its content).
// - The screen that shows the record hands the form a token: the version it read and when it read it ("3.1767000000000").
// - On save, the writer compares the token with the record's version inside its transaction. Same version: saved. Another
//   version: the changes made since the token was read (the record's audit entries) decide —
//   - only the viewer's own changes (a second edit sent before the page refreshed, a Gantt bar dragged twice): saved;
//   - a change by someone else (a person, an import, a connector): refused, naming the last one and when;
//   - no recorded change (a writer that keeps no audit entry): refused, without a name.
// - No token (an older page, a caller that edits without a form): no check — as before R-010.
import { intlLocale, type Lang } from '@/i18n/translate';

export interface VersionToken {
  version: number;
  /** When the screen read the record (epoch ms). */
  readAt: number;
}

/** The token a screen hands its edit form: "<version>.<epoch ms of the read>". */
export function versionToken(version: number, readAt: Date): string {
  return `${version}.${readAt.getTime()}`;
}

const TOKEN_RE = /^(\d{1,9})\.(\d{1,15})$/;

/** The token sent back by a form; null when absent or malformed (an untrusted value). */
export function parseVersionToken(raw: unknown): VersionToken | null {
  if (typeof raw !== 'string') return null;
  const m = TOKEN_RE.exec(raw.trim());
  if (!m) return null;
  const version = Number(m[1]);
  const readAt = Number(m[2]);
  return version >= 1 && Number.isSafeInteger(readAt) ? { version, readAt } : null;
}

/** A change recorded on the record (its audit entries). */
export interface RecordChange {
  actorName: string;
  actorPersonId: string | null;
  at: Date;
}

/** Who saves: the signed-in viewer (person when known, else the display name the audit keeps). */
export interface Saver {
  name: string;
  personId: string | null;
}

/** A refused save: the last change by someone else and when (null when no change was recorded). */
export interface StaleRecord {
  by: string | null;
  at: Date | null;
}

export type Freshness = { ok: true } | ({ ok: false } & StaleRecord);

const isSaver = (c: RecordChange, s: Saver) => (c.actorPersonId && s.personId ? c.actorPersonId === s.personId : c.actorName === s.name);

/**
 * May a save carrying `token` be written on a record now at `currentVersion`? `changesSince`: the record's audit entries from
 * the token's read on (any order).
 */
export function freshness(currentVersion: number, token: VersionToken, changesSince: readonly RecordChange[], saver: Saver): Freshness {
  if (currentVersion === token.version) return { ok: true };
  const others = changesSince.filter((c) => !isSaver(c, saver));
  if (changesSince.length && !others.length) return { ok: true };
  const last = [...others].sort((a, b) => b.at.getTime() - a.at.getTime())[0];
  return { ok: false, by: last?.actorName ?? null, at: last?.at ?? null };
}

/** "29 Oct 2026, 14:05" / "29 oct. 2026 à 14:05" — Paris time (Keystone's users). */
function whenText(at: Date, lang: Lang): string {
  const day = new Intl.DateTimeFormat(intlLocale(lang), { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/Paris' }).format(at);
  const time = new Intl.DateTimeFormat(intlLocale(lang), { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Europe/Paris' }).format(at);
  return lang === 'fr' ? `${day} à ${time}` : `${day}, ${time}`;
}

/**
 * The refusal shown to the viewer: « Fiche modifiée entre-temps par M. Lefebvre le 29 oct. 2026 à 14:05 — rechargez pour voir
 * ses changements ». `by` is typed data (a person's name, or a system: Lucca, Vigie…) and is shown as is.
 */
export function staleRecordText(stale: StaleRecord, lang: Lang): string {
  if (lang === 'fr') {
    const who = stale.by ? ` par ${stale.by}` : '';
    const when = stale.at ? ` le ${whenText(stale.at, lang)}` : '';
    return `Fiche modifiée entre-temps${who}${when} — rechargez pour voir ${stale.by ? 'ses' : 'les'} changements`;
  }
  const who = stale.by ? ` by ${stale.by}` : ' by someone else';
  const when = stale.at ? ` on ${whenText(stale.at, lang)}` : '';
  return `Record modified meanwhile${who}${when} — reload to see ${stale.by ? 'their' : 'the'} changes`;
}
