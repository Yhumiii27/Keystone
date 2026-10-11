'use client';
// "Create spares purchase order" dialog (chapter 4; Project BOM › PU/PR list, E-3 — rules in src/domain/spares-order.ts).
// Opens on the lines of the list as displayed (system and PU/PR filter), loaded from the server: pre-selected where stock
// plus open spares orders fall short of the recommended quantity, with the suggested quantity; the user ticks lines and
// edits quantities. "Create draft purchase orders" drafts one order per preferred supplier in Keystone purchasing, then
// opens the first one on Purchase orders (where the PM sends it for approval).
import { Check, Warning } from '@phosphor-icons/react/dist/ssr';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import { Callout } from '@/components/app/Callout';
import { CheckSquare } from '@/components/app/Check';
import { Button } from '@/components/ds/Button';
import { Dialog } from '@/components/ds/Dialog';
import { DialogActions } from '@/components/ds/DialogParts';
import { Input } from '@/components/ds/Field';
import { Table, Td, Th } from '@/components/ds/Table';
import { showToast } from '@/components/ds/Toast';
import { cx } from '@/components/ds/cx';
import { SPARES_ORDER_MAX_QTY, groupBySupplier, sparesOrderValue } from '@/domain/spares-order';
import { useI18n } from '@/i18n/client';
import { moneyEur } from '@/lib/format';
import { createSparesOrderAction, loadSparesOrderAction, type SparesOrderView } from './spares-order-actions';
import { sparesOrderSummaryText } from './spares-order-text';
import s from './spares-order.module.css';

export interface SparesOrderScope {
  code: string;
  /** `?sys=` of the screen (null = complete system) and `?kind=` (PU / PR / all). */
  system: string | null;
  kind: 'PU' | 'PR' | null;
}

interface Pick {
  on: boolean;
  qty: string;
}

/** Mounted while open (fresh state on every opening); loads its lines on mount. */
export function SparesOrderDialog({ scope, onClose }: { scope: SparesOrderScope; onClose: () => void }) {
  const { t, lang } = useI18n();
  const router = useRouter();
  const [view, setView] = useState<SparesOrderView | null>(null);
  const [picks, setPicks] = useState<Record<string, Pick>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, startLoading] = useTransition();
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    startLoading(async () => {
      try {
        const r = await loadSparesOrderAction(scope.code, scope.system, scope.kind);
        if (!r.ok) return setError(r.error);
        setView(r.view);
        setPicks(Object.fromEntries(r.view.lines.map((l) => [l.ref, { on: l.preselected, qty: String(Math.max(1, l.suggestedQty)) }])));
      } catch {
        setError(t('The change could not be saved'));
      }
    });
  }, [scope.code, scope.system, scope.kind, t]);

  const chosen = (view?.lines ?? [])
    .filter((l) => picks[l.ref]?.on && l.supplier)
    .map((l) => ({ ref: l.ref, qty: Number(picks[l.ref].qty), supplier: l.supplier!, unitPriceEur: l.unitPriceEur }));
  const invalid = chosen.some((l) => !Number.isInteger(l.qty) || l.qty < 1 || l.qty > SPARES_ORDER_MAX_QTY);
  const orders = groupBySupplier(chosen).length;

  const set = (ref: string, p: Partial<Pick>) => setPicks((cur) => ({ ...cur, [ref]: { ...cur[ref], ...p } }));

  const submit = () => {
    if (!chosen.length || invalid || pending) return;
    setError(null);
    startTransition(async () => {
      try {
        const r = await createSparesOrderAction(scope.code, { system: scope.system, kind: scope.kind, lines: chosen.map(({ ref, qty }) => ({ ref, qty })) });
        if (!r.ok) return setError(r.error);
        showToast(r.toast);
        onClose();
        router.push(r.href);
      } catch {
        setError(t('The change could not be saved'));
      }
    });
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('Create spares purchase order')}
      subtitle={view ? `${view.systemName} · ${t('One draft purchase order per preferred supplier')}` : t('One draft purchase order per preferred supplier')}
      width={720}
      offsetTop="6vh"
      maxHeight="88vh"
    >
      {!view && !error && <span className={s.muted}>{loading ? t('Loading…') : ''}</span>}
      {view && (
        <div className={s.tableWrap}>
          <Table scroll={false}>
            <thead>
              <tr>
                <Th>
                  <span className={s.srOnly}>{t('Select')}</span>
                </Th>
                <Th>{t('Reference')}</Th>
                <Th>{t('Supplier')}</Th>
                <Th align="right">{t('Recommended qty')}</Th>
                <Th align="right">{t('Stock')}</Th>
                <Th align="right">{t('On order')}</Th>
                <Th align="right">{t('Quantity')}</Th>
                <Th align="right">{t('Unit price')}</Th>
              </tr>
            </thead>
            <tbody>
              {view.lines.map((l) => {
                const p = picks[l.ref] ?? { on: false, qty: '1' };
                const orderable = !!l.supplier;
                return (
                  <tr key={l.ref} className={cx(!p.on && s.off)}>
                    <td>
                      <button
                        type="button"
                        role="checkbox"
                        aria-checked={p.on}
                        aria-label={`${t('Select')} ${l.ref}`}
                        className={s.check}
                        disabled={!orderable}
                        onClick={() => set(l.ref, { on: !p.on })}
                      >
                        <CheckSquare done={p.on} />
                      </button>
                    </td>
                    <td>
                      <span className={s.ref}>
                        {l.ref} · {l.kind}
                      </span>
                      <span className={s.name}>{l.name}</span>
                      {!!l.warnings.length && <span className={s.warn}>{l.warnings.join(' · ')}</span>}
                    </td>
                    <td className={s.supplier}>{l.supplier ?? '—'}</td>
                    <Td align="right" numeric>
                      {l.recommendedQty}
                    </Td>
                    <Td align="right" numeric>
                      {l.inStock}
                    </Td>
                    <Td align="right" numeric>
                      {l.onOrder}
                    </Td>
                    <Td align="right">
                      <Input
                        size="cell"
                        numeric
                        alignRight
                        className={s.qty}
                        type="number"
                        min={1}
                        max={SPARES_ORDER_MAX_QTY}
                        step={1}
                        value={p.qty}
                        disabled={!p.on}
                        aria-label={`${t('Quantity')} ${l.ref}`}
                        onChange={(e) => set(l.ref, { qty: e.target.value })}
                      />
                    </Td>
                    <Td align="right" numeric>
                      {moneyEur(l.unitPriceEur, lang)}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
          {!view.lines.length && <span className={s.muted}>{t('No line in this list')}</span>}
        </div>
      )}
      {view && <span className={s.summary}>{sparesOrderSummaryText(chosen.length, orders, moneyEur(sparesOrderValue(chosen), lang), lang)}</span>}
      {invalid && <span className={s.warn}>{t('Enter a whole quantity of at least 1')}</span>}
      {error && (
        <Callout variant="emphasis" icon={Warning} role="alert">
          {error}
        </Callout>
      )}
      <DialogActions variant="flush">
        <Button variant="secondary" onClick={onClose}>
          {t('Cancel')}
        </Button>
        <Button variant="primary" icon={Check} disabled={!chosen.length || invalid || pending} aria-busy={pending || undefined} onClick={submit}>
          {t('Create draft purchase orders')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
