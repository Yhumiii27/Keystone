'use client';
// "Apply" on a Suggested rebalancing line (template 629). The prototype button has no handler (docs/spec/06 §1.5,
// OQ5): it keeps the prototype's look and announces "Apply — coming soon" in a toast, like the other controls
// without behaviour (header Export, Budget "Add category").
import { Button } from '@/components/ds/Button';
import { useToast } from '@/components/ds/Toast';
import { useI18n } from '@/i18n/client';
import s from './resources.module.css';

export function ApplySuggestionButton({ title }: { /** Translated suggestion title (completes the accessible name). */ title: string }) {
  const { t } = useI18n();
  const toast = useToast();
  return (
    <Button variant="secondary" className={s.apply} aria-label={`${t('Apply')} — ${title}`} onClick={() => toast.show(t('Apply — coming soon'))}>
      {t('Apply')}
    </Button>
  );
}
