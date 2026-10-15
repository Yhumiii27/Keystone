// Client portal — document categories computed from the Codex index (Delivery 8, L-9 = a, R-138). The prototype's typed
// CLIENT_DOCS rows are gone: each shared document falls in the category of its Codex type (contract, minutes, HSE,
// accepted deliverables) or of its Codex family; categories without a file are left out; the order and keys are fixed.
import { describe, expect, it } from 'vitest';
import { CLIENT_DOC_CATEGORY_OF_TYPE, clientDocCategories, type SharedDocCategoryInput } from './rexclient';

const doc = (type: string, typeLabel: string, family: SharedDocCategoryInput['family'], issuedOn: string): SharedDocCategoryInput => ({ type, typeLabel, family, issuedOn });

describe('clientDocCategories', () => {
  it('maps the Codex types of the constant, then falls back to the Codex family; fixed order, empty ones left out', () => {
    const cats = clientDocCategories([
      doc('PID', 'P&ID', 'eng', '2026-09-26'),
      doc('MIN', 'Meeting minutes', 'contracts', '2026-09-22'),
      doc('SCH', 'Electrical schematics', 'eng', '2026-09-28'),
      doc('PV', 'Acceptance minutes (PV)', 'site', '2026-08-30'),
      doc('HSE', 'HSE plan', 'site', '2026-06-01'),
      doc('COC', 'Certificate of conformity', 'purchasing', '2026-07-10'),
      doc('MIN', 'Meeting minutes', 'contracts', '2026-09-29'),
      doc('RPT', 'Test & inspection report', 'client', '2026-09-01'),
      doc('CTR', 'Contract', 'contracts', '2026-01-15'),
    ]);
    expect(cats.map((c) => [c.key, c.category, c.fileCount, c.description, c.latestIssuedOn])).toEqual([
      ['contract', 'Contract & amendments', 1, 'Contract', '2026-01-15'],
      ['minutes', 'Meeting minutes', 2, 'Meeting minutes', '2026-09-29'],
      // L-9: "HSE documents" — the Codex HSE type is a prevention plan, not the prototype's monthly "HSE reports" (Vigie).
      ['hse', 'HSE documents', 1, 'HSE plan', '2026-06-01'],
      ['accepted', 'Accepted deliverables', 1, 'Acceptance minutes (PV)', '2026-08-30'],
      ['eng', 'Engineering', 2, 'P&ID · Electrical schematics', '2026-09-28'],
      ['client', 'Client deliverables', 1, 'Test & inspection report', '2026-09-01'],
      ['purchasing', 'Purchasing', 1, 'Certificate of conformity', '2026-07-10'],
    ]);
    expect(cats[4].types).toEqual(['P&ID', 'Electrical schematics']);
  });

  it('no shared document → no category; one constant holds the type → category list', () => {
    expect(clientDocCategories([])).toEqual([]);
    expect(Object.fromEntries(Object.entries(CLIENT_DOC_CATEGORY_OF_TYPE).map(([k, v]) => [k, v.key]))).toEqual({ CTR: 'contract', MIN: 'minutes', HSE: 'hse', PV: 'accepted' });
    // A site-family type outside the constant falls back to its family ("Site").
    expect(clientDocCategories([doc('PHO', 'Site photo', 'site', '2026-09-01')]).map((c) => [c.key, c.category])).toEqual([['site', 'Site']]);
  });

  it('the sum of the file counts is the number of shared documents', () => {
    const docs = [doc('PID', 'P&ID', 'eng', '2026-09-26'), doc('MAN', 'Manual / as-built', 'client', '2026-09-01'), doc('GA', 'General arrangement', 'eng', '2026-05-01')];
    expect(clientDocCategories(docs).reduce((a, c) => a + c.fileCount, 0)).toBe(docs.length);
  });
});
