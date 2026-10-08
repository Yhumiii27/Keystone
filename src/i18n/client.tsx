'use client';
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { makeT, type Lang, type T } from './translate';

const Ctx = createContext<{ lang: Lang; t: T }>({ lang: 'fr', t: makeT('fr') });

export function I18nProvider({ lang, children }: { lang: Lang; children: ReactNode }) {
  const value = useMemo(() => ({ lang, t: makeT(lang) }), [lang]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** `{ lang, t }` for Client Components. */
export const useI18n = () => useContext(Ctx);
