'use client';
// Site client islands: the header primary "Daily report" (AF.site form), the readiness steps ("Client confirms",
// "Signed on site", equipment "Confirm") and the Cursus actions ("Remind in Cursus", "Sync Cursus"). Each calls its
// Server Function and shows the translated result; the page is revalidated by the Server Function. Rendered only for
// viewers who may edit the project's site. Chapter 4: "Client communication log" is a real log kept by Keystone
// (./comm-log.tsx).
import { ArrowsClockwise, Plus, Signature } from '@phosphor-icons/react/dist/ssr';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { FormDialog } from '@/components/app/FormDialog';
import type { FormDef } from '@/components/app/form-def';
import { Button } from '@/components/ds/Button';
import { showToast } from '@/components/ds/Toast';
import { useI18n } from '@/i18n/client';
import { advancePrerequisiteAction, confirmEquipmentAction, remindInCursusAction, saveDailyReportAction, syncCursusAction, type SiteActionResult } from './actions';
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
