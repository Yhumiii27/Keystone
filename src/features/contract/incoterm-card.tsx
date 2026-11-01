// R-158 lot A (owner's decision 2): the contract's Incoterm and named place on the Contract screen — the Incoterm, its split of
// responsibilities between EPC2i (seller) and the buyer, and "Set Incoterm" for the contract editors (P-4). The Shipments screen
// organises the transport from it. Server Component; the button is a client island.
import { ShippingContainer } from '@phosphor-icons/react/dist/ssr';
import { SectionCard } from '@/components/app/SectionCard';
import type { FormDef } from '@/components/app/form-def';
import { INCOTERM_MODES_LABEL, INCOTERM_STEPS, INCOTERM_STEP_LABEL, incotermText } from '@/domain/incoterms';
import { dataText } from '@/i18n/data-text';
import type { Lang, T } from '@/i18n/translate';
import type { ContractIncoterm, IncotermRow } from '@/server/dal/incoterms';
import { IncotermButton } from './incoterm-button';
import s from './contract.module.css';

/** "Set Incoterm" dialog: the active Incoterms (the contract's own kept when deactivated) and the named place. */
export function incotermFormDef(t: T, lang: Lang, list: IncotermRow[], current: string | null): FormDef {
  const options = list.filter((i) => i.active || i.code === current).map((i) => ({ value: i.code, label: `${i.code} — ${incotermText(lang, i.nameEn, i.nameFr)}` }));
  return {
    title: t('Contract Incoterm'),
    submit: t('Save'),
    fields: [
      { id: 'incoterm', label: t('Incoterm'), type: 'select', options: [{ value: '', label: t('None') }, ...options] },
      { id: 'place', label: t('Named place'), type: 'text', placeholder: t('Le Havre — terminal site') },
    ],
  };
}

export function IncotermCard({ value, list, code, canEdit, context, t, lang }: {
  value: ContractIncoterm; list: IncotermRow[]; code: string; canEdit: boolean; context: string; t: T; lang: Lang;
}) {
  const inc = value.incoterm;
  const action = canEdit ? (
    <IncotermButton
      code={code} context={context} form={incotermFormDef(t, lang, list, inc?.code ?? null)} label={inc ? t('Edit') : t('Set Incoterm')}
      values={{ incoterm: inc?.code ?? '', place: value.place ?? '' }}
    />
  ) : undefined;
  return (
    <SectionCard title={t('Incoterm')} icon={ShippingContainer} actions={action} subtitle={t('The shipments organise the seller’s steps from it')}>
      {inc ? (
        <>
          <div className={s.incotermHead}>
            <strong>{inc.code}</strong> {incotermText(lang, inc.nameEn, inc.nameFr)}
            {value.place && <span> · {dataText(value.place, lang)}</span>}
            <span className={s.incotermMuted}> · {t(INCOTERM_MODES_LABEL[inc.modes])}</span>
          </div>
          <div className={s.incotermSplit}>
            {INCOTERM_STEPS.map((k) => (
              <span key={k} className={inc.split[k] === 'seller' ? s.incotermSeller : s.incotermBuyer}>
                {t(INCOTERM_STEP_LABEL[k])} · {inc.split[k] === 'seller' ? t('EPC2i (seller)') : t('Buyer')}
              </span>
            ))}
          </div>
        </>
      ) : (
        <span className={s.incotermMuted}>{t('No Incoterm set on the contract')}</span>
      )}
    </SectionCard>
  );
}
