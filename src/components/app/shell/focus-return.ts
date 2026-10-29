// Where the focus goes back when the focused control left the page (R-183, `FocusKeeper`). Browser code without React.

export interface FocusAnchor {
  /** The control that had the focus. */
  el: HTMLElement;
  /** Its row (table row, list item, `[data-focus-row]`), if any. */
  row: HTMLElement | null;
  /** The row's parent and the row's index in it when the control was focused. */
  parent: HTMLElement | null;
  index: number;
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const firstFocusable = (root: Element): HTMLElement | null => root.querySelector<HTMLElement>(FOCUSABLE);

/**
 * The same row (its first control, else the row), else the row now at its place (or the last one), else the row's
 * parent region, else `fallback` (the main region).
 */
export function focusReturnTarget(a: FocusAnchor, fallback: HTMLElement | null): HTMLElement | null {
  if (a.row?.isConnected) return firstFocusable(a.row) ?? a.row;
  if (a.parent?.isConnected) {
    const rows = a.parent.children;
    const next = (rows[a.index] ?? rows[rows.length - 1]) as HTMLElement | undefined;
    if (next) return firstFocusable(next) ?? next;
    return a.parent.closest<HTMLElement>('section, [role="region"], table, main') ?? fallback;
  }
  return fallback;
}
