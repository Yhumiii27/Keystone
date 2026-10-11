'use client';
// Account menu (R-038/R-039, Entra mode) in place of "View as": the signed-in user, the choice of the active role when
// they hold several (default: the highest), and "Sign out". Same trigger and menu as the "View as" switcher (lines
// 58–72); closes on outside click and Escape.
import { CaretUpDown, Check, SignOut } from '@phosphor-icons/react/dist/ssr';
import { useEffect, useRef, useState, useTransition } from 'react';
import { cx } from '@/components/ds/cx';
import { showToast } from '@/components/ds/Toast';
import type { RoleKey } from '@/config/screens';
import { useI18n } from '@/i18n/client';
import { setActiveRole } from '@/server/actions/auth';
import styles from './sidebar.module.css';

export interface SidebarAccount {
  name: string;
  /** EN source string. */
  title: string;
  initials: string;
  /** Active role. */
  role: RoleKey;
  /** Roles held, priority order, with their EN labels. */
  roles: { role: RoleKey; label: string }[];
}

/** Sign-out route (POST; it redirects to the Microsoft sign-out). */
export const SIGN_OUT_ACTION = '/api/auth/sign-out';

export function AccountMenu({ account }: { account: SidebarAccount }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

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
    if (k === account.role) return;
    startTransition(async () => {
      const r = await setActiveRole(k);
      if (r && !r.ok) showToast(r.error);
    });
  };

  return (
    <div ref={ref} className={styles.viewAs}>
      {open && (
        <div className={cx('elev-md', styles.menu)} role="menu">
          {account.roles.length > 1 && (
            <>
              <div className={styles.menuHead}>{t('Active role')}</div>
              {account.roles.map((r) => (
                <button
                  key={r.role}
                  type="button"
                  role="menuitemradio"
                  aria-checked={r.role === account.role}
                  className={cx(styles.persona, r.role === account.role && styles.personaOn)}
                  onClick={() => choose(r.role)}
                  disabled={pending}
                >
                  <span className={styles.roleCheck}>{r.role === account.role && <Check size={12} aria-hidden />}</span>
                  <span className={styles.whoName}>{t(r.label)}</span>
                </button>
              ))}
              <div className={styles.menuSep} role="separator" />
            </>
          )}
          <form method="post" action={SIGN_OUT_ACTION} className={styles.signOutForm}>
            <button type="submit" role="menuitem" className={styles.persona}>
              <span className={styles.roleCheck}>
                <SignOut size={13} aria-hidden />
              </span>
              <span className={styles.whoName}>{t('Sign out')}</span>
            </button>
          </form>
        </div>
      )}
      <button ref={triggerRef} type="button" className={styles.trigger} onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open}>
        <div className={styles.avatar}>{account.initials}</div>
        <div className={styles.who}>
          <span className={styles.triggerName}>{account.name}</span>
          <span className={styles.whoRole}>{t(account.roles.length > 1 ? account.roles.find((r) => r.role === account.role)?.label ?? account.title : account.title)}</span>
        </div>
        <CaretUpDown className={styles.caret} />
      </button>
    </div>
  );
}
