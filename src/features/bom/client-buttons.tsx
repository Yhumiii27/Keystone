'use client';
// Client buttons of the Project BOM.
// - "Add article" (header primary, docs/spec/01 §5.9 → AF `bom`): the generic add-form dialog; rendered only when the
//   viewer may edit the project BOM (the page and PageHeader gate it, the Server Function checks again).
// - "Create spares purchase order" / "Export list" (PU/PR card): no handler in the prototype (09 OQ20, OPEN QUESTION
//   E-3 — the spares order needs its own purchase-order origin so it does not count against the BOM shortfall); they
//   keep the prototype's look and announce "<action> — coming soon", like the other inert controls.
import { FilePdf, Plus, ShoppingCart } from '@phosphor-icons/react/dist/ssr';
import { useState } from 'react';
import { FormDialog } from '@/components/app/FormDialog';
import type { FormDef } from '@/components/app/form-def';
import { Button } from '@/components/ds/Button';
import { showToast } from '@/components/ds/Toast';
import { useI18n } from '@/i18n/client';
import { addBomArticleAction } from './actions';

/** "Add article" → "Add to BOM": toast "Article added to the project BOM". */
export function AddArticleButton({ code, context, form }: { code: string; context: string; form: FormDef }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="primary" icon={Plus} onClick={() => setOpen(true)}>
        {t('Add article')}
      </Button>
      <FormDialog {...form} open={open} onClose={() => setOpen(false)} context={context} onSubmit={(values) => addBomArticleAction(code, values)} />
    </>
  );
}

/** PU/PR card actions (template 1283). `canOrder`: the viewer may edit the project BOM. */
export function SparesActions({ createLabel, exportLabel, canOrder }: { createLabel: string; exportLabel: string; canOrder: boolean }) {
  const { t } = useI18n();
  const soon = (english: string) => () => showToast(t(`${english} — coming soon`));
  return (
    <>
      {canOrder && (
        <Button variant="secondary" size="sm" icon={ShoppingCart} onClick={soon('Create spares purchase order')}>
          {createLabel}
        </Button>
      )}
      <Button variant="ghost" size="sm" icon={FilePdf} onClick={soon('Export list')}>
        {exportLabel}
      </Button>
    </>
  );
}
