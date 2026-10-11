// Team & exchanges translation helpers. English stays the prototype's source text (docs/spec/05 §6, 07 §2.5, 01 §12).
// - `dataT`: register data (organisations, roles, other parties, notes, RACI labels) is translated the way the
//   prototype's deepTr did for the seed — whole text, else each " · " / " — " / " → " / " / " segment — but on exact
//   dictionary matches only, so text typed by people is never rewritten by the month / day / sentence rules
//   ("Sun Group" would become "dim. Group").
// - `statusT`: interface statuses agree with "interface" (feminine), as the prototype's own KPI sub does
//   ("2 gelées · 2 reçues") — the shared dictionary has the masculine "Reçu" / "Gelé" for other objects.
// - `formT`: the submit "Register" is the verb ("Enregistrer"; the shared entry is the noun "Registre").
// - Parameterised KPI sentences with their French singular forms (the shared rules only have the plural).
import FR_DICT_BASE from '@/i18n/fr-dict.json';
import { EXTRA_FR } from '@/i18n/extra';
import type { Lang, T } from '@/i18n/translate';
import { dataText } from '@/i18n/data-text';

const DICT: Record<string, string> = { ...(FR_DICT_BASE as Record<string, string>), ...EXTRA_FR };
const fr = (lang: Lang) => lang === 'fr';

/**
 * Register data (names, descriptions, notes typed in Keystone or received): as typed, or a seeded string's exact
 * dictionary entry — never segment by segment (R-148, NEW-D1-2: the shared helper, src/i18n/data-text.ts).
 */
export const dataT = (s: string, lang: Lang): string => dataText(s, lang);

const STATUS_FR: Record<string, string> = { Received: 'Reçue', Frozen: 'Gelée' };
/** Interface status tag (EN label → FR, feminine). */
export const statusT = (t: T, lang: Lang): T => (s) => (fr(lang) && Object.hasOwn(STATUS_FR, s) ? STATUS_FR[s] : t(s));

const FORM_FR: Record<string, string> = { Register: 'Enregistrer' };
/** Add-form strings ("Register" is the verb). */
export const formT = (t: T, lang: Lang): T => (s) => (fr(lang) && Object.hasOwn(FORM_FR, s) ? FORM_FR[s] : t(s));

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/**
 * French of the commissioning blockers' short labels, kept local: as shared dictionary entries they would also
 * rewrite register data through the segment translation ("Neighbouring cranes — anti-collision zones").
 */
const BLOCKER_FR: Record<string, string> = { 'HV cell': 'Cellule HT', 'anti-collision zones': 'zones anti-collision' };

/** "Blocking commissioning" KPI sub: the labels joined " · " ("HV cell · anti-collision zones"), "—" when none. */
export function blockersText(labels: readonly string[], t: T, lang: Lang): string {
  if (!labels.length) return '—';
  const all = labels.join(' · ');
  if (!fr(lang) || Object.hasOwn(DICT, all)) return t(all);
  return labels.map((l) => BLOCKER_FR[l] ?? dataT(l, lang)).join(' · ');
}

/** Stakeholders KPI sub "2 client · 2 authorities · 2 suppliers & third parties". */
export const stakeholderMixText = (clients: number, authorities: number, others: number, lang: Lang) =>
  fr(lang)
    ? `${clients} client · ${authorities} ${plural(authorities, 'autorité', 'autorités')} · ${others} fournisseurs & tiers`
    : `${clients} client · ${authorities} ${plural(authorities, 'authority', 'authorities')} · ${others} suppliers & third parties`;

/** RACI KPI sub "6 roles". */
export const rolesText = (n: number, lang: Lang) => (fr(lang) ? `${n} ${plural(n, 'rôle', 'rôles')}` : `${n} ${plural(n, 'role', 'roles')}`);

/** Interfaces KPI sub "2 frozen · 2 received". */
export const frozenReceivedText = (frozen: number, received: number, lang: Lang) =>
  fr(lang) ? `${frozen} ${plural(frozen, 'gelée', 'gelées')} · ${received} ${plural(received, 'reçue', 'reçues')}` : `${frozen} frozen · ${received} received`;

/** Open KPI sub "2 due within 30 days". */
export const dueWithinText = (n: number, lang: Lang) => (fr(lang) ? `${n} ${plural(n, 'due', 'dues')} sous 30 jours` : `${n} due within 30 days`);
