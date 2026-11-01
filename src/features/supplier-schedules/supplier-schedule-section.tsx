'use client';
// R-204 — supplier schedule of a purchase order (order drawer of the Purchase orders screen): the supplier's milestones and
// activities with their committed dates, the forecast at the data date and the slip against the commitment, the actual dates and
// % complete the buyer enters, the logic inside the schedule and the ties to the project's activities (reception, installation)
// that consolidate it into the project CPM. Editors: procurement, the project's leads and the director (`canEdit`); the ties:
// the project's leads and the director (`canTie`). Everyone else reads.
import { Plus, Trash, Truck, Warning } from '@phosphor-icons/react/dist/ssr';
import { useState, useTransition } from 'react';
import { FormDialog, type FormDialogResult } from '@/components/app/FormDialog';
import { Button, IconButton } from '@/components/ds/Button';
import { cx } from '@/components/ds/cx';
import { Table, Th } from '@/components/ds/Table';
import { showToast } from '@/components/ds/Toast';
import type { FormDef } from '@/components/app/form-def';
import { useI18n } from '@/i18n/client';
import { dataText } from '@/i18n/data-text';
import { intlLocale } from '@/i18n/translate';
import {
  addSupplierLinkAction, addSupplierTieAction, createSupplierScheduleAction, recordSupplierProgressAction, removeSupplierActivityAction, removeSupplierLinkAction,
  removeSupplierScheduleAction, removeSupplierTieAction, saveSupplierActivityAction, type SupplierActionResult,
} from './actions';
import type { SupplierActivityView, SupplierScheduleView } from './model';
import s from './supplier-schedules.module.css';

export interface SupplierScheduleSectionProps {
  code: string;
  po: string;
  /** The order's schedule; null when it has none. */
  schedule: SupplierScheduleView | null;
  projectActivities: { code: string; name: string }[];
  canEdit: boolean;
  canTie: boolean;
  /** A cancelled order gets no schedule. */
  cancelled: boolean;
}

type Open =
  | { kind: 'add' }
  | { kind: 'edit'; a: SupplierActivityView }
  | { kind: 'progress'; a: SupplierActivityView }
  | { kind: 'link' }
  | { kind: 'tie' }
  | null;

const LINK_TYPES = ['FS', 'SS', 'FF', 'SF'];

export function SupplierScheduleSection({ code, po, schedule, projectActivities, canEdit, canTie, cancelled }: SupplierScheduleSectionProps) {
  const { t, lang } = useI18n();
  const [open, setOpen] = useState<Open>(null);
  const [pending, start] = useTransition();
  const fmt = new Intl.DateTimeFormat(intlLocale(lang), { day: 'numeric', month: 'short', year: '2-digit', timeZone: 'UTC' });
  const day = (iso: string | null) => (iso ? fmt.format(new Date(`${iso}T00:00:00Z`)) : '—');
  const slipText = (n: number | null) => (n == null ? '—' : n === 0 ? t('On time') : `${n > 0 ? '+' : '−'}${Math.abs(n)} ${t('wd')}`);
  const result = (r: SupplierActionResult): FormDialogResult => ('error' in r ? { error: r.error } : undefined);
  const act = (fn: () => Promise<SupplierActionResult>, ok?: string) =>
    start(async () => {
      const r = await fn();
      if ('error' in r) showToast(r.error);
      else if (ok) showToast(ok);
    });
  const nameOf = (c: string) => {
    const a = schedule?.activities.find((x) => x.code === c);
    return a ? `${c} · ${dataText(a.name, lang)}` : c;
  };

  if (!schedule)
    return (
      <section className={s.section} aria-label={t('Supplier schedule')}>
        <div className={s.head}>
          <span className={s.kicker}>
            <Truck aria-hidden /> {t('Supplier schedule')}
          </span>
        </div>
        <p className={s.muted}>{t('No supplier schedule for this order yet — model the supplier’s milestones to consolidate them into the project schedule')}</p>
        {canEdit && !cancelled && (
          <div className={s.buttons}>
            <Button size="sm" variant="secondary" icon={Plus} disabled={pending} onClick={() => act(() => createSupplierScheduleAction(code, po, true), t('Supplier schedule created'))}>
              {t('Create with the standard steps')}
            </Button>
            <Button size="sm" variant="secondary" disabled={pending} onClick={() => act(() => createSupplierScheduleAction(code, po, false), t('Supplier schedule created'))}>
              {t('Create an empty schedule')}
            </Button>
          </div>
        )}
      </section>
    );

  const activityForm = (a?: SupplierActivityView): FormDef => ({
    title: a ? t('Edit supplier activity') : t('Add supplier activity'),
    submit: a ? t('Save') : t('Add'),
    fields: [
      { id: 'code', label: t('Code'), type: 'text', required: true, defaultValue: a?.code ?? '', placeholder: 'F60' },
      { id: 'duration', label: t('Duration (working days)'), type: 'number', required: true, defaultValue: a ? String(a.duration) : '', placeholder: t('0 = milestone') },
      { id: 'name', label: t('Name'), type: 'text', required: true, defaultValue: a?.name ?? '' },
      { id: 'committedStart', label: t('Committed start'), type: 'date', defaultValue: a?.committedStart ?? '' },
      { id: 'committedFinish', label: t('Committed finish'), type: 'date', defaultValue: a?.committedFinish ?? '' },
      ...(a ? [] : [{ id: 'chain', label: t('Link after the last activity'), type: 'select' as const, options: [{ value: 'yes', label: t('Yes (finish-to-start)') }, { value: 'no', label: t('No') }] }]),
    ],
  });
  const progressForm = (a: SupplierActivityView): FormDef => ({
    title: t('Supplier progress'),
    submit: t('Save'),
    fields: [
      { id: 'actualStart', label: t('Actual start'), type: 'date', defaultValue: a.actualStart ?? '' },
      { id: 'actualFinish', label: t('Actual finish'), type: 'date', defaultValue: a.actualFinish ?? '' },
      { id: 'pct', label: t('% complete'), type: 'number', defaultValue: String(a.pct) },
    ],
  });
  const codes = schedule.activities.map((a) => ({ value: a.code, label: `${a.code} · ${dataText(a.name, lang)}` }));
  const linkForm: FormDef = {
    title: t('Add relationship'),
    submit: t('Add'),
    fields: [
      { id: 'pred', label: t('Predecessor'), type: 'select', options: codes },
      { id: 'succ', label: t('Successor'), type: 'select', options: codes, defaultValue: codes.at(-1)?.value },
      { id: 'type', label: t('Type'), type: 'select', options: LINK_TYPES },
      { id: 'lag', label: t('Lag (working days)'), type: 'number', defaultValue: '0' },
    ],
  };
  const tieForm: FormDef = {
    title: t('Tie to the project schedule'),
    submit: t('Tie'),
    fields: [
      { id: 'supplier', label: t('Supplier activity'), type: 'select', options: codes, defaultValue: codes.at(-1)?.value },
      {
        id: 'direction', label: t('Direction'), type: 'select',
        options: [{ value: 'to_project', label: t('Supplier activity → project activity') }, { value: 'from_project', label: t('Project activity → supplier activity') }],
      },
      { id: 'activity', label: t('Project activity'), type: 'select', options: projectActivities.map((a) => ({ value: a.code, label: `${a.code} · ${dataText(a.name, lang)}` })) },
      { id: 'lag', label: t('Lag (working days)'), type: 'number', defaultValue: '0' },
    ],
  };

  return (
    <section className={s.section} aria-label={t('Supplier schedule')}>
      <div className={s.head}>
        <span className={s.kicker}>
          <Truck aria-hidden /> {t('Supplier schedule')}
        </span>
        <span className={cx('tag', schedule.late ? 'tag-accent' : 'tag-neutral')}>
          {schedule.invalid ? t('Cannot be dated') : schedule.late ? `${t('Slipping')} · ${slipText(schedule.slip)}` : t('On time')}
        </span>
        <span className={s.muted}>
          {t('Forecast finish')} · {day(schedule.finish)}
        </span>
        {!schedule.consolidated && <span className={s.muted}>{t('Not tied to the project schedule yet')}</span>}
      </div>

      <div className={s.scroll}>
        <Table size={12.5}>
          <thead>
            <tr>
              <Th>{t('Activity')}</Th>
              <Th align="right">{t('Duration')}</Th>
              <Th>{t('Supplier commitment')}</Th>
              <Th>{t('Forecast')}</Th>
              <Th>{t('Actual')}</Th>
              <Th align="right">%</Th>
              <Th>{t('Slip')}</Th>
              {canEdit && <Th aria-label={t('Actions')} />}
            </tr>
          </thead>
          <tbody>
            {schedule.activities.map((a) => (
              <tr key={a.code} className={cx(a.late && s.lateRow)}>
                <td>
                  <span className={s.code}>{a.code}</span> {dataText(a.name, lang)}
                </td>
                <td className={s.num}>{a.duration === 0 ? t('Milestone') : `${a.duration} ${t('wd')}`}</td>
                <td className={s.nowrap}>{a.duration === 0 ? day(a.committedFinish ?? a.committedStart) : `${day(a.committedStart)} → ${day(a.committedFinish)}`}</td>
                <td className={s.nowrap}>{a.duration === 0 ? day(a.forecastFinish) : `${day(a.forecastStart)} → ${day(a.forecastFinish)}`}</td>
                <td className={s.nowrap}>{a.actualStart ? `${day(a.actualStart)}${a.actualFinish ? ` → ${day(a.actualFinish)}` : ''}` : '—'}</td>
                <td className={s.num}>{a.pct}</td>
                <td className={cx(s.nowrap, a.late && s.late)}>
                  {a.late && <Warning aria-hidden className={s.warnIcon} />}
                  {slipText(a.finishSlip)}
                </td>
                {canEdit && (
                  <td className={s.rowActions}>
                    <Button size="sm" variant="ghost" disabled={pending} onClick={() => setOpen({ kind: 'progress', a })}>
                      {t('Progress')}
                    </Button>
                    <Button size="sm" variant="ghost" disabled={pending} onClick={() => setOpen({ kind: 'edit', a })}>
                      {t('Edit')}
                    </Button>
                    <IconButton
                      icon={Trash}
                      size={24}
                      label={`${t('Remove')} · ${a.code}`}
                      disabled={pending}
                      onClick={() => act(() => removeSupplierActivityAction(code, po, a.code), t('Supplier activity removed'))}
                    />
                  </td>
                )}
              </tr>
            ))}
            {!schedule.activities.length && (
              <tr>
                <td colSpan={canEdit ? 8 : 7} className={s.muted}>
                  {t('No supplier activity yet')}
                </td>
              </tr>
            )}
          </tbody>
        </Table>
      </div>

      <div className={s.cols}>
        <div className={s.col}>
          <span className={s.sub}>{t('Logic')}</span>
          {schedule.links.length === 0 && <span className={s.muted}>{t('No relationship')}</span>}
          {schedule.links.map((l) => (
            <div key={`${l.pred}>${l.succ}`} className={s.line}>
              <span>
                {nameOf(l.pred)} <b className={s.rel}>{`${l.type}${l.lag ? (l.lag > 0 ? '+' : '−') + Math.abs(l.lag) : ''}`}</b> {nameOf(l.succ)}
              </span>
              {canEdit && (
                <IconButton icon={Trash} size={24} label={`${t('Remove')} · ${l.pred} → ${l.succ}`} disabled={pending} onClick={() => act(() => removeSupplierLinkAction(code, po, l.pred, l.succ))} />
              )}
            </div>
          ))}
        </div>
        <div className={s.col}>
          <span className={s.sub}>{t('Ties to the project schedule')}</span>
          {schedule.ties.length === 0 && <span className={s.muted}>{t('Not tied: the supplier’s dates do not move the project yet')}</span>}
          {schedule.ties.map((x) => (
            <div key={`${x.supplier}>${x.activity}`} className={s.line}>
              <span>
                {x.direction === 'to_project' ? (
                  <>
                    {nameOf(x.supplier)} <b className={s.rel}>{`FS${x.lag ? (x.lag > 0 ? '+' : '−') + Math.abs(x.lag) : ''}`}</b> {x.activity} · {dataText(x.activityName, lang)}
                  </>
                ) : (
                  <>
                    {x.activity} · {dataText(x.activityName, lang)} <b className={s.rel}>{`FS${x.lag ? (x.lag > 0 ? '+' : '−') + Math.abs(x.lag) : ''}`}</b> {nameOf(x.supplier)}
                  </>
                )}
              </span>
              {canTie && (
                <IconButton icon={Trash} size={24} label={`${t('Remove')} · ${x.supplier} · ${x.activity}`} disabled={pending} onClick={() => act(() => removeSupplierTieAction(code, po, x.supplier, x.activity))} />
              )}
            </div>
          ))}
        </div>
      </div>

      {(canEdit || canTie) && (
        <div className={s.buttons}>
          {canEdit && (
            <Button size="sm" variant="secondary" icon={Plus} disabled={pending} onClick={() => setOpen({ kind: 'add' })}>
              {t('Add supplier activity')}
            </Button>
          )}
          {canEdit && schedule.activities.length > 1 && (
            <Button size="sm" variant="secondary" disabled={pending} onClick={() => setOpen({ kind: 'link' })}>
              {t('Add relationship')}
            </Button>
          )}
          {canTie && schedule.activities.length > 0 && projectActivities.length > 0 && (
            <Button size="sm" variant="secondary" disabled={pending} onClick={() => setOpen({ kind: 'tie' })}>
              {t('Tie to the project schedule')}
            </Button>
          )}
          {canEdit && (
            <Button size="sm" variant="ghost" icon={Trash} disabled={pending} onClick={() => act(() => removeSupplierScheduleAction(code, po), t('Supplier schedule removed'))}>
              {t('Remove the supplier schedule')}
            </Button>
          )}
        </div>
      )}

      {open?.kind === 'add' && (
        <FormDialog open {...activityForm()} context={po} onClose={() => setOpen(null)} onSubmit={async (v) => result(await saveSupplierActivityAction(code, po, '', v))} />
      )}
      {open?.kind === 'edit' && (
        <FormDialog open {...activityForm(open.a)} context={po} onClose={() => setOpen(null)} onSubmit={async (v) => result(await saveSupplierActivityAction(code, po, open.a.code, v))} />
      )}
      {open?.kind === 'progress' && (
        <FormDialog
          open
          {...progressForm(open.a)}
          context={`${po} · ${open.a.code}`}
          onClose={() => setOpen(null)}
          onSubmit={async (v) => result(await recordSupplierProgressAction(code, po, open.a.code, v))}
        />
      )}
      {open?.kind === 'link' && <FormDialog open {...linkForm} context={po} onClose={() => setOpen(null)} onSubmit={async (v) => result(await addSupplierLinkAction(code, po, v))} />}
      {open?.kind === 'tie' && <FormDialog open {...tieForm} context={po} onClose={() => setOpen(null)} onSubmit={async (v) => result(await addSupplierTieAction(code, po, v))} />}
    </section>
  );
}
