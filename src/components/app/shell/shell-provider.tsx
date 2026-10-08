'use client';
// Session-level client state of the shell, mounted once in the (app) layout so it survives page navigations:
// notifications marked read in this session (docs/spec/01 §5.5 — optimistic overlay, per viewer role, of the
// per-user read state the Server Functions persist), current/last project (from the URL, else the ks-project
// cookie) and the project switcher scope (§5.2).
// The toast is the DS one (src/components/ds/Toast: useToast().showEn(english)), mounted by the layout.
import { usePathname } from 'next/navigation';
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { codeFromPath } from './nav-model';

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

  const value = useMemo(
    () => ({ project, readNotifs, markRead, markAllRead, projScope, setProjScope }),
    [project, readNotifs, markRead, markAllRead, projScope],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
