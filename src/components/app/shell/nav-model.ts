// Pure navigation model of the app shell (docs/spec/01 §4, prototype logic lines 5139–5173).
// Shared by the sidebar (client), the page header and the catch-all route (server). No React, no server-only code.
import {
  FIXED_ORDER, SCREENS, SCREEN_BY_ID, SECTIONS, canSee, screenHref,
  type RoleKey, type ScreenDef, type ScreenId, type SectionKey,
} from '@/config/screens';

/** Badge text per screen ('' / '3' / '!' / 'NO GO'). */
export type Badges = Partial<Record<ScreenId, string>>;

// ── Route matching ─────────────────────────────────────────────────────────

export interface ScreenMatch {
  id: ScreenId;
  /** Project code for project-scoped screens. */
  code?: string;
  /** Task id for the task screen. */
  taskId?: string;
}

const PROJECT_RE = /^\/projects\/([^/?#]+)(?:\/(.*))?$/;

/** Project code of a `/projects/[code]/…` path, else null. */
export function codeFromPath(pathname: string): string | null {
  const m = PROJECT_RE.exec(pathname);
  return m ? decodeURIComponent(m[1]) : null;
}

const trimSlash = (s: string) => s.replace(/\/+$/, '') || '/';

/**
 * Screen of a pathname. `exact` (catch-all route): the path must be exactly a registry URL
 * (or `/my/tasks/<id>`). Otherwise (navigation highlight) the longest registry prefix wins,
 * so sub-routes such as `/resources/approvals/<dept>` still highlight their entry.
 */
export function matchScreen(pathname: string, mode: 'exact' | 'prefix' = 'prefix'): ScreenMatch | null {
  const path = trimSlash(pathname.split(/[?#]/)[0]);
  const pm = PROJECT_RE.exec(path);
  if (pm) {
    const code = decodeURIComponent(pm[1]);
    const rest = pm[2] ?? '';
    if (!rest) return null;
    let best: ScreenDef | null = null;
    for (const s of SCREENS) {
      if (s.scope !== 'project') continue;
      const hit = rest === s.slug || (mode === 'prefix' && rest.startsWith(s.slug + '/'));
      if (hit && (!best || s.slug.length > best.slug.length)) best = s;
    }
    return best ? { id: best.id, code } : null;
  }
  if (path === '/') return { id: 'home' };
  const task = /^\/my\/tasks\/([^/]+)$/.exec(path);
  if (task) return { id: 'task', taskId: decodeURIComponent(task[1]) };
  const rel = path.slice(1);
  let best: ScreenDef | null = null;
  for (const s of SCREENS) {
    if (s.scope === 'project' || s.id === 'task' || s.id === 'home') continue;
    const hit = rel === s.slug || (mode === 'prefix' && rel.startsWith(s.slug + '/'));
    if (hit && (!best || s.slug.length > best.slug.length)) best = s;
  }
  return best ? { id: best.id } : null;
}

/** Global view-state params kept across a project switch (`budgetTab`, `planView`… are not per project in the prototype). */
const KEPT_ON_SWITCH = ['tab', 'view'];

/**
 * Same screen for another project: `/projects/A/plan?act=A1250` → `/projects/B/plan`. Selection params are
 * project-specific and dropped; when `search` is given, the global view state (`?tab=`, `?view=`, docs/spec/00 §8.3,
 * 04 §1.3 "survives project switches") is carried over.
 */
export function swapProjectInPath(pathname: string, code: string, search?: string): string {
  const m = PROJECT_RE.exec(pathname.split(/[?#]/)[0]);
  if (!m) return screenHref('plan', { code });
  const cur = new URLSearchParams(search ?? '');
  const keep = new URLSearchParams();
  for (const k of KEPT_ON_SWITCH) {
    const v = cur.get(k);
    if (v) keep.set(k, v);
  }
  const qs = keep.toString();
  return `/projects/${encodeURIComponent(code)}${m[2] ? '/' + m[2] : ''}${qs ? '?' + qs : ''}`;
}

// ── Access helpers ─────────────────────────────────────────────────────────

/** Project-scoped screens (`showProjectPicker`, line 5175). */
export const PROJECT_SCREENS: ScreenId[] = SCREENS.filter((s) => s.scope === 'project').map((s) => s.id);
/** Project screens whose primary action is hidden in project read-only mode (line 5176: picker list minus client, docs). */
export const PROJECT_EDITABLE: ScreenId[] = PROJECT_SCREENS.filter((id) => id !== 'client' && id !== 'docs');
/** Screens showing the zone bar (`zoneBar`, line 5211). */
export const ZONE_SCREENS: ScreenId[] = SCREENS.filter((s) => s.scope === 'zone').map((s) => s.id);

/** `outside` (line 5153): the screen is not in the role's workspace (task counts as mywork). */
export const isOutside = (role: RoleKey, id: ScreenId) => !canSee(role, id);

// ── Breadcrumb base (`crumbOf`, line 5163) ─────────────────────────────────

/** Section label (+ ' · ' + group) of a screen; fixed entries → Keystone / My work / Documents. EN source string. */
export function crumbBase(id: ScreenId): string {
  const navId = id === 'task' ? 'mywork' : id;
  const s = SCREEN_BY_ID[navId];
  if (s.nav && s.nav !== 'fixed') {
    const sec = SECTIONS.find((x) => x.key === s.nav)!;
    return sec.label + (s.group ? ' · ' + s.group : '');
  }
  if (navId === 'home' || navId === 'myprojects') return 'Keystone';
  if (navId === 'mywork' || navId === 'myapprovals') return 'My work';
  if (navId === 'docs') return 'Documents';
  return 'Keystone';
}

// ── Sidebar model ──────────────────────────────────────────────────────────

export interface NavEntry {
  id: ScreenId;
  /** EN label (navLabel, or the page title for a synthetic "outside" entry). */
  label: string;
  /** True for a synthetic outside entry without a nav definition (eye icon). */
  synthetic?: boolean;
  badge: string;
  active: boolean;
}

export type NavRow =
  | { kind: 'item'; entry: NavEntry }
  | { kind: 'group'; key: string; label: string; open: boolean; bright: boolean; badge: string; count: string };

export interface NavSectionModel {
  key: SectionKey | 'outside';
  /** EN label. */
  label: string;
  /** Sub line (current project / zone), EN; '' = none. */
  sub: string;
  open: boolean;
  /** Header colour: neutral-300 when open or holding the active screen, else neutral-500. */
  bright: boolean;
  badge: string;
  count: string;
  rows: NavRow[];
}

export interface SearchEntry extends NavEntry {
  /** EN section label ('' for fixed entries). */
  section: string;
}

export interface SidebarModel {
  fixed: NavEntry[];
  sections: NavSectionModel[];
  /** Every accessible entry, for the page search (`navAll`, line 5170). */
  searchable: SearchEntry[];
}

export interface SidebarInput {
  role: RoleKey;
  /** Screen matched from the pathname (null = unknown page). */
  active: ScreenId | null;
  badges: Badges;
  /** Persisted open map: section keys and 'sub:<group label>'. */
  navOpen: Record<string, boolean>;
  /** Sub lines: current project label, zone label. EN. */
  subs: Partial<Record<SectionKey, string>>;
}

const sumBadges = (xs: NavEntry[]) => {
  const nums = xs.reduce((a, x) => a + (x.badge && /^\d+$/.test(x.badge) ? parseInt(x.badge, 10) : 0), 0);
  const alert = xs.some((x) => x.badge && !/^\d+$/.test(x.badge));
  return { nums, alert };
};

/** Builds the sidebar exactly as the prototype's `navFixed` / `navSections` / `navAll`. */
export function buildSidebar({ role, active, badges, navOpen, subs }: SidebarInput): SidebarModel {
  const isActive = (id: ScreenId) => id === active || (active === 'task' && id === 'mywork');
  const entry = (s: ScreenDef): NavEntry => ({ id: s.id, label: s.navLabel ?? s.title, badge: badges[s.id] ?? '', active: isActive(s.id) });
  const gate = (s: ScreenDef) => canSee(role, s.id);

  // Fixed entries: navHome (client role: My project instead of My projects) + navWork + navDocs.
  const fixedDefs = FIXED_ORDER.map((id) => SCREEN_BY_ID[id]).filter((s) =>
    role === 'client' ? s.id !== 'myprojects' : s.id !== 'client',
  );
  const fixed = fixedDefs.filter(gate).map(entry);

  const sections: NavSectionModel[] = [];
  const searchable: SearchEntry[] = fixed.map((e) => ({ ...e, section: '' }));

  for (const sec of SECTIONS) {
    const defs = SCREENS.filter((s) => s.nav === sec.key && gate(s));
    if (!defs.length) continue;
    const items = defs.map((s) => ({ def: s, e: entry(s) }));
    const open = navOpen[sec.key] !== undefined ? navOpen[sec.key] : sec.key === 'project';
    const subOpen = (g: string) => (navOpen['sub:' + g] !== undefined ? navOpen['sub:' + g] : g === 'Steering');
    const hasActive = items.some((x) => x.e.active);
    const shown = open ? items : items.filter((x) => x.e.active);
    const rows: NavRow[] = [];
    for (const x of shown) {
      const g = x.def.group;
      if (!g) {
        rows.push({ kind: 'item', entry: x.e });
        continue;
      }
      const gi = items.filter((y) => y.def.group === g);
      const gOpen = subOpen(g);
      // X-8 (R-151): the group header comes before the first SHOWN item of its group, so a collapsed section that shows
      // only its active item still names the group ("Control › Change control"); open, bright, badge and count stay
      // computed over every item of the group.
      if (shown.find((y) => y.def.group === g) === x) {
        const { nums, alert } = sumBadges(gi.map((y) => y.e));
        rows.push({
          kind: 'group', key: g, label: g, open: gOpen,
          bright: gOpen || gi.some((y) => y.e.active),
          badge: !gOpen && (alert || nums) ? (alert ? '!' : String(nums)) : '',
          count: gOpen || alert || nums ? '' : String(gi.length),
        });
      }
      if (gOpen || x.e.active) rows.push({ kind: 'item', entry: x.e });
    }
    const { nums, alert } = sumBadges(items.map((x) => x.e));
    sections.push({
      key: sec.key, label: sec.label, sub: subs[sec.key] ?? '', open,
      bright: hasActive || open,
      badge: !open && (alert || nums) ? (alert ? '!' : String(nums)) : '',
      count: open || alert || nums ? '' : String(items.length),
      rows,
    });
    for (const x of items) {
      const section = sec.key === 'project' && x.def.group === 'Project engineering' ? 'Project engineering' : sec.label;
      searchable.push({ ...x.e, section });
    }
  }

  // "Outside my workspace" section (line 5167): the current screen, forced active, no badge.
  if (active && isOutside(role, active)) {
    const navId: ScreenId = active === 'task' ? 'mywork' : active;
    const def = SCREEN_BY_ID[navId];
    const inNavs = def.navLabel && (def.nav !== 'fixed' || fixedDefs.some((s) => s.id === navId));
    const e: NavEntry = inNavs
      ? { id: navId, label: def.navLabel!, badge: '', active: true }
      : { id: navId, label: def.title, synthetic: true, badge: '', active: true };
    sections.unshift({
      key: 'outside', label: 'Outside my workspace', sub: '', open: true, bright: true, badge: '', count: '',
      rows: [{ kind: 'item', entry: e }],
    });
  }

  return { fixed, sections, searchable };
}

/** Page search (`navHits`, line 5171): case-insensitive substring on the displayed (FR) or EN label, max 8. */
export function searchNav(entries: SearchEntry[], query: string, t: (s: string) => string): SearchEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return entries.filter((n) => t(n.label).toLowerCase().includes(q) || n.label.toLowerCase().includes(q)).slice(0, 8);
}
