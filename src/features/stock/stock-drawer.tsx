'use client';
// Stock-line drawer (docs/spec/08 §4.4, template 1694–1711, `stockSel` 4488–4490): position key/values, the Movement
// form (operation segment, destination for a transfer, the pinned-part scrap warning, quantity + "Apply movement"),
// the movement history of the reference, "Part record" (`?part=`) and "Push to X3". Delivery 7: an issue names the
// activity of the current project's plan (required, SC-5a — its value goes to the activity's work package; optional on a
// return); a line reserved for another project shows what is protected and, for the director, the audited override
// (R-099); "Release reservation" is offered to the reserving project's PM and the director.
// Mounted for the whole screen so the chosen operation survives a change of row, as in the prototype (`stockOp` is not
// reset); the quantity and the destination are reset per line. The Movement form and "Push to X3" are hidden for
// viewers outside the workspace. Labels arrive translated in the view model or go through t().
import { ArrowRight, Check, Cube, LockSimple, PushPin, UploadSimple } from '@phosphor-icons/react/dist/ssr';
import { useId, useState, useTransition, type FormEvent } from 'react';
import { Button, ButtonLink } from '@/components/ds/Button';
import { cx } from '@/components/ds/cx';
import { Drawer } from '@/components/ds/Drawer';
import { Select } from '@/components/ds/Field';
import { Segmented } from '@/components/ds/Segmented';
import { showToast } from '@/components/ds/Toast';
import { KeyValueList } from '@/components/app/KeyValueList';
import { reservedForOtherText, type StockOperation } from '@/domain/stock';
import { useI18n } from '@/i18n/client';
import { applyStockMovementAction, pushStockLineAction } from './actions';
import { stockErrorT } from './i18n';
import type { StockDrawerView } from './model';
import s from './stock.module.css';

export interface StockDrawerProps {
  view: StockDrawerView | null;
  /** Current project (reserve, issue, return: the prototype's `PD.p3`). */
  projectCode: string | null;
  canEdit: boolean;
}

interface LineForm {
  id: string | null;
  qty: string;
  target: string | null;
  /** Activity of an issue / a return (code), '' when none chosen. */
  activity: string;
  /** Director override of another project's reservation (R-099). */
  override: boolean;
  error: string | null;
}

export function StockDrawer({ view, projectCode, canEdit }: StockDrawerProps) {
  const { t, lang } = useI18n();
  const [op, setOp] = useState<StockOperation>('adjust');
  const [form, setForm] = useState<LineForm>({ id: null, qty: '', target: null, activity: '', override: false, error: null });
  const [pending, start] = useTransition();
  const qtyId = useId();
  const errorId = useId();
  const activityId = useId();

  if (!view) return <Drawer open={false} />;
  // Quantity, destination and error belong to the line shown (`select` resets stockQty / stockTarget).
  const cur: LineForm = form.id === view.id ? form : { id: view.id, qty: '', target: null, activity: '', override: false, error: null };
  const patch = (p: Partial<LineForm>) => setForm({ ...cur, ...p });
  const current = view.ops.find((o) => o.value === op) ?? view.ops[0];
  const withActivity = current.value === 'issue' || current.value === 'return';
  const protectedQty = (current.value === 'issue' || current.value === 'scrap') && view.reservedForOther ? view.reservedForOther : null;

  const apply = (e?: FormEvent) => {
    e?.preventDefault();
    if (pending) return;
    start(async () => {
      const r = await applyStockMovementAction(
        view.id,
        {
          op: current.value, qty: cur.qty, target: current.value === 'transfer' ? cur.target : null, activity: withActivity ? cur.activity : null,
          override: protectedQty && view.canOverride ? cur.override : false,
        },
        projectCode,
      );
      if ('error' in r) setForm({ ...cur, error: r.error });
      else setForm({ ...cur, qty: '', override: false, error: null });
    });
  };
  const push = () =>
    start(async () => {
      const r = await pushStockLineAction(view.id);
      showToast('error' in r ? r.error : (r.toast ?? ''));
    });

  return (
    <Drawer
      open
      closeHref={view.closeHref}
      id={view.header}
      title={view.name}
      meta={<span className={cx('tag', view.sourceTone === 'neutral' ? 'tag-neutral' : 'tag-accent')}>{view.source}</span>}
    >
      <span className={s.drawerSub}>{view.locationType}</span>

      <div className={s.section}>
        <span className={s.eyebrow}>{t('Position')}</span>
        <KeyValueList items={view.meta.map((m) => ({ k: m.k, v: m.v, color: 'var(--color-text)' }))} />
      </div>

      {canEdit && (
        <form className={s.movement} onSubmit={apply} aria-label={t('Movement')}>
          <span className={s.eyebrow}>{t('Movement')}</span>
          <Segmented
            wrap
            label={t('Movement')}
            options={view.ops.map((o) => ({ value: o.value, label: o.label }))}
            value={current.value}
            onChange={(v) => {
              setOp(v);
              if (cur.error) patch({ error: null });
            }}
          />
          {withActivity && (
            <>
              <label className={s.destLabel} htmlFor={activityId}>
                {current.value === 'issue' ? t('Activity (required)') : t('Activity — credits its work package (optional)')}
                {view.projectCode ? ` · ${view.projectCode}` : ''}
              </label>
              {view.activities.length ? (
                <Select
                  id={activityId}
                  size="sm"
                  value={cur.activity}
                  required={current.value === 'issue'}
                  aria-required={current.value === 'issue' || undefined}
                  onChange={(e) => patch({ activity: e.target.value, error: null })}
                  options={[{ value: '', label: t('Choose an activity') }, ...view.activities]}
                />
              ) : (
                <span className={s.note}>{t('The current project has no plan activity: an issue cannot be recorded.')}</span>
              )}
            </>
          )}
          {protectedQty && (
            <div className={s.reservedNote}>
              <LockSimple className={s.scrapIcon} aria-hidden />
              <span className={s.scrapText}>
                {stockErrorT(reservedForOtherText(protectedQty.qty, protectedQty.project), t, lang)}
              </span>
              {view.canOverride && (
                <label className={s.override}>
                  <input type="checkbox" checked={cur.override} onChange={(e) => patch({ override: e.target.checked, error: null })} />
                  {t('Take them anyway (director override, recorded in the audit trail)')}
                </label>
              )}
            </div>
          )}
          {op === 'transfer' && (
            <>
              <span className={s.destLabel}>{t('Destination')}</span>
              <Segmented
                wrap
                label={t('Destination')}
                options={view.targets.map((o) => ({ value: o.value, label: o.label, title: o.title }))}
                value={cur.target}
                onChange={(v) => patch({ target: v, error: null })}
              />
            </>
          )}
          {op === 'scrap' && view.scrapWarning && (
            <div className={s.scrapWarn}>
              <PushPin className={s.scrapIcon} aria-hidden />
              <span className={s.scrapText}>{view.scrapWarning.text}</span>
              <ButtonLink variant="ghost" className={s.ecoBtn} href={view.scrapWarning.ecoHref} iconRight={ArrowRight}>
                ECO
              </ButtonLink>
            </div>
          )}
          <div className={s.qtyRow}>
            <label className={s.qtyLabel} htmlFor={qtyId}>
              {current.qtyLabel}
            </label>
            <input
              id={qtyId}
              className={cx('input', s.qtyInput)}
              type="number"
              inputMode="numeric"
              min={0}
              step={1}
              value={cur.qty}
              aria-invalid={cur.error ? true : undefined}
              aria-describedby={cur.error ? errorId : undefined}
              onChange={(e) => patch({ qty: e.target.value, error: null })}
            />
            <Button type="submit" variant="primary" size="sm" icon={Check} disabled={pending} aria-busy={pending || undefined}>
              {t('Apply movement')}
            </Button>
          </div>
          {cur.error && (
            <span id={errorId} className={s.error} role="alert">
              {cur.error}
            </span>
          )}
          <span className={s.note}>{view.x3Note}</span>
        </form>
      )}

      <div className={s.section}>
        <span className={s.eyebrow}>{t('Movement history')}</span>
        {view.moves.map((m) => (
          <div key={m.key} className={s.history}>
            <span className={s.historyType}>
              {m.type} × {m.qty}
            </span>
            <span className={s.historyWhere} title={m.where}>
              {m.where}
            </span>
            <span className={s.historyWhen}>{m.when}</span>
          </div>
        ))}
      </div>

      <div className={s.actions}>
        <ButtonLink variant="secondary" size="sm" icon={Cube} href={view.partHref} scroll={false}>
          {t('Part record')}
        </ButtonLink>
        {canEdit && view.canPush && (
          <Button
            variant="ghost"
            size="sm"
            icon={UploadSimple}
            disabled={pending || !view.isLocal}
            aria-busy={pending || undefined}
            title={view.isLocal ? undefined : t('Nothing to push · this line matches Sage X3')}
            onClick={push}
          >
            {t('Push to X3')}
          </Button>
        )}
      </div>
    </Drawer>
  );
}
