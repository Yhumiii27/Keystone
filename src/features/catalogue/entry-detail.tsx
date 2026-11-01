'use client';
// Entry detail of the Machine catalogue screen (R-186, AC-4; owner, 25 Oct 2026: moved from the Machine types screen to a screen
// of its own): the versions of the selected catalogue code — draft, published (offered to the subsidiaries through
// pub_catalogue_machines) or retired — with their content and actions, then, read-only, the rows the CAPEX application reads and
// the projects' equipment lines that chose a version. The director and the engineering lead (choice 5) edit and publish or
// discard a draft, start a new version of a published entry and retire the published version; the other viewers read. A
// published version is frozen: "New version" copies it into a draft. The Server Functions re-check the rights and parse the
// values again. Also the header's "New catalogue entry" button.
import { Archive, CheckCircle, Copy, PencilSimple, Plus, Trash } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { FormDialog } from '@/components/app/FormDialog';
import type { FormDef, FormValues } from '@/components/app/form-def';
import { Button } from '@/components/ds/Button';
import { Dialog } from '@/components/ds/Dialog';
import { DialogActions } from '@/components/ds/DialogParts';
import { Table, Th } from '@/components/ds/Table';
import { Tag } from '@/components/ds/Tag';
import { showToast } from '@/components/ds/Toast';
import { cx } from '@/components/ds/cx';
import type { AdminActionResult } from '@/features/admin/actions';
import { useI18n } from '@/i18n/client';
import {
  createCatalogueEntryAction, discardCatalogueDraftAction, newCatalogueVersionAction, publishCatalogueVersionAction, retireCatalogueVersionAction,
  updateCatalogueDraftAction,
} from './actions';
import { catalogueHref } from './links';
import { editCatalogueDraftForm, type CatalogueDetailView, type CatalogueVersionView } from './model';
import s from './catalogue.module.css';

const toForm = (r: AdminActionResult) => ('error' in r ? { error: r.error } : { toast: r.toast ?? '' });

/** Header primary action (director and engineering lead): the new code opens selected once created. */
export function NewCatalogueEntryButton({ form }: { form: FormDef }) {
  const { t } = useI18n();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const submit = async (values: FormValues) => {
    const r = await createCatalogueEntryAction(values.machineType, values);
    if (!('error' in r) && r.code) router.push(catalogueHref({ entry: r.code }), { scroll: false });
    return toForm(r);
  };
  return (
    <>
      <Button variant="primary" icon={Plus} onClick={() => setOpen(true)}>
        {t('New catalogue entry')}
      </Button>
      <FormDialog {...form} open={open} onClose={() => setOpen(false)} onSubmit={submit} />
    </>
  );
}

export function CatalogueEntryDetail({ detail, canEdit }: { detail: CatalogueDetailView; canEdit: boolean }) {
  const { t } = useI18n();
  const [pending, start] = useTransition();
  const e = detail.entry;
  const run = (p: () => Promise<AdminActionResult>) =>
    start(async () => {
      try {
        const r = await p();
        showToast('error' in r ? r.error : r.toast ?? t('Saved'));
      } catch (err) {
        showToast(err instanceof Error ? err.message : String(err));
      }
    });
  return (
    <div className={cx('card', 'elev-sm', s.detailCard)} aria-busy={pending || undefined} aria-label={`${t('Catalogue entry')} ${detail.code}`}>
      <div className={s.detailHead}>
        <span className={s.code}>{detail.code}</span>
        <span className="tag tag-neutral">{`${t('Machine type')} ${detail.typeLabel}`}</span>
        {e.canNewVersion && (
          <Button variant="ghost" size="xs" icon={Copy} className={s.pushRight} disabled={pending} onClick={() => run(() => newCatalogueVersionAction(detail.code))}>
            {t('New version')}
          </Button>
        )}
      </div>
      <span className={s.hint}>{t('Published versions are offered to the subsidiaries (CAPEX application); a published version is frozen.')}</span>
      <span className={s.sectionLabel}>{t('Catalogue versions')}</span>
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
            {canEdit && <Th aria-label={t('Actions')} />}
          </tr>
        </thead>
        <tbody>
          {e.versions.map((v) => (
            <tr key={v.version}>
              <td className={s.num}>v{v.version}</td>
              <td>
                <Tag tone={v.tone} size="sm">{v.statusText}</Tag>
                <div className={s.sub}>{v.stamp}</div>
              </td>
              <td>
                <span className={s.label}>
                  <span>{v.label}</span>
                  {(v.variant || v.usedBy) && <span className={s.sub}>{[v.variant, v.usedBy].filter(Boolean).join(' · ')}</span>}
                  {v.description && <span className={s.sub}>{v.description}</span>}
                </span>
              </td>
              <td className={cx(s.right, s.num)}>{v.capacity}</td>
              <td className={cx(s.right, s.num)}>{v.price}</td>
              <td className={cx(s.right, s.num)}>{v.leadTime}</td>
              <td className={s.options}>{v.options.length ? v.options.map((o) => `${o.code} · ${o.label} · ${o.price}`).join(' ; ') : '—'}</td>
              {canEdit && (
                <td>
                  <VersionActions v={v} typeLabel={detail.typeLabel} pending={pending} run={run} />
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </Table>
      <div className={s.twoGrid}>
        <div className={s.block}>
          <span className={s.sectionLabel}>{t('Published to the CAPEX application')}</span>
          <span className={s.sub}>{t('Read-only · the rows of the shared view pub_catalogue_machines (published and retired versions; drafts are never shared)')}</span>
          {detail.publication.length ? (
            <Table size={12.5}>
              <thead>
                <tr>
                  <Th>{t('Version')}</Th>
                  <Th>statut</Th>
                  <Th>{t('Updated')}</Th>
                </tr>
              </thead>
              <tbody>
                {detail.publication.map((p) => (
                  <tr key={p.ref}>
                    <td className={s.num}>{p.ref}</td>
                    <td>
                      <Tag tone={p.tone} size="sm">{p.statut}</Tag>
                    </td>
                    <td className={s.num}>{p.majLe}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : (
            <span className={s.empty}>{t('Nothing published yet for this entry')}</span>
          )}
        </div>
        <div className={s.block}>
          <span className={s.sectionLabel}>{t('Projects’ equipment lines')}</span>
          <span className={s.sub}>{t('Read-only · the lines that chose a version of this entry (Contract, Equipment card)')}</span>
          {detail.uses.length ? (
            <Table size={12.5}>
              <thead>
                <tr>
                  <Th>{t('Version')}</Th>
                  <Th>{t('Project')}</Th>
                  <Th>{t('Line')}</Th>
                  <Th align="right">{t('Quantity')}</Th>
                </tr>
              </thead>
              <tbody>
                {detail.uses.map((u) => (
                  <tr key={`${u.project}-${u.line}`}>
                    <td className={s.num}>{u.ref}</td>
                    <td>
                      <Link href={u.projectHref} className={s.link}>
                        {u.project}
                      </Link>
                    </td>
                    <td className={s.num}>{u.line}</td>
                    <td className={cx(s.right, s.num)}>{u.quantity}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : (
            <span className={s.empty}>{t('No equipment line has chosen this entry yet')}</span>
          )}
        </div>
      </div>
    </div>
  );
}

type Run = (p: () => Promise<AdminActionResult>) => void;

function VersionActions({ v, typeLabel, pending, run }: { v: CatalogueVersionView; typeLabel: string; pending: boolean; run: Run }) {
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  return (
    <span className={s.actions}>
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
