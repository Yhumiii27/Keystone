// The Deliveries transitions run through the database writers (Register receipt, Accept → stock, Reject → quarantine)
// and rendered by the screen's view model in EN and FR, against the prototype's own render values after the same
// clicks (src/domain/deliveries.golden.json `scenarios`, renderVals() EN and FR with deepTr), plus the sidebar badge
// and the "Delivery — quality check" items of My approvals before and after a decision. Each scenario starts from a
// fresh seeded in-memory database. Deliberate deviations are asserted inline: dates not zero-padded, French
// statuses agreed with "livraison", decimal comma, nobody named as inspector before the inspection, accepted goods
// put away at the unlisted "Magasin chantier — Lyon" released to the central warehouse, and the order following its
// receipts (08 OQ7: "Open orders to receive" drops when an order is fully received).
import { describe, expect, it, vi } from 'vitest';
vi.mock('@/server/session', () => ({ getLastProject: async () => 'HLT-026' }));

import { PERSONA_BY_ROLE } from '@/config/personas';
import GOLDEN from '@/domain/deliveries.golden.json';
import { makeT, type Lang } from '@/i18n/translate';
import { getApprovalInbox } from '@/server/approvals';
import { setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { acceptReceipt, getDeliveriesScreen, receiptsQcPendingByProject, registerReceipt, rejectReceipt } from '@/server/dal/deliveries';
import { deliveriesView } from './model';

/* eslint-disable @typescript-eslint/no-explicit-any */
const G = GOLDEN as any;
const QUALITY = 'Gabriel Comte';
const PROCUREMENT = 'Fabien Bertrand';
/** Prototype dates are partly zero-padded ("02 Sep", "08 août"). */
const day = (s: string) => s.replace(/(^|· )0(\d)/g, '$1$2');
/** French statuses agreed with "livraison" (the prototype dictionary mixes genders). */
const FR_STATUS: Record<string, string> = { Accepté: 'Acceptée', Refusé: 'Refusée', Reçu: 'Reçue' };
const status = (s: string, lang: Lang) => (lang === 'fr' ? (FR_STATUS[s] ?? s) : s);
/** "0.3 % des unités reçues" → "0,3 % …" in French. */
const decimal = (s: string, lang: Lang) => (lang === 'fr' ? s.replace(/^(\d+)\.(\d)/, '$1,$2') : s);

async function fresh() {
  setDb(await openDatabase());
}

/** The screen of `code` with `receipt` open, as the prototype's snapshot shape. */
async function screen(code: string, receipt: string, lang: Lang) {
  const data = await getDeliveriesScreen(code);
  const v = deliveriesView(code, data, { status: null, receipt }, makeT(lang), lang);
  const d = v.drawer!;
  return {
    kpis: v.kpis.map((k) => ({ label: k.label, value: k.value, sub: k.sub, color: k.color })),
    chips: v.chips.map((c) => ({ label: c.label, count: c.count })),
    rows: v.rows.map((r) => ({
      id: r.id, sub: r.sub, po: r.po, supplier: r.supplier, lines: r.lines, qty: r.qty, acc: r.acc, rej: r.rej, rejColor: r.rejColor, status: r.status,
      tagClass: `tag tag-${r.tone}`, loc: r.loc, qc: r.qc, selected: r.selected, canReceive: r.canReceive, canQC: r.canQc,
    })),
    drawer: {
      head: d.head, supplier: d.supplier, status: d.status, tagClass: `tag tag-${d.tone}`, meta: d.meta, qc: d.qc, docs: d.docs, canQC: d.canQc, canReceive: d.canReceive,
      lines: d.lines.map((l) => ({ ref: l.ref, name: l.name, o: l.o, d: l.d, a: l.a, r: l.r, rColor: l.rColor, loc: l.loc })),
    },
    badge: String((await receiptsQcPendingByProject())[code] ?? ''),
  };
}

/** The prototype's snapshot in the same shape, with the rebuild's date, gender and decimal conventions. */
function expected(g: any, receipt: string, lang: Lang) {
  return {
    // A-12 (chapter 4): "On-time deliveries" is computed from the receipt and PO dates — 100 % on HLT-026 and NDC-031 (prototype 83 %).
    kpis: g.kpis.map((k: any, i: number) => ({ label: k.label, value: i === 3 ? '100%' : String(k.value), sub: decimal(k.sub, lang), color: k.color })),
    chips: g.chips.map((c: any) => ({ label: status(c.label, lang), count: c.count })),
    rows: g.rows.map((r: any) => ({
      id: r.id, sub: `${day(r.date)} · ${r.note}`, po: r.po, supplier: r.supplier, lines: r.lines, qty: r.qty, acc: r.acc, rej: r.rej, rejColor: r.rejColor,
      status: status(r.status, lang), tagClass: r.tagClass, loc: r.loc, qc: r.qc, selected: r.id === receipt, canReceive: r.canReceive, canQC: r.canQC,
    })),
    drawer: {
      head: `${g.drawer.id} · ${g.drawer.po}`, supplier: g.drawer.supplier, status: status(g.drawer.status, lang), tagClass: g.drawer.tagClass,
      meta: g.drawer.meta.map((m: any, i: number) => ({ ...m, v: i === 2 ? day(m.v) : m.v })), qc: g.drawer.qc, docs: g.drawer.docs, canQC: g.drawer.canQC,
      canReceive: g.drawer.canReceive, lines: g.drawer.lines,
    },
    badge: g.badge,
  };
}

/** Rows' put-away of `receipt` and its drawer lines moved to `loc` (expected deviation). */
const relocate = (e: any, receipt: string, loc: string) => ({
  ...e,
  rows: e.rows.map((r: any) => (r.id === receipt ? { ...r, loc } : r)),
  drawer: { ...e.drawer, lines: e.drawer.lines.map((l: any) => ({ ...l, loc })) },
});
/** KPI tile `i` with another value (expected deviation). */
const kpi = (e: any, i: number, value: string) => ({ ...e, kpis: e.kpis.map((k: any, j: number) => (j === i ? { ...k, value } : k)) });

const LANGS = ['en', 'fr'] as const;

describe('Deliveries transitions through the database vs the prototype (EN and FR)', () => {
  it('seed: the sidebar badge (receipts waiting for QC) of every project', async () => {
    await fresh();
    const badges = await receiptsQcPendingByProject();
    for (const code of Object.keys(G.seed.en)) expect([code, String(badges[code] ?? '')]).toEqual([code, G.seed.en[code].badge]);
  }, 60_000);

  it('Register receipt BL-2026-0540 (procurement, carrier Geodis): QC pending, received complete; nobody inspected yet', async () => {
    await fresh();
    await registerReceipt('BL-2026-0540', { carrier: 'Geodis' }, PROCUREMENT);
    for (const lang of LANGS) {
      const g = G.scenarios.register0540[lang];
      const e = expected(g, 'BL-2026-0540', lang);
      // The prototype wrote "Hélène Sauvage" as the inspector of every receipt it registered (00 §7.16).
      expect(g.drawer.qc[0].v).toBe('Hélène Sauvage');
      expect(await screen('HLT-026', 'BL-2026-0540', lang)).toEqual({ ...e, drawer: { ...e.drawer, qc: [{ ...e.drawer.qc[0], v: '—' }, ...e.drawer.qc.slice(1)] } });
    }
  }, 60_000);

  it.each([
    ['accept0521', QUALITY, 'accept', ''],
    ['accept0521Remarks', QUALITY, 'accept', 'Seals intact · routine test report checked'],
    ['reject0521', PROCUREMENT, 'reject', ''],
  ] as const)('%s: the viewer is the inspector; lines, put-away, QC record, KPIs, badge', async (key, who, decision, remarks) => {
    await fresh();
    await (decision === 'accept' ? acceptReceipt : rejectReceipt)('BL-2026-0521', { remarks }, who);
    for (const lang of LANGS) expect(await screen('HLT-026', 'BL-2026-0521', lang)).toEqual(expected(G.scenarios[key][lang], 'BL-2026-0521', lang));
  }, 60_000);

  it('register then accept BL-2026-0540 (quality): stocked at the Le Havre site store; PO-1078 is now received', async () => {
    await fresh();
    await registerReceipt('BL-2026-0540', { carrier: 'Geodis' }, QUALITY);
    await acceptReceipt('BL-2026-0540', {}, QUALITY);
    for (const lang of LANGS) {
      const g = G.scenarios.registerAccept0540[lang];
      expect(g.kpis[4].value).toBe(4);
      expect(await screen('HLT-026', 'BL-2026-0540', lang)).toEqual(kpi(expected(g, 'BL-2026-0540', lang), 4, '3'));
    }
  }, 60_000);

  it('NDC-031 BL-2026-0331 accepted: released from the unlisted "Magasin chantier — Lyon" to the central warehouse; rejected → quarantine', async () => {
    const id = G.scenarios.acceptNdc.id as string;
    await fresh();
    await acceptReceipt(id, {}, QUALITY);
    for (const lang of LANGS) {
      const g = G.scenarios.acceptNdc[lang];
      expect(g.drawer.lines.map((l: any) => l.loc)).toEqual(['Magasin chantier — Lyon', 'Magasin chantier — Lyon']);
      // Half of PO-3127 came in: the order stays Partially received ("Open orders to receive" unchanged).
      expect(await screen('NDC-031', id, lang)).toEqual(relocate(expected(g, id, lang), id, 'Entrepôt central — Lyon'));
    }
    await fresh();
    await rejectReceipt(id, {}, QUALITY);
    for (const lang of LANGS) expect(await screen('NDC-031', id, lang)).toEqual(expected(G.scenarios.rejectNdc[lang], id, lang));
  }, 60_000);
});

describe('"Delivery — quality check" in My approvals, through the provider (EN and FR as the inbox renders it)', () => {
  /** The inbox row as rendered: kind tag, id, t(title), t(sub), t(who) · t(when). */
  const items = async (role: 'quality' | 'procurement' | 'director' | 'pm', code: string, lang: Lang) => {
    const t = makeT(lang);
    return (await getApprovalInbox(PERSONA_BY_ROLE[role], { projectCode: code, lang })).items
      .filter((i) => i.kind === 'delivery')
      .map((i) => ({ kind: t('Delivery — quality check'), id: i.id, title: t(i.title), sub: t(i.sub), when: t(i.when), who: t(i.who) }));
  };
  const gItems = (xs: any[]) => xs.map((x) => ({ ...x, when: day(x.when) }));

  it('quality and procurement get the current project\'s receipts waiting for QC; the others none; a decided receipt leaves', async () => {
    await fresh();
    for (const lang of LANGS) {
      expect(await items('quality', 'HLT-026', lang)).toEqual(gItems(G.inbox[lang].quality));
      for (const code of ['HLT-026', 'NDC-031', 'MSR-012', 'EWA-051']) expect(await items('procurement', code, lang)).toEqual(gItems(G.inbox[lang][`procurement:${code}`]));
      for (const role of ['director', 'pm'] as const) expect(await items(role, 'HLT-026', lang)).toEqual(G.inbox[lang][role]);
    }
    await acceptReceipt('BL-2026-0521', {}, QUALITY);
    for (const lang of LANGS) expect(await items('quality', 'HLT-026', lang)).toEqual(G.inbox[lang].qualityAfterAccept);
  }, 60_000);

  it('a receipt registered in Keystone enters the queue with its receiving clerk (the viewer) and its date', async () => {
    await fresh();
    await registerReceipt('BL-2026-0540', { receivedOn: '2026-09-24' }, 'Romain Aubert');
    expect(await items('quality', 'HLT-026', 'fr')).toEqual([
      ...gItems(G.inbox.fr.quality),
      { kind: 'Livraison — contrôle qualité', id: 'BL-2026-0540', title: 'Cotswold Fire Systems · FD-DAMP-FR, FD-SPR-HD', sub: 'Reçu complet · inspection à faire', when: '24 sept.', who: 'Romain Aubert' },
    ]);
  }, 60_000);
});
