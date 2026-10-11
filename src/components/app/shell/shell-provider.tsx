'use client';
// Session-level client state of the shell, mounted once in the (app) layout so it survives page navigations:
// notifications marked read in this session (docs/spec/01 §5.5 — optimistic overlay, per viewer role, of the
// per-user read state the Server Functions persist), current/last project (from the URL, else the ks-project
// cookie), the project switcher scope (§5.2) and, on a tablet (R-146), whether the sidebar drawer is open.
// The toast is the DS one (src/components/ds/Toast: useToast().showEn(english)), mounted by the layout.
import { usePathname } from 'next/navigation';
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { codeFromPath } from './nav-model';
import { navDrawerAfter } from './tablet';

const NO_IDS: ReadonlySet<string> = new Set();

interface ShellCtx {
  /** Current project: code in the URL, else the last project used. */
  project: string;
  /** Notifications the viewer `role` marked read in this session (the server state follows on the next render). */
  readNotifs: (role: string) => ReadonlySet<string>;
  markRead: (role: string, id: string) => void;
  markAllRead: (role: string, ids: string[]) => void;
  projScope: 'mine' | 'all';
  setProjScope: (v: 'mine' | 'all') => void;
  /** Tablet layout (≤ 1024 px): the sidebar drawer is open. Closed again by any navigation to another path. */
  navDrawer: boolean;
  setNavDrawer: (open: boolean) => void;
}

const Ctx = createContext<ShellCtx | null>(null);

export function useShell(): ShellCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useShell() outside <ShellProvider>');
  return c;
}

export function ShellProvider({ initialProject, projectCodes, children }: { initialProject: string; projectCodes: string[]; children: ReactNode }) {
  const pathname = usePathname();

  // Last project: follows the URL (adjusted during render, no effect needed).
  const urlCode = codeFromPath(pathname);
  const [last, setLast] = useState(initialProject);
  if (urlCode && urlCode !== last && projectCodes.includes(urlCode)) setLast(urlCode);
  const project = urlCode && projectCodes.includes(urlCode) ? urlCode : last;

  // Keyed by role: switching persona must not carry another user's read marks over.
  const [read, setRead] = useState<{ role: string; ids: ReadonlySet<string> }>({ role: '', ids: NO_IDS });
  const readNotifs = useCallback((role: string) => (read.role === role ? read.ids : NO_IDS), [read]);
  const markRead = useCallback(
    (role: string, id: string) => setRead((r) => ({ role, ids: new Set([...(r.role === role ? r.ids : []), id]) })),
    [],
  );
  const markAllRead = useCallback((role: string, ids: string[]) => setRead({ role, ids: new Set(ids) }), []);

  const [projScope, setProjScope] = useState<'mine' | 'all'>('mine');

  // Sidebar drawer of the tablet layout: closed when the path changes (adjusted during render, as the last project).
  const [drawer, setDrawer] = useState({ open: false, path: pathname });
  const nextDrawer = navDrawerAfter(drawer, pathname);
  if (nextDrawer !== drawer) setDrawer(nextDrawer);
  const setNavDrawer = useCallback((open: boolean) => setDrawer((d) => (d.open === open ? d : { ...d, open })), []);
  const navDrawer = nextDrawer.open;

  const value = useMemo(
    () => ({ project, readNotifs, markRead, markAllRead, projScope, setProjScope, navDrawer, setNavDrawer }),
    [project, readNotifs, markRead, markAllRead, projScope, navDrawer, setNavDrawer],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
