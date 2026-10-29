'use client';
// Interactive parts of the page header (docs/spec/01 §5, §7.2): project switcher, global search,
// notifications, language toggle, Export, zone bar. Strings arrive translated from the server.
import {
  ArrowsClockwise, At, Bell, BellRinging, CaretDown, CheckSquare, Export, Eye, FileCsv, FilePdf, FileXls, FolderOpen, GitBranch, MagnifyingGlass,
  PaperPlaneTilt, Receipt, SealCheck, ShieldWarning, Truck, Warning,
} from '@phosphor-icons/react/dist/ssr';
import type { Icon } from '@phosphor-icons/react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition, type RefObject } from 'react';
import { useI18n } from '@/i18n/client';
import type { Lang } from '@/i18n/translate';
import { setLanguage, setZone } from '@/server/actions/preferences';
import type { ZoneKey } from '@/server/session';
import { markAllNotificationsReadAction, markNotificationReadAction, searchAction } from './actions';
import { swapProjectInPath } from './nav-model';
import { cx } from '@/components/ds/cx';
import { MenuEmpty, MenuHeader, MenuItem } from '@/components/ds/Menu';
import { Popover } from '@/components/ds/Popover';
import { Segmented } from '@/components/ds/Segmented';
import type { ScreenId } from '@/config/screens';
import type { ExportMenuFormat } from '@/features/exports/catalog';
import { downloadExport } from '@/features/exports/download';
import { exportHref } from '@/lib/export-href';
import { useReminderPreferences } from '@/features/reminders/preferences-dialog';
import { useShell } from './shell-provider';
import type { NotificationView, ProjectOptionView, SearchHitView, ZoneOptionView } from './types';
import styles from './header.module.css';

/**
 * Closes a popover on mousedown outside `ref` and on Escape (improvement over the prototype, which only closes
 * through the trigger, a selection or a click-catcher). Escape returns the focus to `trigger`.
 */
function useDismiss(open: boolean, ref: RefObject<HTMLElement | null>, setOpen: (v: boolean) => void, trigger?: RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      trigger?.current?.focus();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, ref, setOpen, trigger]);
}

// ── Project switcher (lines 79–95) ─────────────────────────────────────────
export function ProjectSwitcher({
  current, currentName, options, scopeAvail, mineCount, param,
}: {
  current: string;
  currentName: string;
  options: ProjectOptionView[];
  scopeAvail: boolean;
  mineCount: number;
  /** Global screen scoped by a query parameter (What-if `?project=`): picking sets it instead of swapping the path. */
  param?: string;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const { projScope, setProjScope } = useShell();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  useDismiss(open, ref, setOpen, triggerRef);

  const scope = scopeAvail ? projScope : 'all';
  const query = q.trim().toLowerCase();
  const shown = options.filter((o) => (query ? o.haystack.includes(query) : scope === 'all' || o.mine));

  const pick = (code: string) => {
    setOpen(false);
    setQ('');
    if (code === current) return;
    if (param) {
      const sp = new URLSearchParams(window.location.search);
      sp.set(param, code);
      router.push(`${pathname}?${sp.toString()}`);
    } else router.push(swapProjectInPath(pathname, code, window.location.search));
  };

  return (
    <div ref={ref} className={styles.rel}>
      <button ref={triggerRef} type="button" className={styles.pickBtn} onClick={() => setOpen((o) => !o)} aria-haspopup="true" aria-expanded={open}>
        <FolderOpen className={styles.accentIcon} />
        {currentName}
        <CaretDown className={styles.mutedIcon} />
      </button>
      {open && (
        <div className={cx('elev-md', styles.pickMenu)}>
          <div className={styles.menuHead}>{t('Switch project')}</div>
          {scopeAvail && (
            <Segmented
              className={styles.pickSeg}
              fullWidth
              value={scope}
              onChange={(v) => {
                setProjScope(v);
                setQ('');
              }}
              options={[
                { value: 'mine' as const, label: t('My projects'), count: mineCount },
                { value: 'all' as const, label: t('Whole portfolio'), count: options.length },
              ]}
            />
          )}
          <div className={styles.pickSearch}>
            <MagnifyingGlass size={13} className={styles.pickSearchIcon} />
            <input
              className={cx('input', styles.pickInput)}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t('Search a project number or name…')}
            />
          </div>
          {shown.map((o) => (
            <button
              key={o.code}
              type="button"
              aria-current={o.code === current ? 'true' : undefined}
              className={cx(styles.pickOpt, o.code === current && styles.pickOptOn)}
              onClick={() => pick(o.code)}
            >
              <span className={styles.stack}>
                <span className={styles.ellipsis}>{o.name}</span>
                <span className={styles.optSub}>{o.sub}</span>
              </span>
              <span className={styles.optRight}>
                {o.readOnly && (
                  <span className={styles.roEye} title={t('Read-only')}>
                    <Eye size={14} />
                  </span>
                )}
                <span className={o.tagClass}>{o.health}</span>
              </span>
            </button>
          ))}
          {!shown.length && <span className={styles.menuEmpty}>{t('No project in this scope · search the whole portfolio')}</span>}
        </div>
      )}
    </div>
  );
}

// ── Global search (lines 99–107) ───────────────────────────────────────────
export function GlobalSearch() {
  const { t } = useI18n();
  const { project } = useShell();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<{ query: string; hits: SearchHitView[] } | null>(null);
  const query = q.trim();

  useEffect(() => {
    if (query.length < 2) return;
    let live = true;
    const h = setTimeout(async () => {
      const hits = await searchAction(query, project);
      if (live) setResult({ query, hits });
    }, 120);
    return () => {
      live = false;
      clearTimeout(h);
    };
  }, [query, project]);

  const close = () => {
    setOpen(false);
    setQ('');
  };
  const visible = open && query.length >= 2;
  const fresh = result?.query === query;

  return (
    <div className={styles.search}>
      <MagnifyingGlass className={styles.searchIcon} />
      <input
        className={cx('input', styles.searchInput)}
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') close();
        }}
        placeholder={t('Search projects, activities, parts, orders, people…')}
        aria-label={t('Search projects, activities, parts, orders, people…')}
      />
      {visible && (
        <>
          <div className={styles.catcher} onClick={close} />
          <div className={cx('elev-md', styles.searchPanel)}>
            {(result?.hits ?? []).map((r, i) => (
              <Link key={r.href + i} href={r.href} className={styles.hit} onClick={close}>
                <span className={cx('tag tag-neutral', styles.hitKind)}>{r.kind}</span>
                <span className={styles.stack}>
                  <span className={styles.ellipsis}>{r.title}</span>
                  <span className={styles.hitSub}>{r.sub}</span>
                </span>
              </Link>
            ))}
            {fresh && !result.hits.length && <span className={styles.searchEmpty}>{t('No match — try a reference, a name or a supplier')}</span>}
          </div>
        </>
      )}
    </div>
  );
}

// ── Notifications (lines 108–117) ──────────────────────────────────────────
const NOTIF_ICON: Record<string, Icon> = {
  approval: SealCheck, alert: Warning, quality: ShieldWarning, delivery: Truck, eco: GitBranch,
  mention: At, request: PaperPlaneTilt, invoice: Receipt, task: CheckSquare, sync: ArrowsClockwise,
};

/**
 * The bell. `emailOn`: an e-mail transport is configured (R-199 / R-036: reminders and weekly reports also by e-mail); the
 * footer opens the viewer's "Reminders & reports" preferences.
 */
export function Notifications({ items, role, emailOn = false }: { items: NotificationView[]; role: string; emailOn?: boolean }) {
  const { t } = useI18n();
  const shell = useShell();
  const prefs = useReminderPreferences();
  const readNotifs = shell.readNotifs(role);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  useDismiss(open, ref, setOpen, triggerRef);
  const isRead = (n: NotificationView) => n.read || readNotifs.has(n.id);
  const unread = items.filter((n) => !isRead(n)).length;

  return (
    <div ref={ref} className={styles.rel}>
      <button
        ref={triggerRef}
        type="button"
        className={cx('btn btn-icon btn-secondary', styles.bell)}
        onClick={() => setOpen((o) => !o)}
        title={t('Notifications')}
        aria-label={t('Notifications')}
        aria-expanded={open}
      >
        <Bell />
        {unread > 0 && <span className={styles.bellBadge}>{unread}</span>}
      </button>
      {open && (
        <>
          <div className={styles.catcher} onClick={() => setOpen(false)} />
          <div className={cx('elev-md', styles.notifPanel)}>
            <div className={styles.notifHead}>
              <span className={styles.notifTitle}>{t('Notifications')}</span>
              <button
                type="button"
                className={cx('btn btn-ghost', styles.markAll)}
                onClick={() => {
                  shell.markAllRead(role, items.map((n) => n.id));
                  void markAllNotificationsReadAction();
                }}
              >
                {t('Mark all read')}
              </button>
            </div>
            {items.map((n) => {
              const I = NOTIF_ICON[n.kind] ?? Bell;
              const read = isRead(n);
              return (
                <Link
                  key={n.id}
                  href={n.href}
                  className={cx(styles.notif, !read && styles.notifUnread)}
                  onClick={() => {
                    shell.markRead(role, n.id);
                    if (!n.read) void markNotificationReadAction(n.id);
                    setOpen(false);
                  }}
                >
                  <span className={cx(styles.dot, !read && styles.dotOn)} />
                  <span className={styles.notifIcon}>
                    <I />
                  </span>
                  <span className={styles.stack}>
                    <span className={styles.notifText}>{n.title}</span>
                    <span className={styles.notifSub}>{n.sub}</span>
                    <span className={styles.notifWhen}>{n.when}</span>
                  </span>
                </Link>
              );
            })}
            {/* X-6b / S-11 (R-037): no Teams channel post exists; R-199 / R-036: e-mail when IT's transport is configured. */}
            <div className={styles.notifFoot}>
              <span>{t(emailOn ? 'Reminders and weekly reports are also sent by e-mail' : 'E-mail not connected yet — reminders and notifications stay in Keystone')}</span>
              <button
                type="button"
                className={cx('btn btn-ghost', styles.markAll)}
                disabled={prefs.pending}
                onClick={() => {
                  setOpen(false);
                  prefs.open();
                }}
              >
                <BellRinging aria-hidden /> {t('Reminders & reports')}
              </button>
            </div>
          </div>
        </>
      )}
      {prefs.dialog}
    </div>
  );
}

// ── Language toggle (line 120) ─────────────────────────────────────────────
export function LangToggle({ lang }: { lang: Lang }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  return (
    <Segmented
      value={lang}
      onChange={(v) =>
        startTransition(async () => {
          await setLanguage(v);
          router.refresh();
        })
      }
      options={[
        { value: 'fr' as Lang, label: 'FR' },
        { value: 'en' as Lang, label: 'EN' },
      ]}
    />
  );
}

// ── Export (line 122): menu Excel / CSV (+ PDF report) of the screen's current view (chapter 4, X-3) ──────
/**
 * The file reflects what the screen shows: its search params (tab, filters, search) are read at click time and the
 * route re-applies the viewer's rights. `code` = project of a project screen, else the shell's current project (the
 * global screens that depend on it: Home, My approvals, Sourcing, Resources); `task` = the task of the Task screen.
 */
export function ExportButton({ screen, code, formats = [], task }: { screen?: ScreenId; code?: string | null; formats?: ExportMenuFormat[]; task?: string | null }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const run = async (format: ExportMenuFormat) => {
    if (!screen || busy) return;
    const params = new URLSearchParams(window.location.search);
    if (task) params.set('task', task);
    // Approvals keep the department in the path (/resources/approvals/<dept>).
    if (screen === 'approvals') params.set('dept', decodeURIComponent(window.location.pathname.split('/').filter(Boolean).at(-1) ?? ''));
    setBusy(true);
    try {
      await downloadExport(exportHref(screen, { format, code, params }), t('Export failed'));
    } finally {
      setBusy(false);
    }
  };
  const LABEL: Record<ExportMenuFormat, [Icon, string]> = { xlsx: [FileXls, 'Excel (.xlsx)'], csv: [FileCsv, 'CSV'], pdf: [FilePdf, 'PDF report'] };
  return (
    <Popover
      triggerClassName="btn btn-secondary"
      trigger={
        <>
          <Export />
          {t('Export')}
        </>
      }
      align="end"
      minWidth="200px"
      zIndex={30}
    >
      <MenuHeader>{t('Export this view')}</MenuHeader>
      {formats.map((f) => {
        const [I, label] = LABEL[f];
        return (
          <MenuItem key={f} icon={I} disabled={busy} onClick={() => void run(f)}>
            {t(label)}
          </MenuItem>
        );
      })}
      {!formats.length && <MenuEmpty>{t('Nothing to export on this screen')}</MenuEmpty>}
    </Popover>
  );
}

// ── Zone bar control (lines 130–136) ───────────────────────────────────────
export function ZoneSeg({ zone, options }: { zone: ZoneKey | null; options: ZoneOptionView[] }) {
  const [, startTransition] = useTransition();
  return (
    <Segmented<ZoneKey | 'all'>
      wrap
      value={zone ?? 'all'}
      onChange={(v) => startTransition(() => setZone(v === 'all' ? null : v))}
      options={options.map((o) => ({ value: o.key ?? 'all', label: o.label, count: o.count }))}
    />
  );
}
