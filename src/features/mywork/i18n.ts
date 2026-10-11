// My work / Task translation helpers. English stays the prototype's source text; these build the parameterised
// sentences the shared FR rule engine (src/i18n/fr-rules.ts) does not cover (docs/spec/10 OQ19). Fixed strings go
// through t() with their FR entries in src/i18n/extra/mywork.json.
import { moneyEur } from '@/lib/format';
import type { Lang, T } from '@/i18n/translate';
import { dataText } from '@/i18n/data-text';

/**
 * View option "Board" (kanban). Local FR because the shared dictionary keeps "Board" for the pipeline's management
 * board window ("Board" → "Board").
 */
export const boardViewLabel = (lang: Lang) => (lang === 'fr' ? 'Tableau' : 'Board');

/** Group count: "1 task" / "3 tasks". */
export const taskCountText = (n: number, lang: Lang) => (lang === 'fr' ? `${n} tâche${n > 1 ? 's' : ''}` : `${n} task${n === 1 ? '' : 's'}`);

/** Checklist header: "2 of 4 done" (FR "2 sur 4 faits", "1 sur 1 fait"). */
export const checkCountText = (done: number, total: number, lang: Lang) =>
  lang === 'fr' ? `${done} sur ${total} fait${total > 1 ? 's' : ''}` : `${done} of ${total} done`;

/** Person chip note when viewing someone else's work: "Manager view · exactly what Hélène sees". */
export const viewingNoteText = (firstName: string, lang: Lang) =>
  lang === 'fr' ? `Vue manager · exactement ce que voit ${firstName}` : `Manager view · exactly what ${firstName} sees`;

/** Tag of a task created by an approved resource request: "New · approved by Engineering". */
export const freshTagText = (dept: string, t: T, lang: Lang) => (lang === 'fr' ? `Nouveau · approuvé par ${t(dept)}` : `New · approved by ${dept}`);

/** "Logged this week" sub: "of 40 h · 38%". */
export const loggedSubText = (pct: number, lang: Lang) => (lang === 'fr' ? `sur 40 h · ${pct} %` : `of 40 h · ${pct}%`);

/** Day counts in FR: "-27d" → "-27 j", "+20d" → "+20 j" (as on the Plan screen). */
export const daysText = (s: string, lang: Lang) => (lang === 'fr' ? s.replace(/([+\-−]?\d+)d\b/g, '$1 j') : s);

export interface DescriptionActivity {
  code: string;
  name: string;
  wbs: string;
  packageName: string | null;
}

/**
 * Generated description of a task without its own text (10 §7.4 b): "Part of A1250 Steel erection — Bays 3–4 —
 * WBS 1.4 Steel structure. Complete the work, tick the checklist and log your hours; progress rolls up to the
 * activity and the earned value of its work package."
 */
export function defaultDescription(actCode: string, a: DescriptionActivity | null, t: T, lang: Lang): string {
  const pkg = a ? `${a.wbs}${a.packageName ? ' ' + dataText(a.packageName, lang) : ''}` : '';
  if (lang === 'fr')
    return (
      `Fait partie de ${actCode}${a ? ' ' + dataText(a.name, lang) : ''}${a ? ' — WBS ' + pkg : ''}. ` +
      'Réalisez le travail, cochez la liste de contrôle et saisissez vos heures ; l’avancement remonte à l’activité et à la valeur acquise de son lot de travaux.'
    );
  return (
    `Part of ${actCode}${a ? ' ' + a.name : ''}${a ? ' — WBS ' + pkg : ''}. ` +
    'Complete the work, tick the checklist and log your hours; progress rolls up to the activity and the earned value of its work package.'
  );
}

/**
 * Cost note under the time log: "6.0 h × €95/h = €570 actual cost → Labor · WP 1.4 Steel structure" (FR "6.0 h ×
 * 95 €/h = 570 € de coût réel → Main-d’œuvre · Lot 1.4 …"). Rates are euros (RATES, €/h) — the prototype printed "$"
 * whatever the currency (10 OQ20). Without an activity the target is the project.
 */
export function costNoteText(loggedH: number, rate: number | null, cost: number, target: { wbs: string; packageName: string | null } | null, project: string, t: T, lang: Lang): string {
  const where = target ? `${lang === 'fr' ? 'Lot' : 'WP'} ${target.wbs}${target.packageName ? ' ' + dataText(target.packageName, lang) : ''}` : t(project);
  const h = loggedH.toFixed(1);
  // R-046 (NEW-D2-1): the rate — and the cost, which reveals it — only for the director and the PMs.
  if (rate == null) return lang === 'fr' ? `${h} h → ${t('Labor')} · ${where}` : `${h} h → Labor · ${where}`;
  return lang === 'fr'
    ? `${h} h × ${moneyEur(rate, 'fr')}/h = ${moneyEur(cost, 'fr')} de coût réel → ${t('Labor')} · ${where}`
    : `${h} h × ${moneyEur(rate, 'en')}/h = ${moneyEur(cost, 'en')} actual cost → Labor · ${where}`;
}
