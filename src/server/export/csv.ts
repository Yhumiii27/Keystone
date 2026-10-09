// CSV writer (chapter 4 exports): UTF-8 with a BOM (Excel opens it in the right encoding), RFC 4180 quoting, ';' and a
// decimal comma in French, ',' and a decimal point in English (CSV_DIALECT). Text cells that a spreadsheet would run as a
// formula (=, +, -, @ at the start) are prefixed with an apostrophe (CSV injection). Pure.
import { CSV_DIALECT } from '@/domain/ch4-defaults';
import type { Lang } from '@/i18n/translate';
import { csvCell, isNumericType } from './format';
import type { ExportSheet } from './types';

export const CSV_BOM = '﻿';

function quote(s: string, sep: string): string {
  return /["\r\n]/.test(s) || s.includes(sep) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV text of one sheet (header row + rows), with the BOM. */
export function toCsv(sheet: ExportSheet, lang: Lang): string {
  const sep = CSV_DIALECT[lang].separator;
  const lines = [sheet.columns.map((c) => quote(c.header, sep)).join(sep)];
  for (const row of sheet.rows) {
    lines.push(
      sheet.columns
        .map((c) => {
          const v = row[c.key];
          let s = csvCell(v, c, lang);
          if (typeof v === 'string' && !isNumericType(c.type) && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
          return quote(s, sep);
        })
        .join(sep),
    );
  }
  return CSV_BOM + lines.join('\r\n') + '\r\n';
}
