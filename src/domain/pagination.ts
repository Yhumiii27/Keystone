// Server-side pagination of the long lists (R-017: hold the load with real data volumes). Pure: the page number read from the
// URL (`?page=`), the slice of a list, and the page window of a count read in SQL. Page 1 is the default and holds the first
// PAGE_SIZE rows, so a list shorter than a page (every demo list) shows exactly as before. Exports are never paginated.

/** Rows per page of the paginated lists (documents vault, audit trail). */
export const PAGE_SIZE = 100;

/** `?page=` as a page number ≥ 1 (1 when absent or not a positive integer). */
export function pageOf(raw: unknown): number {
  const v = Array.isArray(raw) ? raw[0] : raw;
  const n = typeof v === 'string' && /^\d{1,6}$/.test(v.trim()) ? Number(v.trim()) : 1;
  return n >= 1 ? n : 1;
}

export interface PageWindow {
  /** Page shown (clamped to the last page). */
  page: number;
  /** Number of pages (1 for an empty list). */
  pages: number;
  /** Rows to skip and to read. */
  offset: number;
  limit: number;
  total: number;
}

/** The window of page `page` over `total` rows. */
export function pageWindow(total: number, page: number, size = PAGE_SIZE): PageWindow {
  const pages = Math.max(1, Math.ceil(total / size));
  const p = Math.min(Math.max(1, Math.floor(page) || 1), pages);
  return { page: p, pages, offset: (p - 1) * size, limit: size, total };
}

/** The rows of page `page` of `rows`, with its window. */
export function pageSlice<T>(rows: readonly T[], page: number, size = PAGE_SIZE): { rows: T[]; window: PageWindow } {
  const window = pageWindow(rows.length, page, size);
  return { rows: rows.slice(window.offset, window.offset + window.limit), window };
}

/** Pager of a paginated list (rendered by src/components/app/Pager.tsx). */
export interface PagerView {
  page: number;
  pages: number;
  /** "Page 2 of 7" (translated). */
  label: string;
  prev: { href: string; label: string } | null;
  next: { href: string; label: string } | null;
  /** Accessible name of the navigation (translated "Pages"). */
  name: string;
}

/** The pager of `page` of `pages` (null for a single page); `href(n)` = the URL of page n. */
export function pagerView(
  page: number, pages: number, href: (n: number) => string, t: (s: string) => string,
): PagerView | null {
  if (pages <= 1) return null;
  return {
    page, pages, label: t(`Page ${page} of ${pages}`), name: t('Pages'),
    prev: page > 1 ? { href: href(page - 1), label: t('Previous page') } : null,
    next: page < pages ? { href: href(page + 1), label: t('Next page') } : null,
  };
}
