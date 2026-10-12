// Links to Vigie (delivery 8, lot connectors): the supplier NCR prefill of a rejected receipt (R-096: NEW-D4-3 "a",
// SC-3b "a", parameter names proposed under V-3), the project filter of Vigie's lists (R-025: V-3b "a", the Keystone code
// until NEW-SYS-1 / R-022) and the ECO routes agreed by NEW-D4-1 "a" (R-024: unchanged URLs).
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  vigieCoactivityUrl, vigieEcoListUrl, vigieHseListUrl, vigieNcrListUrl, vigieNewEcoUrl, vigieProjectParam, vigieReportIncidentUrl, vigieReportNcrUrl,
} from './links';

afterEach(() => vi.unstubAllEnvs());

describe('R-096 — supplier NCR declared in Vigie from a rejected receipt', () => {
  it('prefills project, part, title, supplier, Sage supplier code, order, receipt and rejected quantity (V-3 proposal)', () => {
    const url = new URL(vigieReportNcrUrl({
      projectCode: 'HLT-026', partRef: 'EL-CAB-XLPE', title: 'BL-2026-0533 · EL-CAB-XLPE · XLPE cable drum', supplier: 'Nexans France', supplierCode: 'F-00412',
      order: 'PO-1085', receipt: 'BL-2026-0533', quantity: 2,
    }));
    expect(url.origin + url.pathname).toBe('http://localhost:3200/signaler');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      type: 'NC', projet: 'HLT-026', article: 'EL-CAB-XLPE', titre: 'BL-2026-0533 · EL-CAB-XLPE · XLPE cable drum', fournisseur: 'Nexans France',
      code_fournisseur: 'F-00412', commande: 'PO-1085', reception: 'BL-2026-0533', quantite: '2', source: 'keystone',
    });
  });

  it('drops empty values (no Sage supplier code until the supplier file is loaded, NEW-D4-4)', () => {
    expect(vigieReportNcrUrl({ projectCode: 'HLT-026', supplier: 'Nexans France', supplierCode: null, order: 'PO-1085', receipt: 'BL-2026-0533', quantity: 3 }))
      .toBe('http://localhost:3200/signaler?type=NC&projet=HLT-026&fournisseur=Nexans+France&commande=PO-1085&reception=BL-2026-0533&quantite=3&source=keystone');
    expect(vigieReportNcrUrl({ supplier: '  ', supplierCode: '', order: undefined, quantity: null })).toBe('http://localhost:3200/signaler?type=NC&source=keystone');
  });

  it('the existing prefills are unchanged (R-112 ITP inspection)', () => {
    expect(vigieReportNcrUrl({ projectCode: 'HLT-026', title: 'ITP I-03 · Hoist · Load test', inspection: 'I-03' }))
      .toBe('http://localhost:3200/signaler?type=NC&projet=HLT-026&titre=ITP+I-03+%C2%B7+Hoist+%C2%B7+Load+test&inspection=I-03&source=keystone');
  });
});

describe('R-025 — Vigie lists filtered on the project', () => {
  it('one helper names the project (the Keystone code until NEW-SYS-1 / R-022); blank → nothing', () => {
    expect(vigieProjectParam(' HLT-026 ')).toBe('HLT-026');
    expect([vigieProjectParam(''), vigieProjectParam(null), vigieProjectParam(undefined)]).toEqual([null, null, null]);
  });

  it('NCR list, prevention plans and co-activity map take `projet`; without a project they are unchanged', () => {
    vi.stubEnv('NEXT_PUBLIC_VIGIE_URL', 'https://vigie.example.com/');
    expect(vigieNcrListUrl({ projectCode: 'NDC-031' })).toBe('https://vigie.example.com/evenements?type=NC&projet=NDC-031');
    expect(vigieHseListUrl({ projectCode: 'NDC-031' })).toBe('https://vigie.example.com/prevention?projet=NDC-031');
    expect(vigieCoactivityUrl({ projectCode: 'NDC-031' })).toBe('https://vigie.example.com/prevention/carte?projet=NDC-031');
    expect([vigieNcrListUrl(), vigieHseListUrl(), vigieCoactivityUrl()]).toEqual([
      'https://vigie.example.com/evenements?type=NC', 'https://vigie.example.com/prevention', 'https://vigie.example.com/prevention/carte',
    ]);
    expect(vigieReportIncidentUrl({ projectCode: 'NDC-031' })).toBe('https://vigie.example.com/signaler?projet=NDC-031&source=keystone');
  });
});

describe('R-024 — ECO routes agreed by NEW-D4-1 "a" (English parameters; URLs unchanged)', () => {
  it('new ECO form and register filters', () => {
    expect(vigieNewEcoUrl({ partRef: 'HST-BRK-DSC', projectCode: 'HLT-026', title: 'Disc brake' }))
      .toBe('http://localhost:3200/modifications-techniques/nouvelle?part=HST-BRK-DSC&project=HLT-026&title=Disc+brake&source=keystone');
    expect(vigieEcoListUrl({ projectCode: 'HLT-026' })).toBe('http://localhost:3200/modifications-techniques?project=HLT-026');
  });
});
