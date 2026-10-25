'use client';
// R-158 lot A (owner's decision 9): Settings › Incoterms — the 11 Incoterms 2020 seeded in both seeds and those an administrator
// adds, each with its name and description in both languages, its modes and its split of the 10 steps between the seller (EPC2i)
// and the buyer. The Settings editors (the portfolio director, A-14) add, edit, remove (deleted when unused and added in
// Keystone, else deactivated) and reactivate; the other roles read. Texts arrive in the viewer's language from the page.
import { ArrowCounterClockwise, PencilSimple, Plus, ShippingContainer, X } from '@phosphor-icons/react/dist/ssr';
import { useState, useTransition } from 'react';
import { FormDialog } from '@/components/app/FormDialog';
import type { FormDef, FormValues } from '@/components/app/form-def';
import { Button } from '@/components/ds/Button';
import { cx } from '@/components/ds/cx';
import { showToast } from '@/components/ds/Toast';
import { useI18n } from '@/i18n/client';
import { reactivateIncotermAction, removeIncotermAction, saveIncotermAction, type AdminActionResult } from './actions';
import s from './admin.module.css';

export interface IncotermRowView {
  code: string;
  name: string;
  description: string;
  modes: string;
  split: { label: string; seller: boolean }[];
  standard: boolean;
  active: boolean;
  usedBy: number;
  form: FormValues;
}

async function attempt(p: Promise<AdminActionResult>): Promise<boolean> {
  try {
    const r = await p;
    if ('error' in r) {
      showToast(r.error);
      return false;
    }
    if (r.toast) showToast(r.toast);
    return true;
  } catch (e) {
    showToast(e instanceof Error ? e.message : String(e));
    return false;
  }
}

export function IncotermsCard({ rows, canEdit, createForm, editForm }: { rows: IncotermRowView[]; canEdit: boolean; createForm: FormDef; editForm: FormDef }) {
  const { t } = useI18n();
  const [dialog, setDialog] = useState<{ mode: 'create' | 'update'; values?: FormValues } | null>(null);
  const [pending, startTransition] = useTransition();
  const run = (p: () => Promise<AdminActionResult>) => startTransition(async () => { await attempt(p()); });
  return (
    <div className={cx('card', 'elev-sm', s.incoterms)}>
      <div className={s.incotermsHead}>
        <ShippingContainer className={s.accent} aria-hidden />
        <div className={s.healthTitle}>
          <div className="card-title">{t('Incoterms')}</div>
          <span className={s.muted12}>{t('Incoterms 2020 and the split of each step between the seller (EPC2i) and the buyer · the contract’s Incoterm organises its shipments')}</span>
          <span className={s.muted12}>{t('Highlighted steps are the seller’s (EPC2i)')}</span>
        </div>
        {canEdit && (
          <Button variant="secondary" size="sm" icon={Plus} nowrap push onClick={() => setDialog({ mode: 'create' })}>
            {t('Add Incoterm')}
          </Button>
        )}
      </div>
      <div className={s.incotermList}>
        {rows.map((r) => (
          <div key={r.code} className={cx(s.incotermRow, !r.active && s.incotermInactive)}>
            <div className={s.incotermTop}>
              <span className={s.incotermCode}>{r.code}</span>
              <span className={s.incotermName}>{r.name}</span>
              <span className={s.muted12}>{r.modes}</span>
              {!r.standard && <span className="tag tag-outline">{t('Added in Keystone')}</span>}
              {!r.active && <span className="tag tag-neutral">{t('Inactive')}</span>}
              {r.usedBy > 0 && <span className={s.muted12}>{r.usedBy} {t(r.usedBy > 1 ? 'contracts' : 'contract')}</span>}
              {canEdit && (
                <span className={s.incotermActions}>
                  <Button variant="ghost" size="mini" icon={PencilSimple} nowrap disabled={pending} aria-label={`${t('Edit')} · ${r.code}`} onClick={() => setDialog({ mode: 'update', values: r.form })}>
                    {t('Edit')}
                  </Button>
                  {r.active ? (
                    <Button variant="ghost" size="mini" icon={X} nowrap disabled={pending} aria-label={`${t('Remove')} · ${r.code}`} onClick={() => run(() => removeIncotermAction(r.code))}>
                      {t('Remove')}
                    </Button>
                  ) : (
                    <Button variant="ghost" size="mini" icon={ArrowCounterClockwise} nowrap disabled={pending} aria-label={`${t('Reactivate')} · ${r.code}`} onClick={() => run(() => reactivateIncotermAction(r.code))}>
                      {t('Reactivate')}
                    </Button>
                  )}
                </span>
              )}
            </div>
            {r.description && <p className={s.incotermDesc}>{r.description}</p>}
            <div className={s.incotermSplit}>
              {r.split.map((st) => (
                <span key={st.label} className={st.seller ? s.incotermSeller : s.incotermBuyer}>{st.label}</span>
              ))}
            </div>
          </div>
        ))}
      </div>
      {dialog && (
        <FormDialog
          {...(dialog.mode === 'create' ? createForm : editForm)}
          open
          onClose={() => setDialog(null)}
          initialValues={dialog.values}
          onSubmit={async (v) => {
            const r = await saveIncotermAction(dialog.mode, dialog.mode === 'update' ? { ...v, code: dialog.values?.code ?? '' } : v);
            return 'error' in r ? { error: r.error } : { toast: r.toast };
          }}
        />
      )}
    </div>
  );
}
