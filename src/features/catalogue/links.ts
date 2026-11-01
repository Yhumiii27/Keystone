// URLs of the Machine catalogue screen (owner, 25 Oct 2026). Pure: usable from Server and Client Components.
//   /catalogue/machines?type=EMP          machine type filter (stored code: EMP, MEMU, SPUR, AUTRE, rnd, custom codes; default all)
//   /catalogue/machines?status=draft      status filter: published | draft | retired (default all)
//   /catalogue/machines?entry=EMP-40T     selected entry (default the first listed)
import { screenHref } from '@/config/screens';

export type CatalogueStatusFilter = 'all' | 'published' | 'draft' | 'retired';
export const CATALOGUE_STATUS_FILTERS: readonly CatalogueStatusFilter[] = ['all', 'published', 'draft', 'retired'];

/** `?status=` as typed (any case); unknown → all. */
export function catalogueStatusOf(v: string | null | undefined): CatalogueStatusFilter {
  const s = (v ?? '').toLowerCase();
  return (CATALOGUE_STATUS_FILTERS as readonly string[]).includes(s) ? (s as CatalogueStatusFilter) : 'all';
}

/** Machine catalogue with its filters and selected entry (defaults omitted). */
export function catalogueHref(q: { type?: string | null; status?: CatalogueStatusFilter | null; entry?: string | null } = {}): string {
  const u = new URLSearchParams();
  if (q.type) u.set('type', q.type);
  if (q.status && q.status !== 'all') u.set('status', q.status);
  if (q.entry) u.set('entry', q.entry);
  const qs = u.toString();
  return qs ? `${screenHref('catalogue')}?${qs}` : screenHref('catalogue');
}
