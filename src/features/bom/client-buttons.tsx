'use client';
// Client buttons of the Project BOM.
// - "Add article" (header primary, docs/spec/01 §5.9 → AF `bom`): the generic add-form dialog; rendered only when the
//   viewer may edit the project BOM (the page and PageHeader gate it, the Server Function checks again).
// - "Create spares purchase order" (PU/PR card; no handler in the prototype, 09 OQ20 / E-3): chapter 4 — opens the dialog
//   that drafts one purchase order per preferred supplier from the selected spare lines (origin 'spares', so it never
//   counts against the BOM shortfall), then opens the first draft on Purchase orders (./spares-order-dialog.tsx).
// - "Export list": downloads `exportHref`, the exports feature's PU/PR list PDF (`exportHref('bom', { variant: 'spares' })`).
import { FilePdf, Plus, ShoppingCart } from '@phosphor-icons/react/dist/ssr';
import { useState } from 'react';
import { FormDialog } from '@/components/app/FormDialog';
import type { FormDef } from '@/components/app/form-def';
import { Button } from '@/components/ds/Button';
import { downloadExport } from '@/features/exports/download';
import { useI18n } from '@/i18n/client';
import { addBomArticleAction } from './actions';
import { SparesOrderDialog, type SparesOrderScope } from './spares-order-dialog';

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

/**
 * PU/PR card actions (template 1283). `canOrder`: the viewer may edit the project BOM; `scope`: the project and the list as
 * displayed (system, PU/PR filter) — the spares order covers those lines; `exportHref`: file export of the list (PDF).
 */
export function SparesActions({ createLabel, exportLabel, canOrder, scope, exportHref }: {
  createLabel: string; exportLabel: string; canOrder: boolean; scope?: SparesOrderScope | null; exportHref: string;
}) {
  const { t } = useI18n();
  const [ordering, setOrdering] = useState(false);
  return (
    <>
      {canOrder && scope && (
        <>
          <Button variant="secondary" size="sm" icon={ShoppingCart} aria-haspopup="dialog" onClick={() => setOrdering(true)}>
            {createLabel}
          </Button>
          {ordering && <SparesOrderDialog scope={scope} onClose={() => setOrdering(false)} />}
        </>
      )}
      <Button variant="ghost" size="sm" icon={FilePdf} onClick={() => void downloadExport(exportHref, t('Export failed'))}>
        {exportLabel}
      </Button>
    </>
  );
}
