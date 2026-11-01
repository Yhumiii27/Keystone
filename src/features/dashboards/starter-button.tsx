'use client';
// R-203 (K-203): "Start with suggested widgets" — the user's first dashboard, with the widgets suggested for their role
// (src/domain/dashboards.ts `starterLayout`).
import { MagicWand } from '@phosphor-icons/react/dist/ssr';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { Button } from '@/components/ds/Button';
import { useToast } from '@/components/ds/Toast';
import { screenHref } from '@/config/screens';
import { useI18n } from '@/i18n/client';
import { createDashboardAction } from './actions';

export function StarterButton() {
  const { t } = useI18n();
  const toast = useToast();
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      variant="primary"
      size="sm"
      icon={MagicWand}
      disabled={pending}
      onClick={() =>
        start(async () => {
          try {
            const r = await createDashboardAction({ name: t('My dashboard'), starter: true });
            toast.showEn(r.ok ? r.toast : r.error);
            if (r.ok && r.id) router.push(`${screenHref('dashboards')}?d=${encodeURIComponent(r.id)}`);
          } catch {
            toast.showEn('The dashboard could not be saved');
          }
        })
      }
    >
      {t('Start with suggested widgets')}
    </Button>
  );
}
