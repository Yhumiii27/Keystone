// URLs of the administration screens (docs/spec/00 §8.3). Pure: usable from Server and Client Components.
//   /admin/settings
//   /admin/machine-types?type=EMP                 selected machine type (`mtSel`; stored code: EMP, MEMU, SPUR, AUTRE, rnd, custom codes)
//   /admin/integrations?view=connectors           display (`plumbTab`: activity — default, connectors, imports, audit)
//   /admin/integrations?source=stock              activity source chip (`actFilter`; activity display only)
//   /admin/integrations?view=audit&page=2         page of the audit trail (R-017: 100 entries a page; the CSV export has them all)
//   /admin/integrations/audit.csv                 ISO 9001 export of the audit trail (Route Handler)
import { screenHref } from '@/config/screens';
import type { PlumbView } from '@/domain/admin';

export const settingsHref = () => screenHref('settings');

/** Machine types with `type` selected (default: the first type). */
export function machineTypesHref(type?: string | null): string {
  const base = screenHref('mtypes');
  return type ? `${base}?type=${encodeURIComponent(type)}` : base;
}

/** Activity & integrations with its display and activity source (defaults omitted); R-017: `page` of the audit trail. */
export function integrationsHref(q: { view?: PlumbView | null; source?: string | null; page?: number | null } = {}): string {
  const u = new URLSearchParams();
  const view = q.view ?? 'activity';
  if (view !== 'activity') u.set('view', view);
  else if (q.source) u.set('source', q.source);
  if (view === 'audit' && q.page && q.page > 1) u.set('page', String(q.page));
  const qs = u.toString();
  return qs ? `${screenHref('plumbing')}?${qs}` : screenHref('plumbing');
}

/** Download of the audit trail (CSV). */
export const auditExportHref = () => `${screenHref('plumbing')}/audit.csv`;
