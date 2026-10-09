// Chapter 4 Settings texts (A-14) in the viewer's language: the refusals of the new rules (director-only editing,
// lifecycle stages) and the "Remove" toast, which says whether the value was deleted or only deactivated because records
// still use it. Exact strings translate through t() (src/i18n/extra/ch4-settings.json); counted ones are built here.
import {
  CUSTOM_STATUS_REFUSED, REQUIRED_STAGE_REFUSED, SETTINGS_DIRECTOR_ONLY, type RemovalMode,
} from '@/domain/settings-rules';
import type { Lang, T } from '@/i18n/translate';

const KNOWN = new Set<string>([SETTINGS_DIRECTOR_ONLY, CUSTOM_STATUS_REFUSED, REQUIRED_STAGE_REFUSED]);

/** A chapter-4 Settings refusal, translated; null when the message is not one of them. */
export const settingsErrorT = (message: string, t: T): string | null => (KNOWN.has(message) ? t(message) : null);

/**
 * Toast of "Remove": `"Welding" removed` / `"Technical" deactivated · still used by 3 records` /
 * `"Labor" deactivated · default value, restored by Reset to defaults`.
 */
export function removedEntryToastT(r: { label: string; mode: RemovalMode; inUse: number }, t: T, lang: Lang): string {
  const label = t(r.label);
  if (lang === 'fr') {
    if (r.mode === 'deleted') return `« ${label} » supprimé`;
    return r.inUse
      ? `« ${label} » désactivé · encore utilisé par ${r.inUse} ${r.inUse === 1 ? 'enregistrement' : 'enregistrements'}`
      : `« ${label} » désactivé · valeur par défaut, rétablie par « Réinitialiser »`;
  }
  if (r.mode === 'deleted') return `"${label}" removed`;
  return r.inUse
    ? `"${label}" deactivated · still used by ${r.inUse} ${r.inUse === 1 ? 'record' : 'records'}`
    : `"${label}" deactivated · default value, restored by Reset to defaults`;
}
