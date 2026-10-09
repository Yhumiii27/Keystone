import 'server-only';
// Excel writer (chapter 4 exports): one worksheet per table with a bold, frozen and filterable header row, real numbers and
// dates with number formats (k€, €, %, dates in the viewer's convention), and an "Export" sheet stating the title, project,
// filters, viewer and date. Also reads workbooks for the table imports (src/server/interchange). exceljs (MIT) runs in Node
// only — next.config.ts keeps it outside the bundle.
import ExcelJS from 'exceljs';
import type { Lang } from '@/i18n/translate';
import type { CellValue, ColumnType, ExportColumn, ExportWorkbook } from './types';

const NUM_FMT: Record<Lang, Partial<Record<ColumnType, string>>> = {
  en: { integer: '#,##0', number: '#,##0.##', money_keur: '#,##0" k€"', money_eur: '#,##0.00" €"', percent: '0%', date: 'yyyy-mm-dd', datetime: 'yyyy-mm-dd hh:mm' },
  fr: { integer: '#,##0', number: '#,##0.##', money_keur: '#,##0" k€"', money_eur: '#,##0.00" €"', percent: '0%', date: 'dd/mm/yyyy', datetime: 'dd/mm/yyyy hh:mm' },
};

/** Excel sheet name: ≤ 31 characters, none of []:*?/\ , unique in the workbook. */
export function sheetName(name: string, taken: Set<string>): string {
  let base = name.replace(/[[\]:*?/\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 31) || 'Sheet';
  if (base.startsWith("'")) base = base.slice(1) || 'Sheet';
  let n = base;
  for (let i = 2; taken.has(n.toLowerCase()); i++) n = `${base.slice(0, 31 - String(i).length - 1)} ${i}`;
  taken.add(n.toLowerCase());
  return n;
}

function cellValue(v: CellValue, col: ExportColumn): ExcelJS.CellValue {
  if (v == null || v === '') return null;
  if ((col.type === 'date' || col.type === 'datetime') && typeof v === 'string') {
    const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T00:00:00Z` : v);
    return isNaN(d.getTime()) ? v : d;
  }
  if (typeof v === 'number' && !Number.isFinite(v)) return null;
  return v;
}

const defaultWidth = (c: ExportColumn) => c.width ?? Math.min(60, Math.max(10, c.header.length + 2, c.type === 'date' ? 12 : c.type === 'text' || !c.type ? 18 : 12));

export interface XlsxMeta {
  lang: Lang;
  /** Labels of the "Export" sheet (translated). */
  labels: { sheet: string; title: string; project: string; filters: string; exportedBy: string; exportedOn: string };
  project?: string | null;
  exportedBy: string;
  exportedOn: Date;
}

/** Builds the .xlsx bytes of a workbook. */
export async function toXlsx(wb: ExportWorkbook, meta: XlsxMeta): Promise<Uint8Array> {
  const book = new ExcelJS.Workbook();
  book.creator = 'Keystone';
  book.created = meta.exportedOn;
  book.title = wb.title;
  const taken = new Set<string>();
  const fmt = NUM_FMT[meta.lang];
  for (const sheet of wb.sheets) {
    const ws = book.addWorksheet(sheetName(sheet.name, taken), { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.columns = sheet.columns.map((c) => ({ key: c.key, width: defaultWidth(c) }));
    const header = ws.addRow(sheet.columns.map((c) => c.header));
    header.font = { bold: true };
    header.alignment = { vertical: 'middle' };
    header.eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFEFEF' } };
      cell.border = { bottom: { style: 'thin', color: { argb: 'FF999999' } } };
    });
    for (const row of sheet.rows) ws.addRow(sheet.columns.map((c) => cellValue(row[c.key], c)));
    sheet.columns.forEach((c, i) => {
      const col = ws.getColumn(i + 1);
      const f = c.type === 'number' && c.decimals != null ? (c.decimals ? `#,##0.${'0'.repeat(c.decimals)}` : '#,##0') : fmt[c.type ?? 'text'];
      if (f) col.eachCell({ includeEmpty: false }, (cell, rowNumber) => {
        if (rowNumber > 1) cell.numFmt = f;
      });
      if (c.align) col.alignment = { horizontal: c.align };
    });
    if (sheet.columns.length) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: sheet.columns.length } };
  }
  const info = book.addWorksheet(sheetName(meta.labels.sheet, taken));
  info.columns = [{ width: 22 }, { width: 80 }];
  const lines: [string, string][] = [[meta.labels.title, wb.title]];
  if (meta.project) lines.push([meta.labels.project, meta.project]);
  if (wb.filters?.length) lines.push([meta.labels.filters, wb.filters.join(' · ')]);
  lines.push([meta.labels.exportedBy, meta.exportedBy]);
  lines.push([meta.labels.exportedOn, meta.exportedOn.toISOString().slice(0, 16).replace('T', ' ') + ' UTC']);
  for (const l of lines) info.addRow(l).getCell(1).font = { bold: true };
  return new Uint8Array(await book.xlsx.writeBuffer());
}

/** A worksheet read back as rows of cell texts / numbers (table imports). Dates become ISO strings. */
export interface ReadSheet {
  name: string;
  rows: (string | number | boolean | null)[][];
}

/** Reads every worksheet of an .xlsx file (values only; formulas give their cached result). */
export async function readXlsx(data: Uint8Array): Promise<ReadSheet[]> {
  const book = new ExcelJS.Workbook();
  // exceljs types expect its own Buffer interface; a Node Buffer view of the bytes satisfies it at run time.
  await book.xlsx.load(Buffer.from(data.buffer, data.byteOffset, data.byteLength) as unknown as ExcelJS.Buffer);
  return book.worksheets.map((ws) => {
    const rows: (string | number | boolean | null)[][] = [];
    ws.eachRow({ includeEmpty: true }, (row, rowNumber) => {
      const out: (string | number | boolean | null)[] = [];
      row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        out[colNumber - 1] = plain(cell.value);
      });
      rows[rowNumber - 1] = out;
    });
    for (let i = 0; i < rows.length; i++) rows[i] ??= [];
    return { name: ws.name, rows };
  });
}

function plain(v: ExcelJS.CellValue): string | number | boolean | null {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString().slice(0, v.getUTCHours() || v.getUTCMinutes() ? 16 : 10).replace('T', ' ');
  if (typeof v === 'object') {
    if ('result' in v) return plain((v as { result?: ExcelJS.CellValue }).result ?? null);
    if ('richText' in v) return (v as { richText: { text: string }[] }).richText.map((r) => r.text).join('');
    if ('text' in v) return String((v as { text: unknown }).text);
    if ('error' in v) return null;
    return null;
  }
  return v as string | number | boolean;
}
