import 'server-only';
// R-160 (P2, D9-32): the handover warning of the CE conformity file — added to the toast of the actions that move a machine to its
// handover (Plan SAT, registering delivered machines in the installed base) while the CE file of its equipment line is incomplete
// — whatever the date: Directive 2006/42/EC also requires the file, the declaration and the marking before 20 Jan 2027. A warning only: the action is done (conservative — never a block, owner's brief).
import type { T } from '@/i18n/translate';
import { equipmentRefOfSystem, getProjectCe } from '@/server/dal/ce-conformity';

/**
 * " · CE file incomplete · EQ-02 · the handover is not blocked", or '' when every concerned file is complete. `system`: the
 * commissioning system (its line, or every line for a common one); `equipment`: the line (null = the main line).
 */
export async function ceHandoverWarning(projectCode: string, target: { system: string } | { equipment: string | null }, t: T): Promise<string> {
  try {
    const ce = await getProjectCe(projectCode);
    if (!ce) return '';
    let ref: string | null;
    if ('system' in target) ref = await equipmentRefOfSystem(projectCode, target.system);
    else ref = target.equipment ?? ce.lines[0]?.ref ?? null;
    // A common system (no line) concerns every line of the project.
    const lines = ce.lines.filter((l) => !l.readiness.complete && (ref == null || l.ref === ref));
    if (!lines.length) return '';
    return ` · ${t('CE file incomplete')} · ${lines.map((l) => l.ref).join(', ')} · ${t('the handover is not blocked')}`;
  } catch {
    return '';
  }
}
