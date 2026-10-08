'use client';
// Header primary "Import from X3" (docs/spec/08 §0.4, `importX3` 4492): merges the Sage X3 snapshot (local changes
// kept), then closes the stock-line drawer as the prototype did (`stockRow: null`) and toasts the result.
import { Plus } from '@phosphor-icons/react/dist/ssr';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { Button } from '@/components/ds/Button';
import { showToast } from '@/components/ds/Toast';
import { importFromX3Action } from './actions';

export function ImportX3Button({ label, closeHref }: { label: string; closeHref: string | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      variant="primary"
      icon={Plus}
      disabled={pending}
      aria-busy={pending || undefined}
      onClick={() =>
        start(async () => {
          const r = await importFromX3Action();
          showToast('error' in r ? r.error : (r.toast ?? ''));
          if (!('error' in r) && closeHref) router.replace(closeHref, { scroll: false });
        })
      }
    >
      {label}
    </Button>
  );
}
