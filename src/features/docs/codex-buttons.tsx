'use client';
// Codex banner and drawer buttons (docs/spec/10 §4.4a, §4.5, §5.3): "Sync now" (records a sync of the index, toast
// "Codex sync · index up to date · 412 records"), "Open Codex" / "Edit in Codex" / "Open in Codex" (hand-off to the
// external system: toast "Opening Codex · …" until the deep link exists, D-1), downloads (download log) and "Approve in
// Codex · {role} · {approver}". Labels and toasts arrive translated.
import { ArrowSquareOut, DownloadSimple, Stamp } from '@phosphor-icons/react/dist/ssr';
import { useTransition } from 'react';
import { Button, IconButton, type ButtonSize } from '@/components/ds/Button';
import { showToast } from '@/components/ds/Toast';
import { approveDocumentAction, logDownloadAction, syncCodexAction } from './actions';

/** `btn btn-secondary` 12px "Sync now". */
export function SyncNowButton({ project, label }: { project: string; label: string }) {
  const [pending, start] = useTransition();
  return (
    <Button
      variant="secondary"
      size="xs"
      disabled={pending}
      aria-busy={pending || undefined}
      onClick={() =>
        start(async () => {
          const r = await syncCodexAction(project);
          showToast('error' in r ? r.error : (r.toast ?? ''));
        })
      }
    >
      {label}
    </Button>
  );
}

/** `btn btn-primary` + arrow-square-out: shows the hand-off toast. */
export function OpenCodexButton({ label, toast, size = 'xs' }: { label: string; toast: string; size?: ButtonSize }) {
  return (
    <Button variant="primary" size={size} icon={ArrowSquareOut} onClick={() => showToast(toast)}>
      {label}
    </Button>
  );
}

/** Download of the current revision: icon button (vault row), "Download PDF" (drawer) or "Native" / "PDF" (revision rows). */
export function DownloadButton({
  project,
  number,
  label,
  format = 'PDF',
  variant,
}: {
  project: string;
  number: string;
  /** Translated accessible name / text. */
  label: string;
  format?: 'PDF' | 'Native';
  variant: 'icon' | 'secondary' | 'mini';
}) {
  const [pending, start] = useTransition();
  const run = () =>
    start(async () => {
      const r = await logDownloadAction(project, number, format);
      if ('error' in r) showToast(r.error);
    });
  if (variant === 'icon')
    return <IconButton icon={DownloadSimple} muted label={label} disabled={pending} aria-busy={pending || undefined} onClick={run} />;
  if (variant === 'mini')
    return (
      <Button variant="ghost" size="mini" disabled={pending} aria-busy={pending || undefined} onClick={run}>
        {label}
      </Button>
    );
  return (
    <Button variant="secondary" size="sm" icon={DownloadSimple} disabled={pending} aria-busy={pending || undefined} onClick={run}>
      {label}
    </Button>
  );
}

/** `btn btn-primary` + stamp: "Approve in Codex · Quality manager · G. Comte". */
export function ApproveButton({ project, number, label }: { project: string; number: string; label: string }) {
  const [pending, start] = useTransition();
  return (
    <Button
      variant="primary"
      size="sm"
      icon={Stamp}
      disabled={pending}
      aria-busy={pending || undefined}
      onClick={() =>
        start(async () => {
          const r = await approveDocumentAction(project, number);
          if ('error' in r) showToast(r.error);
        })
      }
    >
      {label}
    </Button>
  );
}
