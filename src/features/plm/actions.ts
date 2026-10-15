'use server';
// PLM Server Functions (docs/spec/09 §3.7 AF `plm` "Create part"; §2.2 "Register equivalent", which had no handler in
// the prototype). Each one validates the raw input, checks the viewer may edit the parts catalogue (the PLM screen is in
// their workspace: director, PM, engineering lead, quality, procurement), writes through the data-layer writers with the
// viewer as the actor, then revalidates every page (the catalogue and the part drawer of the screens that render it).
// R-102 (E-1a = a, E-1b = a): "Complete the record" (the catalogue's editors while the part is Not validated, the engineering
// lead and the director once it is Validated) and "Validate part" (engineering lead, director — the active role); the
// writers re-check the rule and the status on the locked row.
import { revalidatePath } from 'next/cache';
import type { FormDialogResult } from '@/components/app/FormDialog';
import { canCompletePartRecord, canValidatePart, parsePartQualification, partValidationErrors } from '@/domain/parts';
import { PartQualificationError, createPart, getPart, registerEquivalent, updatePartQualification, validatePart } from '@/server/dal/parts';
import { logError } from '@/server/log';
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

/** A catalogue reference as stored (upper case, as `parseNewPart` accepts it). */
const PART_REF_RE = /^[A-Z0-9][A-Z0-9._/-]{0,39}$/;
const VALIDATED_LOCKED = 'Only the engineering lead or the director changes a validated part';
const NOT_VALIDATOR = 'Only the engineering lead or the director validates a part';
const NOT_PENDING = 'This part is no longer awaiting validation';

/** A writer's refusal (the part moved on between the drawer and the click) → its translated message. */
function qualificationRefusal(e: unknown, t: (s: string) => string): FormDialogResult | null {
  if (!(e instanceof PartQualificationError)) return null;
  if (e.code === 'stale') return { error: t(NOT_PENDING) };
  if (e.code === 'unknown') return { error: t('Unknown part') };
  if (e.code === 'incomplete') return { error: e.message.split(' · ').map(t).join(' · ') };
  return { error: t(e.message) };
}

/** R-102 "Complete the record": HS code (or Not applicable), export restriction confirmed, lead time, manufacturer reference. */
export async function completePartRecordAction(ref: string, values: Record<string, string>): Promise<FormDialogResult> {
  const [{ t }, access] = await Promise.all([getI18n(), getScreenAccess('plm')]);
  if (!access.canEdit) return { error: t('The parts catalogue is read-only for you') };
  if (typeof ref !== 'string' || !PART_REF_RE.test(ref)) return { error: t('Invalid request') };
  const part = await getPart(ref);
  if (!part) return { error: t('Unknown part') };
  if (!canCompletePartRecord(part.status, access.viewer.role, true)) return { error: t(VALIDATED_LOCKED) };
  const parsed = parsePartQualification(strings(values));
  if (!parsed.ok) return { error: t(parsed.error) };
  try {
    const r = await updatePartQualification(part.ref, parsed.value, { name: access.viewer.name, role: access.viewer.role });
    refresh();
    return { toast: `${part.ref} · ${t(r.changed ? 'Record updated' : 'Nothing to change')}` };
  } catch (e) {
    const refused = qualificationRefusal(e, t);
    if (refused) return refused;
    logError('completePartRecordAction', e);
    return { error: t('The change could not be saved') };
  }
}

/** R-102 "Validate part": Not validated → Validated once the record is complete; engineering lead or director (active role). */
export async function validatePartAction(ref: string): Promise<{ toast?: string; error?: string }> {
  const [{ t }, access] = await Promise.all([getI18n(), getScreenAccess('plm')]);
  if (!access.canEdit) return { error: t('The parts catalogue is read-only for you') };
  if (typeof ref !== 'string' || !PART_REF_RE.test(ref)) return { error: t('Invalid request') };
  const part = await getPart(ref);
  if (!part) return { error: t('Unknown part') };
  if (part.status !== 'not_validated') {
    refresh(); // the drawer is stale
    return { error: t(NOT_PENDING) };
  }
  if (!canValidatePart(part.status, access.viewer.role)) return { error: t(NOT_VALIDATOR) };
  const missing = partValidationErrors(part);
  if (missing.length) return { error: missing.map(t).join(' · ') };
  try {
    await validatePart(part.ref, { name: access.viewer.name, role: access.viewer.role });
    refresh();
    return { toast: `${part.ref} · ${t('Validated')}` };
  } catch (e) {
    const refused = qualificationRefusal(e, t);
    if (refused) return refused as { error: string };
    logError('validatePartAction', e);
    return { error: t('The change could not be saved') };
  }
}
