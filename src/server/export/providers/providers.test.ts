// Export providers (chapter 4, exports feature): every screen of the registry has a provider; each one exports HLT-026 (or
// its global table) for the portfolio director as a real Excel workbook and a CSV; the documents (purchase order, goods
// receipt, account statement, status report, PV de réception) and the PDF reports carry their key figures; rights follow
// the screens (masked rates, client restricted to its organisation's projects).
import { beforeAll, describe, expect, it } from 'vitest';
import { PERSONA_BY_ROLE } from '@/config/personas';
import { SCREENS, type RoleKey, type ScreenId } from '@/config/screens';
import { setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { formatsOf, getExportProvider } from '../registry';
import { buildExportContext, runExport } from '../run';
import { pdfTextLines } from '../test/pdf-text';
import { readXlsx } from '../xlsx';
import { exportFormatsOf } from '@/features/exports/catalog';
import { listDeliverables } from '@/server/dal/quality';
import { recordStatusReport } from '@/server/dal/trends';
import '.';

const NOW = new Date('2026-10-09T08:00:00Z');
const ctxOf = (screen: ScreenId | string, role: RoleKey, query: string, lang: 'fr' | 'en' = 'en') =>
  buildExportContext({ screen, viewer: PERSONA_BY_ROLE[role], lang, params: new URLSearchParams(query), now: NOW });
const queryOf = (screen: ScreenId) => (SCREENS.find((s) => s.id === screen)!.scope === 'project' ? 'code=HLT-026' : screen === 'task' ? 'task=T-2314' : '');
const csvLines = (body: Uint8Array) => new TextDecoder().decode(body).replace(/^﻿/, '').split('\r\n').filter(Boolean);
const pdfOf = async (screen: ScreenId, role: RoleKey, query: string, lang: 'fr' | 'en' = 'fr') => {
  const f = await runExport(await ctxOf(screen, role, query, lang), 'pdf', { compressPdf: false });
  expect(Buffer.from(f.body.subarray(0, 4)).toString('latin1')).toBe('%PDF');
  return { file: f, text: pdfTextLines(f.body).join('\n') };
};

beforeAll(async () => {
  setDb(await openDatabase());
}, 60_000);

describe('every screen has an export provider', () => {
  it('registry covers the 59 screens, each with tables', () => {
    const missing = SCREENS.filter((s) => !getExportProvider(s.id)?.table).map((s) => s.id);
    expect(missing).toEqual([]);
    expect(SCREENS.length).toBe(59);
  });

  it.each(SCREENS.map((s) => s.id))('%s: Excel opens and the CSV has the main table (director, HLT-026)', async (screen) => {
    const ctx = await ctxOf(screen, 'director', queryOf(screen));
    const x = await runExport(ctx, 'xlsx');
    expect(Buffer.from(x.body.subarray(0, 2)).toString('latin1')).toBe('PK');
    const sheets = await readXlsx(x.body);
    expect(sheets.length).toBeGreaterThanOrEqual(2);
    expect(sheets.at(-1)!.name).toBe('Export');
    expect(sheets[0].rows[0].length).toBeGreaterThan(0);
    const c = await runExport(ctx, 'csv');
    expect(csvLines(c.body).length).toBeGreaterThanOrEqual(1);
    expect(formatsOf(getExportProvider(screen))).toContain('xlsx');
  }, 30_000);

  it('the header menu offers exactly the formats of each provider (PDF only where there is a report)', () => {
    for (const s of SCREENS) expect([s.id, ...exportFormatsOf(s.id)].sort()).toEqual([s.id, ...formatsOf(getExportProvider(s.id))].sort());
  });
});

const sheetsOf = async (screen: ScreenId, role: RoleKey, query: string, lang: 'fr' | 'en' = 'en') => readXlsx((await runExport(await ctxOf(screen, role, query, lang), 'xlsx')).body);
const col = (rows: (string | number | boolean | null)[][], header: string) => {
  const i = rows[0].indexOf(header);
  return rows.slice(1).map((r) => r[i]);
};

describe('provider rows for HLT-026 (director)', () => {
  it('plan: WBS rows in display order with dates, float, % complete and logic as real values', async () => {
    const [wbs] = await sheetsOf('plan', 'director', 'code=HLT-026');
    const ids = col(wbs.rows, 'ID');
    expect(ids[0]).toBe('1');
    const a = wbs.rows[ids.indexOf('A1250') + 1];
    const h = (k: string) => a[wbs.rows[0].indexOf(k)];
    expect([h('Name'), typeof h('Budget'), typeof h('% complete'), h('Start date')]).toEqual(['Steel erection — Bays 3–4', 'number', 'number', expect.stringMatching(/^2026-\d\d-\d\d$/)]);
    expect(String(h('Predecessors'))).toMatch(/^A\d{4} (FS|SS|FF|SF)/);
  });

  it('risks: sorted by score, the category chip filters; PDF register report', async () => {
    const [r] = await sheetsOf('risks', 'director', 'code=HLT-026');
    const scores = col(r.rows, 'Score') as number[];
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
    expect(r.rows[1][0]).toBe('R-03');
    const all = r.rows.length;
    const [f] = await sheetsOf('risks', 'director', 'code=HLT-026&filter=supplier_delivery');
    expect(f.rows.length).toBeLessThan(all);
    const { text } = await pdfOf('risks', 'director', 'code=HLT-026');
    expect(text).toContain('Registre des risques');
    expect(text).toContain('R-03');
  });

  it('orders: purchase orders with real euro values and their lines; status chip filters', async () => {
    const [po, lines] = await sheetsOf('orders', 'director', 'code=HLT-026');
    expect(po.name).toBe('Purchase orders');
    expect(col(po.rows, 'Order')).toContain('PO-1082');
    expect(typeof po.rows[1][po.rows[0].indexOf('Value')]).toBe('number');
    expect(lines.rows.length).toBeGreaterThan(po.rows.length - 1);
    const [received] = await sheetsOf('orders', 'director', 'code=HLT-026&status=received');
    expect(new Set(col(received.rows, 'Status'))).toEqual(new Set(['Received']));
  });

  it('projects map, overview, cash: the zone bar restricts the rows', async () => {
    const [all] = await sheetsOf('worldmap', 'director', '');
    const [afr] = await sheetsOf('worldmap', 'director', 'zone=afr');
    expect(afr.rows.length).toBeLessThan(all.rows.length);
    const [cash] = await sheetsOf('cash', 'director', '');
    expect(col(cash.rows, 'Code')).toContain('HLT-026');
    expect(cash.rows[0]).toContain('Margin');
  });

  it('documents register: the filtered view, or only the ticked documents', async () => {
    const [reg] = await sheetsOf('docs', 'director', 'code=HLT-026');
    expect(reg.rows.length).toBeGreaterThan(3);
    const pick = col(reg.rows, 'Document').slice(0, 2) as string[];
    const [sel] = await sheetsOf('docs', 'director', `code=HLT-026&numbers=${pick.join(',')}`);
    expect(col(sel.rows, 'Document')).toEqual(pick);
  });
});

describe('rights', () => {
  it('rates are left out for the roles that do not see them (rate cards, task, what-if levers)', async () => {
    const [rd, md] = await sheetsOf('rates', 'director', '');
    const [rm, mm] = await sheetsOf('rates', 'member', '');
    expect(rd.rows[0]).toContain('Hourly rate');
    expect(typeof rd.rows[1][rd.rows[0].indexOf('Hourly rate')]).toBe('number');
    expect(rm.rows[0]).not.toContain('Hourly rate');
    expect(md.rows[0]).toContain('Multiplier');
    expect(mm.rows[0]).not.toContain('Multiplier');
    expect(rm.rows.length).toBe(rd.rows.length);
    const [td] = await sheetsOf('task', 'pm', 'task=T-2314');
    const [tm] = await sheetsOf('task', 'quality', 'task=T-2314');
    expect(col(td.rows, 'Field')).toContain('Hourly rate (€)');
    expect(col(tm.rows, 'Field')).not.toContain('Hourly rate (€)');
    const lev = async (role: RoleKey) => (await sheetsOf('whatif', role, 'project=HLT-026')).find((x) => x.name === 'Levers')!;
    expect((await lev('director')).rows[0]).toContain('Hourly rate');
    expect((await lev('procurement')).rows[0]).not.toContain('Hourly rate');
  });

  it('a client exports only its organisation’s projects, everywhere', async () => {
    const [map] = await sheetsOf('worldmap', 'client', '');
    expect(map.rows.length - 1).toBe(3);
    const [ov] = await sheetsOf('overview', 'client', '');
    expect(new Set(col(ov.rows, 'Code'))).toEqual(new Set(['HLT-026']));
    const req = (await sheetsOf('requests', 'client', ''))[0];
    expect(col(req.rows, 'Project').every((c) => c === 'HLT-026')).toBe(true);
    await expect(ctxOf('orders', 'client', 'code=NDC-031')).rejects.toMatchObject({ status: 403 });
    const own = await sheetsOf('client', 'client', 'code=HLT-026&tab=invoices');
    expect(own[0].name).toBe('Invoices');
  });

  it('requests: the viewer’s own unless the screen shows them all', async () => {
    const [d] = await sheetsOf('requests', 'director', '');
    const [pm] = await sheetsOf('requests', 'pm', '');
    expect(pm.rows.length).toBeLessThanOrEqual(d.rows.length);
    expect(new Set(col(pm.rows, 'Requested by'))).toEqual(new Set(['R. Aubert']));
  });
});

describe('PDF documents', () => {
  it('purchase order: header, lines and total, signatures; another project’s order is refused', async () => {
    const { text, file } = await pdfOf('orders', 'director', 'code=HLT-026&variant=po&id=PO-1082');
    expect(file.fileName).toBe('po-HLT-026-PO-1082-2026-10-09.pdf');
    expect(text).toContain('Commande d’achat PO-1082');
    expect(text).toContain('Cotswold Fire Systems');
    expect(text).toContain('Total HT');
    expect(text).toContain('Accusé de réception fournisseur');
    await expect(runExport(await ctxOf('orders', 'director', 'code=NDC-031&variant=po&id=PO-1082'), 'pdf')).rejects.toMatchObject({ status: 404 });
  });

  it('goods receipt: lines with ordered / delivered / accepted, QC and signatures', async () => {
    const { text } = await pdfOf('deliveries', 'director', 'code=HLT-026&variant=receipt&id=BL-2026-0412', 'en');
    expect(text).toContain('Goods receipt BL-2026-0412');
    expect(text).toContain('Keystone Steelworks');
    expect(text).toContain('688');
    expect(text).toContain('Mill certificates checked');
    expect(text).toContain('Quality control');
  });

  it('account statement (billing report and client document) lists the invoices', async () => {
    const a = await pdfOf('billing', 'director', 'code=HLT-026');
    expect(a.text).toContain('Relevé de compte');
    expect(a.text).toContain('INV-2026-001');
    const b = await pdfOf('client', 'client', 'code=HLT-026&variant=statement');
    expect(b.text).toContain('INV-2026-001');
  });

  it('status reports: steering (trends) with the EVM indices, client without them', async () => {
    const s = await pdfOf('trends', 'director', 'code=HLT-026', 'en');
    expect(s.text).toContain('Status report');
    expect(s.text).toContain('SPI');
    expect(s.text).toContain('0.90');
    expect(s.text).toContain('Top risks');
    const k = await pdfOf('trends', 'director', 'code=HLT-026&sections=kpis', 'en');
    expect(k.text).not.toContain('Top risks');
    const c = await pdfOf('client', 'client', 'code=HLT-026&variant=status&period=quarter', 'en');
    expect(c.text).toContain('Q3 2026');
    expect(c.text).not.toContain('CPI');
    expect(c.text).toContain('Progress & milestones');
  });

  it('trends: "Generate status report" downloads the last recorded report (its options and manager note)', async () => {
    await recordStatusReport('HLT-026', { period: 'quarter', audience: 'internal', sections: 'summary', note: 'Crane delivery under watch' }, 'Romain Aubert');
    const r = await pdfOf('trends', 'pm', 'code=HLT-026&variant=status&report=latest', 'en');
    expect(r.text).toContain('Q3 2026');
    expect(r.text).toContain('Crane delivery under watch');
    expect(r.text).not.toContain('Top risks');
  });

  it('PV de réception only for an accepted deliverable', async () => {
    const ds = await listDeliverables('HLT-026');
    const ok = ds.find((d) => d.status === 'accepted')!;
    const no = ds.find((d) => d.status !== 'accepted')!;
    const { text } = await pdfOf('quality', 'director', `code=HLT-026&variant=pv&id=${ok.number}`);
    expect(text).toContain('PV de réception');
    expect(text).toContain(ok.number);
    expect(text).toContain('Pour le client');
    await expect(runExport(await ctxOf('quality', 'director', `code=HLT-026&variant=pv&id=${no.number}`), 'pdf')).rejects.toMatchObject({ status: 404 });
  });

  it('overlay list, wear & spare parts list and meeting minutes', async () => {
    const o = await pdfOf('pid', 'director', 'code=HLT-026&variant=overlay', 'en');
    expect(o.text).toContain('Overlay list');
    expect(o.text).toContain('LT-101');
    const sp = await pdfOf('bom', 'director', 'code=HLT-026&variant=spares', 'en');
    expect(sp.text).toContain('Recommended wear & spare parts');
    const m = await pdfOf('meetings', 'director', 'code=HLT-026&meeting=MTG-118', 'en');
    expect(m.text).toContain('Minutes');
    expect(m.text).toContain('Participants');
  });
});
