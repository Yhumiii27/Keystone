'use client';
// Error boundary page (R-176) shared by src/app/(app)/error.tsx (inside the shell), src/app/error.tsx (the shell itself
// failed) and src/app/global-error.tsx (the root layout failed): "Something went wrong", the incident identifier, "Try
// again" (Next's retry: re-fetches and re-renders the segment) and "Back to Home". French by default (the language comes
// from the I18nProvider, or is given by global-error, which renders without the root layout).
// Incident: Next's digest for a server error (already in the server log); for a browser error a "C-…" identifier, reported
// once to the server log (./actions.ts).
import { ArrowsClockwise } from '@phosphor-icons/react/dist/ssr';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ds/Button';
import { useI18n } from '@/i18n/client';
import { reportClientIncidentAction } from './actions';
import { ErrorView, HomeLink } from './error-view';
import { newClientIncidentId, serverIncidentOf } from './incident';

export interface RouteErrorProps {
  error: Error & { digest?: string };
  retry: () => void;
  layout: 'page' | 'shell';
}

export const ERROR_TEXT = {
  overline: 'Incident',
  title: 'Something went wrong',
  text: 'Keystone could not display this page. Try again; if the problem persists, give the incident ID to IT.',
  incident: 'Incident ID',
  retry: 'Try again',
  home: 'Back to Home',
} as const;

/** Identifiers already reported (an effect may run twice in development). */
const reported = new Set<string>();

export function RouteError({ error, retry, layout }: RouteErrorProps) {
  const { t } = useI18n();
  const server = serverIncidentOf(error);
  // A browser error is only ever rendered in the browser (a server error always has its digest), so the identifier can be
  // made on the first render; the server HTML of a server error never needs one.
  const [client] = useState<string | null>(() => (server || typeof window === 'undefined' ? null : newClientIncidentId()));
  useEffect(() => {
    if (!client || reported.has(client)) return;
    reported.add(client);
    reportClientIncidentAction({ incident: client, message: error?.message ?? '', path: window.location.pathname }).catch(() => null);
  }, [client, error]);
  return (
    <ErrorView
      kind="error"
      layout={layout}
      overline={t(ERROR_TEXT.overline)}
      title={t(ERROR_TEXT.title)}
      text={t(ERROR_TEXT.text)}
      incident={{ label: t(ERROR_TEXT.incident), id: server ?? client }}
      actions={
        <>
          <Button variant="primary" size="sm" icon={ArrowsClockwise} onClick={() => retry()}>
            {t(ERROR_TEXT.retry)}
          </Button>
          <HomeLink label={t(ERROR_TEXT.home)} />
        </>
      }
    />
  );
}
