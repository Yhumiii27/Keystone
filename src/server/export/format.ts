// Cell formatting shared by the CSV and PDF writers (Excel keeps raw values with number formats). Pure.
import { CSV_DIALECT } from '@/domain/ch4-defaults';
import type { Lang } from '@/i18n/translate';
import { money, moneyEur } from '@/lib/format';
import type { CellValue, ColumnType, ExportColumn } from './types';

const locale = (lang: Lang) => (lang === 'fr' ? 'fr-FR' : 'en-GB');
const isNum = (v: CellValue): v is number => typeof v === 'number' && Number.isFinite(v);
export const isNumericType = (t: ColumnType | undefined) => t === 'number' || t === 'integer' || t === 'money_keur' || t === 'money_eur' || t === 'percent';

/** "25 Sep 2026" / "25 sept. 2026" for an ISO date (or timestamp); the value itself when it is not a date. */
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function formatDate(v: string, lang: Lang, withTime = false): string {
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T00:00:00Z` : v);
  if (isNaN(d.getTime())) return v;
  // English as the app writes it ("25 Sep 2026", "25 Sep 2026 09:12"); French from Intl ("25 sept. 2026").
  if (lang === 'en') {
    const p = withTime
      ? Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d).map((x) => [x.type, x.value]))
      : { year: String(d.getUTCFullYear()), month: String(d.getUTCMonth() + 1), day: String(d.getUTCDate()) };
    return `${+p.day} ${MON[+p.month - 1]} ${p.year}${withTime ? ` ${p.hour}:${p.minute}` : ''}`;
  }
  const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric', timeZone: withTime ? 'Europe/Paris' : 'UTC' };
  if (withTime) Object.assign(opts, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  return new Intl.DateTimeFormat(locale(lang), opts).format(d);
}

/** Display text of a cell (PDF tables): numbers per column type and language, dates in words, booleans yes / no. */
export function displayCell(v: CellValue, col: Pick<ExportColumn, 'type' | 'decimals'>, lang: Lang, yesNo: [string, string] = lang === 'fr' ? ['Oui', 'Non'] : ['Yes', 'No']): string {
  if (v == null || v === '') return '';
  const type = col.type ?? 'text';
  if (typeof v === 'boolean') return v ? yesNo[0] : yesNo[1];
  if (isNum(v)) {
    switch (type) {
      case 'money_keur': return money(v, lang);
      case 'money_eur': return moneyEur(v, lang);
      case 'percent': return new Intl.NumberFormat(locale(lang), { style: 'percent', maximumFractionDigits: col.decimals ?? 0 }).format(v);
      case 'integer': return new Intl.NumberFormat(locale(lang), { maximumFractionDigits: 0 }).format(v);
      default: return new Intl.NumberFormat(locale(lang), { maximumFractionDigits: col.decimals ?? 2, minimumFractionDigits: col.decimals ?? 0 }).format(v);
    }
  }
  if (type === 'date' || type === 'datetime') return formatDate(String(v), lang, type === 'datetime');
  return String(v);
}

/** CSV text of a cell: numbers without thousands separators and with the language's decimal mark, ISO dates. */
export function csvCell(v: CellValue, col: Pick<ExportColumn, 'type' | 'decimals'>, lang: Lang): string {
  if (v == null) return '';
  const dec = CSV_DIALECT[lang].decimal;
  if (typeof v === 'boolean') return v ? (lang === 'fr' ? 'Oui' : 'Yes') : lang === 'fr' ? 'Non' : 'No';
  if (isNum(v)) {
    if (col.type === 'percent') return trimNum(v * 100, col.decimals ?? 1).replace('.', dec) + '%';
    const d = col.type === 'integer' ? 0 : col.decimals ?? (col.type === 'money_eur' ? 2 : 4);
    return trimNum(v, d).replace('.', dec);
  }
  if (col.type === 'datetime') {
    const d = new Date(String(v));
    return isNaN(d.getTime()) ? String(v) : d.toISOString().replace('T', ' ').slice(0, 19);
  }
  return String(v);
}

/** Number with at most `decimals` decimals, trailing zeros removed, '.' as decimal mark. */
export function trimNum(n: number, decimals: number): string {
  const s = n.toFixed(Math.max(0, Math.min(10, decimals)));
  return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s;
}
