'use client';
// Sidebar (docs/spec/01 §4, prototype lines 19–73): brand, page search (⌘K), fixed entries, collapsible
// sections with Project groups, "Outside my workspace" section, "View as" switcher.
// Fed by server data from the (app) layout; active entry and current project come from the URL.
// Tablet layout (R-146, X-4): up to 1024 px the sidebar is a drawer over the page, opened by the top bar's menu button
// (nav-toggle.tsx), closed by its close button, the backdrop, Escape or any navigation; the page behind is inert.
import { CaretDown, CaretRight, CaretUpDown, Eye, MagnifyingGlass, Polygon, X } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, useTransition, type KeyboardEvent } from 'react';
import { cx } from '@/components/ds/cx';
import { SCREEN_BY_ID, screenHref, type RoleKey, type ScreenId } from '@/config/screens';
import { useI18n } from '@/i18n/client';
import { setViewAs } from '@/server/actions/preferences';
import { AccountMenu, type SidebarAccount } from './account-menu';
import { COOKIE_NAV } from './types';
import { buildSidebar, matchScreen, searchNav, type Badges, type NavEntry, type NavSectionModel } from './nav-model';
import { useShell } from './shell-provider';
import styles from './sidebar.module.css';
import { NAV_TOGGLE_ID, SIDEBAR_ID, TABLET_MEDIA } from './tablet';

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
  const router = useRouter();
  const { project: code, navDrawer, setNavDrawer } = useShell();
  const [navOpen, setOpenState] = useState(initialOpen);
  const [navQ, setNavQ] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);

  // Drawer open (tablet layout): the page behind is inert, focus moves to the close button, Escape closes and gives the
  // focus back to the menu button. Widening the window past the tablet layout closes it (the page must not stay inert).
  useEffect(() => {
    if (!navDrawer) return;
    const main = document.querySelector('main');
    const media = window.matchMedia(TABLET_MEDIA);
    // The menu button only exists in the tablet layout.
    if (!media.matches) return;
    if (main) main.inert = true;
    closeRef.current?.focus();
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      returnFocus.current = true;
      setNavDrawer(false);
    };
    const onMedia = () => {
      if (!media.matches) setNavDrawer(false);
    };
    document.addEventListener('keydown', onKey);
    media.addEventListener('change', onMedia);
    return () => {
      document.removeEventListener('keydown', onKey);
      media.removeEventListener('change', onMedia);
      if (main) main.inert = false;
      if (returnFocus.current) document.getElementById(NAV_TOGGLE_ID)?.focus();
      returnFocus.current = false;
    };
  }, [navDrawer, setNavDrawer]);
  const closeDrawer = (focusToggle: boolean) => {
    returnFocus.current = focusToggle;
    setNavDrawer(false);
  };

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
  const hits = useMemo(() => searchNav(model.searchable, navQ, t), [model.searchable, navQ, t]);
  const searching = !!navQ.trim();

  // ⌘K / Ctrl+K focuses and selects the page search (componentDidMount, line 3765).
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const hrefOf = (id: ScreenId) => screenHref(id, { code });

  const onSearchKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') setNavQ('');
    else if (e.key === 'Enter' && hits.length) {
      router.push(hrefOf(hits[0].id));
      setNavQ('');
      closeDrawer(false);
    }
  };

  const toggle = (key: string, open: boolean) => {
    const next = { ...navOpen, [key]: !open };
    setOpenState(next);
    persistNavOpen(next);
  };

  const entry = (n: NavEntry, kind: 'fixed' | 'item') => {
    const Icon = n.synthetic ? Eye : SCREEN_BY_ID[n.id].icon ?? Eye;
    return (
      <Link
        key={n.id}
        href={hrefOf(n.id)}
        className={cx(styles.entry, kind === 'item' && styles.item, n.active && styles.active)}
        aria-current={n.active ? 'page' : undefined}
        onClick={() => closeDrawer(false)}
      >
        <Icon size={16} className={styles.icon} />
        <span className={styles.label}>{t(n.label)}</span>
        {n.badge && <span className={styles.badge}>{t(n.badge)}</span>}
      </Link>
    );
  };

  const section = (sec: NavSectionModel) => {
    const outside = sec.key === 'outside';
    const Chev = outside ? Eye : sec.open ? CaretDown : CaretRight;
    return (
      <div key={sec.key} className={styles.section}>
        <button
          type="button"
          className={cx(styles.secHead, sec.bright && styles.bright, outside && styles.outsideHead)}
          onClick={outside ? undefined : () => toggle(sec.key, sec.open)}
          aria-expanded={outside ? undefined : sec.open}
        >
          <Chev size={11} className={styles.icon} />
          <span className={styles.label}>{t(sec.label)}</span>
          {sec.badge && <span className={styles.secBadge}>{t(sec.badge)}</span>}
          {sec.count && <span className={styles.secCount}>{sec.count}</span>}
        </button>
        {sec.sub && (
          <div className={styles.sub} title={t('Current project')}>
            {t(sec.sub)}
          </div>
        )}
        {sec.rows.map((r) => {
          if (r.kind === 'item') return entry(r.entry, 'item');
          const GChev = r.open ? CaretDown : CaretRight;
          return (
            <button
              key={'g:' + r.key}
              type="button"
              className={cx(styles.group, r.bright && styles.bright)}
              onClick={(e) => {
                e.stopPropagation();
                toggle('sub:' + r.key, r.open);
              }}
              aria-expanded={r.open}
            >
              <GChev size={10} className={styles.icon} />
              <span className={styles.groupLabel}>{t(r.label)}</span>
              <span className={styles.rule} />
              {r.badge && <span className={styles.groupBadge}>{t(r.badge)}</span>}
              {r.count && <span className={styles.groupCount}>{r.count}</span>}
            </button>
          );
        })}
      </div>
    );
  };

  return (
    <>
      <div className={cx(styles.backdrop, navDrawer && styles.backdropOn)} onClick={() => closeDrawer(true)} aria-hidden="true" />
      <aside id={SIDEBAR_ID} className={cx(styles.aside, navDrawer && styles.open)} aria-label={t('Main menu')}>
        <div className={styles.brand}>
          <div className={styles.logo}>
            <Polygon size={15} />
          </div>
          <div className={styles.wordmark}>{t('Keystone')}</div>
          <button ref={closeRef} type="button" className={cx('btn btn-ghost btn-icon', styles.close)} onClick={() => closeDrawer(true)} aria-label={t('Close menu')}>
            <X size={18} />
          </button>
        </div>
        <div className={styles.search}>
          <MagnifyingGlass size={13} className={styles.searchIcon} />
          <input
            ref={searchRef}
            className={cx('input', styles.searchInput)}
            value={navQ}
            onChange={(e) => setNavQ(e.target.value)}
            onKeyDown={onSearchKey}
            placeholder={t('Go to a page…')}
            aria-label={t('Go to a page…')}
          />
          <span className={styles.kbd}>⌘K</span>
        </div>
        {searching ? (
          <div className={styles.list}>
            {hits.map((n) => {
              const Icon = SCREEN_BY_ID[n.id].icon ?? Eye;
              return (
                <Link
                  key={n.id}
                  href={hrefOf(n.id)}
                  onClick={() => {
                    setNavQ('');
                    closeDrawer(false);
                  }}
                  className={cx(styles.entry, styles.hit, n.active && styles.active)}
                >
                  <Icon size={16} className={styles.icon} />
                  <span className={styles.hitText}>
                    <span className={styles.hitLabel}>{t(n.label)}</span>
                    <span className={styles.hitSection}>{n.section ? t(n.section) : ''}</span>
                  </span>
                  {n.badge && <span className={styles.badge}>{t(n.badge)}</span>}
                </Link>
              );
            })}
            {!hits.length && <span className={styles.empty}>{t('No page matches')}</span>}
          </div>
        ) : (
          <>
            <div className={styles.list}>{model.fixed.map((n) => entry(n, 'fixed'))}</div>
            <div className={styles.sections}>{model.sections.map(section)}</div>
          </>
        )}
        {account ? <AccountMenu account={account} /> : <ViewAs role={role} personas={personas} />}
      </aside>
    </>
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
      <button ref={triggerRef} type="button" className={styles.trigger} onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open}>
        <div className={styles.avatar}>{viewer.initials}</div>
        <div className={styles.who}>
          <span className={styles.triggerName}>{viewer.name}</span>
          <span className={styles.whoRole}>{t(viewer.title)}</span>
        </div>
        <CaretUpDown className={styles.caret} />
      </button>
    </div>
  );
}
