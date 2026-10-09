'use client';
// "Apply" on a Suggested rebalancing line (template 629). The prototype button had no handler (docs/spec/06 §1.5, OQ5).
// Chapter 4 (R-3, S-7): it drafts the lever's resource request through the requests DAL — a DRAFT, sent to the department
// from Resource requests; the plan changes only at the next Reschedule. The page re-renders with "Requested · RQ-…".
import { useTransition } from 'react';
import { Button } from '@/components/ds/Button';
import { useToast } from '@/components/ds/Toast';
import { useI18n } from '@/i18n/client';
import { applySuggestion } from './actions';
import s from './resources.module.css';

export function ApplySuggestionButton({ title, projectCode, lever }: { /** Translated suggestion title (completes the accessible name). */ title: string; projectCode: string; lever: string }) {
  const { t } = useI18n();
  const toast = useToast();
  const [pending, start] = useTransition();
  const apply = () =>
    start(async () => {
      try {
        const r = await applySuggestion(projectCode, lever);
        toast.show('error' in r ? r.error : (r.message ?? ''));
      } catch {
        toast.show(t('The change could not be saved'));
      }
    });
  return (
    <Button variant="secondary" className={s.apply} aria-label={`${t('Apply')} — ${title}`} onClick={apply} disabled={pending} aria-busy={pending || undefined}>
      {t('Apply')}
    </Button>
  );
}
