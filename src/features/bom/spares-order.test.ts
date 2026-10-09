// Chapter 4 (E-3) — "Create spares purchase order" on the Project BOM's PU/PR list: the Server Functions (candidates as
// displayed, suggested quantities, rights, validation), the drafts in Keystone purchasing (one per preferred supplier,
// origin 'spares', not counted against the BOM shortfall) and the button. In-memory seeded database, mocked session.
import { createElement as h, type ReactElement } from 'react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const session = { role: 'director' as string, lang: 'en' as 'en' | 'fr' };
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ usePathname: () => '/projects/HLT-026/bom', useRouter: () => ({ push() {}, replace() {}, refresh() {} }), useSearchParams: () => new URLSearchParams() }));
vi.mock('@/server/session', async () => {
  const { makeT } = await import('@/i18n/translate');
  const { PERSONA_BY_ROLE } = await import('@/config/personas');
  return {
    getViewer: async () => PERSONA_BY_ROLE[session.role as keyof typeof PERSONA_BY_ROLE],
    getI18n: async () => ({ lang: session.lang, t: makeT(session.lang) }),
    getLang: async () => session.lang,
  };
});

import { renderToStaticMarkup } from 'react-dom/server';
import { I18nProvider } from '@/i18n/client';
import { makeT } from '@/i18n/translate';
import { setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { getBomScreen } from '@/server/dal/bom-screen';
import { listAudit } from '@/server/dal/notifications';
import { getBomShortfall, listPurchaseOrders } from '@/server/dal/purchasing';
import { BomBody } from './bom-view';
import { parseBomState } from './links';
import { bomScreenView } from './model';
import { createSparesOrderAction, loadSparesOrderAction } from './spares-order-actions';

beforeAll(async () => {
  setDb(await openDatabase());
}, 60_000);
beforeEach(() => {
  session.role = 'director';
  session.lang = 'en';
});

describe('spares purchase order (E-3)', () => {
  it('candidates: the list as displayed, preferred supplier, stock, suggested quantity, warnings', async () => {
    const r = await loadSparesOrderAction('HLT-026', null, null);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.view.systemName).toBe('Gantry crane 250 t — complete');
    expect(r.view.lines.map((l) => [l.ref, l.kind, l.supplier, l.recommendedQty, l.inStock, l.onOrder, l.suggestedQty, l.unitPriceEur, l.preselected])).toEqual([
      ['CR-WHL-630', 'PU', 'Halvorsen Cranes', 8, 0, 0, 8, 2090, true],
      ['CR-BRG-SKF', 'PU', 'SKF', 16, 16, 0, 0, 598, false],
      ['HST-ROP-28', 'PU', 'Teufelberger', 4, 2, 0, 2, 9200, true],
      ['HST-BRK-DSC', 'PU', 'Dellner Bubenzer', 4, 0, 0, 4, 7400, false], // frozen by an open ECO: not pre-selected
      ['CR-MOT-15K', 'PR', 'SEW-Eurodrive', 2, 0, 0, 2, 4650, true],
      ['HST-MOT-160', 'PR', 'ABB', 2, 0, 0, 2, 27900, true],
      ['EL-VFD-200', 'PR', 'ABB', 2, 0, 0, 2, 13600, true],
      ['EL-PLC-S7', 'PR', 'Siemens', 2, 0, 0, 2, 6700, true],
      ['CTL-ANT-COL', 'PR', 'SICK', 4, 0, 0, 4, 4980, true],
      ['CTL-CAM-OCR', 'PR', 'Camco', 4, 0, 0, 4, 2950, true],
      ['EL-HMI-15', 'PR', 'Siemens', 2, 0, 0, 2, 2400, true],
      ['FD-DET-OPT2', 'PR', 'Cotswold Fire Systems', 8, 60, 0, 0, 54, false],
    ]);
    expect(r.view.lines.find((l) => l.ref === 'HST-BRK-DSC')!.warnings).toEqual(['Not validated', 'Under change']);
    const pr = await loadSparesOrderAction('HLT-026', null, 'PR');
    expect(pr.ok && pr.view.lines.every((l) => l.kind === 'PR')).toBe(true);
    session.lang = 'fr';
    const fr = await loadSparesOrderAction('HLT-026', null, null);
    expect(fr.ok && fr.view.lines.find((l) => l.ref === 'HST-BRK-DSC')!.warnings).toEqual(['Non validé', 'En modification']);
  });

  it('drafts one purchase order per supplier (origin spares), audited; the BOM shortfall is unchanged; quantities on order are netted', async () => {
    const shortfall = await getBomShortfall('HLT-026');
    const before = (await listPurchaseOrders('HLT-026')).length;
    const r = await createSparesOrderAction('HLT-026', {
      system: null, kind: null,
      lines: [{ ref: 'HST-MOT-160', qty: 2 }, { ref: 'CR-WHL-630', qty: 8 }, { ref: 'EL-VFD-200', qty: 1 }, { ref: 'EL-PLC-S7', qty: 2 }],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.numbers).toHaveLength(3); // ABB, Halvorsen Cranes, Siemens
    expect(r.href).toBe(`/projects/HLT-026/orders?po=${r.numbers[0]}`);
    expect(r.toast).toBe(`${r.numbers.join(', ')} · Draft purchase orders created`);
    const orders = await listPurchaseOrders('HLT-026');
    expect(orders).toHaveLength(before + 3);
    const drafts = r.numbers.map((n) => orders.find((o) => o.number === n)!);
    expect(drafts.map((o) => [o.supplier, o.status, o.origin, o.expectedOn, o.createdBy, o.lines.map((l) => [l.ref, l.orderedQty, l.unitPriceEur])])).toEqual([
      ['ABB', 'draft', 'spares', null, 'Marie Lefebvre', [['HST-MOT-160', 2, 27900], ['EL-VFD-200', 1, 13600]]],
      ['Halvorsen Cranes', 'draft', 'spares', null, 'Marie Lefebvre', [['CR-WHL-630', 8, 2090]]],
      ['Siemens', 'draft', 'spares', null, 'Marie Lefebvre', [['EL-PLC-S7', 2, 6700]]],
    ]);
    const [audit] = await listAudit({ projectCode: 'HLT-026', limit: 1 });
    expect([audit.object, audit.change]).toEqual([r.numbers[2], 'draft created from the PU/PR list (Gantry crane 250 t — complete) · Siemens · EL-PLC-S7 × 2']);
    // Spares orders never count against the BOM shortfall (EL-PLC-S7 is also a BOM article).
    expect(await getBomShortfall('HLT-026')).toEqual(shortfall);
    // Ordered quantities are netted: the next proposal only tops up what is still missing.
    const again = await loadSparesOrderAction('HLT-026', null, null);
    expect(again.ok && again.view.lines.filter((l) => ['HST-MOT-160', 'CR-WHL-630', 'EL-VFD-200'].includes(l.ref)).map((l) => [l.ref, l.onOrder, l.suggestedQty, l.preselected])).toEqual([
      ['CR-WHL-630', 8, 0, false], ['HST-MOT-160', 2, 0, false], ['EL-VFD-200', 1, 1, true],
    ]);
  });

  it('validates the lines against the list as displayed', async () => {
    expect(await createSparesOrderAction('HLT-026', { system: null, kind: null, lines: [] })).toEqual({ ok: false, error: 'Select at least one line to order' });
    expect(await createSparesOrderAction('HLT-026', { system: null, kind: 'PR', lines: [{ ref: 'CR-WHL-630', qty: 1 }] })).toEqual({ ok: false, error: 'This line is not in the list any more' });
    expect(await createSparesOrderAction('HLT-026', { system: null, kind: null, lines: [{ ref: 'CR-WHL-630', qty: 0 }] })).toEqual({ ok: false, error: 'Enter a whole quantity of at least 1' });
    expect(await createSparesOrderAction('NDC-031', { system: null, kind: null, lines: [{ ref: 'CR-WHL-630', qty: 1 }] })).toEqual({ ok: false, error: 'This project has no PU/PR list' });
  });

  it('rights: BOM editors only (outside roles and other PMs’ projects are refused)', async () => {
    session.role = 'client';
    expect(await loadSparesOrderAction('HLT-026', null, null)).toEqual({ ok: false, error: 'This project BOM is read-only for you' });
    session.role = 'pm';
    expect((await loadSparesOrderAction('HLT-026', null, null)).ok).toBe(true);
    expect(await createSparesOrderAction('NDC-031', { system: null, kind: null, lines: [{ ref: 'CR-WHL-630', qty: 1 }] })).toEqual({ ok: false, error: 'This project BOM is read-only for you' });
    session.role = 'member';
    expect(await createSparesOrderAction('HLT-026', { system: null, kind: null, lines: [{ ref: 'CR-WHL-630', qty: 1 }] })).toEqual({ ok: false, error: 'This project BOM is read-only for you' });
  });

  it('the PU/PR card button opens the dialog (no coming-soon toast)', async () => {
    const state = parseBomState({ view: 'spares' });
    const data = (await getBomScreen('HLT-026', { view: state.view, used: state.used, system: state.sys }))!;
    const view = bomScreenView('HLT-026', state, data, { canEdit: true, canRaiseEco: true }, makeT('en'), 'en');
    const html = renderToStaticMarkup(h(I18nProvider, { lang: 'en', children: h(BomBody, { view, canEdit: true }) as ReactElement }));
    expect(html).toMatch(/<button[^>]*aria-haspopup="dialog"[^>]*>[\s\S]*?Create spares purchase order<\/button>/);
  });
});
