'use client';
// Top bar of the tablet layout (R-146, X-4): the menu button that opens the sidebar drawer, and the wordmark the hidden
// sidebar no longer shows. Hidden above 1024 px (shell.module.css), where the sidebar stays in the grid.
import { List, Polygon } from '@phosphor-icons/react/dist/ssr';
import { useI18n } from '@/i18n/client';
import { useShell } from './shell-provider';
import { NAV_TOGGLE_ID, SIDEBAR_ID } from './tablet';
import styles from './shell.module.css';

export function NavToggle() {
  const { t } = useI18n();
  const { navDrawer, setNavDrawer } = useShell();
  return (
    <div className={styles.topbar}>
      <button
        id={NAV_TOGGLE_ID}
        type="button"
        className={`btn btn-secondary ${styles.menuBtn}`}
        aria-controls={SIDEBAR_ID}
        aria-expanded={navDrawer}
        onClick={() => setNavDrawer(!navDrawer)}
      >
        <List size={18} />
        <span>{t('Menu')}</span>
      </button>
      <span className={styles.topbarBrand}>
        <Polygon size={15} className={styles.topbarLogo} />
        {t('Keystone')}
      </span>
    </div>
  );
}
