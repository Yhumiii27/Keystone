'use client';
// Client islands of the P&ID screen:
// - "Import P&ID tags" (header primary, docs/spec/01 §5.9 → AF `pid`): opens the staging import dialog; rendered only
//   for viewers who may edit the project's P&ID (the page and PageHeader gate it, the Server Functions check again);
// - the tag drawer's mapping: a candidate row links the tag to that BOM reference, "Unlink" removes the mapping
//   (`pidOv` of the prototype, now saved); the toast confirms, an error refreshes the screen;
// - "Open in PDM" / "Export overlay list": no handler in the prototype (09 OQ20) — they keep the prototype's look and
//   announce "<action> — coming soon", like the other inert controls.
import { ArrowSquareOut, FilePdf, Plus } from '@phosphor-icons/react/dist/ssr';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Button } from '@/components/ds/Button';
import { cx } from '@/components/ds/cx';
import { showToast } from '@/components/ds/Toast';
import { useI18n } from '@/i18n/client';
import { mapPidTagAction, unlinkPidTagAction, type PidActionResult } from './actions';
import { ImportTagsDialog } from './import-dialog';
import type { CandidateView } from './model';
import s from './pid.module.css';

/** Shown when the Server Function itself fails (network, server error). */
const FAILED = 'The change could not be saved';

function useMapping() {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const run = (call: () => Promise<PidActionResult>) =>
    startTransition(async () => {
      try {
        const r = await call();
        showToast(r.toast ?? r.error ?? '');
        if (r.error) router.refresh();
      } catch {
        showToast(t(FAILED));
        router.refresh();
      }
    });
  return { pending, run };
}

/** A mapping candidate (`pidCands` row): ref / name / part status tag; click links the tag to it. */
export function CandidateButton({ code, tag, c, current }: { code: string; tag: string; c: CandidateView; current: boolean }) {
  const { t } = useI18n();
  const { pending, run } = useMapping();
  return (
    <button
      type="button"
      className={s.cand}
      disabled={pending}
      aria-pressed={current}
      aria-label={`${t('Map to a BOM reference')} · ${tag} → ${c.ref}`}
      onClick={() => run(() => mapPidTagAction(code, tag, c.ref))}
    >
      <span className={s.candText}>
        <span className={cx(s.candRef, current && s.candCurrent)}>{c.ref}</span>
        <span className={s.candName} title={c.name}>
          {c.name}
        </span>
      </span>
      <span className={cx(c.tagClass, s.nowrap)}>{c.status}</span>
    </button>
  );
}

/** "Unlink" (ghost): the tag loses its BOM reference (status Unmapped). */
export function UnlinkButton({ code, tag }: { code: string; tag: string }) {
  const { t } = useI18n();
  const { pending, run } = useMapping();
  return (
    <Button variant="ghost" className={s.btn125} disabled={pending} onClick={() => run(() => unlinkPidTagAction(code, tag))}>
      {t('Unlink')}
    </Button>
  );
}

/** Inert prototype buttons: "Open in PDM" (`ph-arrow-square-out`), "Export overlay list" (`ph-file-pdf`). */
export function ComingSoonButton({ icon, label, toast }: { icon: 'open' | 'pdf'; label: string; toast: string }) {
  return (
    <Button variant="secondary" className={s.btn125} icon={icon === 'open' ? ArrowSquareOut : FilePdf} onClick={() => showToast(toast)}>
      {label}
    </Button>
  );
}

/** "Import P&ID tags" → the staging import dialog. */
export function ImportTagsButton({ code, context, currentRevision }: { code: string; context: string; currentRevision: string | null }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="primary" icon={Plus} onClick={() => setOpen(true)}>
        {t('Import P&ID tags')}
      </Button>
      {open && <ImportTagsDialog code={code} context={context} currentRevision={currentRevision} onClose={() => setOpen(false)} />}
    </>
  );
}
