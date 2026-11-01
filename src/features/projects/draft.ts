// The New project wizard's draft (docs/spec/01 §10, 03 §5.8) checked on the server: the Projects register's createProjectAction and,
// R-187 (K-10), the creation of a project from a subsidiary's ordered need (src/features/capex-needs/actions.ts) share it. Messages
// are English source strings (the client shows them with toast showEn).
import { CATEGORY_TYPES, CONTINGENCIES, DAS_LIST, WIZARD_CURRENCIES } from '@/domain/lifecycle';
import { parseCatalogueChoice } from '@/domain/machine-catalogue';
import { DEFAULT_PROJECT_CATEGORY, isProjectCategory } from '@/domain/project-category';
import { MAX_EQUIPMENT_LINES, MAX_EQUIPMENT_QUANTITY } from '@/domain/project-equipment';
import { WIZARD_CALENDAR_OPTIONS, WIZARD_REQUIRED, wizardSiteError, wizardWindowError } from '@/domain/project-template';
import { costType, machineType, type MachineTypeCode } from '@/server/db/codes';
import type { NewProjectSetup, WizardCreateInput } from '@/server/dal/projects-register';

/** Draft of the New project wizard (`state.np` without UI fields). Labels are the wizard's EN / data values. */
export interface NewProjectDraft {
  name: string;
  client: string;
  das: string;
  /** R-196 (K-196): 'client' (default when absent) or 'rd' — an R&D project. */
  category?: string;
  /** Machine type label: EMP, MEMU, SPUR, AUTRE, R&D, or a custom type's code — the main type (first equipment line). */
  mt: string;
  /**
   * R-185: the equipment lines (type label × quantity), the first one of `mt`; absent → one line of `mt`, quantity 1.
   */
  lines?: { mt: string; qty: number; cat?: string }[];
  cur: string;
  /** 'blank' or the machine type label of the template. */
  template: string;
  /** Type = EN label (Labor…); budget = the free text typed (parseFloat, as npTotal). */
  cats: { name: string; type: string; budget: string }[];
  cont: number;
  /** Calendar code (WIZARD_CALENDAR_OPTIONS) or its EN label. */
  cal: string;
  /** Project manager, person id (L-3). */
  pm?: string | null;
  /** Planned window, ISO dates (L-3). The finish is optional (L-3b): '' / absent → taken from the instantiated plan. */
  start?: string;
  finish?: string | null;
  /** Site (L-3b, required): city, and a country of the countries table (EN name). */
  city?: string;
  country?: string;
}

const MAX_TEXT = 200;
const INVALID_SETUP = 'Invalid project setup';
const str = (v: unknown, max = MAX_TEXT) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

export type ParsedProjectDraft = { ok: true; input: Omit<WizardCreateInput, 'actorName'> } | { ok: false; error: string };

/**
 * npCreate (3969) checks: required name, client, PM (among the wizard's project managers), type, planned start and location
 * (L-3b: site city + a country of the countries table); the planned finish is optional; calendar, currency, contingency, cost
 * categories and equipment lines (R-185, R-186) among the wizard's choices. `setup` = the wizard's reference data for the viewer.
 */
export function parseProjectDraft(draft: NewProjectDraft, setup: NewProjectSetup): ParsedProjectDraft {
  if (WIZARD_REQUIRED.name && !str(draft?.name)) return { ok: false, error: 'Project name is required' };
  if (WIZARD_REQUIRED.client && !str(draft?.client)) return { ok: false, error: 'Client / sponsor is required' };
  const finish = typeof draft?.finish === 'string' && draft.finish ? draft.finish : null;
  const windowError = wizardWindowError(draft?.start, finish);
  if (windowError) return { ok: false, error: windowError };
  const siteError = WIZARD_REQUIRED.location ? wizardSiteError(draft?.city, draft?.country, setup.countries) : null;
  if (siteError) return { ok: false, error: siteError };
  const das = (DAS_LIST as readonly string[]).includes(draft?.das) ? draft.das : null;
  const category = draft?.category == null ? DEFAULT_PROJECT_CATEGORY : isProjectCategory(draft.category) ? draft.category : null;
  if (!category) return { ok: false, error: 'Choose the project category' };
  const mt = typeof draft?.mt === 'string' && setup.machineTypes.includes(draft.mt) ? draft.mt : null;
  const cur = (WIZARD_CURRENCIES as readonly string[]).includes(draft?.cur) ? (draft.cur as 'EUR' | 'USD') : null;
  const cont = (CONTINGENCIES as readonly number[]).includes(draft?.cont) ? draft.cont : null;
  const cal = WIZARD_CALENDAR_OPTIONS.find((o) => o.value === draft?.cal || o.label === draft?.cal)?.value ?? null;
  const template = draft?.template === 'blank' || draft?.template === mt ? draft.template : null;
  const cats = Array.isArray(draft?.cats) && draft.cats.length <= 50 ? draft.cats : null;
  const pm = draft?.pm == null ? setup.defaultManagerId : setup.managers.some((m) => m.id === draft.pm) ? draft.pm : undefined;
  if (pm === undefined || (WIZARD_REQUIRED.pm && !pm)) return { ok: false, error: 'Choose the project manager among the proposed people' };
  if (!das || !mt || !cur || cont == null || !cal || !template || !cats) return { ok: false, error: INVALID_SETUP };
  const codeOf = (label: string) => (machineType.labels.includes(label) ? machineType.code(label) : label) as MachineTypeCode;
  const mtCode = codeOf(mt);
  // R-185: equipment lines — known active types, whole quantities, the first one of the main type.
  const rawLines: unknown = draft?.lines;
  let equipments: { machineType: MachineTypeCode; quantity: number; catalogueCode: string | null; catalogueVersion: number | null }[] | undefined;
  if (rawLines !== undefined && rawLines !== null) {
    if (!Array.isArray(rawLines) || !rawLines.length || rawLines.length > MAX_EQUIPMENT_LINES) return { ok: false, error: INVALID_SETUP };
    equipments = [];
    for (const l of rawLines as { mt?: unknown; qty?: unknown; cat?: unknown }[]) {
      if (typeof l?.mt !== 'string' || !setup.machineTypes.includes(l.mt)) return { ok: false, error: 'Choose the machine type among the proposed types' };
      const qty = l.qty;
      if (typeof qty !== 'number' || !Number.isInteger(qty) || qty < 1 || qty > MAX_EQUIPMENT_QUANTITY)
        return { ok: false, error: `The quantity is a whole number from 1 to ${MAX_EQUIPMENT_QUANTITY}` };
      // R-186: an optional published catalogue version of the line's type ("EMP-40T@1").
      const cat = parseCatalogueChoice(l.cat);
      if (!cat.ok || (cat.value && !setup.catalogue.some((c) => c.value === l.cat && c.mt === l.mt))) return { ok: false, error: 'Unknown catalogue entry' };
      equipments.push({ machineType: codeOf(l.mt), quantity: qty, catalogueCode: cat.value?.code ?? null, catalogueVersion: cat.value?.version ?? null });
    }
    if (equipments[0].machineType !== mtCode) return { ok: false, error: INVALID_SETUP };
  }
  const categories = [];
  for (const c of cats) {
    if (!(CATEGORY_TYPES as readonly string[]).includes(c?.type)) return { ok: false, error: INVALID_SETUP };
    const budget = parseFloat(String(c?.budget ?? '')) || 0;
    if (!Number.isFinite(budget) || Math.abs(budget) > 1e9) return { ok: false, error: INVALID_SETUP };
    categories.push({ name: str(c?.name), type: costType.code(c.type), budget });
  }

  return {
    ok: true,
    input: {
      name: str(draft?.name),
      client: str(draft?.client),
      das,
      category,
      machineType: mtCode,
      equipments,
      currency: cur,
      templateCode: template === 'blank' ? 'blank' : mtCode,
      categories,
      contingencyPct: cont,
      calendar: cal,
      pmPersonId: pm,
      plannedStart: draft.start,
      plannedFinish: finish,
      site: typeof draft.city === 'string' && typeof draft.country === 'string' ? { city: draft.city.trim().slice(0, 120), country: draft.country } : null,
    },
  };
}
