// Export framework types (chapter 4, X-3 / C-5): every screen registers a provider that turns what the viewer sees — with the
// screen's current filters — into tables (CSV / Excel) and, for screens with a report or a document, a PDF.
import type { ScreenId } from '@/config/screens';
import type { Lang, T } from '@/i18n/translate';
import type { ExportFormat } from '@/server/db/codes';
import type { ProjectRow } from '@/server/dal/projects';
import type { Viewer, ZoneKey } from '@/server/session';

/** A cell: numbers stay numbers in Excel; dates are ISO strings ('2026-09-25') in `date` columns. */
export type CellValue = string | number | boolean | null | undefined;

export type ColumnType =
  /** Free text (default). */
  | 'text'
  /** Plain number (decimals from `decimals`, default up to 2). */
  | 'number'
  | 'integer'
  /** Thousands of euros (the app's k€ amounts). */
  | 'money_keur'
  /** Euros. */
  | 'money_eur'
  /** A fraction (0.64 → 64 %). */
  | 'percent'
  /** ISO date 'YYYY-MM-DD'. */
  | 'date'
  /** R-157: a month-precision date, ISO 'YYYY-MM' (project start / finish "Dec 2026"): an Excel date shown as month and year. */
  | 'month'
  /** ISO timestamp. */
  | 'datetime'
  | 'boolean';

export interface ExportColumn {
  /** Property of the row. */
  key: string;
  /** Header, already in the viewer's language. */
  header: string;
  type?: ColumnType;
  /** Excel width in characters / relative PDF width (default from the header and type). */
  width?: number;
  decimals?: number;
  align?: 'left' | 'right' | 'center';
  /**
   * R-046 (NEW-D2-1): a supplier price, an order / stock / BOM value or a supplier-invoice amount, whatever its type — an amount
   * in another currency than the euro is a plain `number` column (C-9). The priced providers drop it for a viewer whose prices
   * are masked (`stripPriceColumns`), as they drop every € column.
   */
  price?: true;
}

export interface ExportSheet {
  /** Sheet name (≤ 31 characters are kept; already translated). */
  name: string;
  columns: ExportColumn[];
  rows: Record<string, CellValue>[];
}

export interface ExportWorkbook {
  /** Document title, translated ("Budget & cost"). */
  title: string;
  /** Filters / view described in words, translated ("Zone: Africa · Stage: Chantier · Search: crane"). */
  filters?: string[];
  /** First sheet = the main table (the CSV export takes it). */
  sheets: ExportSheet[];
}

// ── PDF documents ────────────────────────────────────────────────────────────────────────────────────────────────────
export type PdfBlock =
  | { kind: 'heading'; text: string }
  | { kind: 'paragraph'; text: string; muted?: boolean }
  /** Label / value pairs laid out in `columns` columns (default 2). */
  | { kind: 'fields'; items: [label: string, value: string][]; columns?: 1 | 2 | 3 }
  /** KPI tiles (label, value, optional sub-line). */
  | { kind: 'kpis'; items: { label: string; value: string; sub?: string }[] }
  /** A table (numbers formatted per column type and language); `totals` adds a bold last row. */
  | { kind: 'table'; sheet: ExportSheet; totals?: Record<string, CellValue> }
  /** Signature boxes ("PV de réception", purchase order): one per party. */
  | { kind: 'signatures'; parties: { role: string; name?: string }[] }
  | { kind: 'spacer'; height?: number }
  | { kind: 'pageBreak' }
  /** A Gantt chart drawn in the PDF (Schedule / client portal planning): bars and diamonds on a month timeline. */
  | PdfGanttBlock;

/** One bar row of a PDF Gantt; positions are fractions of the timeline (0 = first month's start, 1 = last month's end). */
export interface PdfGanttRow {
  name: string;
  /** Second, muted text after the name (owner). */
  sub?: string;
  /** "72%" (done column). */
  done?: string;
  /** "+39 d" / "—" (slip column); `slipAlert` prints it in the attention colour. */
  slip?: string;
  slipAlert?: boolean;
  critical?: boolean;
  /** Baseline bar (thin, grey); null / absent → none. */
  baseline?: [start: number, end: number] | null;
  /** Forecast bar. */
  forecast: [start: number, end: number];
  /** Share of the forecast bar filled (0–1). */
  progress?: number;
}

export interface PdfGanttMilestone {
  name: string;
  slip?: string;
  slipAlert?: boolean;
  /** Baseline (outline) and forecast (filled) diamonds, as timeline fractions. */
  baseline?: number | null;
  forecast: number;
  done?: boolean;
}

export interface PdfGanttBlock {
  kind: 'gantt';
  /** Month labels of the timeline (translated), one column each. */
  months: string[];
  rows: PdfGanttRow[];
  milestones?: PdfGanttMilestone[];
  /** Data date line, as a timeline fraction. */
  today?: number | null;
  /** Translated labels: column headers and legend. */
  labels: { name: string; done: string; slip: string; milestones: string; baseline: string; forecast: string; progress: string; critical: string; today: string };
}

export interface PdfDocument {
  /** Title, translated ("Purchase order PO-1082"). */
  title: string;
  /** Second line under the title (supplier, period…). */
  subtitle?: string;
  /** Project shown in the header (code and name). */
  project?: { code: string; name: string } | null;
  /** Reference printed on the right of the header ("PO-1082", "PV D-014"). */
  reference?: string;
  /** Document date (ISO); default: today. */
  date?: string;
  landscape?: boolean;
  blocks: PdfBlock[];
  /** Small print above the footer (legal mention, "Generated by Keystone from …"). */
  footnote?: string;
}

// ── Providers ────────────────────────────────────────────────────────────────────────────────────────────────────────
export interface ExportContext {
  viewer: Viewer;
  lang: Lang;
  t: T;
  screen: ScreenId;
  /** The screen is outside the viewer's workspace (read-only view with the banner): export what that view shows. */
  outside: boolean;
  /** Project of a project-scoped screen (null for global / zone screens). */
  project: ProjectRow | null;
  /** The project is read-only for the viewer (pm / client on a project that is not theirs). */
  readOnly: boolean;
  /** Query parameters of the screen URL (tab, filters, search, zone…) — the provider reads them like the page does. */
  params: URLSearchParams;
  /** Zone bar selection (zone screens). */
  zone: ZoneKey | null;
  /** Hourly rates are masked for this viewer (rates screen rule: only the director and the PM see them). */
  ratesMasked: boolean;
  /** Supplier prices, order values and supplier invoices are masked (R-046, NEW-D2-1: only the director, PMs and procurement see them). */
  pricesMasked: boolean;
  /** Document variant ('po', 'receipt', 'statement', 'status', 'pv'…) or null for the screen table / report. */
  variant: string | null;
  /** Export instant (real clock: file names and the "exported on" line). */
  now: Date;
  /** Business date (R-013, src/server/clock.ts): the year that the screens' year-less dates are in. */
  today: string;
}

export interface ExportProvider {
  screen: ScreenId;
  /** Tables of the screen (CSV takes the first sheet). null → nothing to export (empty state of the screen). */
  table?: (ctx: ExportContext) => Promise<ExportWorkbook | null>;
  /** PDF report of the screen (header Export menu "PDF"), when the screen has one. */
  pdf?: (ctx: ExportContext) => Promise<PdfDocument | null>;
  /** PDF documents by variant (`?variant=po&id=PO-1082`). */
  documents?: Record<string, (ctx: ExportContext) => Promise<PdfDocument | null>>;
  /** Extra rule: an EN reason when this viewer may not export (403), else null. */
  refuse?: (ctx: ExportContext) => string | null;
  /** Base of the file name ('budget' → budget-HLT-026-2026-10-09.xlsx); default: the screen id. */
  fileBase?: (ctx: ExportContext) => string;
}

export interface ExportFile {
  format: ExportFormat;
  fileName: string;
  mime: string;
  body: Uint8Array;
  rowCount: number;
}
