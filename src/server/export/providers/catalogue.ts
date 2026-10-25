// Export provider — Machine catalogue (owner, 25 Oct 2026; R-186): every catalogue version of the codes the screen lists
// (`?type=` and `?status=` as on the screen), the rows published to the CAPEX application (pub_catalogue_machines) and the
// projects' equipment lines that chose a version. Typed text as typed (dataText); the indicative price is Keystone's own
// catalogue price (class E50), not a supplier price, so it is not masked.
import { CATALOGUE_STATUS_LABEL } from '@/domain/machine-catalogue';
import { catalogueStatusOf } from '@/features/catalogue/links';
import { CATALOGUE_STATUS_FILTER_LABEL, entryState } from '@/features/catalogue/model';
import { dataText } from '@/i18n/data-text';
import { listCatalogue, listCataloguePublication, listCatalogueUses } from '@/server/dal/machine-catalogue';
import { listMachineTypes } from '@/server/dal/mtypes';
import { registerExportProvider } from '../registry';
import type { ExportContext, ExportWorkbook } from '../types';
import { col, compact, filterLine, param, sheet } from './common';

async function catalogueWorkbook(ctx: ExportContext): Promise<ExportWorkbook> {
  const { t, lang } = ctx;
  const [rows, types, publication, uses] = await Promise.all([listCatalogue(), listMachineTypes(), listCataloguePublication(), listCatalogueUses()]);
  const typed = (param(ctx, 'type') ?? '').trim().toLowerCase();
  const type = typed ? types.find((m) => m.code.toLowerCase() === typed || m.displayCode.toLowerCase() === typed) ?? null : null;
  const status = catalogueStatusOf(param(ctx, 'status'));
  const codes = new Set(
    [...new Set(rows.map((r) => r.code))].filter((code) => {
      const all = rows.filter((r) => r.code === code);
      if (type && all[0].machineTypeCode !== type.code) return false;
      const e = entryState(all);
      return status === 'all' || (status === 'draft' ? e.hasDraft : e.state === status);
    }),
  );
  const versions = rows.filter((r) => codes.has(r.code));
  return {
    title: t('Machine catalogue'),
    filters: compact([type ? filterLine(t('Machine type'), type.displayCode) : null, status !== 'all' ? filterLine(t('Status'), t(CATALOGUE_STATUS_FILTER_LABEL[status])) : null]),
    sheets: [
      sheet(t('Catalogue entries'), [
        col('code', t('Code'), 'text', 12), col('version', t('Version'), 'integer', 8), col('type', t('Machine type'), 'text', 10), col('status', t('Status'), 'text', 10),
        col('variant', t('Variant'), 'text', 16), col('label', t('Label'), 'text', 34), col('capacity', t('Nominal capacity'), 'number'), col('unit', t('Capacity unit'), 'text', 8),
        col('price', t('Indicative price'), 'money_keur'), col('lead', t('Typical lead time (weeks)'), 'integer'), col('options', t('Options'), 'text', 40),
        col('lines', t('Equipment lines'), 'integer'), col('updated', t('Updated'), 'datetime'),
      ], versions.map((r) => ({
        code: r.code, version: r.version, type: r.typeLabel, status: t(CATALOGUE_STATUS_LABEL[r.status]), variant: r.variant ? dataText(r.variant, lang) : '',
        label: dataText(r.label, lang), capacity: r.nominalCapacity, unit: r.capacityUnit ?? '', price: r.indicativePriceKeur, lead: r.leadTimeWeeks,
        options: r.options.map((o) => `${o.code} · ${dataText(o.libelle, lang)}`).join(' ; '), lines: r.projectLines, updated: r.updatedAt,
      }))),
      sheet(t('Published to the CAPEX application'), [col('code', t('Code'), 'text', 12), col('version', t('Version'), 'integer', 8), col('statut', 'statut', 'text', 8), col('majLe', 'maj_le', 'datetime')],
        publication.filter((p) => codes.has(p.code)).map((p) => ({ code: p.code, version: p.version, statut: p.statut, majLe: p.majLe }))),
      sheet(t('Projects’ equipment lines'), [col('code', t('Code'), 'text', 12), col('version', t('Version'), 'integer', 8), col('project', t('Project'), 'text', 12), col('line', t('Line'), 'text', 8), col('quantity', t('Quantity'), 'integer')],
        uses.filter((u) => codes.has(u.code)).map((u) => ({ code: u.code, version: u.version, project: u.projectCode, line: u.ref, quantity: u.quantity }))),
    ],
  };
}

registerExportProvider({ screen: 'catalogue', table: catalogueWorkbook, fileBase: () => 'machine-catalogue' });
