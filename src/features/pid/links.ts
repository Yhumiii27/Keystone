// URL state of P&ID — tags, overlay & process validation — /projects/[code]/pid (docs/spec/09 §6, 00 §8.3). Pure: usable
// from Server and Client Components, and from other screens linking to a tag.
//   ?status=linked|unmapped|unknown_ref|not_in_bom|part_not_validated|part_outdated|part_obsolete|client   status chip (`pidFilter`)
//   ?scope=keystone|overlay|client   scope segment (`pidScope`)
//   ?q=<search>                      tag, description, reference, PLC, feedback (`pidQ`)
//   ?tag=LT-101                      tag drawer (`pidTag`; matched case-insensitively, unknown → none)
//   ?part=EL-PLC-S7                  part record drawer over the screen (the shared <PartDrawer/>; "Part record")
//   ?cq=<search>&ctype=all|<type>   R-108: the tag drawer's catalogue search (text, type filter — default the compatible types)
import { screenHref } from '@/config/screens';
import { pidScopeFilterOf, pidStatusFilterOf, pidTypeFilterOf, type BomScope, type PidTagStatus, type PidTypeFilter } from '@/domain/pid';

export interface PidState {
  status: PidTagStatus | null;
  scope: BomScope | null;
  q: string;
  tag: string | null;
  part: string | null;
  /** R-108: candidate search text of the tag drawer ('' = none). */
  cq?: string;
  /** R-108: candidate type filter ('compatible' = the default, omitted from the URL). */
  ctype?: PidTypeFilter;
}

export const DEFAULT_PID_STATE: PidState = { status: null, scope: null, q: '', tag: null, part: null, cq: '', ctype: 'compatible' };

type SP = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
/** A reference-like parameter ("LT-101", "EL-PLC-S7"); anything else is ignored. */
const ident = (v: string | string[] | undefined) => {
  const s = (first(v) ?? '').trim();
  return /^[A-Za-z0-9][\w ./#×-]{0,59}$/.test(s) ? s : null;
};

/** URL search params → state; unknown or malformed values fall back to the defaults. */
export function parsePidState(sp: SP): PidState {
  return {
    status: pidStatusFilterOf(first(sp.status)),
    scope: pidScopeFilterOf(first(sp.scope)),
    q: (first(sp.q) ?? '').replace(/[\u0000-\u001f]/g, '').slice(0, 120),
    tag: ident(sp.tag),
    part: ident(sp.part),
    cq: (first(sp.cq) ?? '').replace(/[\u0000-\u001f]/g, '').slice(0, 60),
    ctype: pidTypeFilterOf(first(sp.ctype)),
  };
}

/** `/projects/{code}/pid` with a state (defaults omitted). */
export function pidHref(code: string, s: Partial<PidState> = {}): string {
  const u = new URLSearchParams();
  if (s.status) u.set('status', s.status);
  if (s.scope) u.set('scope', s.scope);
  if (s.q) u.set('q', s.q);
  if (s.tag) u.set('tag', s.tag);
  if (s.part) u.set('part', s.part);
  // The candidate search belongs to the open tag drawer.
  if (s.tag && s.cq) u.set('cq', s.cq);
  if (s.tag && s.ctype && s.ctype !== 'compatible') u.set('ctype', s.ctype);
  const qs = u.toString();
  const base = screenHref('pid', { code });
  return qs ? `${base}?${qs}` : base;
}

/** A tag's drawer on the P&ID screen of `code` (links from other screens). */
export const pidTagHref = (code: string, tag: string) => pidHref(code, { tag });

/** An activity's drawer on the project plan (`?act=`). */
export const activityHref = (code: string, activityCode: string) => `${screenHref('plan', { code })}?act=${encodeURIComponent(activityCode)}`;
