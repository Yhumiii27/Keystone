'use client';
// Codex banner and drawer buttons (docs/spec/10 §4.4a, §4.5, §5.3): "Sync now" (records a sync of the index, toast
// "Codex sync · index up to date · 412 records"), "Open Codex" / "Edit in Codex" / "Open in Codex" (Delivery 8, R-033:
// links opening Codex in a new tab — its home with parameters Codex ignores until the deep links exist, TODO(codex) D-1),
// downloads (Delivery 8, R-127, D-2: the files are in Codex — the Codex hand-off toast, no Keystone download log) and
// "Approve in Codex · {role} · {approver}". Labels and toasts arrive translated.
import { ArrowSquareOut, DownloadSimple, Stamp } from '@phosphor-icons/react/dist/ssr';
import { useTransition } from 'react';
import { Button, ButtonLink, IconButton, type ButtonSize } from '@/components/ds/Button';
import { showToast } from '@/components/ds/Toast';
import { CODEX_LINK_ATTRS } from '@/server/integrations/codex/links';
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

/** `btn btn-primary` + arrow-square-out: opens Codex in a new tab (R-033; the hand-off toast before Delivery 8). */
export function OpenCodexButton({ label, href, size = 'xs' }: { label: string; href: string; size?: ButtonSize }) {
  return (
    <ButtonLink variant="primary" size={size} icon={ArrowSquareOut} href={href} prefetch={false} {...CODEX_LINK_ATTRS}>
      {label}
    </ButtonLink>
  );
}

/**
 * Download of the current revision: icon button (vault row), "Download PDF" (drawer) or "Native" / "PDF" (revision rows).
 * The files are stored in Codex (D-2 = a, R-127): the server checks the viewer may see the record and answers the Codex
 * hand-off toast, with an "Open Codex" link for the internal team (clients have no Codex access).
 */
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
      else if (r.toast) showToast(r.toast, r.link ?? undefined);
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

/**
 * `btn btn-primary` + stamp: "Approve in Codex · Quality manager · G. Comte". Delivery 7 (R-124): the approval goes to
 * Codex through the outbox — toast "RPT-HLT-014 · Approved · Pending sync with Codex".
 */
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
          showToast('error' in r ? r.error : (r.toast ?? ''));
        })
      }
    >
      {label}
    </Button>
  );
}
