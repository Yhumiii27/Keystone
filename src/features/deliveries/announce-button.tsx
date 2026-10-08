'use client';
// Header primary "Announce a delivery" (docs/spec/01 §5.9, 08 §0.4; SC-4): `btn btn-primary` + plus icon opening the
// form — order still expecting goods, expected date, carrier, put-away. The new receipt is listed at once and its
// drawer opens (`announce` selected it, 4466); a status chip that would hide it (anything but Announced) is
// cleared, so the new row is in the register. With no order waiting for goods the button only says so (the
// prototype did nothing). Rendered only for viewers who may edit the project (the page and PageHeader gate it).
import { Plus } from '@phosphor-icons/react/dist/ssr';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { FormDialog } from '@/components/app/FormDialog';
import type { FormDef } from '@/components/app/form-def';
import { Button } from '@/components/ds/Button';
import { showToast } from '@/components/ds/Toast';
import { useI18n } from '@/i18n/client';
import { announceDeliveryAction } from './actions';

export interface AnnounceDeliveryButtonProps {
  code: string;
  /** Translated "#026 · Harbor Line Terminal Expansion" — the dialog sub-line. */
  context: string;
  /** Translated form definition; null when no order is waiting for goods. */
  form: FormDef | null;
  /** Screen path (`/projects/HLT-026/deliveries`) and the active status chip, kept when it lists the new receipt. */
  path: string;
  status: string | null;
}

export function AnnounceDeliveryButton({ code, context, form, path, status }: AnnounceDeliveryButtonProps) {
  const { t } = useI18n();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="primary" icon={Plus} onClick={() => (form ? setOpen(true) : showToast(t('No ordered purchase order is waiting for a delivery')))}>
        {t('Announce a delivery')}
      </Button>
      {form && (
        <FormDialog
          {...form}
          open={open}
          onClose={() => setOpen(false)}
          context={context}
          onSubmit={async (values) => {
            const r = await announceDeliveryAction(code, values);
            if (r && typeof r === 'object' && 'number' in r && r.number)
              router.push(`${path}?${new URLSearchParams({ ...(status === 'announced' ? { status } : {}), receipt: r.number })}`, { scroll: false });
            return r;
          }}
        />
      )}
    </>
  );
}
