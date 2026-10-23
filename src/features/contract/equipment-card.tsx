// "Equipment" card of the Contract screen (R-185, AC-5): what the project supplies — one line per machine type × quantity
// (EQ-01 = the main type), with its label, target capacity, options and the CAPEX application's machine need. Everyone who sees
// the Contract screen reads it; the director and the project's leads add, edit and remove lines (never the last one). Server
// Component; the buttons are client islands. Typed text (label, options) is shown as typed (dataText).
import type { FormDef, FormValues } from '@/components/app/form-def';
import { Card, CardTitle } from '@/components/ds/Card';
import { cx } from '@/components/ds/cx';
import { Table, Th } from '@/components/ds/Table';
import { MAX_EQUIPMENT_LINES, equipmentCount, equipmentSummary } from '@/domain/project-equipment';
import { dataText } from '@/i18n/data-text';
import { intlLocale, type Lang, type T } from '@/i18n/translate';
import type { EquipmentLine } from '@/server/dal/project-equipment';
import { AddEquipmentButton, EditEquipmentButton, RemoveEquipmentButton } from './equipment-buttons';
import s from './contract.module.css';

/** The line form (Add / Edit): `types` = the active machine types (code, display label). */
export function equipmentFormDef(t: T, types: { code: string; label: string }[], title: string, submit: string): FormDef {
  return {
    title, submit,
    fields: [
      { id: 'machineTypeCode', label: t('Machine type'), type: 'select', options: types.map((m) => ({ value: m.code, label: m.label })) },
      { id: 'quantity', label: t('Quantity'), type: 'number', required: true, defaultValue: '1' },
      { id: 'label', label: t('Equipment label'), type: 'text', placeholder: t('Optional'), span: 'full' },
      { id: 'capacityValue', label: t('Target capacity'), type: 'number', placeholder: t('Optional') },
      { id: 'capacityUnit', label: t('Capacity unit'), type: 'text', placeholder: 't, t/h, m³…' },
      { id: 'options', label: t('Options (comma-separated)'), type: 'text', placeholder: t('Optional'), span: 'full' },
      { id: 'besoinRef', label: t('Machine need'), type: 'text', placeholder: 'CPX-SAI-2026-01/B01' },
    ],
  };
}

export interface EquipmentCardProps {
  lines: EquipmentLine[];
  code: string;
  canEdit: boolean;
  /** Active machine types offered by the form (a line keeps its own type even when retired). */
  types: { code: string; label: string }[];
  /** Translated project label, the dialogs' sub-line. */
  context: string;
  t: T;
  lang: Lang;
}

export function EquipmentCard({ lines, code, canEdit, types, context, t, lang }: EquipmentCardProps) {
  const nf = new Intl.NumberFormat(intlLocale(lang), { maximumFractionDigits: 2 });
  const summary = equipmentSummary(lines);
  const machines = equipmentCount(lines);
  const values = (l: EquipmentLine): FormValues => ({
    machineTypeCode: l.machineTypeCode, quantity: String(l.quantity), label: l.label ?? '', capacityValue: l.capacityValue == null ? '' : String(l.capacityValue),
    capacityUnit: l.capacityUnit ?? '', options: l.options.join(', '), besoinRef: l.besoinRef ?? '',
  });
  const editTypes = (l: EquipmentLine) => (types.some((m) => m.code === l.machineTypeCode) ? types : [{ code: l.machineTypeCode, label: l.typeLabel }, ...types]);
  return (
    <Card className={s.listCard}>
      <div className={s.headTop}>
        <div className={s.titleCol}>
          <CardTitle>{t('Equipment')}</CardTitle>
          <span className={s.subtitle}>
            {summary
              ? `${summary} · ${machines} machine${machines > 1 ? 's' : ''}`
              : t('No equipment line')}
          </span>
        </div>
        {canEdit && lines.length < MAX_EQUIPMENT_LINES && (
          <AddEquipmentButton code={code} context={context} form={equipmentFormDef(t, types, t('Add equipment line'), t('Add'))} label={t('Add equipment line')} saved={t('Equipment saved')} />
        )}
      </div>
      {lines.length > 0 && (
        <Table>
          <thead>
            <tr>
              <Th>{t('Ref.')}</Th>
              <Th>{t('Equipment')}</Th>
              <Th>{t('Label')}</Th>
              <Th align="right">{t('Target capacity')}</Th>
              <Th>{t('Options')}</Th>
              <Th>{t('Machine need')}</Th>
              {canEdit && <Th aria-label={t('Actions')} />}
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={l.id}>
                <td className={cx(s.num, s.strong)}>{l.ref}</td>
                <td className={s.num}>
                  {l.quantity} × {l.typeLabel}
                  {i === 0 && lines.length > 1 && <span className={s.meta}> · {t('main type')}</span>}
                </td>
                <td>{l.label ? dataText(l.label, lang) : <span className={s.muted}>—</span>}</td>
                <td className={cx(s.right, s.num)}>{l.capacityValue == null ? '—' : `${nf.format(l.capacityValue)} ${l.capacityUnit ?? ''}`.trim()}</td>
                <td>{l.options.length ? l.options.map((o) => dataText(o, lang)).join(', ') : <span className={s.muted}>—</span>}</td>
                <td className={s.num}>{l.besoinRef ?? '—'}</td>
                {canEdit && (
                  <td className={s.actionCell}>
                    <span className={s.milestoneActions}>
                      <EditEquipmentButton
                        code={code} refCode={l.ref} context={`${context} · ${l.ref}`} form={equipmentFormDef(t, editTypes(l), `${t('Edit equipment line')} ${l.ref}`, t('Save'))}
                        values={values(l)} label={t('Edit')} ariaLabel={`${t('Edit equipment line')} ${l.ref}`} saved={t('Equipment saved')}
                      />
                      {lines.length > 1 && (
                        <RemoveEquipmentButton
                          code={code} refCode={l.ref} label={t('Remove')} ariaLabel={`${t('Remove')} ${l.ref}`} title={`${t('Remove equipment line')} ${l.ref}`}
                          text={t('The line leaves the project; its planning lots stay, common to the project.')} cancel={t('Cancel')} removed={t('Equipment removed')}
                        />
                      )}
                    </span>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  );
}
