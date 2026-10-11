'use client';
// Sidebar (docs/spec/01 §4, prototype lines 19–73): brand, page search (⌘K), fixed entries, collapsible
// sections with Project groups, "Outside my workspace" section, "View as" switcher.
// Fed by server data from the (app) layout; active entry and current project come from the URL.
import { CaretDown, CaretRight, CaretUpDown, Eye, MagnifyingGlass, Polygon } from '@phosphor-icons/react/dist/ssr';
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
  const { project: code } = useShell();
  const [navOpen, setOpenState] = useState(initialOpen);
  const [navQ, setNavQ] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

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
    <aside className={styles.aside}>
      <div className={styles.brand}>
        <div className={styles.logo}>
          <Polygon size={15} />
        </div>
        <div className={styles.wordmark}>{t('Keystone')}</div>
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
                onClick={() => setNavQ('')}
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
