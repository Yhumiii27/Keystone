// Stock & storages Server Functions against an in-memory database: the workspace gate (roles without Stock & storages
// are refused server-side), input validation and the stock rules with their translated messages, the viewer as the
// author of the movement and of the audit row, the current project for reservations, Import from X3 (merge, toast)
// and the per-line Push to X3. The session (viewer, language) is mocked; the access rule is the real one.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RoleKey } from '@/config/screens';

const viewer = { role: 'procurement' as RoleKey, lang: 'en' as 'en' | 'fr' };
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/server/session', async () => {
  const { makeT } = await import('@/i18n/translate');
  const { PERSONA_BY_ROLE } = await import('@/config/personas');
  return {
    getI18n: async () => ({ lang: viewer.lang, t: makeT(viewer.lang) }),
    getViewer: async () => PERSONA_BY_ROLE[viewer.role],
    getLastProject: async () => 'HLT-026',
  };
});

import { revalidatePath } from 'next/cache';
import { setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { listAudit } from '@/server/dal/notifications';
import { getX3StockSync, listStock, listStockMovements, stockNavBadge } from '@/server/dal/stock';
import { applyStockMovementAction, importFromX3Action, pushStockLineAction } from './actions';

const line = async (ref: string, loc: string) => (await listStock()).find((s) => s.ref === ref && s.location === loc)!;
const CENTRAL = 'Entrepôt central — Lyon';

describe('stock Server Functions', () => {
  beforeAll(async () => {
    setDb(await openDatabase());
  }, 60_000);
  beforeEach(() => {
    viewer.role = 'procurement';
    viewer.lang = 'en';
    vi.mocked(revalidatePath).mockClear();
  });

  it('refuses viewers outside the workspace (depthead, member, englead; the client is sent home), in their language', async () => {
    const id = (await line('KS-STL-0450', CENTRAL)).id;
    // R-042 (P-1): stock is outside the client's workspace — a redirect home (NEXT_REDIRECT), nothing written.
    viewer.role = 'client';
    await expect(importFromX3Action()).rejects.toThrow('NEXT_REDIRECT');
    await expect(applyStockMovementAction(id, { op: 'adjust', qty: '5' }, 'HLT-026')).rejects.toThrow('NEXT_REDIRECT');
    for (const role of ['depthead', 'member', 'englead'] as RoleKey[]) {
      viewer.role = role;
      expect(await applyStockMovementAction(id, { op: 'adjust', qty: '5' }, 'HLT-026')).toEqual({ error: 'Stock is read-only for you' });
      expect(await importFromX3Action()).toEqual({ error: 'Stock is read-only for you' });
      expect(await pushStockLineAction(id)).toEqual({ error: 'Stock is read-only for you' });
    }
    viewer.lang = 'fr';
    expect(await importFromX3Action()).toEqual({ error: 'Le stock est en lecture seule pour vous' });
    expect((await line('KS-STL-0450', CENTRAL)).onHand).toBe(6);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('validates the input and applies the stock rules (messages translated)', async () => {
    const id = (await line('KS-STL-0450', CENTRAL)).id;
    expect(await applyStockMovementAction('', { op: 'adjust', qty: '1' }, null)).toEqual({ error: 'Invalid request' });
    expect(await applyStockMovementAction(id, null as never, null)).toEqual({ error: 'Invalid request' });
    expect(await applyStockMovementAction(id, { op: 'melt', qty: '1' }, null)).toEqual({ error: 'Invalid movement' });
    expect(await applyStockMovementAction(id, { op: 'scrap', qty: 'abc' }, null)).toEqual({ error: 'Enter a whole quantity' });
    expect(await applyStockMovementAction(id, { op: 'scrap', qty: '0' }, null)).toEqual({ error: 'Enter a quantity above 0' });
    expect(await applyStockMovementAction(id, { op: 'transfer', qty: '1' }, null)).toEqual({ error: 'Choose a destination' });
    expect(await applyStockMovementAction(id, { op: 'transfer', qty: '1', target: CENTRAL }, null)).toEqual({ error: 'The destination is the current location' });
    expect(await applyStockMovementAction(id, { op: 'transfer', qty: '1', target: 'Magasin chantier — Lyon' }, null)).toEqual({ error: 'Choose a destination' });
    expect(await applyStockMovementAction(id, { op: 'reserve', qty: '1' }, null)).toEqual({ error: 'A project is required' });
    expect(await applyStockMovementAction(id, { op: 'reserve', qty: '1' }, 'NOPE-000')).toEqual({ error: 'A project is required' });
    expect(await applyStockMovementAction(id, { op: 'issue', qty: '9' }, 'HLT-026')).toEqual({ error: `Only 6 on hand at ${CENTRAL}` });
    expect(await applyStockMovementAction(id, { op: 'reserve', qty: '3' }, 'HLT-026')).toEqual({ error: `Only 2 available at ${CENTRAL}` });
    expect(await applyStockMovementAction('00000000-0000-0000-0000-000000000000', { op: 'adjust', qty: '1' }, null)).toEqual({ error: 'Unknown stock line' });
    const msr = (await line('SG-BRK-SS2', 'Atelier mécanique — Lyon')).id;
    viewer.lang = 'fr';
    expect(await applyStockMovementAction(msr, { op: 'reserve', qty: '5' }, 'HLT-026')).toEqual({ error: 'Cette ligne est déjà réservée pour un autre projet' });
    expect(await applyStockMovementAction(id, { op: 'issue', qty: '9' }, 'HLT-026')).toEqual({ error: `Seulement 6 en stock à ${CENTRAL}` });
    expect(await applyStockMovementAction(id, { op: 'reserve', qty: '3' }, 'HLT-026')).toEqual({ error: `Seulement 2 disponibles à ${CENTRAL}` });
    expect(await applyStockMovementAction(id, { op: 'scrap', qty: '-1' }, null)).toEqual({ error: 'Saisissez une quantité entière' });
    expect((await line('KS-STL-0450', CENTRAL)).onHand).toBe(6);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('applies a movement with the viewer as author (quality), flags the line Local and revalidates', async () => {
    viewer.role = 'quality';
    const before = (await getX3StockSync())!.localLines;
    expect(await stockNavBadge()).toBe('1'); // MD-GAS-OUT
    const id = (await line('KS-STL-0450', CENTRAL)).id;
    expect(await applyStockMovementAction(id, { op: 'adjust', qty: '0' }, 'HLT-026')).toEqual({ ok: true });
    expect(await line('KS-STL-0450', CENTRAL)).toMatchObject({ onHand: 0, reserved: 0, reservedForProject: null, source: 'local', lastMovementOn: '2026-09-25' });
    expect((await listStockMovements({ limit: 1 }))[0]).toMatchObject({ type: 'adjust', qty: 0, where: `${CENTRAL} · counted`, who: 'Gabriel Comte', pendingPush: true });
    expect((await listAudit())[0]).toMatchObject({ who: 'Gabriel Comte', object: `KS-STL-0450 · ${CENTRAL}`, area: 'Stock', change: 'Adjust (count) × 0 · on hand 6 → 0 · reserved 4 → 0 · Local' });
    expect((await getX3StockSync())!.localLines).toBe(before + 1);
    expect(await stockNavBadge()).toBe('2'); // + KS-STL-0450 (0 < min 4)
    expect(revalidatePath).toHaveBeenCalledWith('/', 'layout');
    // Reserve for the current project; the destination of a transfer is created when missing.
    viewer.role = 'pm';
    const lt = (await line('LT-HB-200W', CENTRAL)).id;
    expect(await applyStockMovementAction(lt, { op: 'reserve', qty: '30' }, 'NDC-031')).toEqual({ ok: true });
    expect(await line('LT-HB-200W', CENTRAL)).toMatchObject({ reserved: 30, reservedForShort: 'NDC' });
    expect((await listStockMovements({ limit: 1 }))[0]).toMatchObject({ where: `${CENTRAL} · NDC`, who: 'Romain Aubert' });
    expect(await applyStockMovementAction(lt, { op: 'transfer', qty: '20', target: 'Consignation — Nordvolt' }, 'NDC-031')).toEqual({ ok: true });
    expect(await line('LT-HB-200W', 'Consignation — Nordvolt')).toMatchObject({ onHand: 20, source: 'local' });
  });

  it('"Import from X3" keeps the local changes; "Push to X3" sends one line and its movements', async () => {
    const local = (await listStock()).filter((s) => s.source === 'local').length;
    const r = await importFromX3Action();
    const sync = (await getX3StockSync())!;
    expect(r).toEqual({ ok: true, toast: `Imported from Sage X3 · ${sync.x3Lines} lines · ${local} local changes kept` });
    expect(sync.localLines).toBe(local);
    expect((await line('KS-STL-0450', CENTRAL)).onHand).toBe(0);
    const id = (await line('KS-STL-0450', CENTRAL)).id;
    viewer.lang = 'fr';
    expect(await pushStockLineAction(id)).toEqual({ ok: true, toast: `Envoyé vers Sage X3 · KS-STL-0450 · ${CENTRAL} · 1 mouvement` });
    expect(await line('KS-STL-0450', CENTRAL)).toMatchObject({ source: 'x3', onHand: 0 });
    expect((await getX3StockSync())!.localLines).toBe(local - 1);
    expect(await pushStockLineAction(id)).toEqual({ ok: true, toast: 'Rien à envoyer · cette ligne est à jour dans Sage X3' });
    // The pushed count survives the next import (X3 holds Keystone's value, not the seed snapshot's 6).
    await importFromX3Action();
    expect((await line('KS-STL-0450', CENTRAL)).onHand).toBe(0);
    expect(await pushStockLineAction('nope')).toEqual({ error: 'Ligne de stock inconnue' });
  });

  it('a transfer of reserved goods moves their reservation; it never lands on another project’s reservation', async () => {
    const HAVRE = 'Magasin chantier — Le Havre';
    const NORDVOLT = 'Consignation — Nordvolt';
    // KS-STL-0450 Le Havre 14 / 14 HLT → the central line (counted to 0 above, no reservation).
    expect(await line('KS-STL-0450', CENTRAL)).toMatchObject({ onHand: 0, reserved: 0 });
    expect(await applyStockMovementAction((await line('KS-STL-0450', HAVRE)).id, { op: 'transfer', qty: '6', target: CENTRAL }, 'HLT-026')).toEqual({ ok: true });
    expect(await line('KS-STL-0450', HAVRE)).toMatchObject({ onHand: 8, reserved: 8, reservedForShort: 'HLT', available: 0 });
    expect(await line('KS-STL-0450', CENTRAL)).toMatchObject({ onHand: 6, reserved: 6, reservedForShort: 'HLT', available: 0, source: 'local' });
    // EL-CBL-XLPE: the consignment line is reserved for NDC; HLT's reserved cable may not join it, free cable may.
    viewer.role = 'pm';
    expect(await applyStockMovementAction((await line('EL-CBL-XLPE', NORDVOLT)).id, { op: 'reserve', qty: '5' }, 'NDC-031')).toEqual({ ok: true });
    const xlpe = (await line('EL-CBL-XLPE', CENTRAL)).id;
    viewer.lang = 'fr';
    expect(await applyStockMovementAction(xlpe, { op: 'transfer', qty: '17', target: NORDVOLT }, null)).toEqual({ error: 'La destination est réservée pour un autre projet' });
    expect(await applyStockMovementAction(xlpe, { op: 'transfer', qty: '16', target: NORDVOLT }, null)).toEqual({ ok: true });
    expect(await line('EL-CBL-XLPE', CENTRAL)).toMatchObject({ onHand: 24, reserved: 24, reservedForShort: 'HLT' });
    expect(await line('EL-CBL-XLPE', NORDVOLT)).toMatchObject({ onHand: 36, reserved: 5, reservedForShort: 'NDC' });
  });
});
