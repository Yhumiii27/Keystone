// "New RFQ" — the generic add-form of the Sourcing header (docs/spec/08 §1.4.5, AF.procurement): title, suppliers and
// articles required, reply date (default: the business date + 20 days, "15 Oct 2026" on the seed — R-169, R-013), Incoterm
// (DAP site · EXW · FCA · DDP, values are codes).
// Built translated on the server; FormDialog renders it as is.
import type { FormDef } from '@/components/app/form-def';
import { NEW_RFQ_INCOTERMS, newRfqDefaultDueIso } from '@/domain/procurement';
import type { T } from '@/i18n/translate';
import { displayOfIso, incoterm } from '@/server/db/codes';

/** AF_RESULT.procurement. */
export const NEW_RFQ_RESULT = 'RFQ sent to suppliers';

/** `asOf`: the business date (R-013). */
export function newRfqFormDef(t: T, asOf: string): FormDef {
  return {
    title: t('New RFQ'),
    kind: 'create',
    submit: t('Send RFQ'),
    fields: [
      { id: 'title', label: t('Title'), type: 'text', required: true },
      { id: 'suppliers', label: t('Suppliers'), type: 'text', required: true },
      { id: 'articles', label: t('Articles'), type: 'text', required: true },
      { id: 'due', label: t('Reply due'), type: 'text', defaultValue: t(displayOfIso(newRfqDefaultDueIso(asOf))) },
      { id: 'incoterm', label: t('Incoterm'), type: 'select', options: NEW_RFQ_INCOTERMS.map((c) => ({ value: c, label: t(incoterm.label(c)) })) },
    ],
  };
}
