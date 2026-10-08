// Generic data table (docs/spec/02 C-11) over the DS `.table` helpers, plus the CSS-grid table variant.
// Server-compatible: `render` functions run where the table is rendered; `rowHref` rows use the client
// `ClickableRow`; `onRowClick` only from Client Components.
import type { CSSProperties, HTMLAttributes, ReactNode } from 'react';
import { Table, Td, Th, Tr } from '@/components/ds/Table';
import { cx } from '@/components/ds/cx';
import { ClickableRow } from './ClickableRow';
import { EmptyState } from './EmptyState';
import s from './DataTable.module.css';

export interface DataColumn<R> {
  key: string;
  /** Header text (translated). */
  header: ReactNode;
  render: (row: R, index: number) => ReactNode;
  align?: 'left' | 'right' | 'center';
  /** Header width hint, e.g. "24%". */
  width?: string;
  /** tabular-nums (numeric columns: also set align right + nowrap). */
  numeric?: boolean;
  nowrap?: boolean;
  /** `secondary` 12px neutral-300 · `muted` 12px neutral-400. */
  tone?: 'secondary' | 'muted';
  maxWidth?: number;
  /** Data-driven cell text colour (LO/OK…). */
  color?: (row: R) => string | undefined;
}

export interface DataTableProps<R> {
  columns: DataColumn<R>[];
  rows: R[];
  rowKey: (row: R, index: number) => string;
  /** 13 (registers, default) or 12.5 (secondary tables). */
  size?: 13 | 12.5;
  /** Key of the selected row (background accent-900). */
  selectedKey?: string | null;
  /** Row link (opens a drawer through the URL); clicking anywhere on the row navigates. */
  rowHref?: (row: R) => string | undefined;
  /** Row click handler (Client Components only). */
  onRowClick?: (row: R) => void;
  /** Shown as an inline EmptyState below the table when `rows` is empty. */
  empty?: ReactNode;
  /** Hide the header row when there are no rows. */
  hideHeaderWhenEmpty?: boolean;
  className?: string;
  style?: CSSProperties;
}

export function DataTable<R>({ columns, rows, rowKey, size = 13, selectedKey, rowHref, onRowClick, empty, hideHeaderWhenEmpty, className, style }: DataTableProps<R>) {
  const showHead = !(hideHeaderWhenEmpty && rows.length === 0);
  return (
    <>
      <Table size={size} className={className} style={style}>
        {showHead && (
          <thead>
            <tr>
              {columns.map((c) => (
                <Th key={c.key} align={c.align} width={c.width} nowrap={c.nowrap}>
                  {c.header}
                </Th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {rows.map((row, i) => {
            const key = rowKey(row, i);
            const selected = selectedKey != null && key === selectedKey;
            const cells = columns.map((c) => (
              <Td key={c.key} align={c.align} numeric={c.numeric} nowrap={c.nowrap} tone={c.tone} maxWidth={c.maxWidth} color={c.color?.(row)}>
                {c.render(row, i)}
              </Td>
            ));
            const href = rowHref?.(row);
            return href ? (
              <ClickableRow key={key} href={href} selected={selected}>
                {cells}
              </ClickableRow>
            ) : (
              <Tr key={key} selected={selected} onClick={onRowClick ? () => onRowClick(row) : undefined}>
                {cells}
              </Tr>
            );
          })}
        </tbody>
      </Table>
      {rows.length === 0 && empty != null && <EmptyState variant="inline">{empty}</EmptyState>}
    </>
  );
}

// ── Grid-table variant ─────────────────────────────────────────────────────────────────────────────

export interface GridTableProps {
  /** grid-template-columns, e.g. "72px minmax(220px,1.6fr) 150px 64px 84px minmax(170px,1fr) 100px 92px". */
  columns: string;
  /** Inner min-width in px (the card around it scrolls horizontally). */
  minWidth?: number;
  /** Column gap in px (default 0). */
  gap?: number;
  /** Row min-height in px (36 default; 40/44 fixed rows). */
  rowHeight?: number;
  /** Header font size: 11 (default) or 10.5. */
  headSize?: 11 | 10.5;
  className?: string;
  children: ReactNode;
}

/** Wrapper that shares the column template with `GridHead` / `GridRow` through CSS variables. */
export function GridTable({ columns, minWidth, gap, rowHeight, headSize, className, children }: GridTableProps) {
  const vars = {
    '--gt-cols': columns,
    ...(minWidth != null ? { '--gt-min': `${minWidth}px` } : null),
    ...(gap != null ? { '--gt-gap': `${gap}px` } : null),
    ...(rowHeight != null ? { '--gt-row-h': `${rowHeight}px` } : null),
    ...(headSize != null ? { '--gt-head-size': `${headSize}px` } : null),
  } as CSSProperties;
  return (
    <div className={cx(s.gridWrap, className)} style={vars} role="table">
      {children}
    </div>
  );
}

/** Header row: 11px · .08em · uppercase · neutral-400 · padding 6px 0 · bottom rule neutral-800. Children = one element per column. */
export function GridHead({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cx(s.gridHead, className)} role="row">
      {children}
    </div>
  );
}

export interface GridRowProps extends HTMLAttributes<HTMLDivElement> {
  /** Hover background neutral-900 (default true). */
  hover?: boolean;
}

/** Body row: min-height 36px, bottom rule neutral-900, hover neutral-900. */
export function GridRow({ hover = true, className, children, ...rest }: GridRowProps) {
  return (
    <div role="row" className={cx(s.gridRow, hover && s.gridRowHover, rest.onClick && s.gridRowClickable, className)} {...rest}>
      {children}
    </div>
  );
}
