'use server';
// Warranty & after-sales Server Functions (docs/spec/07 §3 AF `fleet` "Add machine" and AF `sav` "New warranty claim").
// Each one checks the viewer's workspace includes the screen (director, pm, quality, procurement — the others reach the
// screens "outside my workspace", read-only), validates the raw form values with the domain parsers against the
// current options, writes through the data-layer writers with the viewer as the actor (audit trail, activity), then
// revalidates every page (the sidebar badge, the zone bar counts, the part record's installed base and both screens).
// Messages are English source strings translated per " · " segment.
import { revalidatePath } from 'next/cache';
import type { FormDialogResult } from '@/components/app/FormDialog';
import { parseNewClaim, parseNewMachine } from '@/domain/aftersales';
import { claimFormOptions, machineTypeOptions } from '@/server/dal/aftersales';
import { openClaim } from '@/server/dal/claims';
import { addMachine } from '@/server/dal/fleet';
import { getScreenAccess } from '@/server/project-context';
import { getI18n } from '@/server/session';
import { CLAIM_RESULT, MACHINE_RESULT } from './forms';
import { messageText } from './i18n';
import { logError } from '@/server/log';

/** Form values as sent by the client, keeping string entries only (a forged payload never reaches `.trim()`). */
const strings = (values: unknown): Record<string, string> =>
  values && typeof values === 'object' && !Array.isArray(values)
    ? Object.fromEntries(Object.entries(values).filter((e): e is [string, string] => typeof e[1] === 'string'))
    : {};

const refreshAll = () => revalidatePath('/', 'layout');

/** "Add machine": MCH-050, MCH-051…, no delivering project, In warranty; toast "Machine added to the installed base". */
export async function addMachineAction(values: Record<string, string>): Promise<FormDialogResult> {
  const [{ t }, access] = await Promise.all([getI18n(), getScreenAccess('fleet')]);
  if (!access.canEdit) return { error: messageText('The installed base is read-only for you', t) };
  const parsed = parseNewMachine(strings(values), (await machineTypeOptions()).map((m) => m.code));
  if (!parsed.ok) return { error: messageText(parsed.error, t) };
  const v = parsed.value;
  try {
    await addMachine(
      { name: v.name, machineType: v.machineType, client: v.client, site: v.site, deliveredOn: v.deliveredOn, warrantyEndOn: v.warrantyEndOn },
      { name: access.viewer.name, role: access.viewer.role },
    );
  } catch (e) {
    logError('addMachineAction', e);
    return { error: messageText('The change could not be saved', t) };
  }
  refreshAll();
  return { toast: messageText(MACHINE_RESULT, t) };
}

/**
 * "New warranty claim" → "Open claim": WC-020, WC-021…, Open, reported on the prototype's "today" (30 Sep 2026), cost 0;
 * toast "Warranty claim opened".
 */
export async function openClaimAction(values: Record<string, string>): Promise<FormDialogResult> {
  const [{ t }, access] = await Promise.all([getI18n(), getScreenAccess('sav')]);
  if (!access.canEdit) return { error: messageText('Warranty claims are read-only for you', t) };
  const opts = await claimFormOptions();
  const parsed = parseNewClaim(strings(values), opts.machines.map((m) => m.number), opts.owners);
  if (!parsed.ok) return { error: messageText(parsed.error, t) };
  try {
    await openClaim(parsed.value, { name: access.viewer.name, role: access.viewer.role });
  } catch (e) {
    logError('openClaimAction', e);
    return { error: messageText('The change could not be saved', t) };
  }
  refreshAll();
  return { toast: messageText(CLAIM_RESULT, t) };
}
