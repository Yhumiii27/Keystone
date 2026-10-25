'use server';
// Machine catalogue Server Functions of the Machine catalogue screen (R-186, AC-4; choice 5 of the framing: the portfolio
// director and the engineering lead edit the catalogue; owner, 25 Oct 2026: the catalogue has its own screen). The per-equipment
// flag of a standard phase stays on the Machine types screen (src/features/admin/actions.ts). Each one checks the viewer's
// workspace and role, validates the raw input with the domain parsers,
// writes through the DAL with the viewer as the actor (the DAL re-checks the rights and records the audit row and activity),
// then revalidates the app (the equipment forms and the shared view read the catalogue).
import { revalidatePath } from 'next/cache';
import { CATALOGUE_EDITORS_ONLY, CATALOGUE_CODE_RE, canEditCatalogue, normaliseCatalogueCode } from '@/domain/machine-catalogue';
import {
  createCatalogueEntry, discardCatalogueDraft, newCatalogueVersion, publishCatalogueVersion, retireCatalogueVersion, updateCatalogueDraft,
} from '@/server/dal/machine-catalogue';
import { getMachineType } from '@/server/dal/mtypes';
import type { Actor } from '@/server/dal/ops-common';
import { getScreenAccess } from '@/server/project-context';
import { getI18n } from '@/server/session';
import type { AdminActionResult } from '@/features/admin/actions';
import { CATALOGUE_READ_ONLY, catalogueErrorT } from './i18n';

const refresh = () => revalidatePath('/', 'layout');

async function tr(english: string) {
  const { t } = await getI18n();
  return t(english);
}

/**
 * Catalogue writers: the Machine catalogue workspace (director, PM, engineering lead, quality — others get the read-only
 * refusal) and, among its roles, the director and the engineering lead (choice 5).
 */
async function catalogueEditor(): Promise<{ actor: Actor } | { error: string }> {
  const access = await getScreenAccess('catalogue');
  if (!access.canEdit) return { error: await tr(CATALOGUE_READ_ONLY) };
  const actor = { name: access.viewer.name, role: access.viewer.role };
  return canEditCatalogue(actor.role) ? { actor } : { error: await tr(CATALOGUE_EDITORS_ONLY) };
}

async function failure(e: unknown): Promise<{ error: string }> {
  const { t, lang } = await getI18n();
  return { error: catalogueErrorT(e instanceof Error ? e.message : '', t, lang) ?? t('The change could not be saved') };
}

const isText = (v: unknown, max = 200): v is string => typeof v === 'string' && v.length <= max;
const isCode = (v: unknown): v is string => isText(v, 30) && CATALOGUE_CODE_RE.test(v);
const isVersion = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 99999;

/** Only the content fields, as strings (the DAL parses them again). */
function contentFields(values: unknown): Record<string, string> | null {
  if (!values || typeof values !== 'object') return null;
  const out: Record<string, string> = {};
  for (const k of ['variant', 'label', 'description', 'nominalCapacity', 'capacityUnit', 'indicativePriceKeur', 'leadTimeWeeks', 'options']) {
    const v = (values as Record<string, unknown>)[k];
    if (v == null) continue;
    if (!isText(v, 5000)) return null;
    out[k] = v;
  }
  return out;
}

async function run(guard: () => Promise<{ actor: Actor } | { error: string }>, write: (actor: Actor) => Promise<unknown>, toast?: string): Promise<AdminActionResult> {
  const ok = await guard();
  if ('error' in ok) return ok;
  try {
    await write(ok.actor);
  } catch (e) {
    return failure(e);
  }
  refresh();
  return toast ? { ok: true, toast: await tr(toast) } : { ok: true };
}

/** "New catalogue entry" on machine type `typeCode` (the form's machine type): code + content → version 1, draft; returns the code. */
export async function createCatalogueEntryAction(typeCode: unknown, values: unknown): Promise<AdminActionResult> {
  const ok = await catalogueEditor();
  if ('error' in ok) return ok;
  const mt = isText(typeCode, 40) && typeCode ? (await getMachineType(typeCode))?.code ?? null : null;
  const fields = contentFields(values);
  const code = values && typeof values === 'object' ? (values as Record<string, unknown>).code : null;
  if (!mt || !fields || !isText(code, 60)) return { error: await tr('Invalid request') };
  if (!normaliseCatalogueCode(code)) return { error: await tr('Code is required') };
  let created: string;
  try {
    created = await createCatalogueEntry({ ...fields, code, machineTypeCode: mt }, ok.actor);
  } catch (e) {
    return failure(e);
  }
  refresh();
  return { ok: true, toast: await tr('Catalogue draft saved'), code: created };
}

/** "Edit draft": the content of a draft version. */
export async function updateCatalogueDraftAction(code: unknown, version: unknown, values: unknown): Promise<AdminActionResult> {
  const fields = contentFields(values);
  if (!isCode(code) || !isVersion(version) || !fields) {
    const r = await catalogueEditor();
    return 'error' in r ? r : { error: await tr('Invalid request') };
  }
  return run(catalogueEditor, (actor) => updateCatalogueDraft(code, version, fields, actor), 'Catalogue draft saved');
}

/** "New version" of a code (a draft copied from its latest version). */
export async function newCatalogueVersionAction(code: unknown): Promise<AdminActionResult> {
  if (!isCode(code)) return run(catalogueEditor, async () => { throw new Error('Invalid request'); });
  return run(catalogueEditor, (actor) => newCatalogueVersion(code, actor), 'Catalogue draft saved');
}

/** "Publish": freezes the draft and offers it to the subsidiaries; the code's published version is retired. */
export async function publishCatalogueVersionAction(code: unknown, version: unknown): Promise<AdminActionResult> {
  if (!isCode(code) || !isVersion(version)) return run(catalogueEditor, async () => { throw new Error('Invalid request'); });
  return run(catalogueEditor, (actor) => publishCatalogueVersion(code, version, actor), 'Catalogue version published');
}

/** "Retire": the published version leaves the catalogue offered to the subsidiaries. */
export async function retireCatalogueVersionAction(code: unknown, version: unknown): Promise<AdminActionResult> {
  if (!isCode(code) || !isVersion(version)) return run(catalogueEditor, async () => { throw new Error('Invalid request'); });
  return run(catalogueEditor, (actor) => retireCatalogueVersion(code, version, actor), 'Catalogue version retired');
}

/** "Discard draft". */
export async function discardCatalogueDraftAction(code: unknown, version: unknown): Promise<AdminActionResult> {
  if (!isCode(code) || !isVersion(version)) return run(catalogueEditor, async () => { throw new Error('Invalid request'); });
  return run(catalogueEditor, (actor) => discardCatalogueDraft(code, version, actor), 'Catalogue draft discarded');
}
