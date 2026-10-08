// Serializable view models passed from the server shell to its client islands (already translated).
import type { ZoneKey } from '@/server/session';

/** Sidebar open/closed map cookie (= COOKIE.nav in server/session, which is server-only). */
export const COOKIE_NAV = 'ks-nav';

export interface SearchHitView {
  kind: string;
  title: string;
  sub: string;
  href: string;
}

export interface NotificationView {
  id: string;
  kind: string;
  title: string;
  sub: string;
  when: string;
  /** Read in the data set. */
  read: boolean;
  href: string;
}

export interface ProjectOptionView {
  code: string;
  /** "#026 · Extension du terminal Harbor Line" (translated). */
  name: string;
  /** "HAV004 · DAS 2 · EMP · R. Aubert". */
  sub: string;
  health: string;
  tagClass: string;
  readOnly: boolean;
  mine: boolean;
  /** Lower-cased haystack: code, name, id, analytic code, PM, client (+ FR name). */
  haystack: string;
}

export interface ZoneOptionView {
  key: ZoneKey | null;
  label: string;
  count: number;
}
