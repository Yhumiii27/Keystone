'use client';
// Site client islands: the header primary "Daily report" (AF.site form), the readiness steps ("Client confirms",
// "Signed on site", equipment "Confirm") and the Cursus actions ("Remind in Cursus", "Sync Cursus"). Each calls its
// Server Function and shows the translated result; the page is revalidated by the Server Function. Rendered only for
// viewers who may edit the project's site. ("Client communication log" is a link to the project's client decisions in
// Meetings — D-5, ./site-view.tsx.) R-118 (D-3 'a'): "Prepare the site", "Edit site sheet" and the lines' Add / Edit / Remove,
// rendered for the project's leads only (the Server Functions and the writers re-check).
import { ArrowsClockwise, ClipboardText, PencilSimple, Plus, Signature, Trash } from '@phosphor-icons/react/dist/ssr';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { FormDialog } from '@/components/app/FormDialog';
import type { FormDef, FormValues } from '@/components/app/form-def';
import { Button, IconButton } from '@/components/ds/Button';
import { Dialog } from '@/components/ds/Dialog';
import { DialogActions } from '@/components/ds/DialogParts';
import { showToast } from '@/components/ds/Toast';
import type { SiteLineKind } from '@/domain/site-sheet';
import { useI18n } from '@/i18n/client';
import {
  addSiteLineAction, advancePrerequisiteAction, arbitrateConflictAction, confirmEquipmentAction, editSiteLineAction, editSiteSheetAction, prepareSiteAction,
  remindInCursusAction, removeSiteLineAction, saveDailyReportAction, syncCursusAction, type SiteActionResult,
} from './actions';
import s from './site.module.css';

/** Shown when the Server Function itself fails (network, server error). */
const FAILED = 'The change could not be saved';

function useSiteAction() {
  const { t } = useI18n();
  const [pending, startTransition] = useTransition();
  const run = (call: () => Promise<SiteActionResult>) =>
    startTransition(async () => {
      try {
        const r = await call();
        if (!r.ok) showToast(r.error);
        else if (r.toast) showToast(r.toast);
      } catch {
        showToast(t(FAILED));
      }
    });
  return { pending, run };
}

export interface DailyReportButtonProps {
  code: string;
  /** Translated "#026 · Harbor Line Terminal Expansion" — the dialog sub-line. */
  context: string;
  /** Translated form definition (dailyReportFormDef). */
  form: FormDef;
  /** Daily execution tab of the screen, opened after saving so the new report shows. */
  execHref: string;
}

/** Header primary "Daily report" (`btn btn-primary` + plus icon) → the AF.site form. */
export function DailyReportButton({ code, context, form, execHref }: DailyReportButtonProps) {
  const { t } = useI18n();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="primary" icon={Plus} onClick={() => setOpen(true)}>
        {t('Daily report')}
      </Button>
      <FormDialog
        {...form}
        open={open}
        onClose={() => setOpen(false)}
        context={context}
        onSubmit={async (values) => {
          const r = await saveDailyReportAction(code, values);
          if (r && typeof r === 'object' && 'number' in r && r.number) router.push(execHref, { scroll: false });
          return r;
        }}
      />
    </>
  );
}

/** "Client confirms" (secondary) / "Signed on site" (primary, signature icon) on a client prerequisite. */
export function PrerequisiteButton({ code, position, to, label, title }: { code: string; position: number; to: 'confirmed' | 'signed'; label: string; title: string }) {
  const { pending, run } = useSiteAction();
  return (
    <Button
      variant={to === 'signed' ? 'primary' : 'secondary'}
      size="row"
      icon={to === 'signed' ? Signature : undefined}
      disabled={pending}
      aria-label={`${label} — ${title}`}
      onClick={() => run(() => advancePrerequisiteAction(code, position, to))}
    >
      {label}
    </Button>
  );
}

/** "Confirm" on a pending equipment line. */
export function ConfirmEquipmentButton({ code, position, name }: { code: string; position: number; name: string }) {
  const { t } = useI18n();
  const { pending, run } = useSiteAction();
  return (
    <Button variant="secondary" size="row" disabled={pending} aria-label={`${t('Confirm')} — ${name}`} onClick={() => run(() => confirmEquipmentAction(code, position))}>
      {t('Confirm')}
    </Button>
  );
}

/** "Remind in Cursus" on a person whose verdict is not GO (sent to Cursus): `person` = Cursus's name, `label` = as displayed. */
export function RemindButton({ code, person, label }: { code: string; person: string; label: string }) {
  const { t } = useI18n();
  const { pending, run } = useSiteAction();
  return (
    <Button variant="secondary" size="row" disabled={pending} aria-label={`${t('Remind in Cursus')} — ${label}`} onClick={() => run(() => remindInCursusAction(code, person))}>
      {t('Remind in Cursus')}
    </Button>
  );
}

/**
 * "Arbitrate" on an open site-team conflict (R-119, D-6b 'a'): the comment form; shown to whoever may arbitrate it (the
 * director, the head of the person's department; for a contractor, the director and the project's leads) — re-checked by the
 * Server Function and the writer.
 */
export function ArbitrateButton({ code, conflictKey, label, form }: { code: string; conflictKey: string; label: string; form: FormDef }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="ghost" size="row" aria-label={`${t('Arbitrate')} — ${label}`} onClick={() => setOpen(true)}>
        {t('Arbitrate')}
      </Button>
      <FormDialog {...form} open={open} onClose={() => setOpen(false)} context={label} onSubmit={(values) => arbitrateConflictAction(code, conflictKey, values)} />
    </>
  );
}

/** "Sync Cursus" (ghost, arrows icon): refreshes the verdicts from Cursus. */
export function SyncCursusButton({ code }: { code: string }) {
  const { t } = useI18n();
  const { pending, run } = useSiteAction();
  return (
    <Button variant="ghost" icon={ArrowsClockwise} className={s.headBtn} disabled={pending} onClick={() => run(() => syncCursusAction(code))}>
      {t('Sync Cursus')}
    </Button>
  );
}

// ── Site sheet entered by the project's leads (R-118, D-3 'a') ──────────────────────────────────────

/** "Prepare the site" on the Site's empty state: the sheet form, prefilled with the project's defaults. */
export function PrepareSiteButton({ code, context, form, values }: { code: string; context: string; form: FormDef; values: FormValues }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="primary" icon={ClipboardText} onClick={() => setOpen(true)}>
        {t('Prepare the site')}
      </Button>
      <FormDialog {...form} open={open} onClose={() => setOpen(false)} context={context} initialValues={values} onSubmit={(v) => prepareSiteAction(code, v)} />
    </>
  );
}

/** "Edit site sheet" in the Site sheet card (the stamp is what the form saw; a sheet changed meanwhile is refused). */
export function EditSheetButton({ code, context, stamp, form, values }: { code: string; context: string; stamp: string; form: FormDef; values: FormValues }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="ghost" size="row" icon={PencilSimple} nowrap onClick={() => setOpen(true)}>
        {t('Edit site sheet')}
      </Button>
      <FormDialog {...form} open={open} onClose={() => setOpen(false)} context={context} initialValues={values} onSubmit={(v) => editSiteSheetAction(code, stamp, v)} />
    </>
  );
}

/** "Add …" in a site table's header: the line's form; the new line takes the next position. */
export function AddLineButton({ code, kind, label, form }: { code: string; kind: SiteLineKind; label: string; form: FormDef }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" size="row" icon={Plus} nowrap onClick={() => setOpen(true)}>
        {label}
      </Button>
      <FormDialog {...form} open={open} onClose={() => setOpen(false)} onSubmit={(v) => addSiteLineAction(code, kind, v)} />
    </>
  );
}

interface LineProps {
  code: string;
  kind: SiteLineKind;
  position: number;
  stamp: string;
  /** The line as shown (typed text), for the accessible names and the confirmation. */
  label: string;
}

/** "Edit" of a line (icon button), opened with its values. */
export function EditLineButton({ code, kind, position, stamp, label, form, values }: LineProps & { form: FormDef; values: FormValues }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <>
      <IconButton icon={PencilSimple} size={24} label={`${t('Edit')} — ${label}`} title={t('Edit')} onClick={() => setOpen(true)} />
      <FormDialog
        {...form} open={open} onClose={() => setOpen(false)} context={label} initialValues={values}
        onSubmit={(v) => editSiteLineAction(code, kind, position, stamp, v)}
      />
    </>
  );
}

/** "Remove" of a line without recorded evidence, after a confirmation. */
export function RemoveLineButton({ code, kind, position, stamp, label }: LineProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const confirm = () =>
    startTransition(async () => {
      try {
        const r = await removeSiteLineAction(code, kind, position, stamp);
        showToast(r.ok ? (r.toast ?? '') : r.error);
        setOpen(false);
      } catch {
        showToast(t(FAILED));
      }
    });
  return (
    <>
      <IconButton icon={Trash} size={24} label={`${t('Remove')} — ${label}`} title={t('Remove')} onClick={() => setOpen(true)} />
      <Dialog open={open} onClose={() => setOpen(false)} title={t('Remove the line?')} width={440}>
        <p className={s.confirmText}>
          {label} — {t('The line is removed from the site sheet; the audit keeps it.')}
        </p>
        <DialogActions>
          <Button variant="secondary" onClick={() => setOpen(false)}>
            {t('Cancel')}
          </Button>
          <Button variant="primary" disabled={pending} aria-busy={pending || undefined} onClick={confirm}>
            {t('Remove')}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
