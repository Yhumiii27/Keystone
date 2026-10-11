// Documents-specific translation helpers. English stays the prototype's source text (docs/spec/10 §4–§5); the
// French comes from the prototype dictionary through t(), with the fixes below where the shared dictionary is wrong
// in this context or the prototype left parameterised strings in English:
// - approver role "Direction" (management) is "Sens" in the shared dictionary (the connector form's direction
//   field), so circuit roles go through `roleT`;
// - "Opening Codex · project HLT-026", "PID-HLT-026 · new revision E", "1 selected", "Approve in Codex · {role} ·
//   {name}" (the prototype translated neither the word "project", the revision banner, the singular nor the role);
// - Keystone-created records (deposits, minutes): typed titles and tags are translated only on an exact dictionary
//   match (`exactT`), never segment by segment.
import { approveLabelText } from '@/domain/documents';
import { dataText } from '@/i18n/data-text';
import type { Lang, T } from '@/i18n/translate';

const fr = (lang: Lang) => lang === 'fr';

/** Approver-role labels whose French differs from the shared dictionary entry. */
const ROLE_FR: Record<string, string> = { Direction: 'Direction' };

/** Circuit role label ("Quality manager" → "Responsable qualité", "Direction" → "Direction"). */
export const roleT = (t: T, lang: Lang) => (label: string) => (fr(lang) && Object.hasOwn(ROLE_FR, label) ? ROLE_FR[label] : t(label));

/** Approval circuit "Author → Quality manager → Direction", role by role. */
export const circuitT = (labels: readonly string[], t: T, lang: Lang) => labels.map(roleT(t, lang)).join(' → ');

/** Free text typed in Keystone: as typed, or a seeded string's exact dictionary entry (R-148: the shared helper). */
export const exactT = (s: string, lang: Lang) => dataText(s, lang);

/** Toast "Opening Codex · project HLT-026" (`openCodex`). */
export const openingCodexProjectText = (code: string, lang: Lang) => (fr(lang) ? `Ouverture de Codex · projet ${code}` : `Opening Codex · project ${code}`);

/** Deposit banner "PID-HLT-026 · new revision E" (EN source from the domain). */
export const revisionContextT = (english: string, lang: Lang) => (fr(lang) ? english.replace(' · new revision', ' · nouvelle révision') : english);

/** Selection bar "1 selected" / "3 selected". */
export const selectedT = (n: number, t: T, lang: Lang) => (fr(lang) ? `${n} sélectionné${n > 1 ? 's' : ''}` : t(`${n} selected`));

/** Delivery 7 (R-124): "Sync now" toast tail "2 decisions pending sync with Codex". */
export const pendingSyncCountText = (n: number, lang: Lang) =>
  fr(lang)
    ? `${n} décision${n > 1 ? 's' : ''} en attente de synchronisation avec Codex`
    : `${n} decision${n > 1 ? 's' : ''} pending sync with Codex`;

/** "Approve in Codex · Quality manager · G. Comte" with the role translated. */
export const approveLabelT = (roleLabel: string, approver: string, t: T, lang: Lang) =>
  t(approveLabelText(roleT(t, lang)(roleLabel), approver));
