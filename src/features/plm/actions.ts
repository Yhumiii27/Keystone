'use server';
// PLM Server Functions (docs/spec/09 §3.7 AF `plm` "Create part"; §2.2 "Register equivalent", which had no handler in
// the prototype). Each one validates the raw input, checks the viewer may edit the parts catalogue (the PLM screen is in
// their workspace: director, PM, engineering lead, quality, procurement), writes through the data-layer writers with the
// viewer as the actor, then revalidates every page (the catalogue and the part drawer of the screens that render it).
import { revalidatePath } from 'next/cache';
import type { FormDialogResult } from '@/components/app/FormDialog';
import { createPart, getPart, registerEquivalent } from '@/server/dal/parts';
import { listEquivalentCandidates } from '@/server/dal/plm';
import { getScreenAccess } from '@/server/project-context';
import { getI18n } from '@/server/session';
import { NEW_PART_RESULT, parseNewPart } from './forms';
import { duplicateRefT, equivalentRegisteredT } from './i18n';

/** Form values as sent by the client, keeping string entries only (a forged payload never reaches `.trim()`). */
const strings = (values: unknown): Record<string, string> =>
  values && typeof values === 'object'
    ? Object.fromEntries(Object.entries(values).filter((e): e is [string, string] => typeof e[1] === 'string'))
    : {};

/** The viewer, when the parts catalogue is in their workspace; else the translated refusal. */
async function editor(): Promise<{ actor: string } | { error: string }> {
  const [{ t }, access] = await Promise.all([getI18n(), getScreenAccess('plm')]);
  if (!access.canEdit) return { error: t('The parts catalogue is read-only for you') };
  return { actor: access.viewer.name };
}

const refresh = () => revalidatePath('/', 'layout');

/** "New part" → "Create part": appended as Not validated (qualification pending), revision A; toast "Part created in the catalogue". */
export async function createPartAction(values: Record<string, string>): Promise<FormDialogResult> {
  const ok = await editor();
  if ('error' in ok) return ok;
  const { t, lang } = await getI18n();
  const parsed = parseNewPart(strings(values));
  if (!parsed.ok) return { error: t(parsed.error) };
  const v = parsed.value;
  if (await getPart(v.ref)) return { error: duplicateRefT(v.ref, lang) };
  try {
    await createPart({ ref: v.ref, name: v.name, family: v.family, supplier: v.supplier, priceEur: v.priceEur, unit: v.unit }, ok.actor);
  } catch {
    return { error: t('The change could not be saved') };
  }
  refresh();
  return { toast: t(NEW_PART_RESULT) };
}

/** "Register equivalent": records the equivalence both ways; toast "Equivalent registered · REF". */
export async function registerEquivalentAction(ref: string, values: Record<string, string>): Promise<FormDialogResult> {
  const ok = await editor();
  if ('error' in ok) return ok;
  const { t } = await getI18n();
  if (typeof ref !== 'string' || !ref) return { error: t('Invalid request') };
  const equivalent = strings(values).equivalent?.trim() ?? '';
  const candidates = await listEquivalentCandidates(ref);
  if (!(await getPart(ref))) return { error: t('Unknown part') };
  if (!equivalent || !candidates.some((c) => c.ref === equivalent)) return { error: t('Choose a part of the catalogue') };
  try {
    await registerEquivalent(ref, equivalent, ok.actor);
  } catch {
    return { error: t('The change could not be saved') };
  }
  refresh();
  return { toast: equivalentRegisteredT(equivalent, t) };
}
