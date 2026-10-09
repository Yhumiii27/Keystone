// Resource-assignment quantities (chapter 4, S-7 levers and S-9 imports): the prototype stores display texts
// ("6 × 10 h/d", "1,840 / 2,400 h"); the numbers behind them are parsed once into activity_assignments. Pure.

export interface AssignmentQuantities {
  /** Units of the resource (people, machines); null when the text gives none. */
  resourceCount: number | null;
  /** Hours per day per unit; null when the assignment is not counted in hours. */
  hoursPerDay: number | null;
  /** Planned / actual work in hours; null when the progress is not in hours ("28 / 40 d", "132 t installed"). */
  plannedHours: number | null;
  actualHours: number | null;
}

/** Working days per week assumed for weekly rates ("40 h/wk" → 8 h/d). */
export const WORK_DAYS_PER_WEEK = 5;

const num = (s: string) => {
  const t = s.replace(/[\s  ]/g, '');
  // "1,840" (thousands) vs "1,5" (decimal comma): a comma followed by exactly three digits is a thousands separator.
  const n = /^\d{1,3}(,\d{3})+(\.\d+)?$/.test(t) ? parseFloat(t.replace(/,/g, '')) : parseFloat(t.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};

/** "6 × 10 h/d" → 6 units × 10 h; "8 h/d" → 1 × 8; "40 h/wk" → 1 × 8; "1 unit" → 1 unit. */
export function parseUnits(units: string | null | undefined): Pick<AssignmentQuantities, 'resourceCount' | 'hoursPerDay'> {
  const u = (units ?? '').trim();
  let m = /^([\d.,]+)\s*[×x*]\s*([\d.,]+)\s*h\s*\/\s*d(ay)?$/i.exec(u);
  if (m) return { resourceCount: num(m[1]), hoursPerDay: num(m[2]) };
  m = /^([\d.,]+)\s*h\s*\/\s*d(ay)?$/i.exec(u);
  if (m) return { resourceCount: 1, hoursPerDay: num(m[1]) };
  m = /^([\d.,]+)\s*h\s*\/\s*(wk|week)$/i.exec(u);
  if (m) {
    const h = num(m[1]);
    return { resourceCount: 1, hoursPerDay: h == null ? null : h / WORK_DAYS_PER_WEEK };
  }
  m = /^([\d.,]+)\s*units?$/i.exec(u);
  if (m) return { resourceCount: num(m[1]), hoursPerDay: null };
  return { resourceCount: null, hoursPerDay: null };
}

/** "1,840 / 2,400 h" → actual 1840, planned 2400; other units → null. */
export function parseProgressHours(text: string | null | undefined): Pick<AssignmentQuantities, 'plannedHours' | 'actualHours'> {
  const m = /^([\d.,\s]+)\/\s*([\d.,\s]+)\s*h$/i.exec((text ?? '').trim());
  if (!m) return { plannedHours: null, actualHours: null };
  return { actualHours: num(m[1]), plannedHours: num(m[2]) };
}

export function parseAssignmentQuantities(units: string | null | undefined, progressText: string | null | undefined): AssignmentQuantities {
  return { ...parseUnits(units), ...parseProgressHours(progressText) };
}
