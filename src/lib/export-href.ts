// URL of a file export (chapter 4): GET /api/export/<screen>?format=csv|xlsx|pdf&code=…&variant=…&<screen filters>. Pure —
// usable by client islands (header Export menu, "Export PO", "Print receipt" buttons). The route re-checks every right.
import type { ScreenId } from '@/config/screens';

export type ExportFormatParam = 'csv' | 'xlsx' | 'pdf';

export interface ExportHrefOptions {
  format: ExportFormatParam;
  /** Project code of a project-scoped screen. */
  code?: string | null;
  /** PDF document variant ('po', 'receipt', 'statement', 'status', 'pv'…) and the record it is about. */
  variant?: string | null;
  id?: string | null;
  /** The screen's own search params (tab, filters, search…), forwarded as they are. */
  params?: URLSearchParams | Record<string, string | string[] | undefined> | null;
}

const RESERVED = new Set(['format', 'code', 'variant', 'id']);

export function exportHref(screen: ScreenId, o: ExportHrefOptions): string {
  const q = new URLSearchParams();
  q.set('format', o.format);
  if (o.code) q.set('code', o.code);
  if (o.variant) q.set('variant', o.variant);
  if (o.id) q.set('id', o.id);
  const add = (k: string, v: string) => {
    if (!RESERVED.has(k) && v !== '') q.append(k, v);
  };
  if (o.params instanceof URLSearchParams) o.params.forEach((v, k) => add(k, v));
  else if (o.params)
    for (const [k, v] of Object.entries(o.params)) {
      if (Array.isArray(v)) v.forEach((x) => add(k, x));
      else if (v != null) add(k, v);
    }
  return `/api/export/${encodeURIComponent(screen)}?${q.toString()}`;
}
