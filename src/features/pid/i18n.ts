// P&ID translation helpers. English stays the prototype's source text (docs/spec/09 §6); the French comes from the
// prototype dictionary through t(), with these local forms:
// - drawing data (tag descriptions, part names, feedback texts, notes, activity names) is translated on exact
//   dictionary matches only — the whole text, then its " · ", " — ", " → " segments — as the prototype's deepTr did
//   for these values ("Safety PLC — E-stop loop" → "Automate sécurité — E-stop loop"), never through the sentence rules;
// - parameterised texts with their singular forms ("1 sheet", "1 client-supplied") the prototype never built;
// - "rev C" is "rév. C" everywhere (the prototype left "rev" in the drawing card title and the import toast);
// - the drawing state in the KPI sub-line is translated (the prototype left "Under review" in English);
// - the import dialog, its staged plan and the messages are new.
import FR_DICT_BASE from '@/i18n/fr-dict.json';
import { EXTRA_FR } from '@/i18n/extra';
import type { Lang, T } from '@/i18n/translate';
import { displayOfIso, fmtDOfIso } from '@/server/db/codes';

const DICT: Record<string, string> = { ...(FR_DICT_BASE as Record<string, string>), ...EXTRA_FR };
const fr = (lang: Lang) => lang === 'fr';
const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** Data text: French only on an exact dictionary match, the whole text then its " · " / " — " / " → " segments. */
export function dataT(s: string, lang: Lang): string {
  if (!fr(lang) || !s) return s;
  if (Object.hasOwn(DICT, s)) return DICT[s];
  return s
    .split(/( · | — | → )/)
    .map((p, i) => (i % 2 ? p : Object.hasOwn(DICT, p) ? DICT[p] : p))
    .join('');
}

/** "rev C" / "rév. C". */
export const revT = (rev: string, lang: Lang) => (fr(lang) ? `rév. ${rev}` : `rev ${rev}`);

/** KPI "P&ID" value: "PID-HLT-026 rev C". */
export const pidValueT = (doc: string, rev: string, lang: Lang) => `${doc} ${revT(rev, lang)}`;

/** KPI "P&ID" sub-line: "4 sheets · Under review · 12 Sep 2026". */
export function sheetsSubT(sheets: number, stateLabel: string, issuedOnIso: string, t: T, lang: Lang): string {
  const n = fr(lang) ? `${sheets} ${plural(sheets, 'feuille', 'feuilles')}` : `${sheets} ${plural(sheets, 'sheet', 'sheets')}`;
  return `${n} · ${t(stateLabel)} · ${t(displayOfIso(issuedOnIso))}`;
}

/** KPI "Tags in our scope" sub-line: "5 overlay · 2 client-supplied". */
export const scopeSubT = (overlay: number, client: number, lang: Lang) =>
  fr(lang) ? `${overlay} surcouche · ${client} ${plural(client, 'fourni', 'fournis')} par le client` : `${overlay} overlay · ${client} client-supplied`;

/** KPI "Linked to a BOM reference" sub-line: "13 / 22 tags". */
export const linkedSubT = (linked: number, inScope: number) => `${linked} / ${inScope} ${plural(inScope, 'tag', 'tags')}`;

/** Drawer "Sheet": "PID-HLT-026 · sheet 3" / "PID-HLT-026 · feuille 3". */
export const sheetLabelT = (doc: string, sheet: number, lang: Lang) => `${doc} · ${fr(lang) ? 'feuille' : 'sheet'} ${sheet}`;

/** Drawing card placeholder: "Drop the P&ID (PDF / PNG) — sheets 1–4". */
export function placeholderT(sheets: number, t: T, lang: Lang): string {
  if (sheets === 4) return t('Drop the P&ID (PDF / PNG) — sheets 1–4');
  const range = sheets > 1 ? `1–${sheets}` : '1';
  return fr(lang) ? `Déposer le PID (PDF / PNG) — ${plural(sheets, 'feuille', 'feuilles')} ${range}` : `Drop the P&ID (PDF / PNG) — ${plural(sheets, 'sheet', 'sheets')} ${range}`;
}

const EXTRACTED = /^Tags extracted from P&ID rev (\S+)$/;
const RELEASED = /^P&ID released for construction \(rev ([^)]*)\)$/;
/** Validation step label: dictionary, then the revision patterns ("Tags extracted from P&ID rev E"). */
export function stepLabelT(label: string, t: T, lang: Lang): string {
  if (!fr(lang) || Object.hasOwn(DICT, label)) return t(label);
  const e = EXTRACTED.exec(label);
  if (e) return `Tags extraits du PID rév. ${e[1]}`;
  const r = RELEASED.exec(label);
  if (r) return `PID diffusé pour construction (rév. ${r[1]})`;
  return dataT(label, lang);
}

/** Step "who · date": who through the dictionary segments ("Quality · Engineering"), date "12 Sep" or "—". */
export const stepWhoT = (who: string, lang: Lang) => dataT(who, lang);
export const stepDateT = (dateIso: string | null, t: T) => (dateIso ? t(fmtDOfIso(dateIso)) : '—');

// ── Import ───────────────────────────────────────────────────────────────────────────────────────────────

/** Import toast (AF_RESULT.pid with the real numbers): "27 tags · rev E imported · 3 new · 1 updated". */
export function importToastT(c: { imported: number; new: number; updated: number; removed: number; rejected: number }, rev: string, lang: Lang): string {
  if (!fr(lang)) {
    return `${c.imported} ${plural(c.imported, 'tag', 'tags')} · rev ${rev} imported · ${c.new} new · ${c.updated} updated` + (c.removed ? ` · ${c.removed} removed` : '') + (c.rejected ? ` · ${c.rejected} rejected` : '');
  }
  return (
    `${c.imported} ${plural(c.imported, 'tag', 'tags')} · rév. ${rev} ${plural(c.imported, 'importé', 'importés')} · ${c.new} ${plural(c.new, 'nouveau', 'nouveaux')} · ${c.updated} mis à jour` +
    (c.removed ? ` · ${c.removed} ${plural(c.removed, 'supprimé', 'supprimés')}` : '') +
    (c.rejected ? ` · ${c.rejected} ${plural(c.rejected, 'refusé', 'refusés')}` : '')
  );
}

/** Revision line of the staged plan: "Revision C → E" / "Registers PID-NDC-031 rev A" / "Revision E (unchanged)". */
export function revisionLineT(current: string | null, next: string, doc: string | null, lang: Lang): string {
  if (current == null) return fr(lang) ? `Enregistre le PID du projet · ${doc ?? 'PID'} rév. ${next}` : `Registers the project’s P&ID · ${doc ?? 'P&ID'} rev ${next}`;
  if (current === next) return fr(lang) ? `Révision ${next} (inchangée)` : `Revision ${next} (unchanged)`;
  return fr(lang) ? `Révision ${current} → ${next}` : `Revision ${current} → ${next}`;
}

/** Messages with parameters (domain / data layer, English) → French; the others through t(). */
const MESSAGE_FR: [RegExp, string][] = [
  [/^Invalid kind "(.*)" \(Instrument or Equipment\)$/, 'Nature « $1 » invalide (Instrument ou Équipement)'],
  [/^Invalid scope "(.*)" \(Keystone, Overlay or Client\)$/, 'Périmètre « $1 » invalide (Keystone, Surcouche ou Client)'],
  [/^Invalid PLC "(.*)" \(P, S, L or empty\)$/, 'Automate « $1 » invalide (P, S, L ou vide)'],
  [/^Invalid role "(.*)" \(sensor, actuator, ctrl or passive\)$/, 'Rôle « $1 » invalide (capteur, actionneur, contrôleur ou passif)'],
  [/^Invalid sheet "(.*)"$/, 'Feuille « $1 » invalide'],
  [/^Invalid tag "(.*)"$/, 'Tag « $1 » invalide'],
  [/^Duplicate tag \(line (\d+)\)$/, 'Tag en double (ligne $1)'],
  [/^Too many lines \(more than (\d+)\)$/, 'Trop de lignes (plus de $1)'],
  [/^(\S+) is not in the catalogue$/, '$1 n’est pas au catalogue'],
  [/^Activity (\S+) is not in the project plan$/, 'L’activité $1 n’est pas au planning du projet'],
  [/^Mapping kept in Keystone \((\S+); the file gives (\S+)\)$/, 'Association conservée dans Keystone ($1 ; le fichier indique $2)'],
  [/^Mapping to (\S+) removed: client-supplied equipment$/, 'Association à $1 retirée : équipement fourni par le client'],
  [/^Mapping to (\S+) lost$/, 'Association à $1 perdue'],
  [/^(\S+) is not a BOM article of a compatible type$/, '$1 n’est pas un article de la nomenclature de type compatible'],
  [/^(.+) is not mapped$/, '$1 n’est associé à aucune référence'],
  [/^(.+) is already linked to (\S+)$/, '$1 est déjà lié à $2'],
  [/^Unknown tag (.+) on (\S+)$/, 'Tag $1 inconnu sur $2'],
];
export function messageT(msg: string, t: T, lang: Lang): string {
  if (!fr(lang) || Object.hasOwn(DICT, msg)) return t(msg);
  for (const [re, rep] of MESSAGE_FR) if (re.test(msg)) return msg.replace(re, rep);
  return t(msg);
}

/** Changed fields of an updated tag: "Description, State feedback". */
export const fieldsT = (labels: readonly string[], t: T) => labels.map(t).join(', ');

/** Mapping toasts: "Tag linked · TT-102 → EL-SWG-11KV", "Tag unlinked · LT-101". */
export const linkedToastT = (tag: string, ref: string, t: T) => `${t('Tag linked')} · ${tag} → ${ref}`;
export const unlinkedToastT = (tag: string, t: T) => `${t('Tag unlinked')} · ${tag}`;
