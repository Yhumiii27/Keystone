// Header project switcher lines (prototype projSwitcher / projMatch, docs/spec/01 §5.2), from the project record.
// R-170: the number, analytic code, business area (DAS) and machine type are the project's own columns; the prototype
// constant PROJ_ID only knew its six projects, so a project created by the wizard showed " · DAS — ·  · S. Perrin".
import type { ProjectRow } from '@/server/dal/projects';

type OptionSource = Pick<ProjectRow, 'code' | 'name' | 'displayId' | 'analytic' | 'das' | 'machineType' | 'equipment' | 'pm' | 'client'>;

/**
 * "HAV004 · DAS 2 · EMP · R. Aubert": codes and a person's name, data shown as stored (never translated). R-185: the equipment
 * lines in place of the machine type ("HAV004 · DAS 2 · 1 × EMP · 3 × MEMU · R. Aubert").
 */
export const projectOptionSub = (p: OptionSource) => `${p.analytic ?? ''} · DAS ${p.das ?? '—'} · ${p.equipment ?? p.machineType ?? ''} · ${p.pm}`;

/**
 * Lower-cased search text of a switcher option: code, name, number, analytic code, PM and client (projMatch), plus the
 * name as displayed when it differs (a seeded name shown in French), so what the user reads also matches.
 */
export function projectOptionHaystack(p: OptionSource, shownName: string): string {
  const number = p.displayId !== p.code ? p.displayId : '';
  const shown = shownName !== p.name ? shownName : '';
  return [p.code, p.name, number, p.analytic ?? '', p.pm, p.client, shown].filter(Boolean).join(' ').toLowerCase();
}
