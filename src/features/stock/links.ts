// Stock & storages URL state (docs/spec/00 §8.3): `?loc=` location chip, `?q=` search, `?stock=` stock-line drawer
// (position id), `?part=` shared part record drawer. Links to other screens go through the screen registry.
import { screenHref } from '@/config/screens';

export interface StockUrlState {
  loc: string | null;
  q: string;
  stock: string | null;
  part: string | null;
}

/** `/purchasing/stock?…` with the given state (empty values dropped; order loc, q, stock, part). */
export function stockHref(state: Partial<StockUrlState>): string {
  const sp = new URLSearchParams();
  if (state.loc) sp.set('loc', state.loc);
  if (state.q?.trim()) sp.set('q', state.q);
  if (state.stock) sp.set('stock', state.stock);
  if (state.part) sp.set('part', state.part);
  const qs = sp.toString();
  return screenHref('stock') + (qs ? `?${qs}` : '');
}

/** ECO screen with the change order selected (the scrap warning's "ECO →"; the ECO itself is managed in Vigie). */
export const ecoHref = (number: string) => `${screenHref('eco')}?eco=${encodeURIComponent(number)}`;
