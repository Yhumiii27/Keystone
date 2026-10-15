'use client';
// Client islands of the P&ID screen:
// - "Import P&ID tags" (header primary, docs/spec/01 §5.9 → AF `pid`): opens the staging import dialog; rendered only
//   for viewers who may edit the project's P&ID (the page and PageHeader gate it, the Server Functions check again);
// - the tag drawer's mapping: a candidate row links the tag to that BOM reference, "Unlink" removes the mapping
//   (`pidOv` of the prototype, now saved); the toast confirms, an error refreshes the screen. R-108: the catalogue search
//   (debounced, kept in the URL as `cq` / `ctype`) and, for an article outside the BOM, the "Link and add to the BOM" /
//   "Link only" confirmation with a quantity;
// - "Open in PDM" / "Export overlay list": no handler in the prototype (09 OQ20) — they keep the prototype's look and
//   announce "<action> — coming soon", like the other inert controls.
import { ArrowSquareOut, FilePdf, LinkSimple, MagnifyingGlass, Plus } from '@phosphor-icons/react/dist/ssr';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState, useTransition } from 'react';
import { Button } from '@/components/ds/Button';
import { cx } from '@/components/ds/cx';
import { Dialog } from '@/components/ds/Dialog';
import { DialogActions } from '@/components/ds/DialogParts';
import { Field, Input, Select } from '@/components/ds/Field';
import { showToast } from '@/components/ds/Toast';
import type { PidTypeFilter } from '@/domain/pid';
import { useI18n } from '@/i18n/client';
import { mapPidTagAction, unlinkPidTagAction, type PidActionResult } from './actions';
import { ImportTagsDialog } from './import-dialog';
import { pidHref } from './links';
import type { CandidateSearchView, CandidateView } from './model';
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

/** R-108: the candidates' catalogue search — text (debounced, 300 ms) and type filter, kept in the URL (`cq`, `ctype`). */
export function CandidateSearch({ code, tag, search }: { code: string; tag: string; search: CandidateSearchView }) {
  const { t } = useI18n();
  const router = useRouter();
  const [q, setQ] = useState(search.q);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const go = (cq: string, ctype: string) => router.replace(pidHref(code, { ...search.keep, tag, cq, ctype: ctype as PidTypeFilter }), { scroll: false });
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  return (
    <div className={s.candSearch}>
      <Input
        size="sm"
        value={q}
        maxLength={60}
        placeholder={t('Search reference or name')}
        aria-label={t('Search reference or name')}
        onChange={(e) => {
          const v = e.target.value;
          setQ(v);
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => go(v.trim(), search.type), 300);
        }}
      />
      <Select size="sm" value={search.type} aria-label={t('Type of part')} options={search.types} onChange={(e) => go(q.trim(), e.target.value)} />
      <MagnifyingGlass className={s.candSearchIcon} aria-hidden />
    </div>
  );
}

/**
 * A mapping candidate: ref / name / "In the BOM" or the part status; click links the tag to it. R-108: an article outside the
 * project BOM opens a confirmation — "Link and add to the BOM" with a quantity (default 1; the BOM's editors only) or "Link
 * only" (the tag stays Not in BOM; "Add reference to project BOM" remains in the drawer).
 */
export function CandidateButton({ code, tag, c, current, canAddToBom = false }: { code: string; tag: string; c: CandidateView; current: boolean; canAddToBom?: boolean }) {
  const { t } = useI18n();
  const { pending, run } = useMapping();
  const [asking, setAsking] = useState(false);
  return (
    <>
      <button
        type="button"
        className={s.cand}
        disabled={pending}
        aria-pressed={current}
        aria-haspopup={c.inBom ? undefined : 'dialog'}
        aria-label={`${t('Map to a BOM reference')} · ${tag} → ${c.ref}`}
        onClick={() => (c.inBom ? run(() => mapPidTagAction(code, tag, c.ref)) : setAsking(true))}
      >
        <CandidateBody c={c} current={current} />
      </button>
      {!c.inBom && (
        <LinkOutsideBomDialog
          open={asking}
          tag={tag}
          c={c}
          canAddToBom={canAddToBom}
          pending={pending}
          onClose={() => setAsking(false)}
          onLink={(addToBom, quantity) => {
            setAsking(false);
            run(() => mapPidTagAction(code, tag, c.ref, addToBom ? { addToBom: true, quantity } : undefined));
          }}
        />
      )}
    </>
  );
}

function LinkOutsideBomDialog({ open, tag, c, canAddToBom, pending, onClose, onLink }: {
  open: boolean; tag: string; c: CandidateView; canAddToBom: boolean; pending: boolean; onClose: () => void; onLink: (addToBom: boolean, quantity: string) => void;
}) {
  const { t } = useI18n();
  const id = useId();
  const [qty, setQty] = useState('1');
  return (
    <Dialog open={open} onClose={onClose} title={`${tag} → ${c.ref}`} width={440} placement="center" maxHeight={null}>
      <form
        className={s.linkForm}
        onSubmit={(e) => {
          e.preventDefault();
          if (canAddToBom && !pending) onLink(true, qty);
        }}
      >
        <span className={s.hint}>
          {t('This article is not in the project BOM')} · {c.name} · {c.partStatus}
        </span>
        {canAddToBom && (
          <Field label={t('Quantity')} htmlFor={id}>
            <Input id={id} size="sm" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} autoFocus />
          </Field>
        )}
        <DialogActions variant="flush">
          <Button variant="secondary" onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button variant={canAddToBom ? 'secondary' : 'primary'} icon={LinkSimple} disabled={pending} onClick={() => onLink(false, '')}>
            {t('Link only')}
          </Button>
          {canAddToBom && (
            <Button type="submit" variant="primary" icon={Plus} disabled={pending || !qty.trim()}>
              {t('Link and add to the BOM')}
            </Button>
          )}
        </DialogActions>
      </form>
    </Dialog>
  );
}

function CandidateBody({ c, current }: { c: CandidateView; current: boolean }) {
  return (
    <>
      <span className={s.candText}>
        <span className={cx(s.candRef, current && s.candCurrent)}>{c.ref}</span>
        <span className={s.candName} title={c.name}>
          {c.name}
        </span>
      </span>
      <span className={cx(c.tagClass, s.nowrap)}>{c.status}</span>
    </>
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

/**
 * "Import P&ID tags" → the staging import dialog. R-109: `suggestedRevision` = Codex's reference revision when it is ahead
 * (the header's and the revision banner's buttons suggest the same one); the dialog is modal, so one opens at a time.
 */
export function ImportTagsButton({ code, context, currentRevision, suggestedRevision, variant = 'primary' }: {
  code: string; context: string; currentRevision: string | null; suggestedRevision?: string | null; variant?: 'primary' | 'secondary';
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant={variant} size={variant === 'secondary' ? 'sm' : undefined} icon={Plus} onClick={() => setOpen(true)}>
        {t('Import P&ID tags')}
      </Button>
      {open && <ImportTagsDialog code={code} context={context} currentRevision={currentRevision} suggestedRevision={suggestedRevision ?? null} onClose={() => setOpen(false)} />}
    </>
  );
}
