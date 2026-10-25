// R-034 (A-15, R-021 as built): the Sage X3 mock is honest. On a demo database "Import from X3" and the two "Push to X3"
// keep working and say they are simulated (toast, audit, activity); on a production database — or when IT disabled
// "Sage X3" in the connectors file (D-7a) — the three buttons are not rendered and the Server Functions and the writers
// refuse them ("Sage X3 is not connected"): no x3_sync_runs row, no pushed movement, no fake X3 reference. The 8 personas on
// the demo import; the production wording of the stock KPIs, the stock drawer note and the order drawer's Sage X3 line.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const session = { role: 'procurement' as string, lang: 'en' as 'en' | 'fr' };
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({
  redirect: () => {
    throw new Error('NEXT_REDIRECT');
  },
  notFound: () => {
    throw new Error('NOT_FOUND');
  },
  usePathname: () => '/',
  useRouter: () => ({ push() {}, replace() {}, refresh() {} }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/server/session', async () => {
  const { makeT } = await import('@/i18n/translate');
  const { PERSONA_BY_ROLE } = await import('@/config/personas');
  return {
    getViewer: async () => PERSONA_BY_ROLE[session.role as keyof typeof PERSONA_BY_ROLE],
    getI18n: async () => ({ lang: session.lang, t: makeT(session.lang) }),
    getLang: async () => session.lang,
    getLastProject: async () => 'HLT-026',
    getZone: async () => null,
    getNavOpen: async () => ({}),
  };
});

import { eq, sql } from 'drizzle-orm';
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import StockPage from '@/app/(app)/purchasing/stock/page';
import { PERSONAS } from '@/config/personas';
import { makeT } from '@/i18n/translate';
import { getDb, setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { connectors, x3SyncRuns } from '@/server/db/schema';
import type { DB } from '@/server/db/types';
import { listActivity, listAudit } from '@/server/dal/notifications';
import { getOrdersScreen, pushPurchaseOrderToX3 } from '@/server/dal/orders';
import { approvePurchaseOrder, createDraftPurchaseOrders, submitPurchaseOrder } from '@/server/dal/purchasing';
import { getStockPosition, importStockFromX3, listStock, pushStockToX3 } from '@/server/dal/stock';
import { x3Simulated } from '@/server/integrations/x3/mock-mode';
import { pushOrderToX3Action } from '@/features/orders/actions';
import { ordersView } from '@/features/orders/model';
import { importFromX3Action, pushStockLineAction } from './actions';
import type { StockUrlState } from './links';
import { stockDrawerView, stockScreenView } from './model';

type El = ReactElement<Record<string, unknown> & { children?: ReactNode }>;
function parts(tree: unknown): Record<string, El> {
  const out: Record<string, El> = {};
  const kids = (tree as El).props.children;
  for (const k of (Array.isArray(kids) ? kids : [kids]) as unknown[]) if (isValidElement(k) && typeof k.type === 'function') out[(k.type as { name: string }).name] = k as El;
  return out;
}
const stockPage = async (sp: Record<string, string> = {}) => parts(await StockPage({ searchParams: Promise.resolve(sp) }));
const runs = async () => (await (await getDb()).select({ n: sql<number>`count(*)::int` }).from(x3SyncRuns))[0].n;
const as = (role: string, lang: 'en' | 'fr' = 'en') => {
  session.role = role;
  session.lang = lang;
};
const STATE: StockUrlState = { loc: null, q: '', stock: null, part: null };

describe('R-034 on a demo database: the X3 actions are simulated and say so', () => {
  let demo: DB;
  beforeAll(async () => {
    demo = await openDatabase();
    setDb(demo);
  }, 60_000);
  beforeEach(() => as('procurement'));

  it('every persona: the Stock editors run the simulated import; the others are refused', async () => {
    expect(await x3Simulated()).toBe(true);
    const outcome: Record<string, string> = {};
    for (const p of PERSONAS) {
      as(p.role);
      try {
        const r = await importFromX3Action();
        outcome[p.role] = 'error' in r ? r.error : (r.toast ?? '').split(' · ')[0];
      } catch (e) {
        outcome[p.role] = (e as Error).message;
      }
    }
    expect(outcome).toEqual({
      director: 'Simulated import (Sage X3 not connected)', pm: 'Simulated import (Sage X3 not connected)', depthead: 'Stock is read-only for you',
      member: 'Stock is read-only for you', englead: 'Stock is read-only for you', quality: 'Simulated import (Sage X3 not connected)',
      procurement: 'Simulated import (Sage X3 not connected)', client: 'NEXT_REDIRECT',
      // R-044 (roles-rates-hr lot): Finance, the 9th persona, reads Stock only.
      finance: 'Stock is read-only for you', logistics: 'Stock is read-only for you',
    });
    expect((await listAudit({ limit: 1 }))[0]).toMatchObject({ who: 'Fabien Bertrand', object: 'Sage X3', area: 'Stock' });
    expect((await listAudit({ limit: 1 }))[0].change).toMatch(/^simulated stock import \(Sage X3 not connected\) · \d+ lines · /);
    as('procurement', 'fr');
    expect(((await importFromX3Action()) as { toast: string }).toast).toMatch(/^Import simulé \(Sage X3 non connecté\) · \d+ lignes · /);
  });

  it('the stock line push and the order push are simulated too (audit and activity say so); the buttons are rendered', async () => {
    const page = await stockPage();
    expect(((page.PageHeader.props.primary as El).type as { name: string }).name).toBe('ImportX3Button');
    const local = (await listStock()).find((s) => s.source === 'local');
    if (local) {
      const r = await pushStockLineAction(local.id);
      expect('toast' in r && r.toast).toMatch(/^Simulated push \(Sage X3 not connected\) · /);
      expect((await listAudit({ limit: 1 }))[0].change).toMatch(/^simulated stock push \(Sage X3 not connected\) · 1 lines · /);
    }
    const detail = (await getStockPosition((await listStock())[0].id))!;
    const d = stockDrawerView({ year: 2026, detail, locations: [], pins: {}, state: STATE }, makeT('en'), 'en');
    expect([d.canPush, d.x3Note]).toEqual([true, 'Local movements are flagged until the next push to X3 · X3 remains the accounting reference']);
    // A Keystone draft, approved, pushed: the toast, the audit and the activity line say "simulated".
    const [n] = await createDraftPurchaseOrders('HLT-026', 'Fabien Bertrand');
    await submitPurchaseOrder(n, 'Fabien Bertrand');
    await approvePurchaseOrder(n, 'Romain Aubert');
    as('pm');
    expect(await pushOrderToX3Action('HLT-026', n)).toEqual({ ok: true, message: `${n} · Simulated push (Sage X3 not connected) · X3-${n}` });
    expect((await listAudit({ limit: 1 }))[0].change).toBe(`simulated push to Sage X3 (not connected) · X3-${n}`);
    expect((await listActivity({ kind: 'sync', limit: 1 }))[0].what).toBe(`Simulated push of ${n} to Sage X3 (not connected) · X3-${n}`);
    expect(makeT('fr')(`${n} · Simulated push (Sage X3 not connected) · X3-${n}`)).toBe(`${n} · Envoi simulé (Sage X3 non connecté) · X3-${n}`);
  });

  it('IT disables "Sage X3" (D-7a): the simulation stops on the demo database too', async () => {
    const db = await getDb();
    await db.update(connectors).set({ enabled: false }).where(eq(connectors.name, 'Sage X3'));
    try {
      expect(await x3Simulated()).toBe(false);
      const before = await runs();
      expect(await importFromX3Action()).toEqual({ error: 'Sage X3 is not connected' });
      await expect(importStockFromX3('Fabien Bertrand')).rejects.toThrow('Sage X3 is not connected');
      expect(await runs()).toBe(before);
      expect((await stockPage()).PageHeader.props.primary).toBeUndefined();
    } finally {
      await db.update(connectors).set({ enabled: true }).where(eq(connectors.name, 'Sage X3'));
    }
    expect(await x3Simulated()).toBe(true);
  });
});

describe('R-034 on a production database: Sage X3 is not connected', () => {
  beforeAll(async () => {
    setDb(await openDatabase(undefined, undefined, { seed: 'production' }));
  }, 60_000);
  beforeEach(() => as('procurement'));

  it('the Server Functions and the writers refuse the three actions; nothing reaches the data', async () => {
    expect(await x3Simulated()).toBe(false);
    expect(await importFromX3Action()).toEqual({ error: 'Sage X3 is not connected' });
    expect(await pushStockLineAction('00000000-0000-4000-8000-000000000000')).toEqual({ error: 'Sage X3 is not connected' });
    as('procurement', 'fr');
    expect(await importFromX3Action()).toEqual({ error: 'Sage X3 n’est pas connecté' });
    await expect(importStockFromX3('Fabien Bertrand')).rejects.toThrow('Sage X3 is not connected');
    await expect(pushStockToX3('Fabien Bertrand')).rejects.toThrow('Sage X3 is not connected');
    await expect(pushPurchaseOrderToX3('PO-1100', 'Fabien Bertrand')).rejects.toThrow('Sage X3 is not connected');
    expect(await runs()).toBe(0);
    expect((await listAudit({ limit: 5 })).filter((a) => a.object === 'Sage X3')).toEqual([]);
  });

  it('the buttons are not rendered; the KPIs and the drawers say Sage X3 is not connected', async () => {
    as('director');
    const page = await stockPage();
    expect(page.PageHeader.props.primary).toBeUndefined();
    const v = stockScreenView({ year: 2026, rows: [], locations: [], sync: null, moves: [], pins: {}, state: STATE, x3: false }, makeT('en'), 'en');
    expect(v.kpis.slice(3).map((k) => [k.label, k.value, k.sub])).toEqual([['X3 import', '—', 'Sage X3 not connected'], ['Local changes', '0', 'Sage X3 not connected']]);
    expect(stockScreenView({ year: 2026, rows: [], locations: [], sync: null, moves: [], pins: {}, state: STATE, x3: false }, makeT('fr'), 'fr').kpis[4].sub).toBe('Sage X3 non connecté');
  });
});

describe('R-034 production wording of the drawers (demo data shown as a production database would)', () => {
  beforeAll(async () => {
    setDb(await openDatabase());
  }, 60_000);

  it('order drawer: no "Push to X3", the Sage X3 line does not promise a push; stock drawer: no push, a plain note', async () => {
    const [n] = await createDraftPurchaseOrders('HLT-026', 'Fabien Bertrand');
    await submitPurchaseOrder(n, 'Fabien Bertrand');
    await approvePurchaseOrder(n, 'Romain Aubert');
    const data = await getOrdersScreen('HLT-026', 'Romain Aubert');
    const on = ordersView({ code: 'HLT-026', data, filter: null, selected: n }, makeT('en'), 'en').drawer!;
    expect([on.canPush, on.meta.at(-1)!.v]).toEqual([true, 'Local change · not yet pushed to X3']);
    const off = ordersView({ code: 'HLT-026', data, filter: null, selected: n, x3: false }, makeT('fr'), 'fr').drawer!;
    expect([off.canPush, off.meta.at(-1)!.v, off.meta.at(-1)!.color]).toEqual([false, 'Absente de Sage X3 · Sage X3 non connecté', 'var(--color-text)']);
    const detail = (await getStockPosition((await listStock())[0].id))!;
    const d = stockDrawerView({ year: 2026, detail, locations: [], pins: {}, state: STATE, x3: false }, makeT('fr'), 'fr');
    expect([d.canPush, d.x3Note]).toEqual([false, 'Sage X3 non connecté · les mouvements sont enregistrés dans Keystone seulement']);
  });
});
