'use client';
// Interactive islands of Lessons learned & closure: the header primary action with its action-form dialog (AF `rex` "Add
// lesson"), the lesson step buttons and the closure checklist rows (the client portal's islands went with the portal, D9-06).
// They call the Server Functions of ./actions; the page re-renders from the database after each write. Labels arrive
// translated from the Server Components; refusals show their (translated) error in a toast.
import { Plus } from '@phosphor-icons/react/dist/ssr';
import { useState, useTransition, type CSSProperties, type ReactNode } from 'react';
import { FormDialog } from '@/components/app/FormDialog';
import { Button } from '@/components/ds/Button';
import { showToast } from '@/components/ds/Toast';
import { useI18n } from '@/i18n/client';
import type { ClosureItemStatus, LessonStatus } from '@/server/db/codes';
import { addLessonAction, advanceLessonAction, cycleClosureAction, type RexClientResult } from './actions';
import { LESSON_FORM } from './forms';
import { recordVerb } from './i18n';
import s from './rexclient.module.css';

/** Runs a write and toasts its error, if any. */
function useWrite() {
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<RexClientResult>, after?: () => void) =>
    start(async () => {
      try {
        const r = await fn();
        if ('error' in r) showToast(r.error);
        else after?.();
      } catch (e) {
        showToast(e instanceof Error ? e.message : String(e));
      }
    });
  return { pending, run };
}

interface PrimaryProps {
  code: string;
  /** Translated "#026 · Harbor Line Terminal Expansion" (dialog sub-line). */
  context: string;
}

/** Header primary "Add lesson" (`btn btn-primary` + plus) opening AF `rex`. */
export function AddLessonButton({ code, context }: PrimaryProps) {
  const { t, lang } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="primary" icon={Plus} onClick={() => setOpen(true)}>
        {t('Add lesson')}
      </Button>
      <FormDialog {...LESSON_FORM} submit={recordVerb(lang)} translate open={open} onClose={() => setOpen(false)} context={context} onSubmit={(values) => addLessonAction(code, values)} />
    </>
  );
}

/** Row action "Validate" / "Mark applied" (`btn btn-secondary` 12px, nowrap). */
export function LessonStepButton({ code, number, from, label }: { code: string; number: string; from: LessonStatus; label: string }) {
  const { pending, run } = useWrite();
  return (
    <Button variant="secondary" size="xs" nowrap disabled={pending} aria-busy={pending || undefined} onClick={() => run(() => advanceLessonAction(code, number, from))}>
      {label}
    </Button>
  );
}

/** Closure checklist row: the whole row is the button that cycles the item. */
export function ClosureToggle({ code, position, from, label, style, children }: { code: string; position: number; from: ClosureItemStatus; label: string; style: CSSProperties; children: ReactNode }) {
  const { pending, run } = useWrite();
  return (
    <button
      type="button"
      className={s.clRow}
      style={style}
      title={label}
      disabled={pending}
      aria-busy={pending || undefined}
      onClick={() => run(() => cycleClosureAction(code, position, from))}
    >
      {children}
    </button>
  );
}
