// Load-window navigation of the load plans (R-085, owner decision R-7 a; owner answers 17 Oct 2026). The view switch "Week" ·
// "8 weeks" (the default), then "Previous 8 weeks" (8-week view only) · "Previous week" · "Current week" (no `?week=`) ·
// "Following week" · "Next 8 weeks" (8-week view only), then the weeks shown. Links, not client state: the server reads and
// validates `?view=` and `?week=` (src/domain/load-window.ts). Server Component; used by Resources, Project resources,
// Leave & calendar (with the view switch) and the what-if levelling (8 weeks, no switch).
import { CaretDoubleLeft, CaretDoubleRight, CaretLeft, CaretRight } from '@phosphor-icons/react/dist/ssr';
import { Button, ButtonLink } from '@/components/ds/Button';
import { LOAD_VIEWS, loadWindowHref, type LoadView, type LoadWindow } from '@/domain/load-window';
import type { Lang, T } from '@/i18n/translate';
import { isoWeekOf, weekLabelOfIso } from '@/server/db/codes';
import { weekLabel } from './model';
import s from './window-nav.module.css';

/**
 * 8 weeks: "Sep 21 – Nov 9, 2026" / "21 sept. – 9 nov. 2026" (first and last Monday, the year of the last one). One week:
 * "Week 39 · Sep 21, 2026" / "Semaine 39 · 21 sept. 2026".
 */
export function windowRangeText(w: Pick<LoadWindow, 'weeks'>, t: T, lang: Lang): string {
  if (!w.weeks.length) return '';
  const first = weekLabel(weekLabelOfIso(w.weeks[0]), t, lang);
  const last = w.weeks[w.weeks.length - 1];
  if (w.weeks.length === 1) {
    const n = isoWeekOf(last);
    return lang === 'fr' ? `Semaine ${n} · ${first} ${last.slice(0, 4)}` : `Week ${n} · ${first}, ${last.slice(0, 4)}`;
  }
  const lastText = weekLabel(weekLabelOfIso(last), t, lang);
  return lang === 'fr' ? `${first} – ${lastText} ${last.slice(0, 4)}` : `${first} – ${lastText}, ${last.slice(0, 4)}`;
}

/** View switch labels (EN source strings). */
const VIEW_LABEL: Record<LoadView, string> = { week: 'Week', '8w': '8 weeks' };

export interface LoadWindowNavProps {
  window: LoadWindow;
  /** Screen path the links point to ("/resources", "/projects/HLT-026/resources"). */
  path: string;
  /** Other search params of the screen, kept by the links. */
  keep?: Record<string, string | null | undefined>;
  /** Show the "Week" · "8 weeks" switch (load plans); the what-if has the 8-week horizon only. Default true. */
  views?: boolean;
  t: T;
  lang: Lang;
}

export function LoadWindowNav({ window: w, path, keep, views = true, t, lang }: LoadWindowNavProps) {
  const href = (start: string, view: LoadView = w.view) => loadWindowHref(path, start, w.current, keep, view);
  const step = (to: string | null, label: string, icon: typeof CaretLeft, right: boolean) =>
    to == null ? (
      <Button variant="secondary" size="xs" disabled icon={right ? undefined : icon} iconRight={right ? icon : undefined}>
        {label}
      </Button>
    ) : (
      <ButtonLink variant="secondary" size="xs" href={href(to)} scroll={false} icon={right ? undefined : icon} iconRight={right ? icon : undefined}>
        {label}
      </ButtonLink>
    );
  const paged = w.view === '8w';
  return (
    <nav className={s.nav} aria-label={t('Weeks shown')}>
      {views && (
        <span className={s.views} role="group" aria-label={t('Load plan view')}>
          {LOAD_VIEWS.map((v) => (
            <ButtonLink
              key={v}
              variant={v === w.view ? 'primary' : 'ghost'}
              size="xs"
              href={href(w.start, v)}
              scroll={false}
              aria-current={v === w.view ? 'page' : undefined}
            >
              {t(VIEW_LABEL[v])}
            </ButtonLink>
          ))}
        </span>
      )}
      {paged && step(w.prevPage, t('Previous 8 weeks'), CaretDoubleLeft, false)}
      {step(w.prev, t('Previous week'), CaretLeft, false)}
      <ButtonLink variant="ghost" size="xs" href={href(w.current)} scroll={false} aria-current={w.isCurrent ? 'page' : undefined}>
        {t('Current week')}
      </ButtonLink>
      {step(w.next, t('Following week'), CaretRight, true)}
      {paged && step(w.nextPage, t('Next 8 weeks'), CaretDoubleRight, true)}
      <span className={s.range}>{windowRangeText(w, t, lang)}</span>
    </nav>
  );
}
