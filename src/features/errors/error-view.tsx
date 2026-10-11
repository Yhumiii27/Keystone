// Error / "page not found" card (R-176): icon, overline, title, text, optional incident identifier, actions. Presentational,
// no hooks: rendered by the Server Component not-found pages and by the client error boundaries. Strings arrive translated.
// Links are plain anchors styled as DS buttons: after an error the client router may be unusable, a full load is safer.
import { MagnifyingGlass, WarningCircle } from '@phosphor-icons/react/dist/ssr';
import type { ReactNode } from 'react';
import { cx } from '@/components/ds/cx';
import s from './errors.module.css';

export interface ErrorViewProps {
  kind: 'error' | 'not-found';
  /** `page`: full page with the shell's background (no shell); `shell`: inside the shell's content column. */
  layout: 'page' | 'shell';
  overline: string;
  title: string;
  text: string;
  /** "Incident ID" label and value; the line is left out while there is no value. */
  incident?: { label: string; id: string | null };
  /** Buttons / links (DS button classes). */
  actions: ReactNode;
}

export function ErrorView({ kind, layout, overline, title, text, incident, actions }: ErrorViewProps) {
  const I = kind === 'error' ? WarningCircle : MagnifyingGlass;
  return (
    <div className={layout === 'page' ? s.page : s.inShell}>
      <section className={cx('elev-sm', s.card)} role={kind === 'error' ? 'alert' : undefined} aria-labelledby="ks-error-title">
        <div className={s.head}>
          <I className={s.icon} aria-hidden />
          <span className={s.overline}>{overline}</span>
        </div>
        <h1 id="ks-error-title" className={s.title}>
          {title}
        </h1>
        <p className={s.text}>{text}</p>
        {incident?.id && (
          <p className={s.incident} data-testid="incident">
            <span>{incident.label}</span>
            <code className={s.incidentId}>{incident.id}</code>
          </p>
        )}
        <div className={s.actions}>{actions}</div>
      </section>
    </div>
  );
}

/** "Back to Home" (full page load). */
export function HomeLink({ label }: { label: string }) {
  return (
    // eslint-disable-next-line @next/next/no-html-link-for-pages -- a full load on purpose: after an error the client router may be broken
    <a href="/" className="btn btn-secondary">
      {label}
    </a>
  );
}
