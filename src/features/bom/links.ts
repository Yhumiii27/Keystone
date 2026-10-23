// URL state of the Project BOM — /projects/[code]/bom (docs/spec/09 §1, 00 §8.3). Pure: usable from Server and Client
// Components, and from other screens linking into the BOM (part drawer "Projects equipped", "Open PU/PR list").
//   ?view=tree|used|compare|spares   display (default flat — `bomView`)
//   ?q=  ?type=<part type code>  ?mfr=<supplier>   flat-list search and filters (`bomQ`, `bomType`, `bomMfr`)
//   ?sort=ref|name|type|total|status  ?dir=asc|desc  flat-list sort (default ref, ascending)
//   ?part=<ref>                       part record drawer (shared <PartDrawer/>, any view — `part`)
//   ?node=<ref>                       assembly-tree node drawer (`bomNode`)
//   ?used=<query>                     Where-used search (`bomUsedQ`; empty = CR-BRG-SKF, as the prototype)
//   ?sys=<assembly ref>  ?kind=PU|PR  PU/PR list system (default: the complete system) and kind filter
//   ?eq=<EQ-02>|common               flat-list equipment filter (R-185; projects with more than one equipment line)
// Folding the assembly tree (`bomClosed`) is transient UI kept in the client.
import { screenHref } from '@/config/screens';
import { DEFAULT_BOM_SORT, isBomSortKey, type BomSort } from '@/domain/bom';

export type BomView = 'flat' | 'tree' | 'used' | 'compare' | 'spares';
export const BOM_VIEWS: readonly BomView[] = ['flat', 'tree', 'used', 'compare', 'spares'];
export const isBomView = (v: unknown): v is BomView => typeof v === 'string' && (BOM_VIEWS as readonly string[]).includes(v);

export interface BomState {
  view: BomView;
  q: string;
  /** Part type code. */
  type: string | null;
  /** Manufacturer / supplier name. */
  mfr: string | null;
  sort: BomSort;
  part: string | null;
  node: string | null;
  used: string;
  sys: string | null;
  kind: 'PU' | 'PR' | null;
  /** R-185: flat-list equipment filter — a line's reference, 'common', or null (every line). */
  eq?: string | null;
}

export const DEFAULT_BOM_STATE: BomState = { view: 'flat', q: '', type: null, mfr: null, sort: DEFAULT_BOM_SORT, part: null, node: null, used: '', sys: null, kind: null, eq: null };

type SP = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
/** A free-text parameter, trimmed of control characters and capped. */
const text = (v: string | string[] | undefined, max = 120) => (first(v) ?? '').replace(/[\u0000-\u001f]/g, '').slice(0, max);
/** A reference-like parameter ("CR-BRG-SKF", "heavy_equipment"); anything else is ignored. */
const ref = (v: string | string[] | undefined) => {
  const s = (first(v) ?? '').trim();
  return /^[A-Za-z0-9][\w./-]{0,59}$/.test(s) ? s : null;
};

/** URL search params → state; unknown or malformed values fall back to the defaults. */
export function parseBomState(sp: SP): BomState {
  const view = first(sp.view);
  const sort = first(sp.sort);
  const dir = first(sp.dir);
  const kind = first(sp.kind);
  const key = isBomSortKey(sort) ? sort : DEFAULT_BOM_SORT.key;
  return {
    view: isBomView(view) ? view : 'flat',
    q: text(sp.q),
    type: ref(sp.type),
    mfr: text(sp.mfr, 80).trim() || null,
    sort: { key, dir: dir === 'desc' || dir === 'asc' ? dir : DEFAULT_BOM_SORT.dir },
    part: ref(sp.part),
    node: ref(sp.node),
    used: text(sp.used, 80),
    sys: ref(sp.sys),
    kind: kind === 'PU' || kind === 'PR' ? kind : null,
    eq: ref(sp.eq),
  };
}

/** `/projects/{code}/bom` with a state (defaults omitted). */
export function bomHref(code: string, s: Partial<BomState> = {}): string {
  const u = new URLSearchParams();
  if (s.view && s.view !== 'flat') u.set('view', s.view);
  if (s.q) u.set('q', s.q);
  if (s.type) u.set('type', s.type);
  if (s.mfr) u.set('mfr', s.mfr);
  if (s.eq) u.set('eq', s.eq);
  if (s.sort && (s.sort.key !== DEFAULT_BOM_SORT.key || s.sort.dir !== DEFAULT_BOM_SORT.dir)) {
    u.set('sort', s.sort.key);
    u.set('dir', s.sort.dir);
  }
  if (s.used) u.set('used', s.used);
  if (s.sys) u.set('sys', s.sys);
  if (s.kind) u.set('kind', s.kind);
  if (s.node) u.set('node', s.node);
  if (s.part) u.set('part', s.part);
  const qs = u.toString();
  const base = screenHref('bom', { code });
  return qs ? `${base}?${qs}` : base;
}

/** The PU/PR list of a system (part drawer "Open PU/PR list": `{bomView:'spares', spareSys:ref, part:null}`). */
export const bomSparesHref = (code: string, systemRef: string) => bomHref(code, { view: 'spares', sys: systemRef });

/** The part record drawer over a project's BOM (part drawer "Projects equipped", other screens' part links). */
export const bomPartHref = (code: string, partRef: string) => bomHref(code, { part: partRef });
