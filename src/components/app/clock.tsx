'use client';
// Business date for Client Components (R-013): the app layout resolves it on the server (src/server/clock.ts) and provides it
// here, so the client never reads its own wall clock for business rules (a client in another time zone, or a pinned demo
// date, still sees the server's business date).
import { createContext, useContext, type ReactNode } from 'react';
import { DEMO_TODAY_ISO, workdayOffsetOf } from '@/domain/clock';

const Ctx = createContext<string>(DEMO_TODAY_ISO);

export function ClockProvider({ today, children }: { today: string; children: ReactNode }) {
  return <Ctx.Provider value={today}>{children}</Ctx.Provider>;
}

/** Business date (ISO) for Client Components. */
export const useToday = () => useContext(Ctx);
/** Working-day offset of the business date on the prototype's day axis (the former TODAY). */
export const useTodayOffset = () => workdayOffsetOf(useContext(Ctx));
