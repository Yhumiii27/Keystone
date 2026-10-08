// Parameterised French forms the shared dictionary lacks (docs/spec/01 §13.4 gaps) for the Projects register and
// the New project wizard. Everything else goes through t() (exact entries in src/i18n/extra/projects.json).
import type { WizardSummaryInput } from '@/domain/lifecycle';
import { wizardSummary } from '@/domain/lifecycle';
import type { Lang, T } from '@/i18n/translate';

/** Card title "{stage|All} projects · {n}" — FR "Projets {étape} · n" / "Tous les projets · n". */
export function registerTitleText(t: T, lang: Lang, stageLabel: string | null, rows: number): string {
  if (!stageLabel) return t(`All projects · ${rows}`);
  return lang === 'fr' ? `Projets ${t(stageLabel)} · ${rows}` : `${stageLabel} projects · ${rows}`;
}

/** Copy-panel "n categories" / "Define in step 3". */
export function categoriesText(t: T, lang: Lang, n: number): string {
  if (!n) return t('Define in step 3');
  return lang === 'fr' ? `${n} catégorie${n > 1 ? 's' : ''}` : `${n} categories`;
}

/** "Will be created" sentence (summary 3967), with a French version of its tail. */
export function wizardSummaryText(t: T, lang: Lang, s: WizardSummaryInput): string {
  if (lang !== 'fr') return wizardSummary(s);
  const structure = s.template.blank ? 'WBS vide' : `${s.template.wbs}, ${s.template.acts} copiés`;
  return (
    `${s.projectId} · ${s.analytic} · DAS ${s.das} · ${s.machineType} · ${s.name || t('Untitled project')} · statut Initiative · ` +
    `${structure} · ${s.categories} ${s.categories > 1 ? 'catégories' : 'catégorie'} de coûts avec ${s.contingencyPct} % de provision pour aléas · ` +
    `calendrier ${t(s.calendar)} · ` +
    'date de référence hebdomadaire.'
  );
}
