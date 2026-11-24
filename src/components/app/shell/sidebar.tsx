'use client';
// Sidebar (docs/spec/01 §4, prototype lines 19–73): brand, page search (⌘K), fixed entries, collapsible
// sections with Project groups, "Outside my workspace" section, "View as" switcher.
// Fed by server data from the (app) layout; active entry and current project come from the URL.
// Rendered with Norma 2.0's common shell (norma/charte/COQUE.md § 2: Sidebar, PageSearch, NavList, NavSections, NavSection,
// NavEntry; classes of coque.css): the navigation model (screens, rights, badges) stays Keystone's (nav-model.ts).
// Tablet layout (R-146, X-4): up to 1024 px the sidebar is the charte's drawer, opened by the top bar's menu button
// (topbar.tsx), closed by its close button, the backdrop, Escape or a followed entry; the page behind is inert.
import { CaretDown, CaretRight, CaretUpDown, Eye, Polygon } from '@phosphor-icons/react/dist/ssr';
import { NavEntry as NavLink, NavList, NavSection, NavSections, PageSearch, Sidebar as CoqueSidebar, type PageHit } from '@norma/charte/ds/Sidebar';
import { usePathname } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { cx } from '@/components/ds/cx';
import { SCREEN_ICONS } from '@/config/screen-icons';
import { screenHref, type RoleKey, type ScreenId } from '@/config/screens';
import { useI18n } from '@/i18n/client';
import { setViewAs } from '@/server/actions/preferences';
import { AccountMenu, type SidebarAccount } from './account-menu';
import { COOKIE_NAV } from './types';
import { buildSidebar, matchScreen, type Badges, type NavEntry, type NavSectionModel } from './nav-model';
import { useShell } from './shell-provider';
import styles from './sidebar.module.css';

export interface SidebarPersona {
  role: RoleKey;
  name: string;
  /** EN source string. */
  title: string;
  initials: string;
}

export interface SidebarProps {
  role: RoleKey;
  /** Demo mode: the "View as" personas. */
  personas: SidebarPersona[];
  /** Entra mode (R-038): the signed-in user — the account menu replaces "View as". */
  account?: SidebarAccount | null;
  navOpen: Record<string, boolean>;
  /** Selected zone label (EN), '' when none: sub line of Portfolio and Warranty & after-sales. */
  zoneLabel: string;
  /** Every project: code → EN label ("#026 · Harbor Line Terminal Expansion"). */
  projects: { code: string; label: string }[];
  globalBadges: Badges;
  projectBadges: Record<string, Badges>;
}

/**
 * Persists the open/closed map like the prototype's localStorage key, in the cookie read by getNavOpen(). Written
 * client-side: a server action setting a cookie would re-render the whole page on every toggle.
 */
function persistNavOpen(map: Record<string, boolean>) {
  document.cookie = `${COOKIE_NAV}=${encodeURIComponent(JSON.stringify(map))}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
}

export function Sidebar({ role, personas, account, navOpen: initialOpen, zoneLabel, projects, globalBadges, projectBadges }: SidebarProps) {
  const { t } = useI18n();
  const pathname = usePathname();
  const { project: code } = useShell();
  const [navOpen, setOpenState] = useState(initialOpen);

  const active = matchScreen(pathname)?.id ?? null;
  const projectLabel = projects.find((p) => p.code === code)?.label ?? code;
  const model = useMemo(
    () =>
      buildSidebar({
        role,
        active,
        badges: { ...globalBadges, ...(projectBadges[code] ?? {}) },
        navOpen,
        subs: { portfolio: zoneLabel, sav: zoneLabel, project: projectLabel },
      }),
    [role, active, globalBadges, projectBadges, code, navOpen, zoneLabel, projectLabel],
  );

  const hrefOf = (id: ScreenId) => screenHref(id, { code });
  // Every page of the menu, for the ⌘K page search (COQUE.md § 2: every word of the query in the label or the section).
  const pages: PageHit[] = useMemo(
    () =>
      model.searchable.map((n) => ({
        href: screenHref(n.id, { code }),
        label: t(n.label),
        section: n.section ? t(n.section) : undefined,
        icon: SCREEN_ICONS[n.id] ?? Eye,
        badge: n.badge ? t(n.badge) : undefined,
      })),
    [model.searchable, code, t],
  );

  const toggle = (key: string, open: boolean) => {
    const next = { ...navOpen, [key]: !open };
    setOpenState(next);
    persistNavOpen(next);
  };

  const entry = (n: NavEntry, item: boolean) => (
    <NavLink
      key={n.id}
      href={hrefOf(n.id)}
      label={t(n.label)}
      icon={n.synthetic ? Eye : SCREEN_ICONS[n.id] ?? Eye}
      active={n.active}
      badge={n.badge ? t(n.badge) : undefined}
      item={item}
    />
  );

  const rows = (sec: NavSectionModel) =>
    sec.rows.map((r) => {
      if (r.kind === 'item') return entry(r.entry, true);
      const GChev = r.open ? CaretDown : CaretRight;
      // A project group (the charte's NavGroup, with Keystone's badge and brighter label when it holds the current page).
      return (
        <button
          key={'g:' + r.key}
          type="button"
          className={cx('coque-group', r.bright && styles.groupBright)}
          onClick={(e) => {
            e.stopPropagation();
            toggle('sub:' + r.key, r.open);
          }}
          aria-expanded={r.open}
        >
          <GChev size={10} className="coque-entry-icon" aria-hidden />
          <span>{t(r.label)}</span>
          <span className="coque-group-rule" />
          {r.badge && <span className="coque-sec-badge">{t(r.badge)}</span>}
          {r.count && <span className="coque-group-count">{r.count}</span>}
        </button>
      );
    });

  const section = (sec: NavSectionModel) => {
    if (sec.key === 'outside') {
      // "Outside my workspace": a fixed section, an eye instead of the caret (not collapsible).
      return (
        <div key={sec.key} className="coque-sec">
          <div className={cx('coque-sec-head', styles.outsideHead)}>
            <Eye size={11} className="coque-entry-icon" aria-hidden />
            <span className="coque-entry-label">{t(sec.label)}</span>
            {sec.count && <span className="coque-sec-count">{sec.count}</span>}
          </div>
          {rows(sec)}
        </div>
      );
    }
    return (
      <NavSection
        key={sec.key}
        label={t(sec.label)}
        open={sec.open}
        onToggle={() => toggle(sec.key, sec.open)}
        bright={sec.bright}
        badge={sec.badge ? t(sec.badge) : undefined}
        count={sec.count || undefined}
        sub={sec.sub ? t(sec.sub) : undefined}
      >
        {rows(sec)}
      </NavSection>
    );
  };

  return (
    <CoqueSidebar name={t('Keystone')} icon={Polygon} footer={account ? <AccountMenu account={account} /> : <ViewAs role={role} personas={personas} />}>
      <PageSearch pages={pages}>
        <NavList>{model.fixed.map((n) => entry(n, false))}</NavList>
        <NavSections>{model.sections.map(section)}</NavSections>
      </PageSearch>
    </CoqueSidebar>
  );
}

/** "View as" persona switcher (lines 58–72). Closes on outside click and Escape (improvement over the prototype). */
function ViewAs({ role, personas }: { role: RoleKey; personas: SidebarPersona[] }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [, startTransition] = useTransition();
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const viewer = personas.find((p) => p.role === role) ?? personas[0];

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const choose = (k: RoleKey) => {
    setOpen(false);
    startTransition(async () => {
      await setViewAs(k);
    });
  };

  return (
    <div ref={ref} className={styles.viewAs}>
      {open && (
        <div className={cx('elev-md', styles.menu)} role="menu">
          <div className={styles.menuHead}>{t('View as')}</div>
          {personas.map((p) => (
            <button
              key={p.role}
              type="button"
              role="menuitemradio"
              aria-checked={p.role === role}
              className={cx(styles.persona, p.role === role && styles.personaOn)}
              onClick={() => choose(p.role)}
            >
              <span className={styles.avatarSm}>{p.initials}</span>
              <span className={styles.who}>
                <span className={styles.whoName}>{p.name}</span>
                <span className={styles.whoRole}>{t(p.title)}</span>
              </span>
            </button>
          ))}
        </div>
      )}
      <button ref={triggerRef} type="button" className="coque-user" onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open}>
        <span className="coque-avatar">{viewer.initials}</span>
        <span className="coque-who">
          <span className="coque-who-name">{viewer.name}</span>
          <span className="coque-who-role">{t(viewer.title)}</span>
        </span>
        <CaretUpDown className="coque-user-caret" aria-hidden />
      </button>
    </div>
  );
}
