'use client';
// "Recently deleted" on the Plan (chapter 4, S-5): the last removals of work packages and activities that can still be
// restored (src/server/dal/plan-trash.ts, PLAN_TRASH_RETENTION_DAYS). Shown to the director and the project's manager only,
// when there is something to restore. "Restore" puts the rows back exactly (links, assignments, to-dos) and toasts.
import { ArrowCounterClockwise } from '@phosphor-icons/react/dist/ssr';
import { useTransition } from 'react';
import { Button } from '@/components/ds/Button';
import { CardTitle } from '@/components/ds/Card';
import { useToast } from '@/components/ds/Toast';
import { useI18n } from '@/i18n/client';
import { restoreRow } from './actions';
import s from './plan.module.css';

export interface RecentlyDeletedEntry {
  id: string;
  /** "1.7 · Commissioning" (name as removed). */
  label: string;
  /** Translated "2 activités · Romain Aubert · 9 oct. 14:05". */
  meta: string;
}

export function RecentlyDeleted({ code, entries, title, hint }: { code: string; entries: RecentlyDeletedEntry[]; title: string; hint: string }) {
  const { t } = useI18n();
  const toast = useToast();
  const [pending, start] = useTransition();
  if (!entries.length) return null;
  return (
    <section className={`card elev-sm ${s.card}`} aria-label={title}>
      <div className={s.cardHead}>
        <div className={s.cardHeadText}>
          <CardTitle compact>{title}</CardTitle>
          <span className={s.cardSub}>{hint}</span>
        </div>
      </div>
      <ul className={s.trashList}>
        {entries.map((e) => (
          <li key={e.id} className={s.trashItem}>
            <span className={s.trashLabel}>{e.label}</span>
            <span className={s.trashMeta}>{e.meta}</span>
            <Button
              variant="ghost"
              size="sm"
              icon={ArrowCounterClockwise}
              disabled={pending}
              aria-label={`${t('Restore')} · ${e.label}`}
              onClick={() =>
                start(async () => {
                  const r = await restoreRow(code, e.id);
                  toast.show('error' in r ? r.error : r.toast);
                })
              }
            >
              {t('Restore')}
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
