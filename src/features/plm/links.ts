// URLs of the PLM — parts catalogue and of the part record drawer (docs/spec/09 §2–§3, 00 §8.3). Pure: usable from
// Server and Client Components of any screen. URL state of /reference/parts:
//   ?q=<search>   ?type=<part type code>   ?status=<part status code>   ?pu=PU|PR|none   ?mb=manufactured|purchased
//   ?restr=1 (export-restricted only)   ?sort=ref|name|type|price|status &dir=asc|desc (default ref ascending)
//   ?part=EL-VFD-200   the part record drawer (also on every screen that renders <PartDrawer/>: BOM, stock, …)
// Links to the screens of other teams (BOM, ECO, drawings, stock, fleet) follow the 00 §8.3 proposal; their params
// are centralised here.
import { screenHref } from '@/config/screens';
import { plmParams, type PlmState } from '@/domain/parts';

const withQuery = (base: string, params: Record<string, string | null | undefined>) => {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v != null && v !== '') u.set(k, v);
  const qs = u.toString();
  return qs ? `${base}?${qs}` : base;
};

/** `/reference/parts` with its filters / sort (defaults omitted) and the open part. */
export function plmHref(state?: PlmState | null, part?: string | null): string {
  return withQuery(screenHref('plm'), { ...(state ? plmParams(state) : {}), part });
}

/** `href` with `?part=` set to `ref` (or removed when null), keeping its other params. */
export function withPart(href: string, ref: string | null): string {
  const [path, query = ''] = href.split('?');
  const u = new URLSearchParams(query);
  if (ref) u.set('part', ref);
  else u.delete('part');
  const qs = u.toString();
  return qs ? `${path}?${qs}` : path;
}

/** "Open in PLM": the catalogue with the drawer of `ref` (keeps the catalogue state when already on it). */
export function openInPlmHref(ref: string, currentHref: string): string {
  const base = screenHref('plm');
  return currentHref === base || currentHref.startsWith(`${base}?`) ? withPart(currentHref, ref) : plmHref(null, ref);
}

/** ECO screen with the ECO's drawer (`openEcoScreen` → `?eco=`). */
export const ecoHref = (number: string) => withQuery(screenHref('eco'), { eco: number });
/** Drawings register with the drawing's drawer (`?dwg=`). */
export const drawingHref = (number: string) => withQuery(screenHref('drawings'), { dwg: number });
/** Stock & storages with the position's drawer (`?stock=<position id>`). */
export const stockHref = (positionId: string) => withQuery(screenHref('stock'), { stock: positionId });
/** Installed base (after-sales, phase 8). */
export const fleetHref = () => screenHref('fleet');

/**
 * Project BOM of `code`: the flat list with the part drawer kept open (`{screen:'bom', project, bomType:null}` keeps
 * `part`), or the PU/PR list of a system (`{bomView:'spares', spareSys, part:null}` → `?view=spares&sys=`).
 */
export function bomHref(code: string, opts: { part?: string | null; spares?: string | null } = {}): string {
  const base = screenHref('bom', { code });
  return opts.spares ? withQuery(base, { view: 'spares', sys: opts.spares }) : withQuery(base, { part: opts.part });
}
