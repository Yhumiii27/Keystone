// Rule messages of the machine catalogue writers (src/domain/machine-catalogue.ts, src/server/dal/machine-catalogue.ts) in the
// viewer's language; null when the message is not a known rule (the action then
// shows a generic failure). The English messages are source strings with their French in src/i18n/extra/d9-catalogue.json.
import type { Lang, T } from '@/i18n/translate';

/** Refusal outside the Machine catalogue workspace (Server Functions and DAL). */
export const CATALOGUE_READ_ONLY = 'The machine catalogue is read-only for you';

const KNOWN = new Set([
  'Invalid request', 'Code is required', 'Label is required', CATALOGUE_READ_ONLY, 'The change could not be saved',
  'Only the director and the engineering lead edit the machine catalogue', 'A catalogue code reads like EMP-40T (capitals, digits and dashes)',
  'This catalogue code is already used', 'Choose the machine type among the proposed types', 'Unknown catalogue entry', 'Unknown catalogue version',
  'The label is too long', 'The variant is too long', 'The description is too long', 'Invalid catalogue options',
  'An option reads “CODE | label | indicative price k€” (one per line)', 'Option codes must be distinct', 'An option price is a positive amount in k€',
  'The nominal capacity is a positive number', 'The capacity unit is too long', 'Enter the unit of the nominal capacity',
  'The indicative price is a positive amount in k€', 'Enter the indicative price before publishing', 'Enter the typical lead time before publishing',
  'This entry already has a draft version', 'Only the published version can be retired', 'A published version is frozen: create a new version',
]);

export function catalogueErrorT(message: string, t: T, lang: Lang): string | null {
  const fr = lang === 'fr';
  const lead = /^The typical lead time is a whole number of weeks from 1 to (\d+)$/.exec(message);
  if (lead) return fr ? `Le délai type est un nombre entier de semaines, de 1 à ${lead[1]}` : message;
  const max = /^A catalogue entry has at most (\d+) options$/.exec(message);
  if (max) return fr ? `Une fiche catalogue a au plus ${max[1]} options` : message;
  const outside = /^Machine catalogue is outside your workspace$/.test(message);
  if (outside) return t(CATALOGUE_READ_ONLY);
  // The database trigger (machine_catalogue_entries_frozen) speaks for a writer that skipped the rule.
  if (/is published and (frozen|cannot be deleted)$/.test(message)) return t('A published version is frozen: create a new version');
  return KNOWN.has(message) ? t(message) : null;
}
