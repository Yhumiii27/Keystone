'use server';
// Project BOM Server Functions (docs/spec/09 §1.12 AF `bom`). "Add to BOM" validates the raw form values with the
// domain parser (catalogue reference not yet in the project BOM, positive quantity, one of the offered activities,
// scope code), checks the viewer may edit the BOM of this project (screen in their workspace, project not read-only
// for them), writes the line through the BOM data layer with the viewer as the actor (audit row), then revalidates the
// project's pages (BOM, part record, PLM usage, shortfall on Purchase orders).
import { revalidatePath } from 'next/cache';
import type { FormDialogResult } from '@/components/app/FormDialog';
import { screenHref } from '@/config/screens';
import { parseNewBomLine } from '@/domain/bom';
import { equipmentChoiceOf } from '@/domain/equipment-scope';
import { addBomLine, getProjectBom, listBomActivityOptions, setBomLineEquipment } from '@/server/dal/bom';
import { listProjectEquipments } from '@/server/dal/project-equipment';
import { listParts } from '@/server/dal/parts';
import { getProject } from '@/server/dal/projects';
import { getProjectContext } from '@/server/project-context';
import { getI18n } from '@/server/session';
import { BOM_RESULT } from './forms';

/** Form values as sent by the client, keeping string entries only (a forged payload never reaches `.trim()`). */
const strings = (values: unknown): Record<string, string> =>
  values && typeof values === 'object' && !Array.isArray(values)
    ? Object.fromEntries(Object.entries(values).filter((e): e is [string, string] => typeof e[1] === 'string'))
    : {};

/** Toast / error text translated per " · " segment, like the prototype's showToast. */
async function tr(english: string) {
  const { t } = await getI18n();
  return english.split(' · ').map(t).join(' · ');
}

/** "Add article" → "Add to BOM": the catalogue article joins the project BOM; toast "Article added to the project BOM". */
export async function addBomArticleAction(code: unknown, values: unknown): Promise<FormDialogResult> {
  if (typeof code !== 'string' || !code) return { error: await tr('Invalid request') };
  const project = await getProject(code);
  if (!project) return { error: await tr('Unknown project') };
  const ctx = await getProjectContext(project.code, 'bom');
  if (!ctx.canEdit('bom')) return { error: await tr('This project BOM is read-only for you') };
  const [catalogue, bom, activities] = await Promise.all([listParts(), getProjectBom(project.code), listBomActivityOptions(project.code)]);
  const parsed = parseNewBomLine(strings(values), {
    catalogue: new Set(catalogue.map((p) => p.ref)),
    inBom: new Set((bom?.lines ?? []).map((l) => l.ref)),
    activities: activities.map((a) => a.code),
  });
  if (!parsed.ok) return { error: await tr(parsed.error) };
  // R-185: the equipment line of the article (offered when the project has more than one line; else common).
  const equipment = equipmentChoiceOf(strings(values).equipment, (await listProjectEquipments(project.code)).map((l) => l.ref));
  if (!equipment.ok) return { error: await tr(equipment.error) };
  try {
    await addBomLine(project.code, { ...parsed.value, equipment: equipment.value }, ctx.viewer.name);
  } catch {
    return { error: await tr('The change could not be saved') };
  }
  revalidatePath(`/projects/${project.code}`, 'layout');
  revalidatePath(screenHref('plm'));
  return { toast: await tr(BOM_RESULT) };
}

/**
 * R-185 part 2: the equipment line of a BOM line, changed on the flat list — a line of the project ("EQ-02") or "common". Same
 * rights as "Add article" (the BOM screen editable for the viewer on this project); toast "Equipment saved".
 */
export async function setBomLineEquipmentAction(code: unknown, ref: unknown, equipment: unknown): Promise<{ toast: string } | { error: string }> {
  if (typeof code !== 'string' || !code || typeof ref !== 'string' || !ref || typeof equipment !== 'string') return { error: await tr('Invalid request') };
  const project = await getProject(code);
  if (!project) return { error: await tr('Unknown project') };
  const ctx = await getProjectContext(project.code, 'bom');
  if (!ctx.canEdit('bom')) return { error: await tr('This project BOM is read-only for you') };
  const choice = equipmentChoiceOf(equipment, (await listProjectEquipments(project.code)).map((l) => l.ref));
  if (!choice.ok) return { error: await tr(choice.error) };
  const bom = await getProjectBom(project.code);
  if (!bom?.lines.some((l) => l.ref === ref)) return { error: await tr('Unknown article') };
  try {
    await setBomLineEquipment(project.code, ref, choice.value, ctx.viewer.name);
  } catch {
    return { error: await tr('The change could not be saved') };
  }
  revalidatePath(`/projects/${project.code}`, 'layout');
  return { toast: await tr('Equipment saved') };
}
