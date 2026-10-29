'use client';
// R-010 — "Record modified meanwhile" in the browser. A Server Function that refused a save on a record changed since the page
// read it answers `{ error, conflict: true }` (src/server/dal/record-version.ts). Two presentations, both with a "Reload"
// action that fetches the page's data again (router.refresh — the form's other values are not lost on the page):
// - `StaleRecordCallout`, inside a form (FormDialog shows it for a `conflict` result);
// - `useStaleRecordToast()`, for the inline edits (cells, segments, Gantt bars) that report errors as toasts.
import { ArrowClockwise, Warning } from '@phosphor-icons/react/dist/ssr';
import { useRouter } from 'next/navigation';
import { useCallback } from 'react';
import { Button } from '@/components/ds/Button';
import { showToast } from '@/components/ds/Toast';
import { useI18n } from '@/i18n/client';
import { Callout } from './Callout';

/** A Server Function's answer that may be a refused save. */
export type MaybeConflict = { error?: string; conflict?: boolean } | null | undefined | void | string;

/** True for a `{ error, conflict: true }` answer. */
export const isConflict = (r: unknown): r is { error: string; conflict: true } =>
  !!r && typeof r === 'object' && (r as { conflict?: unknown }).conflict === true && typeof (r as { error?: unknown }).error === 'string';

export interface StaleRecordCalloutProps {
  /** The refusal, already in the viewer's language. */
  message: string;
  /** Called after the reload (e.g. close the dialog, whose values are stale). */
  onReload?: () => void;
  className?: string;
}

/** The refusal with its "Reload" action, inside a form. */
export function StaleRecordCallout({ message, onReload, className }: StaleRecordCalloutProps) {
  const { t } = useI18n();
  const router = useRouter();
  return (
    <Callout
      variant="emphasis"
      icon={Warning}
      role="alert"
      className={className}
      action={
        <Button
          variant="secondary"
          size="sm"
          icon={ArrowClockwise}
          onClick={() => {
            router.refresh();
            onReload?.();
          }}
        >
          {t('Reload')}
        </Button>
      }
    >
      {message}
    </Callout>
  );
}

/**
 * For inline edits: `report(result)` shows a refused save as a toast with "Reload" and returns true; any other answer returns
 * false (the caller handles its own errors).
 */
export function useStaleRecordToast(): (r: unknown) => boolean {
  const { t } = useI18n();
  const router = useRouter();
  return useCallback(
    (r: unknown) => {
      if (!isConflict(r)) return false;
      showToast(r.error, { action: { label: t('Reload'), onClick: () => router.refresh() } });
      return true;
    },
    [t, router],
  );
}
