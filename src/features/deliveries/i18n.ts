// Deliveries-specific translation helpers. English stays the prototype's source text (docs/spec/08 §3, 01 §12).
// - Data typed or stored as text (supplier delivery notes, carriers, QC remarks, document names, article names,
//   locations) is translated on an exact dictionary match only: seeded prototype strings come out as in the
//   prototype, text typed in Keystone is shown as typed (the segment / month engine would alter "Mon équipe…").
// - Receipt statuses agree with "livraison" (feminine) in French; the prototype dictionary mixes "Annoncée",
//   "Partiellement refusée" with "Reçu", "Accepté", "Refusé" (deliberate fix).
// - Parameterised sentences the shared FR rule engine does not cover ("Failed on 3 units", toasts).
import type { Lang, T } from '@/i18n/translate';
import type { ReceiptStatus } from '@/server/db/codes';
import { receiptStatusLabel } from '@/domain/deliveries';
import { dataText } from '@/i18n/data-text';

const fr = (lang: Lang) => lang === 'fr';

/** Typed / received text: as typed, or a seeded string's exact dictionary entry (R-148: the shared helper, src/i18n/data-text.ts). */
export { dataText };

/** Receipt statuses in French, agreed with "livraison". */
const STATUS_FR: Record<ReceiptStatus, string> = {
  announced: 'Annoncée',
  received: 'Reçue',
  qc_pending: 'Contrôle en attente',
  accepted: 'Acceptée',
  partially_rejected: 'Partiellement refusée',
  rejected: 'Refusée',
};

/** Status label of a receipt (chips, tags, toasts). */
export const statusText = (s: ReceiptStatus, t: T, lang: Lang) => (fr(lang) ? STATUS_FR[s] : t(receiptStatusLabel(s)));

/** FR forms of the feature's parameterised sentences (English source → French); `null` when none applies. */
const RULES: [RegExp, (m: RegExpExecArray) => string][] = [
  [/^Failed on (\d+) units?$/, (m) => `Non conforme sur ${m[1]} unité${m[1] === '1' ? '' : 's'}`],
  [/^Delivery (\S+) announced$/, (m) => `Livraison ${m[1]} annoncée`],
  [/^(\S+) received · quality check to do$/, (m) => `${m[1]} reçue · contrôle qualité à faire`],
  [/^(.+) attached to (\S+)$/, (m) => `${m[1]} joint à ${m[2]}`],
  // R-096: rejected units counted in the toast of a rejection.
  [/^(\d+) rejected$/, (m) => `${m[1]} refusé${m[1] === '1' ? '' : 's'}`],
];

/** R-096 (NEW-D4-3 "a"): toast segment after a rejection on the Deliveries screen (FR in the d8-connectors dictionary). */
export const DECLARE_NCR_HINT = 'declare the supplier NCR in Vigie';
/** R-096: drawer link of a rejected line (one per line with rejected units). */
export const DECLARE_NCR_LINK = 'Declare the supplier NCR in Vigie';
/** "3 rejected" (EN source of the toast segment; the RULES above give the French). */
export const rejectedCountText = (n: number) => `${n} rejected`;

function ruleFr(s: string): string | null {
  for (const [re, f] of RULES) {
    const m = re.exec(s);
    if (m) return f(m);
  }
  return null;
}

/** QC result (data text, or the "Failed on n units" sentence Keystone writes). */
export const qcResultText = (s: string, lang: Lang) => (fr(lang) ? (ruleFr(s) ?? dataText(s, lang)) : s);

/** A message (toast, error) built in English: the feature's sentences, else t() per " · " segment. */
export const messageText = (s: string, t: T, lang: Lang) => (fr(lang) ? (ruleFr(s) ?? s.split(' · ').map(t).join(' · ')) : s);
