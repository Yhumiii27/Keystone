'use client';
// R-159 (P1, D9-31) — expediting of a purchase order (order drawer of the Purchase orders screen): the supplier's fabrication
// progress, the inspections at the supplier's works (FAT tied to an ITP FAT point), the NCR of a failed inspection (reported in
// Vigie, which owns it), the release note that authorises the supplier to ship, and the deliveries flagged for want of one.
// Editors: procurement, quality and the director (`canEdit`); the release note: quality and the director (`canRelease`). Everyone
// else (the project's PMs…) reads.
import { ArrowSquareOut, Plus, SealCheck, Trash, Warning } from '@phosphor-icons/react/dist/ssr';
import { useState, useTransition } from 'react';
import { FormDialog, type FormDialogResult } from '@/components/app/FormDialog';
import type { FormDef } from '@/components/app/form-def';
import { Button, IconButton } from '@/components/ds/Button';
import { cx } from '@/components/ds/cx';
import { Table, Th } from '@/components/ds/Table';
import { showToast } from '@/components/ds/Toast';
import { PO_INSPECTION_KINDS, PO_INSPECTION_KIND_LABEL, PO_INSPECTION_RESULT_LABEL, RECORDED_RESULTS } from '@/domain/expediting';
import { useI18n } from '@/i18n/client';
import { dataText } from '@/i18n/data-text';
import { intlLocale } from '@/i18n/translate';
import {
  issueReleaseNoteAction, recordInspectionResultAction, removeInspectionAction, saveInspectionAction, setFabricationProgressAction, withdrawReleaseNoteAction,
  type ExpeditingActionResult,
} from './actions';
import type { ExpeditingView } from './model';
import s from './expediting.module.css';

type Row = ExpeditingView['inspections'][number];
type Open = { kind: 'progress' } | { kind: 'plan' } | { kind: 'edit'; i: Row } | { kind: 'result'; i: Row } | { kind: 'release' } | { kind: 'withdraw'; number: string } | null;

export interface ExpeditingSectionProps {
  code: string;
  view: ExpeditingView;
  canEdit: boolean;
  canRelease: boolean;
}

const TAG: Record<ExpeditingView['state'], string> = { none: 'tag-outline', in_progress: 'tag-neutral', late: 'tag-accent', blocked: 'tag-accent', released: 'tag-neutral' };

export function ExpeditingSection({ code, view, canEdit, canRelease }: ExpeditingSectionProps) {
  const { t, lang } = useI18n();
  const [open, setOpen] = useState<Open>(null);
  const [pending, start] = useTransition();
  const po = view.po;
  const closed = view.poStatus === 'cancelled' || view.poStatus === 'draft';
  const edit = canEdit && !closed;
  const fmt = new Intl.DateTimeFormat(intlLocale(lang), { day: 'numeric', month: 'short', year: '2-digit', timeZone: 'UTC' });
  const day = (iso: string | null) => (iso ? fmt.format(new Date(`${iso}T00:00:00Z`)) : '—');
  const result = (r: ExpeditingActionResult): FormDialogResult => ('error' in r ? { error: r.error } : undefined);
  const act = (fn: () => Promise<ExpeditingActionResult>, ok?: string) =>
    start(async () => {
      const r = await fn();
      if ('error' in r) showToast(r.error);
      else if (ok) showToast(ok);
    });

  const kindOptions = PO_INSPECTION_KINDS.map((k) => ({ value: k, label: t(PO_INSPECTION_KIND_LABEL[k]) }));
  const itpOptions = [{ value: '', label: t('None') }, ...view.itpFatPoints.map((p) => ({ value: p.id, label: `${p.number} · ${dataText(p.name, lang)}` }))];
  const planForm = (i?: Row): FormDef => ({
    title: i ? t('Edit inspection') : t('Plan an inspection'),
    submit: i ? t('Save') : t('Plan'),
    fields: [
      { id: 'kind', label: t('Kind'), type: 'select', options: kindOptions, defaultValue: i?.kind ?? 'fat' },
      { id: 'plannedOn', label: t('Planned date'), type: 'date', defaultValue: i?.plannedOn ?? '' },
      { id: 'name', label: t('Name'), type: 'text', defaultValue: i?.name ?? '', placeholder: t('Default: the kind of inspection') },
      { id: 'location', label: t('Place'), type: 'text', defaultValue: i?.location ?? '', placeholder: t('Supplier’s works') },
      { id: 'inspector', label: t('Inspector'), type: 'text', defaultValue: i?.inspector ?? '' },
      ...(view.itpFatPoints.length ? [{ id: 'itp', label: t('ITP FAT point (FAT only)'), type: 'select' as const, options: itpOptions, defaultValue: i?.itp?.id ?? '' }] : []),
    ],
  });
  const resultForm = (i: Row): FormDef => ({
    title: t('Record the inspection result'),
    submit: t('Save'),
    fields: [
      { id: 'result', label: t('Result'), type: 'select', options: RECORDED_RESULTS.map((r) => ({ value: r, label: t(PO_INSPECTION_RESULT_LABEL[r]) })), defaultValue: i.result === 'planned' ? 'passed' : i.result },
      { id: 'resultOn', label: t('Date'), type: 'date', required: true, defaultValue: i.resultOn ?? i.plannedOn ?? '' },
      { id: 'inspector', label: t('Inspector'), type: 'text', required: true, defaultValue: i.inspector ?? '' },
      { id: 'ncr', label: t('NCR number in Vigie (failed only)'), type: 'text', defaultValue: i.ncrRef ?? '' },
      { id: 'comment', label: t('Comment'), type: 'textarea', defaultValue: i.comment ?? '' },
    ],
  });
  const progressForm: FormDef = {
    title: t('Fabrication progress'),
    submit: t('Save'),
    fields: [
      { id: 'pct', label: t('% complete'), type: 'number', required: true, defaultValue: String(view.progress?.pct ?? 0) },
      { id: 'reportedOn', label: t('Reported by the supplier on'), type: 'date', defaultValue: '' },
      { id: 'note', label: t('Note'), type: 'textarea', defaultValue: view.progress?.note ?? '' },
    ],
  };
  const releaseForm: FormDef = {
    title: t('Issue the release note'),
    submit: t('Issue the release note'),
    fields: [
      { id: 'scope', label: t('Scope released'), type: 'text', defaultValue: '', placeholder: t('Whole order') },
      { id: 'inspector', label: t('Inspector'), type: 'text', defaultValue: '' },
      { id: 'reserves', label: t('Reserves'), type: 'textarea', defaultValue: '' },
    ],
  };
  const withdrawForm: FormDef = { title: t('Withdraw the release note'), submit: t('Withdraw'), fields: [{ id: 'reason', label: t('Reason'), type: 'textarea', required: true }] };

  return (
    <section className={s.section} aria-label={t('Expediting & inspections')}>
      <div className={s.head}>
        <span className={s.kicker}>
          <SealCheck aria-hidden /> {t('Expediting & inspections')}
        </span>
        <span className={cx('tag', TAG[view.state])}>{t(view.stateLabel)}</span>
        {view.longLead && <span className="tag tag-outline">{t('Long lead')}</span>}
        <span className={s.muted}>
          {t('Fabrication')} · {view.progress ? `${view.progress.pct} % · ${day(view.progress.reportedOn)}` : '—'}
        </span>
        {view.next && (
          <span className={s.muted}>
            {t('Next inspection')} · {view.next.number} · {day(view.next.plannedOn)}
          </span>
        )}
      </div>
      {view.progress?.note && <p className={s.muted}>{dataText(view.progress.note, lang)}</p>}

      {view.flaggedDeliveries.length > 0 && (
        <p className={s.flag} role="note">
          <Warning aria-hidden className={s.warnIcon} />
          {t('Delivered or announced without a release note')} · {view.flaggedDeliveries.map((d) => `${d.number} (${day(d.on)})`).join(', ')}
        </p>
      )}

      <div className={s.scroll}>
        <Table size={12.5}>
          <thead>
            <tr>
              <Th>{t('Inspection')}</Th>
              <Th>{t('Planned')}</Th>
              <Th>{t('Inspector')}</Th>
              <Th>{t('Result')}</Th>
              <Th>{t('NCR')}</Th>
              {edit && <Th aria-label={t('Actions')} />}
            </tr>
          </thead>
          <tbody>
            {view.inspections.map((i) => (
              <tr key={i.number} className={cx(i.late && s.lateRow)}>
                <td>
                  <span className={s.code}>{i.number}</span> {dataText(i.name, lang)}
                  <span className={s.sub}>
                    {t(PO_INSPECTION_KIND_LABEL[i.kind])}
                    {i.location ? ` · ${dataText(i.location, lang)}` : ''}
                    {i.itp ? ` · ${t('ITP')} ${i.itp.number}` : ''}
                  </span>
                </td>
                <td className={cx(s.nowrap, i.late && s.late)}>
                  {i.late && <Warning aria-hidden className={s.warnIcon} />}
                  {day(i.plannedOn)}
                </td>
                <td>{i.inspector ? dataText(i.inspector, lang) : '—'}</td>
                <td className={s.nowrap}>
                  <span className={cx('tag', i.result === 'failed' ? 'tag-accent' : i.result === 'planned' ? 'tag-outline' : 'tag-neutral')}>{t(PO_INSPECTION_RESULT_LABEL[i.result])}</span>
                  {i.resultOn && <span className={s.sub}>{day(i.resultOn)}</span>}
                  {i.comment && <span className={s.sub}>{dataText(i.comment, lang)}</span>}
                </td>
                <td className={s.nowrap}>
                  {i.ncrs.map((n) => (
                    <a key={n.number} className={s.link} href={n.vigieUrl} target="_blank" rel="noopener noreferrer">
                      {n.number} <ArrowSquareOut aria-hidden />
                    </a>
                  ))}
                  {!i.ncrs.length && i.ncrRef && <span>{i.ncrRef}</span>}
                  {view.reportNcr[i.number] && (
                    <a className={s.link} href={view.reportNcr[i.number]} target="_blank" rel="noopener noreferrer">
                      {t('Report the NCR in Vigie')} <ArrowSquareOut aria-hidden />
                    </a>
                  )}
                  {!i.ncrs.length && !i.ncrRef && !view.reportNcr[i.number] && '—'}
                </td>
                {edit && (
                  <td className={s.rowActions}>
                    <Button size="sm" variant="ghost" disabled={pending} onClick={() => setOpen({ kind: 'result', i })}>
                      {t('Result')}
                    </Button>
                    {i.result === 'planned' && (
                      <>
                        <Button size="sm" variant="ghost" disabled={pending} onClick={() => setOpen({ kind: 'edit', i })}>
                          {t('Edit')}
                        </Button>
                        <IconButton icon={Trash} size={24} label={`${t('Remove')} · ${i.number}`} disabled={pending} onClick={() => act(() => removeInspectionAction(code, po, i.number), t('Inspection removed'))} />
                      </>
                    )}
                  </td>
                )}
              </tr>
            ))}
            {!view.inspections.length && (
              <tr>
                <td colSpan={edit ? 6 : 5} className={s.muted}>
                  {t('No inspection planned for this order — plan the supplier’s inspections and FAT')}
                </td>
              </tr>
            )}
          </tbody>
        </Table>
      </div>

      <div className={s.release}>
        <span className={s.subhead}>{t('Release note')}</span>
        {view.release ? (
          <span>
            <b>{view.release.number}</b> · {day(view.release.issuedOn)} · {dataText(view.release.issuedBy, lang)} · {view.release.scope === 'Whole order' ? t('Whole order') : dataText(view.release.scope, lang)}
            {view.release.reserves ? ` · ${t('Reserves')}: ${dataText(view.release.reserves, lang)}` : ''}
          </span>
        ) : (
          <span className={s.muted}>{view.required ? t('Not issued: the supplier may not ship yet') : t('Not required (no inspection planned)')}</span>
        )}
        {!view.release && view.required && view.blockers.length > 0 && (
          <span className={s.late}>
            {view.blockers.map((b) => (b.kind === 'fat' ? t('The FAT has not passed yet') : `${t('Failed inspection without a passing re-inspection')}: ${b.numbers.join(', ')}`)).join(' · ')}
          </span>
        )}
        {view.releases.filter((r) => r.withdrawn).map((r) => (
          <span key={r.number} className={s.sub}>
            {r.number} · {t('Withdrawn')} · {r.withdrawnBy ? dataText(r.withdrawnBy, lang) : ''} · {r.withdrawReason ? dataText(r.withdrawReason, lang) : ''}
          </span>
        ))}
      </div>

      {(edit || (canRelease && !closed)) && (
        <div className={s.buttons}>
          {edit && (
            <Button size="sm" variant="secondary" icon={Plus} disabled={pending} onClick={() => setOpen({ kind: 'plan' })}>
              {t('Plan an inspection')}
            </Button>
          )}
          {edit && (
            <Button size="sm" variant="secondary" disabled={pending} onClick={() => setOpen({ kind: 'progress' })}>
              {t('Fabrication progress')}
            </Button>
          )}
          {canRelease && !view.release && view.required && (
            <Button size="sm" variant="secondary" icon={SealCheck} disabled={pending || view.blockers.length > 0} onClick={() => setOpen({ kind: 'release' })}>
              {t('Issue the release note')}
            </Button>
          )}
          {canRelease && view.release && (
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => setOpen({ kind: 'withdraw', number: view.release!.number })}>
              {t('Withdraw the release note')}
            </Button>
          )}
        </div>
      )}

      {open?.kind === 'plan' && <FormDialog open {...planForm()} context={po} successToast={t('Inspection planned')} onClose={() => setOpen(null)} onSubmit={async (v) => result(await saveInspectionAction(code, po, '', v))} />}
      {open?.kind === 'edit' && (
        <FormDialog open {...planForm(open.i)} context={`${po} · ${open.i.number}`} onClose={() => setOpen(null)} onSubmit={async (v) => result(await saveInspectionAction(code, po, open.i.number, v))} />
      )}
      {open?.kind === 'result' && (
        <FormDialog open {...resultForm(open.i)} context={`${po} · ${open.i.number}`} successToast={t('Inspection result recorded')} onClose={() => setOpen(null)} onSubmit={async (v) => result(await recordInspectionResultAction(code, po, open.i.number, v))} />
      )}
      {open?.kind === 'progress' && <FormDialog open {...progressForm} context={po} onClose={() => setOpen(null)} onSubmit={async (v) => result(await setFabricationProgressAction(code, po, v))} />}
      {open?.kind === 'release' && <FormDialog open {...releaseForm} context={po} successToast={t('Release note issued')} onClose={() => setOpen(null)} onSubmit={async (v) => result(await issueReleaseNoteAction(code, po, v))} />}
      {open?.kind === 'withdraw' && (
        <FormDialog open {...withdrawForm} context={open.number} successToast={t('Release note withdrawn')} onClose={() => setOpen(null)} onSubmit={async (v) => result(await withdrawReleaseNoteAction(code, po, open.number, v))} />
      )}
    </section>
  );
}
