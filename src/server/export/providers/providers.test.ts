// Export providers (chapter 4, exports feature): every screen of the registry has a provider; each one exports HLT-026 (or
// its global table) for the portfolio director as a real Excel workbook and a CSV; the documents (purchase order, goods
// receipt, account statement, status report, PV de réception) and the PDF reports carry their key figures; rights follow
// the screens (masked rates, client restricted to its organisation's projects).
import ExcelJS from 'exceljs';
import { beforeAll, describe, expect, it } from 'vitest';
import { isOutside } from '@/components/app/shell/nav-model';
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

  // A masked-rate role (member: no hourly rates, no premium multipliers) — every screen, rates left out of every sheet.
  it.each(SCREENS.map((s) => s.id))('%s: Excel opens without rate columns for a masked-rate role (member)', async (screen) => {
    const ctx = await ctxOf(screen, 'member', queryOf(screen));
    expect(ctx.ratesMasked).toBe(true);
    const x = await runExport(ctx, 'xlsx');
    expect(Buffer.from(x.body.subarray(0, 2)).toString('latin1')).toBe('PK');
    const sheets = await readXlsx(x.body);
    expect(sheets.at(-1)!.name).toBe('Export');
    for (const sh of sheets) for (const h of ['Hourly rate', 'Hourly rate (€)', 'Multiplier']) expect(sh.rows[0] ?? [], `${screen} · ${sh.name}`).not.toContain(h);
  }, 30_000);

  // A client passing another organisation's project on a global screen gets its own project's figures instead; outside
  // their workspace a client gets 403 (P-1: "accès refusé pour le client").
  it.each(SCREENS.filter((s) => s.scope !== 'project').map((s) => s.id))('%s: a client’s ?code=<other organisation> leaks nothing', async (screen) => {
    const q = [queryOf(screen), 'code=NDC-031'].filter(Boolean).join('&');
    if (isOutside('client', screen)) {
      await expect(ctxOf(screen, 'client', q)).rejects.toMatchObject({ status: 403 });
      return;
    }
    const sheets = await sheetsOf(screen, 'client', q);
    for (const sh of sheets) for (const r of sh.rows) for (const c of r) expect(String(c ?? ''), `${screen} · ${sh.name}`).not.toMatch(/NDC-031|EWA-051|\bNDC\b/);
    // Same figures as for the client's own project (labour cost, NCR counts, home tiles…): the foreign code is ignored.
    const own = await sheetsOf(screen, 'client', [queryOf(screen), 'code=HLT-026'].filter(Boolean).join('&'));
    expect(sheets.slice(0, -1)).toEqual(own.slice(0, -1));
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
    expect((await lev('director')).rows[0]).toContain('Load change (h)'); // S-7: load delta of each lever, as the cards show it
    expect((await lev('procurement')).rows[0]).not.toContain('Hourly rate');
  });

  it('R-046 (NEW-D2-1): supplier prices are left out for the roles that do not see them (orders, PO, sourcing, stock, BOM, parts)', async () => {
    const [pp] = await sheetsOf('orders', 'procurement', 'code=HLT-026');
    expect(pp.rows[0]).toContain('Value');
    const [pq] = await sheetsOf('orders', 'quality', 'code=HLT-026');
    expect(pq.rows[0]).not.toContain('Value');
    expect(col(pq.rows, 'Order')).toContain('PO-1082');
    expect(pq.rows.length).toBe(pp.rows.length);
    const masked = [
      ...(await sheetsOf('orders', 'quality', 'code=HLT-026')), ...(await sheetsOf('procurement', 'englead', '')), ...(await sheetsOf('stock', 'member', '')),
      ...(await sheetsOf('bom', 'englead', 'code=HLT-026')), ...(await sheetsOf('plm', 'quality', '')),
    ];
    const euros = masked.flatMap((s) => s.rows.slice(1).flat()).filter((v) => typeof v === 'string' && v.includes('€'));
    expect(euros).toEqual([]);
    expect((await sheetsOf('bom', 'pm', 'code=HLT-026')).flatMap((s) => s.rows.slice(1).flat()).some((v) => typeof v === 'number')).toBe(true);
    const { text } = await pdfOf('orders', 'quality', 'code=HLT-026&variant=po&id=PO-1082', 'en');
    expect(text).toContain('PO-1082');
    expect(text).not.toMatch(/\d\s?€|€\s?\d/);
  });

  it('R-043 (P-10b): the client’s meetings export holds the external meetings only, without the client-questions bridge', async () => {
    const d = await sheetsOf('meetings', 'director', 'code=HLT-026');
    const c = await sheetsOf('meetings', 'client', 'code=HLT-026');
    expect(d.map((s) => s.name)).toContain('Client questions');
    expect(c.map((s) => s.name)).not.toContain('Client questions');
    const types = new Set(col(c[0].rows, 'Type'));
    expect(c[0].rows.length).toBeLessThan(d[0].rows.length);
    expect(types.size).toBe(1);
    const internal = col(d[0].rows, 'Meeting').find((n, i) => !types.has(col(d[0].rows, 'Type')[i]))!;
    // An internal meeting asked by number falls back to the client's own (external) meetings — never its minutes.
    const f = await runExport(await ctxOf('meetings', 'client', `code=HLT-026&meeting=${internal}`), 'pdf', { compressPdf: false });
    const text = pdfTextLines(f.body).join('\n');
    expect(text).not.toContain(String(internal));
    expect(col(c[0].rows, 'Meeting').some((n) => text.includes(String(n)))).toBe(true);
  });

  it('a client exports only its organisation’s projects, and nothing outside their workspace (P-1)', async () => {
    for (const screen of ['worldmap', 'overview', 'requests', 'task', 'mtypes', 'eco', 'plan', 'budget'] as const)
      await expect(ctxOf(screen, 'client', screen === 'task' ? 'task=T-2331' : 'code=HLT-026'), screen).rejects.toMatchObject({ status: 403 });
    await expect(ctxOf('orders', 'client', 'code=NDC-031')).rejects.toMatchObject({ status: 403 });
    await expect(ctxOf('trends', 'client', 'code=NDC-031')).rejects.toMatchObject({ status: 403 });
    const [home] = await sheetsOf('home', 'client', '');
    expect(home.rows.length).toBeGreaterThan(0);
    const own = await sheetsOf('client', 'client', 'code=HLT-026&tab=invoices');
    expect(own[0].name).toBe('Invoices');
  });

  it('the machine-type and ECO "Projects" columns keep the client filter (defence in depth behind P-1)', async () => {
    const own = /^(HLT|PRS|QFR)-/;
    // P-1 refuses these screens to the client; the providers still filter for a client context built directly.
    const asClient = async (screen: 'mtypes' | 'eco') => {
      const ctx = await ctxOf(screen, 'director', '');
      return readXlsx((await runExport({ ...ctx, viewer: PERSONA_BY_ROLE.client }, 'xlsx')).body);
    };
    const [mt] = await asClient('mtypes');
    const [mtd] = await sheetsOf('mtypes', 'director', '');
    const codes = (rows: (string | number | boolean | null)[][]) => col(rows, 'Projects').flatMap((v) => String(v ?? '').split(' · ').filter(Boolean));
    expect(codes(mtd.rows).some((c) => !own.test(c))).toBe(true);
    expect(codes(mt.rows).every((c) => own.test(c))).toBe(true);
    const [eco] = await asClient('eco');
    expect(codes(eco.rows).every((c) => own.test(c) || /^(HLT|PRS|QFR)$/.test(c))).toBe(true);
  });

  it('requests: the viewer’s own unless the screen shows them all', async () => {
    const [d] = await sheetsOf('requests', 'director', '');
    const [pm] = await sheetsOf('requests', 'pm', '');
    expect(pm.rows.length).toBeLessThanOrEqual(d.rows.length);
    expect(new Set(col(pm.rows, 'Requested by'))).toEqual(new Set(['R. Aubert']));
  });
});

describe('typed columns (real dates and percentages in Excel)', () => {
  const cellsOf = async (screen: ScreenId, query: string, sheetName: string, header: string) => {
    const x = await runExport(await ctxOf(screen, 'director', query), 'xlsx');
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(Buffer.from(x.body) as unknown as ExcelJS.Buffer);
    const ws = book.worksheets.find((w) => w.name === sheetName)!;
    const i = (ws.getRow(1).values as unknown[]).indexOf(header);
    return ws.getColumn(i).values.slice(2).filter((v) => v != null);
  };
  it('requests start / due / sent, my projects milestone and finish, client milestones are dates; weights share is a percent', async () => {
    for (const h of ['Start date', 'Due', 'Sent']) expect((await cellsOf('requests', '', 'Resource requests', h)).every((v) => v instanceof Date), h).toBe(true);
    const ms = await cellsOf('myprojects', '', 'My projects', 'Milestone date');
    expect(ms.length).toBeGreaterThan(0);
    expect(ms.every((v) => v instanceof Date)).toBe(true);
    expect((await cellsOf('myprojects', '', 'My projects', 'Forecast finish')).some((v) => v instanceof Date)).toBe(true);
    for (const h of ['Baseline', 'Forecast']) expect((await cellsOf('client', 'code=HLT-026', 'Milestones', h)).every((v) => v instanceof Date), h).toBe(true);
    const share = await cellsOf('portfolio', '', 'Weights', 'Share');
    expect(share.length).toBeGreaterThan(0);
    expect(share.every((v) => typeof v === 'number' && v >= 0 && v <= 1)).toBe(true);
  });
});

describe('PDF documents', () => {
  it('plan: the detailed plan (landscape) with the WBS rows and activities; schedule: the Gantt with bars and milestones', async () => {
    const p = await pdfOf('plan', 'director', 'code=HLT-026', 'en');
    expect(p.file.fileName).toBe('plan-HLT-026-2026-10-09.pdf');
    expect(p.text).toContain('Plan — WBS & activities');
    expect(p.text).toContain('A1250');
    expect(p.text).toContain('Steel erection — Bays 3–4');
    expect(p.file.rowCount).toBeGreaterThan(20);
    const s = await pdfOf('schedule', 'director', 'code=HLT-026', 'en');
    expect(s.text).toContain('Schedule — baseline vs forecast');
    expect(s.text).toContain('Critical path (*)');
    expect(s.text).toContain('MILESTONES');
    expect(s.text).toContain('SPI');
    const fr = await pdfOf('schedule', 'director', 'code=HLT-026', 'fr');
    expect(fr.text).toContain('Planning — référence vs prévision');
    expect(fr.text).toContain('Jalons');
  });

  it('client portal "Schedule": the Gantt PDF without the internal indicators; another organisation’s project is refused', async () => {
    const c = await pdfOf('client', 'client', 'code=HLT-026&variant=planning', 'en');
    expect(c.file.fileName).toBe('planning-HLT-026-2026-10-09.pdf');
    expect(c.text).toContain('Schedule — baseline vs forecast');
    expect(c.text).not.toContain('SPI');
    await expect(ctxOf('client', 'client', 'code=NDC-031&variant=planning')).rejects.toMatchObject({ status: 403 });
    const [wp] = await sheetsOf('client', 'client', 'code=HLT-026&tab=planning');
    expect(wp.name).toBe('Work packages');
    expect(wp.rows[0]).not.toContain('Owner');
  });

  it('FR reports: indices with a decimal comma, float in jours, "Compte rendu" for the minutes', async () => {
    const tr = await pdfOf('trends', 'director', 'code=HLT-026', 'fr');
    expect(tr.text).toContain('0,90');
    expect(tr.text).not.toMatch(/\b0\.9\d\b/);
    expect(tr.text).toMatch(/-\d+ j\b/);
    const b = await pdfOf('budget', 'director', 'code=HLT-026', 'fr');
    expect(b.text).toMatch(/\b\d,\d\d\b/);
    const m = await pdfOf('meetings', 'director', 'code=HLT-026&meeting=MTG-118', 'fr');
    expect(m.text).toContain('Compte rendu');
  });

  it('purchase order: an internal summary (SC-4b, R-097) — header, X3 reference, lines and total, no supplier signature; another project’s order is refused', async () => {
    const { text, file } = await pdfOf('orders', 'director', 'code=HLT-026&variant=po&id=PO-1082');
    expect(file.fileName).toBe('po-HLT-026-PO-1082-2026-10-09.pdf');
    expect(text).toContain('Récapitulatif de commande PO-1082');
    expect(text).toContain('Document interne — non envoyé au fournisseur');
    expect(text).toContain('Cotswold Fire Systems');
    expect(text).toContain('RÉFÉRENCE SAGE X3');
    expect(text).toContain('Importée de Sage X3');
    expect(text).toContain('Total HT');
    expect(text).toContain('est édité par Sage X3');
    // SC-4b = a: the legal order is Sage X3's — no supplier acknowledgement, no instructions to the supplier.
    expect(text).not.toContain('Accusé de réception fournisseur');
    expect(text).not.toContain('Pour Keystone — acheteur');
    expect(text).not.toContain('merci de rappeler le numéro de commande');
    const en = await pdfOf('orders', 'director', 'code=HLT-026&variant=po&id=PO-1082', 'en');
    expect(en.text).toContain('Purchase order summary PO-1082');
    expect(en.text).not.toContain('Supplier acknowledgement');
    await expect(runExport(await ctxOf('orders', 'director', 'code=NDC-031&variant=po&id=PO-1082'), 'pdf')).rejects.toMatchObject({ status: 404 });
  });

  it('purchase order summary: an order with a Sage X3 reference names it; a local order is "not yet in Sage X3"', async () => {
    const { getDb } = await import('@/server/db/client');
    const { purchaseOrders } = await import('@/server/db/schema');
    const { eq } = await import('drizzle-orm');
    const db = await getDb();
    const [o] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.number, 'PO-1082'));
    try {
      await db.update(purchaseOrders).set({ x3Ref: 'X3-PO-1082' }).where(eq(purchaseOrders.id, o.id));
      expect((await pdfOf('orders', 'director', 'code=HLT-026&variant=po&id=PO-1082', 'en')).text).toContain('Sage X3 order X3-PO-1082');
      await db.update(purchaseOrders).set({ x3Ref: null, origin: 'shortfall' }).where(eq(purchaseOrders.id, o.id));
      expect((await pdfOf('orders', 'director', 'code=HLT-026&variant=po&id=PO-1082', 'en')).text).toContain('Not yet in Sage X3');
    } finally {
      await db.update(purchaseOrders).set({ x3Ref: o.x3Ref, origin: o.origin }).where(eq(purchaseOrders.id, o.id));
    }
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
