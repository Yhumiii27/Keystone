// Multi-equipment projects (R-185, AC-5; framing docs/delivery-9/cadrage-r185-r186.md, validated by the product owner on
// 23 Oct 2026). Pure rules — no import of the server: the DAL (src/server/dal/project-equipment.ts), the Server Functions and the
// New project wizard share them.
//
//   Line          one machine type × a quantity ("1 × EMP", "3 × MEMU"), numbered EQ-01, EQ-02… per project (choice 1: the
//                 machines delivered — serial numbers — stay in the installed base).
//   Main type     the type of the first line (position 0): projects.machine_type_code, read by the screens written before R-185.
//   Summary       "EMP" for a single line of one machine (the display before R-185), else "1 × EMP · 3 × MEMU".
//   Budget        reference budget = Σ over the lines of the type's reference cost categories × the quantity (choice 3); the
//                 categories of the same name and type are merged, the main type's first.
//   Planning      phases common to the project + lots specific to an equipment generated per line (choice 2): see
//                 PER_EQUIPMENT_PHASES and instantiateTemplate (src/domain/project-template.ts).

/** "EQ-01" … "EQ-99", "EQ-100". */
export const EQUIPMENT_REF_RE = /^EQ-(\d{2,})$/;
export const equipmentRef = (n: number) => `EQ-${String(n).padStart(2, '0')}`;

/** The next free reference of a project: one after the highest in use (EQ-01 for a project without line). */
export function nextEquipmentRef(refs: readonly string[]): string {
  let max = 0;
  for (const r of refs) {
    const m = EQUIPMENT_REF_RE.exec(r);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return equipmentRef(max + 1);
}

/** Lines of one project, and machines of one line (typo guards). */
export const MAX_EQUIPMENT_LINES = 20;
export const MAX_EQUIPMENT_QUANTITY = 999;
export const MAX_EQUIPMENT_LABEL = 120;
export const MAX_EQUIPMENT_OPTIONS = 12;
export const MAX_EQUIPMENT_OPTION = 80;
export const MAX_CAPACITY_UNIT = 20;

/** Arche's machine need reference (projects_besoin_ref_check without the CAPEX prefix rule). */
export const NEED_REF_RE = /^CPX-[A-Z]{3}-[0-9]{4}-[0-9]{2,}\/B[0-9]{2,}$/;

/**
 * Standard phases specific to an equipment, per machine type code (names of the Machine types screen, prototype NP_TEMPLATES):
 * the workshop lots — fabrication, assembly, workshop / platform tests (FAT). Studies, purchasing, site works, commissioning on
 * site and acceptance stay common to the project. R&D has none (one prototype per project). The seed sets
 * machine_type_phases.per_equipment from this list; migration 0042 does the same on existing databases (same list, by name).
 */
export const PER_EQUIPMENT_PHASES: Readonly<Record<string, readonly string[]>> = {
  EMP: ['Fabrication structure', 'Montage mécanique', 'Installation électrique & automatisme'],
  MEMU: ['Fabrication modules', 'Assemblage & câblage', 'Essais plateforme'],
  SPUR: ['Structures & supports', 'Équipements électriques'],
  AUTRE: ['Réalisation', 'Essais'],
};
export const isPerEquipmentPhase = (typeCode: string, name: string) => (PER_EQUIPMENT_PHASES[typeCode] ?? []).includes(name);

export interface EquipmentLineInput {
  machineTypeCode: string;
  quantity: number;
  label: string | null;
  capacityValue: number | null;
  capacityUnit: string | null;
  options: string[];
  besoinRef: string | null;
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

const text = (v: unknown) => (typeof v === 'string' ? v.trim() : v == null ? '' : null);

/**
 * Validates an equipment line typed by the PM (or sent by the wizard). `types` = the machine type codes the line may take
 * (active types). Messages are English source strings. Options: an array of strings, or one string separated by commas.
 */
export function parseEquipmentLine(input: Record<string, unknown> | null | undefined, types: readonly string[]): Parsed<EquipmentLineInput> {
  const v = input ?? {};
  const mt = text(v.machineTypeCode);
  if (!mt || !types.includes(mt)) return { ok: false, error: 'Choose the machine type among the proposed types' };
  const q = typeof v.quantity === 'string' && v.quantity.trim() !== '' ? Number(v.quantity.trim()) : v.quantity;
  if (typeof q !== 'number' || !Number.isInteger(q) || q < 1 || q > MAX_EQUIPMENT_QUANTITY) return { ok: false, error: `The quantity is a whole number from 1 to ${MAX_EQUIPMENT_QUANTITY}` };
  const label = text(v.label);
  if (label == null || label.length > MAX_EQUIPMENT_LABEL) return { ok: false, error: 'The equipment label is too long' };
  const rawCap = typeof v.capacityValue === 'string' ? v.capacityValue.trim().replace(',', '.') : v.capacityValue;
  let capacityValue: number | null = null;
  if (rawCap !== '' && rawCap != null) {
    const n = typeof rawCap === 'number' ? rawCap : Number(rawCap);
    if (!Number.isFinite(n) || n <= 0 || n > 1e9) return { ok: false, error: 'The target capacity is a positive number' };
    capacityValue = n;
  }
  const unit = text(v.capacityUnit);
  if (unit == null || unit.length > MAX_CAPACITY_UNIT) return { ok: false, error: 'The capacity unit is too long' };
  if (capacityValue != null && !unit) return { ok: false, error: 'Enter the unit of the target capacity' };
  const rawOptions = typeof v.options === 'string' ? v.options.split(',') : v.options == null ? [] : v.options;
  if (!Array.isArray(rawOptions) || rawOptions.some((o) => typeof o !== 'string')) return { ok: false, error: 'Invalid options' };
  const options = [...new Set((rawOptions as string[]).map((o) => o.trim()).filter(Boolean))];
  if (options.length > MAX_EQUIPMENT_OPTIONS || options.some((o) => o.length > MAX_EQUIPMENT_OPTION)) return { ok: false, error: 'Too many or too long options' };
  const need = text(v.besoinRef);
  if (need == null) return { ok: false, error: 'The machine need follows the CAPEX application’s format (CPX-SAI-2026-01/B01)' };
  const besoinRef = need ? need.toUpperCase() : null;
  if (besoinRef && !NEED_REF_RE.test(besoinRef)) return { ok: false, error: 'The machine need follows the CAPEX application’s format (CPX-SAI-2026-01/B01)' };
  return {
    ok: true,
    value: { machineTypeCode: mt, quantity: q, label: label || null, capacityValue, capacityUnit: capacityValue != null ? unit : null, options, besoinRef },
  };
}

/** A line as the summaries read it: the type's display label (EMP, R&D…) and the quantity. */
export interface EquipmentSummaryLine {
  typeLabel: string;
  quantity: number;
}

/** "EMP" (a single line of one machine, as before R-185) / "1 × EMP · 3 × MEMU"; null without line. */
export function equipmentSummary(lines: readonly EquipmentSummaryLine[]): string | null {
  if (!lines.length) return null;
  if (lines.length === 1 && lines[0].quantity === 1) return lines[0].typeLabel;
  return lines.map((l) => `${l.quantity} × ${l.typeLabel}`).join(' · ');
}

/** Machines supplied by the project (Σ quantities). */
export const equipmentCount = (lines: readonly { quantity: number }[]) => lines.reduce((a, l) => a + l.quantity, 0);

/** "EQ-02 · 3 × MEMU" / "EQ-01 · EMP": the name suffix of the lots generated for a line when the project has several. */
export const equipmentLotLabel = (l: { ref: string; typeLabel: string; quantity: number }) =>
  l.quantity > 1 ? `${l.ref} · ${l.quantity} × ${l.typeLabel}` : `${l.ref} · ${l.typeLabel}`;

/** The main type after a change of the lines: the type of the line with the lowest position (null without line). */
export function mainTypeOf(lines: readonly { machineTypeCode: string; position: number }[]): string | null {
  if (!lines.length) return null;
  return [...lines].sort((a, b) => a.position - b.position)[0].machineTypeCode;
}

export interface ReferenceCategory<T extends string = string> {
  name: string;
  type: T;
  budget: number;
}

/**
 * Reference cost categories of a project (choice 3): every line's type categories × its quantity, the categories of the same
 * name and type merged (the main type's order first, then the new ones of the next lines). Rounded to 0.01 k.
 */
export function referenceCategories<T extends string>(
  lines: readonly { machineTypeCode: string; quantity: number }[],
  categoriesOf: (typeCode: string) => readonly ReferenceCategory<T>[],
): ReferenceCategory<T>[] {
  const out: ReferenceCategory<T>[] = [];
  for (const l of lines)
    for (const c of categoriesOf(l.machineTypeCode)) {
      const add = (Number.isFinite(c.budget) ? c.budget : 0) * l.quantity;
      const same = out.find((x) => x.name === c.name && x.type === c.type);
      if (same) same.budget = Math.round((same.budget + add) * 100) / 100;
      else out.push({ name: c.name, type: c.type, budget: Math.round(add * 100) / 100 });
    }
  return out;
}

/** Reference budget of the lines (k, no contingency): Σ type budget × quantity. */
export const referenceBudget = (
  lines: readonly { machineTypeCode: string; quantity: number }[],
  categoriesOf: (typeCode: string) => readonly ReferenceCategory[],
) => Math.round(referenceCategories(lines, categoriesOf).reduce((a, c) => a + c.budget, 0) * 100) / 100;
