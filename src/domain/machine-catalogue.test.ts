// R-186 (AC-4, K-01): pure rules of the machine catalogue — content validation, the options' text form, versioning (next number,
// latest), the status transitions and immutability of a published version, the publication's superseded version, the catalogue
// choice of an equipment line, and the rights (choice 5: director and engineering lead).
import { describe, expect, it } from 'vitest';
import {
  CATALOGUE_SHARE_STATUS, canEditCatalogue, catalogueActionBlocker, catalogueChoiceBlocker, catalogueOptionsText, latestVersion, nextCatalogueVersion,
  normaliseCatalogueCode, parseCatalogueChoice, parseCatalogueContent, parseCatalogueOptions, publishBlockers, supersededBy, type CatalogueVersionState,
} from './machine-catalogue';

const err = <T,>(r: { ok: true; value: T } | { ok: false; error: string }) => (r.ok ? null : r.error);

describe('catalogue content', () => {
  it('trims and normalises a draft; blank optional fields are null; a unit without a capacity is dropped', () => {
    expect(parseCatalogueContent({
      label: '  Portique 40 t ', variant: ' Quai ', description: '', nominalCapacity: '40', capacityUnit: ' t ', indicativePriceKeur: '4 200,5', leadTimeWeeks: '52',
      options: 'tele | Télécommande radio | 18\n\nANTI-COL | Anticollision laser',
    })).toEqual({
      ok: true,
      value: {
        variant: 'Quai', label: 'Portique 40 t', description: null, nominalCapacity: 40, capacityUnit: 't', indicativePriceKeur: 4200.5, leadTimeWeeks: 52,
        options: [{ code: 'TELE', libelle: 'Télécommande radio', prix_indicatif_keur: 18 }, { code: 'ANTI-COL', libelle: 'Anticollision laser', prix_indicatif_keur: null }],
      },
    });
    expect(parseCatalogueContent({ label: 'X', capacityUnit: 't' })).toMatchObject({ ok: true, value: { nominalCapacity: null, capacityUnit: null, options: [], leadTimeWeeks: null } });
  });

  it('refuses a missing label, bad numbers, bad options', () => {
    expect(err(parseCatalogueContent({ label: ' ' }))).toBe('Label is required');
    expect(err(parseCatalogueContent({ label: 'x'.repeat(121) }))).toBe('The label is too long');
    expect(err(parseCatalogueContent({ label: 'X', nominalCapacity: '0', capacityUnit: 't' }))).toBe('The nominal capacity is a positive number');
    expect(err(parseCatalogueContent({ label: 'X', nominalCapacity: '12' }))).toBe('Enter the unit of the nominal capacity');
    expect(err(parseCatalogueContent({ label: 'X', indicativePriceKeur: '-1' }))).toBe('The indicative price is a positive amount in k€');
    for (const w of ['0', '2.5', '521', 'abc']) expect(err(parseCatalogueContent({ label: 'X', leadTimeWeeks: w }))).toBe('The typical lead time is a whole number of weeks from 1 to 520');
    expect(err(parseCatalogueOptions('TELE'))).toBe('An option reads “CODE | label | indicative price k€” (one per line)');
    expect(err(parseCatalogueOptions('TELE | A\ntele | B'))).toBe('Option codes must be distinct');
    expect(err(parseCatalogueOptions('TELE | A | -3'))).toBe('An option price is a positive amount in k€');
    expect(err(parseCatalogueOptions(Array.from({ length: 21 }, (_, i) => `O${i} | x`).join('\n')))).toBe('A catalogue entry has at most 20 options');
    expect(err(parseCatalogueOptions(42))).toBe('Invalid catalogue options');
  });

  it('options round-trip through their text form; the K-01 shape is accepted as is', () => {
    const options = [{ code: 'TELE', libelle: 'Télécommande radio', prix_indicatif_keur: 18 }, { code: 'GEN', libelle: 'Groupe', prix_indicatif_keur: null }];
    expect(catalogueOptionsText(options)).toBe('TELE | Télécommande radio | 18\nGEN | Groupe');
    expect(parseCatalogueOptions(catalogueOptionsText(options))).toEqual({ ok: true, value: options });
    expect(parseCatalogueOptions(options)).toEqual({ ok: true, value: options });
  });

  it('a draft is published with an indicative price and a typical lead time', () => {
    expect(publishBlockers({ label: 'X', indicativePriceKeur: null, leadTimeWeeks: null })).toEqual(['Enter the indicative price before publishing', 'Enter the typical lead time before publishing']);
    expect(publishBlockers({ label: 'X', indicativePriceKeur: 0, leadTimeWeeks: 4 })).toEqual([]);
  });

  it('codes are upper-cased, spaces become dashes', () => {
    expect(normaliseCatalogueCode(' emp 40t ')).toBe('EMP-40T');
  });
});

describe('versions and statuses', () => {
  const v = (version: number, status: CatalogueVersionState['status']): CatalogueVersionState => ({ version, status });

  it('numbers a new version one after the highest; the latest is the highest', () => {
    expect(nextCatalogueVersion([])).toBe(1);
    expect(nextCatalogueVersion([v(1, 'retired'), v(3, 'published'), v(2, 'retired')])).toBe(4);
    expect(latestVersion([v(1, 'retired'), v(3, 'published'), v(2, 'retired')])).toEqual(v(3, 'published'));
    expect(latestVersion([])).toBeNull();
  });

  it('only a draft is edited, published or discarded: a published or retired version is frozen', () => {
    const all = [v(1, 'retired'), v(2, 'published'), v(3, 'draft')];
    for (const a of ['edit', 'publish', 'discard'] as const) {
      expect(catalogueActionBlocker(a, v(3, 'draft'), all)).toBeNull();
      expect(catalogueActionBlocker(a, v(2, 'published'), all)).toBe('A published version is frozen: create a new version');
      expect(catalogueActionBlocker(a, v(1, 'retired'), all)).toBe('A published version is frozen: create a new version');
    }
    expect(catalogueActionBlocker('edit', null, all)).toBe('Unknown catalogue version');
  });

  it('only the published version is retired; a new version waits for no pending draft', () => {
    expect(catalogueActionBlocker('retire', v(2, 'published'), [])).toBeNull();
    expect(catalogueActionBlocker('retire', v(1, 'retired'), [])).toBe('Only the published version can be retired');
    expect(catalogueActionBlocker('retire', v(3, 'draft'), [])).toBe('Only the published version can be retired');
    expect(catalogueActionBlocker('newVersion', null, [v(1, 'published')])).toBeNull();
    expect(catalogueActionBlocker('newVersion', null, [v(1, 'retired')])).toBeNull();
    expect(catalogueActionBlocker('newVersion', null, [v(1, 'published'), v(2, 'draft')])).toBe('This entry already has a draft version');
  });

  it('publishing a draft retires the published version of the code (kept for the needs that chose it); drafts are never shared', () => {
    expect(supersededBy(v(3, 'draft'), [v(1, 'retired'), v(2, 'published'), v(3, 'draft')])).toEqual([2]);
    expect(supersededBy(v(1, 'draft'), [v(1, 'draft')])).toEqual([]);
    expect(CATALOGUE_SHARE_STATUS).toEqual({ draft: null, published: 'publie', retired: 'retire' });
  });
});

describe('catalogue choice of an equipment line', () => {
  it('parses "CODE@version" or nothing', () => {
    expect(parseCatalogueChoice('')).toEqual({ ok: true, value: null });
    expect(parseCatalogueChoice(undefined)).toEqual({ ok: true, value: null });
    expect(parseCatalogueChoice('EMP-40T@2')).toEqual({ ok: true, value: { code: 'EMP-40T', version: 2 } });
    for (const bad of ['EMP-40T', 'EMP-40T@0', 'emp@1', 3]) expect(parseCatalogueChoice(bad)).toEqual({ ok: false, error: 'Unknown catalogue entry' });
  });

  it('a published version of the line type; a retired one only when the line already had it; never a draft', () => {
    const c = { code: 'EMP-40T', version: 1 };
    expect(catalogueChoiceBlocker(null, null, 'EMP')).toBeNull();
    expect(catalogueChoiceBlocker(c, { status: 'published', machineTypeCode: 'EMP' }, 'EMP')).toBeNull();
    expect(catalogueChoiceBlocker(c, { status: 'published', machineTypeCode: 'EMP' }, 'MEMU')).toBe('The catalogue entry is of another machine type');
    expect(catalogueChoiceBlocker(c, { status: 'draft', machineTypeCode: 'EMP' }, 'EMP')).toBe('Unknown catalogue entry');
    expect(catalogueChoiceBlocker(c, null, 'EMP')).toBe('Unknown catalogue entry');
    expect(catalogueChoiceBlocker(c, { status: 'retired', machineTypeCode: 'EMP' }, 'EMP')).toBe('This catalogue version is retired');
    expect(catalogueChoiceBlocker(c, { status: 'retired', machineTypeCode: 'EMP' }, 'EMP', { code: 'EMP-40T', version: 1 })).toBeNull();
  });
});

describe('rights (choice 5)', () => {
  it('the director and the engineering lead edit the catalogue', () => {
    expect(['director', 'pm', 'depthead', 'member', 'englead', 'quality', 'procurement', 'finance', 'client'].filter(canEditCatalogue)).toEqual(['director', 'englead']);
  });
});
