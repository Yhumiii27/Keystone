// After-sales translation helpers. English stays the prototype's source text (docs/spec/07 §2.8–2.9, 01 §12).
// - Machine names, clients, sites, claim issues, owners and technicians are data: French only on an exact dictionary
//   match ("Port authority" → "Autorité portuaire"); text typed in Keystone is shown as typed. Seeded next steps go
//   through t() as the prototype did ("intervention 8 Oct" → "intervention 8 oct."); a claim opened in Keystone
//   shows its description as typed.
// - Count sub-lines agree in number in French ("1 étendue", "1 ouverte", "0 majeure"; the prototype's rules always used
//   the plural) and in English ("1 client").
// - Intervention statuses agree with "intervention" (feminine): "Planifiée", "Terminée" (the dictionary's "Planifié",
//   "Terminé" are masculine).
// - The claim form's "Issue" is the reported problem ("Problème"), not the stock issue ("Sortie") of the dictionary.
import type { Lang, T } from '@/i18n/translate';
import { countTextEn, type CountKind } from '@/domain/aftersales';
import { interventionStatus, type InterventionStatus } from '@/server/db/codes';
import { dataText } from '@/i18n/data-text';

const fr = (lang: Lang) => lang === 'fr';

/** Typed / received text: as typed, or a seeded string's exact dictionary entry (R-148: the shared helper, src/i18n/data-text.ts). */
export { dataText };

const FR_COUNT: Record<CountKind, [string, string]> = {
  clients: ['client', 'clients'],
  extended: ['étendue', 'étendues'],
  open: ['ouverte', 'ouvertes'],
  major: ['majeure', 'majeures'],
};

/** "6 clients" / "1 extended" / "2 open" / "0 major", agreed in number in French. */
export const countText = (kind: CountKind, n: number, lang: Lang) => (fr(lang) ? `${n} ${FR_COUNT[kind][n > 1 ? 1 : 0]}` : countTextEn(kind, n));

const IV_STATUS_FR: Record<InterventionStatus, string> = { planned: 'Planifiée', done: 'Terminée' };
/** Intervention status label ("Planned" / "Done"). */
export const interventionStatusText = (s: InterventionStatus, t: T, lang: Lang) => (fr(lang) ? IV_STATUS_FR[s] : t(interventionStatus.label(s)));

/** Form labels whose dictionary French belongs to another screen. */
const FORM_FR: Record<string, string> = { Issue: 'Problème' };
/** A form label, title or option in the viewer's language. */
export const formText = (s: string, t: T, lang: Lang) => (fr(lang) && Object.hasOwn(FORM_FR, s) ? FORM_FR[s] : t(s));

/** A message (toast, error) built in English, translated per " · " segment like the prototype's showToast. */
export const messageText = (s: string, t: T) => s.split(' · ').map(t).join(' · ');
