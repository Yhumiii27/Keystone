// Shared helpers of the export providers (chapter 4, exports feature): column / sheet builders, a "Key figures" sheet for
// KPI tiles, parsing of the display strings some view models carry ("4 800 k€", "64 %", "0.90") back into numbers, EN date
// strings → ISO, the project header of PDF documents and the URL parameters a screen reads. Pure (no DB access).
import { CURRENCIES } from '@/domain/currency';
import type { Lang } from '@/i18n/translate';
import { dataText } from '@/i18n/data-text';
import type { ColumnType, CellValue, ExportColumn, ExportContext, ExportSheet, ExportWorkbook, PdfBlock, PdfDocument } from '../types';

/** A column: `col('budget', t('Budget'), 'money_keur')`. */
export function col(key: string, header: string, type?: ColumnType, width?: number, extra: Partial<ExportColumn> = {}): ExportColumn {
  return { key, header, ...(type ? { type } : {}), ...(width ? { width } : {}), ...extra };
}

export function sheet(name: string, columns: ExportColumn[], rows: Record<string, CellValue>[]): ExportSheet {
  return { name, columns, rows };
}

/** First value of a search parameter, trimmed ('' → null). */
export function param(ctx: Pick<ExportContext, 'params'>, key: string): string | null {
  const v = ctx.params.get(key);
  return v != null && v.trim() !== '' ? v.trim() : null;
}

/** The params as the Record a page's `searchParams` gives (for model builders that take it). */
export function paramRecord(ctx: Pick<ExportContext, 'params'>): Record<string, string | string[] | undefined> {
  const out: Record<string, string | string[] | undefined> = {};
  ctx.params.forEach((v, k) => {
    const cur = out[k];
    out[k] = cur === undefined ? v : Array.isArray(cur) ? [...cur, v] : [cur, v];
  });
  return out;
}

export interface KpiLike {
  label: string;
  value: string | number;
  sub?: string | null;
}

/** "Key figures" sheet of the screen's KPI tiles (label, value, detail), already translated by the caller. */
export function kpiSheet(ctx: Pick<ExportContext, 't'>, items: KpiLike[], name?: string): ExportSheet {
  const { t } = ctx;
  return sheet(name ?? t('Key figures'), [col('label', t('Indicator'), 'text', 30), col('value', t('KPI value'), 'text', 18), col('sub', t('KPI detail'), 'text', 48)], items.map((k) => ({
    label: k.label, value: typeof k.value === 'number' ? String(k.value) : k.value, sub: k.sub ?? '',
  })));
}

/**
 * Number of a display string: "4 800 k€" → 4800, "−27" → -27, "64%" → 64, "0,90" → 0.9, "1.2M€" → 1.2 (unit letters are
 * dropped, not applied). null when the text holds no number ("—", "").
 */
export function num(v: string | number | null | undefined): number | null {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = v.replace(/[\s  ]/g, '').replace(/[−–]/g, '-').replace(/,(\d)/g, '.$1');
  const m = /-?\d+(?:\.\d+)?/.exec(s);
  if (!m) return null;
  const n = parseFloat(m[0]);
  return Number.isFinite(n) ? n : null;
}

/** Fraction of a percent string: "64%" → 0.64, "−3,5 %" → -0.035; null when no number. */
export function pctNum(v: string | number | null | undefined): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const n = num(v);
  return n == null ? null : n / 100;
}

const MON: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

/**
 * ISO date of an EN date string as the prototype writes them: "25 Sep 2026", "25 Sep" (year 2026, the data set's year),
 * "Wed 23 Sep", "17 Aug A" (actual), "2026-09-25". null when it is not a date (the caller then keeps the text).
 */
export function isoOf(v: string | null | undefined, year = 2026): string | null {
  if (!v) return null;
  // " A" marks an actual date in the planning screens ("17 Aug A").
  const s = v.trim().replace(/\s+A$/, '');
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = /^(?:[A-Z][a-z]{2}\s+)?(\d{1,2})\s+([A-Za-z]{3})[a-z]*\.?(?:\s+[’']?(\d{2,4}))?$/.exec(s);
  if (!m) return null;
  const mo = MON[m[2].toLowerCase()];
  if (!mo) return null;
  let y = m[3] ? parseInt(m[3], 10) : year;
  if (y < 100) y += 2000;
  const d = parseInt(m[1], 10);
  const iso = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  return isNaN(Date.parse(iso + 'T00:00:00Z')) ? null : iso;
}

/** "Yes" / "No" through t(). */
export const yesNo = (t: (s: string) => string, b: boolean | null | undefined) => (b == null ? '' : t(b ? 'Yes' : 'No'));

/** Joins non-empty parts with " · ". */
export const dot = (...parts: (string | number | null | undefined | false)[]) => parts.filter((p) => p !== null && p !== undefined && p !== false && p !== '' && p !== '—').join(' · ');

/** The export date (ISO) — the document date of the PDFs. */
export const todayIso = (ctx: Pick<ExportContext, 'now'>) => ctx.now.toISOString().slice(0, 10);

/** Project reference of a PDF header ("HLT-026", the name as typed — R-148). */
export function projectRef(ctx: Pick<ExportContext, 'project' | 't' | 'lang'>): PdfDocument['project'] {
  return ctx.project ? { code: ctx.project.code, name: dataText(ctx.project.name, ctx.lang) } : null;
}

/** Sheets whose rows are empty are kept only when nothing else has rows (the screen's empty state). */
export function nonEmpty(sheets: ExportSheet[]): ExportSheet[] {
  const full = sheets.filter((s) => s.rows.length);
  return full.length ? full : sheets.slice(0, 1);
}

/** A PDF table block of a sheet (optionally restricted to some columns). */
export function tableBlock(s: ExportSheet, keys?: string[], totals?: Record<string, CellValue>) {
  const sheet_ = keys ? { ...s, columns: keys.map((k) => s.columns.find((c) => c.key === k)).filter((c): c is ExportColumn => !!c) } : s;
  return { kind: 'table' as const, sheet: sheet_, ...(totals ? { totals } : {}) };
}

/** Sum of a numeric column. */
export const sum = (rows: Record<string, CellValue>[], key: string) => rows.reduce((a, r) => a + (typeof r[key] === 'number' ? (r[key] as number) : 0), 0);

/** "Tab: Performance" filter line (values already translated). */
export const filterLine = (label: string, value: string | null | undefined) => (value ? `${label}: ${value}` : null);

export const compact = <X>(xs: (X | null | undefined | false)[]): X[] => xs.filter((x): x is X => x !== null && x !== undefined && x !== false);

/** ISO date of a month offset from Jan 2026 (fractions = days, as the Gantt charts draw them). */
export function monthIso(m: number): string {
  const whole = Math.floor(m);
  const y = 2026 + Math.floor(whole / 12);
  const mo = ((whole % 12) + 12) % 12;
  const day = Math.min(28, 1 + Math.round((m - whole) * 27));
  return `${y}-${String(mo + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** An index (SPI, CPI) for a PDF tile in the viewer's language: "0.90" / "0,90". */
export const ratioText = (v: number, lang: Lang) => new Intl.NumberFormat(lang === 'fr' ? 'fr-FR' : 'en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);

/** Working days for a PDF tile in the viewer's language: "−27 d" / "−27 j" (U+2212 minus, as the screens write it). */
export const daysText = (v: number, lang: Lang) => `${v < 0 ? '−' : ''}${Math.abs(v)} ${lang === 'fr' ? 'j' : 'd'}`;

// ── R-046 (NEW-D2-1): supplier prices masked for the roles that may not see them ──────────────────────────────────────

const PRICE_COLUMNS: readonly ColumnType[] = ['money_eur', 'money_keur'];
const PRICE_MASK = '•••';
// C-9: an amount may be in any currency of a project — a symbol ("€4,700", "$1.20M", "4 700 £") or an ISO code next to a number
// ("CHF 4,700", "450 k CHF", "12 000 USD").
const CODES = CURRENCIES.join('|');
const AMOUNT_RE = new RegExp(`[€$£]|\\d\\s*(?:[kKM]\\s*)?(?:${CODES})\\b|\\b(?:${CODES})\\s*[−+-]?\\d`);

/** A display text showing an amount in any currency (masked for a viewer who may not see supplier prices). */
export const showsAmount = (v: CellValue): boolean => typeof v === 'string' && AMOUNT_RE.test(v);

/** A supplier price / value column: marked `price` (any currency) or typed in euros. */
export const isPriceColumn = (c: ExportColumn): boolean => c.price === true || PRICE_COLUMNS.includes(c.type ?? 'text');

/**
 * A sheet without its amounts (supplier prices, order, stock and BOM values, supplier invoices — in euros or in another
 * currency); a text cell showing an amount is masked.
 */
export function stripPriceColumns(s: ExportSheet): ExportSheet {
  const columns = s.columns.filter((c) => !isPriceColumn(c));
  const keys = new Set(columns.map((c) => c.key));
  return {
    ...s,
    columns,
    rows: s.rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => keys.has(k)).map(([k, v]) => [k, showsAmount(v) ? PRICE_MASK : v]))),
  };
}

/** A workbook builder whose result has no supplier price for a viewer whose prices are masked (`ctx.pricesMasked`). */
export const pricedWorkbook = (fn: (ctx: ExportContext) => Promise<ExportWorkbook | null>) => async (ctx: ExportContext): Promise<ExportWorkbook | null> => {
  const wb = await fn(ctx);
  return wb && ctx.pricesMasked ? { ...wb, sheets: wb.sheets.map(stripPriceColumns) } : wb;
};

/** A PDF builder whose tables lose their amounts (and totals) and whose fields / KPI tiles mask them, for a masked viewer. */
export const pricedPdf = (fn: (ctx: ExportContext) => Promise<PdfDocument | null>) => async (ctx: ExportContext): Promise<PdfDocument | null> => {
  const doc = await fn(ctx);
  if (!doc || !ctx.pricesMasked) return doc;
  const blocks = doc.blocks.map((b): PdfBlock => {
    if (b.kind === 'table') return { kind: 'table', sheet: stripPriceColumns(b.sheet) };
    if (b.kind === 'fields') return { ...b, items: b.items.map(([k, v]): [string, string] => [k, showsAmount(v) ? PRICE_MASK : v]) };
    if (b.kind === 'kpis') return { ...b, items: b.items.map((i) => ({ ...i, value: showsAmount(i.value) ? PRICE_MASK : i.value, ...(showsAmount(i.sub) ? { sub: PRICE_MASK } : {}) })) };
    return b;
  });
  return { ...doc, blocks };
};
