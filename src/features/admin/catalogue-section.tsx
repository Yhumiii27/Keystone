'use client';
// Machine catalogue section of the Machine types screen (R-186, AC-4): the catalogue codes built on the selected machine type,
// each with its versions — draft, published (offered to the subsidiaries through pub_catalogue_machines) or retired. The director
// and the engineering lead (choice 5) create an entry, edit and publish or discard a draft, start a new version of a published
// entry and retire the published version; the other viewers read. A published version is frozen: "New version" copies it into a
// draft. The Server Functions re-check the rights and parse the values again.
import { Archive, CheckCircle, Copy, PencilSimple, Plus, Trash } from '@phosphor-icons/react/dist/ssr';
import { useState, useTransition } from 'react';
import { FormDialog } from '@/components/app/FormDialog';
import type { FormValues } from '@/components/app/form-def';
import { Button } from '@/components/ds/Button';
import { Dialog } from '@/components/ds/Dialog';
import { DialogActions } from '@/components/ds/DialogParts';
import { Table, Th } from '@/components/ds/Table';
import { Tag } from '@/components/ds/Tag';
import { showToast } from '@/components/ds/Toast';
import { cx } from '@/components/ds/cx';
import { useI18n } from '@/i18n/client';
import type { AdminActionResult } from './actions';
import {
  createCatalogueEntryAction, discardCatalogueDraftAction, newCatalogueVersionAction, publishCatalogueVersionAction, retireCatalogueVersionAction,
  updateCatalogueDraftAction,
} from './catalogue-actions';
import { editCatalogueDraftForm, newCatalogueEntryForm, type CatalogueVersionView, type CatalogueView } from './catalogue-model';
import s from './admin.module.css';

const toForm = (r: AdminActionResult) => ('error' in r ? { error: r.error } : { toast: r.toast ?? '' });

export function CatalogueSection({ typeCode, typeLabel, view }: { typeCode: string; typeLabel: string; view: CatalogueView }) {
  const { t } = useI18n();
  const [creating, setCreating] = useState(false);
  const [pending, start] = useTransition();
  const run = (p: () => Promise<AdminActionResult>) =>
    start(async () => {
      try {
        const r = await p();
        showToast('error' in r ? r.error : r.toast ?? t('Saved'));
      } catch (e) {
        showToast(e instanceof Error ? e.message : String(e));
      }
    });
  return (
    <div className={cx('card', 'elev-sm', s.catalogueCard)} aria-busy={pending || undefined}>
      <div className={s.sectionHead}>
        <span className={s.sectionLabel}>{t('Machine catalogue')}</span>
        {view.canEdit && (
          <Button variant="ghost" icon={Plus} className={s.addBtn} onClick={() => setCreating(true)}>
            {t('New catalogue entry')}
          </Button>
        )}
      </div>
      <span className={s.catalogueHint}>
        {view.sub} · {t('Published versions are offered to the subsidiaries (CAPEX application); a published version is frozen.')}
      </span>
      {view.entries.map((e) => (
        <div key={e.code} className={s.catalogueEntry}>
          <div className={s.catalogueEntryHead}>
            <span className={s.catalogueCode}>{e.code}</span>
            {e.canNewVersion && (
              <Button variant="ghost" size="xs" icon={Copy} className={s.pushRight} disabled={pending} onClick={() => run(() => newCatalogueVersionAction(e.code))}>
                {t('New version')}
              </Button>
            )}
          </div>
          <Table size={12.5}>
            <thead>
              <tr>
                <Th>{t('Version')}</Th>
                <Th>{t('Status')}</Th>
                <Th>{t('Label')}</Th>
                <Th align="right">{t('Nominal capacity')}</Th>
                <Th align="right">{t('Indicative price')}</Th>
                <Th align="right">{t('Typical lead time')}</Th>
                <Th>{t('Options')}</Th>
                {view.canEdit && <Th aria-label={t('Actions')} />}
              </tr>
            </thead>
            <tbody>
              {e.versions.map((v) => (
                <tr key={v.version}>
                  <td className={s.catalogueNum}>v{v.version}</td>
                  <td>
                    <Tag tone={v.tone} size="sm">{v.statusText}</Tag>
                    <div className={s.catalogueSub}>{v.stamp}</div>
                  </td>
                  <td>
                    <span className={s.catalogueLabel}>
                      <span>{v.label}</span>
                      {(v.variant || v.usedBy) && <span className={s.catalogueSub}>{[v.variant, v.usedBy].filter(Boolean).join(' · ')}</span>}
                      {v.description && <span className={s.catalogueSub}>{v.description}</span>}
                    </span>
                  </td>
                  <td className={cx(s.right, s.catalogueNum)}>{v.capacity}</td>
                  <td className={cx(s.right, s.catalogueNum)}>{v.price}</td>
                  <td className={cx(s.right, s.catalogueNum)}>{v.leadTime}</td>
                  <td className={s.catalogueOptions}>{v.options.length ? v.options.map((o) => `${o.code} · ${o.label} · ${o.price}`).join(' ; ') : '—'}</td>
                  {view.canEdit && (
                    <td>
                      <VersionActions v={v} typeLabel={typeLabel} pending={pending} run={run} />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      ))}
      {!view.entries.length && <span className={s.emptyNote}>{t('No catalogue entry for this machine type yet')}</span>}
      {view.canEdit && (
        <FormDialog
          {...newCatalogueEntryForm(t)}
          open={creating}
          onClose={() => setCreating(false)}
          context={`${t('Machine type')} ${typeLabel}`}
          onSubmit={async (values: FormValues) => toForm(await createCatalogueEntryAction(typeCode, values))}
        />
      )}
    </div>
  );
}

type Run = (p: () => Promise<AdminActionResult>) => void;

function VersionActions({ v, typeLabel, pending, run }: { v: CatalogueVersionView; typeLabel: string; pending: boolean; run: Run }) {
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  return (
    <span className={s.catalogueActions}>
      {v.canEdit && (
        <>
          <Button variant="ghost" size="mini" icon={PencilSimple} nowrap onClick={() => setEditing(true)} aria-label={`${t('Edit draft')} ${v.ref}`}>
            {t('Edit')}
          </Button>
          <FormDialog
            {...editCatalogueDraftForm(t, v.ref)}
            open={editing}
            onClose={() => setEditing(false)}
            context={`${t('Machine type')} ${typeLabel}`}
            initialValues={v.values}
            onSubmit={async (values: FormValues) => toForm(await updateCatalogueDraftAction(v.code, v.version, values))}
          />
        </>
      )}
      {v.canPublish && (
        <Confirm
          label={t('Publish')} icon={CheckCircle} ariaLabel={`${t('Publish')} ${v.ref}`} title={`${t('Publish')} ${v.ref}`} disabled={pending || !!v.publishBlocker}
          tooltip={v.publishBlocker ?? undefined}
          text={t('The version is frozen and offered to the subsidiaries; the published version of this entry, if any, is retired.')}
          onConfirm={() => run(() => publishCatalogueVersionAction(v.code, v.version))}
        />
      )}
      {v.canDiscard && (
        <Confirm
          label={t('Discard')} icon={Trash} ariaLabel={`${t('Discard')} ${v.ref}`} title={`${t('Discard draft')} ${v.ref}`} disabled={pending}
          text={t('The draft is deleted; it was never published.')}
          onConfirm={() => run(() => discardCatalogueDraftAction(v.code, v.version))}
        />
      )}
      {v.canRetire && (
        <Confirm
          label={t('Retire')} icon={Archive} ariaLabel={`${t('Retire')} ${v.ref}`} title={`${t('Retire')} ${v.ref}`} disabled={pending}
          text={t('The entry is no longer offered to the subsidiaries; the needs and projects that chose this version keep it.')}
          onConfirm={() => run(() => retireCatalogueVersionAction(v.code, v.version))}
        />
      )}
    </span>
  );
}

function Confirm({ label, icon, ariaLabel, title, text, disabled, tooltip, onConfirm }: {
  label: string;
  icon: typeof Trash;
  ariaLabel: string;
  title: string;
  text: string;
  disabled?: boolean;
  tooltip?: string;
  onConfirm: () => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="ghost" size="mini" icon={icon} nowrap disabled={disabled} title={tooltip ?? label} aria-label={ariaLabel} onClick={() => setOpen(true)}>
        {label}
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title={title} width={440}>
        <p className={s.confirmText}>{text}</p>
        <DialogActions>
          <Button variant="secondary" onClick={() => setOpen(false)}>
            {t('Cancel')}
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              setOpen(false);
              onConfirm();
            }}
          >
            {label}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
