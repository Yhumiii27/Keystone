'use client';
// R-204 — activity codes on the Plan screen:
// - CodeFilterBar: filter (`?code=<type>~<value>`) and grouping (`?group=<type>`) of the rows, kept in the URL;
// - ActivityCodesCard: the project's dictionary — derived types (equipment line, purchasing package) read-only, stored types
//   (site, custom) with their values, added and removed by the project's leads and the director;
// - ActivityCodesSection: the codes of one activity in its drawer (one value per type; the equipment type sets the activity's
//   equipment line; the purchasing package is derived) and the supplier activities tied to it.
import { Plus, Tag as TagIcon, Trash, X } from '@phosphor-icons/react/dist/ssr';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useState, useTransition } from 'react';
import { FormDialog, type FormDialogResult } from '@/components/app/FormDialog';
import { Button, IconButton } from '@/components/ds/Button';
import { cx } from '@/components/ds/cx';
import { Select } from '@/components/ds/Field';
import { showToast } from '@/components/ds/Toast';
import { NO_CODE_VALUE, NO_CODE_VALUE_LABEL, type CodeType } from '@/domain/activity-codes';
import { useI18n } from '@/i18n/client';
import { dataText } from '@/i18n/data-text';
import { addCodeTypeAction, addCodeValueAction, removeCodeTypeAction, removeCodeValueAction, setActivityCodeAction, type CodeActionResult } from './actions';
import s from './activity-codes.module.css';

function useTypeName() {
  const { t, lang } = useI18n();
  return (x: Pick<CodeType, 'derived' | 'name'>) => (x.derived ? t(x.name) : dataText(x.name, lang));
}

/** Filter and grouping selects (URL state; the other parameters are kept, the open activity closed). */
export function CodeFilterBar({ types, filter, group }: { types: CodeType[]; filter: string; group: string }) {
  const { t, lang } = useI18n();
  const typeName = useTypeName();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const go = (key: 'code' | 'group', value: string) => {
    const u = new URLSearchParams(params.toString());
    u.delete('act');
    if (value) u.set(key, value);
    else u.delete(key);
    const qs = u.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  };
  if (!types.length) return null;
  return (
    <div className={s.bar}>
      <TagIcon aria-hidden className={s.barIcon} />
      <Select
        size="inline"
        aria-label={t('Filter by code')}
        value={filter}
        onChange={(e) => go('code', e.target.value)}
        options={[
          { value: '', label: t('All activities') },
          ...types.flatMap((x) => [
            ...x.values.map((v) => ({ value: `${x.key}~${v.key}`, label: `${typeName(x)} · ${v.code}${v.label && v.label !== v.code ? ` · ${dataText(v.label, lang)}` : ''}` })),
            { value: `${x.key}~${NO_CODE_VALUE}`, label: `${typeName(x)} · ${t(NO_CODE_VALUE_LABEL)}` },
          ]),
        ]}
      />
      <Select
        size="inline"
        aria-label={t('Group by')}
        value={group}
        onChange={(e) => go('group', e.target.value)}
        options={[{ value: '', label: t('Group by work package') }, ...types.map((x) => ({ value: x.key, label: `${t('Group by')} · ${typeName(x)}` }))]}
      />
      {group && <span className={s.hint}>{t('Grouped view: read only — group by work package to edit')}</span>}
    </div>
  );
}

const done = (r: CodeActionResult, ok?: string): FormDialogResult => ('error' in r ? { error: r.error } : ok);

/** The project's code dictionary. */
export function ActivityCodesCard({ code, types, canEdit }: { code: string; types: CodeType[]; canEdit: boolean }) {
  const { t, lang } = useI18n();
  const typeName = useTypeName();
  const [pending, start] = useTransition();
  const [dialog, setDialog] = useState<{ kind: 'type' } | { kind: 'value'; type: CodeType } | null>(null);
  const act = (fn: () => Promise<CodeActionResult>) =>
    start(async () => {
      const r = await fn();
      if ('error' in r) showToast(r.error);
    });
  const hasSite = types.some((x) => x.kind === 'site');
  return (
    <div className={s.list}>
      {types.map((x) => (
        <div key={x.key} className={s.type}>
          <div className={s.typeHead}>
            <span className={s.typeName}>{typeName(x)}</span>
            <span className={s.kind}>{x.derived ? t('Derived from the project’s links') : x.kind === 'site' ? t('Site') : t('Custom code')}</span>
            {canEdit && !x.derived && (
              <IconButton icon={Trash} size={24} label={`${t('Remove')} · ${typeName(x)}`} disabled={pending} onClick={() => act(() => removeCodeTypeAction(code, x.key))} />
            )}
          </div>
          <div className={s.values}>
            {x.values.length === 0 && <span className={s.hint}>{t('No value yet')}</span>}
            {x.values.map((v) => (
              <span key={v.key} className={cx('tag', 'tag-neutral', s.value)} title={dataText(v.label, lang)}>
                <b>{v.code}</b>
                {v.label && v.label !== v.code ? ` · ${dataText(v.label, lang)}` : ''}
                {canEdit && !x.derived && (
                  <button type="button" className={s.remove} aria-label={`${t('Remove')} · ${v.code}`} disabled={pending} onClick={() => act(() => removeCodeValueAction(code, v.key))}>
                    <X aria-hidden />
                  </button>
                )}
              </span>
            ))}
            {canEdit && !x.derived && (
              <Button size="xs" variant="ghost" icon={Plus} disabled={pending} onClick={() => setDialog({ kind: 'value', type: x })}>
                {t('Add value')}
              </Button>
            )}
          </div>
        </div>
      ))}
      {types.length === 0 && <span className={s.hint}>{t('No activity code yet')}</span>}
      {canEdit && (
        <div>
          <Button size="sm" variant="secondary" icon={Plus} disabled={pending} onClick={() => setDialog({ kind: 'type' })}>
            {t('Add code type')}
          </Button>
        </div>
      )}
      {dialog?.kind === 'type' && (
        <FormDialog
          open
          title={t('Add code type')}
          submit={t('Add')}
          fields={[
            { id: 'name', label: t('Name'), type: 'text', required: true, placeholder: t('Zone, discipline, contractor…') },
            {
              id: 'kind', label: t('Kind'), type: 'select',
              options: [{ value: 'custom', label: t('Custom code') }, ...(hasSite ? [] : [{ value: 'site', label: t('Site') }])],
            },
          ]}
          onClose={() => setDialog(null)}
          onSubmit={async (v) => done(await addCodeTypeAction(code, v), t('Code type added'))}
        />
      )}
      {dialog?.kind === 'value' && (
        <FormDialog
          open
          title={t('Add value')}
          context={typeName(dialog.type)}
          submit={t('Add')}
          fields={[
            { id: 'code', label: t('Code'), type: 'text', required: true, placeholder: 'Z1' },
            { id: 'label', label: t('Description'), type: 'text' },
          ]}
          onClose={() => setDialog(null)}
          onSubmit={async (v) => done(await addCodeValueAction(code, dialog.type.key, v), t('Value added'))}
        />
      )}
    </div>
  );
}

/** The codes of an activity (drawer). */
export function ActivityCodesSection({
  code, activity, types, values, ties, canEdit,
}: {
  code: string;
  activity: string;
  types: CodeType[];
  /** Type key → value keys of the activity. */
  values: Record<string, string[]>;
  /** Supplier activities tied to the activity ("PO-1082/F50 · Delivery → FS"), already formatted. */
  ties: string[];
  canEdit: boolean;
}) {
  const { t, lang } = useI18n();
  const typeName = useTypeName();
  const [pending, start] = useTransition();
  if (!types.length && !ties.length) return null;
  const set = (type: string, value: string) =>
    start(async () => {
      const r = await setActivityCodeAction(code, activity, type, value);
      if ('error' in r) showToast(r.error);
    });
  return (
    <section className={s.section} aria-label={t('Activity codes')}>
      <span className={s.kicker}>{t('Activity codes')}</span>
      {types.map((x) => {
        const mine = values[x.key] ?? [];
        const editable = canEdit && x.kind !== 'purchase_package';
        return (
          <div key={x.key} className={s.kv}>
            <span className={s.kvKey}>{typeName(x)}</span>
            {editable ? (
              <Select
                size="inline"
                aria-label={typeName(x)}
                value={mine[0] ?? ''}
                disabled={pending}
                onChange={(e) => set(x.key, e.target.value)}
                options={[{ value: '', label: '—' }, ...x.values.map((v) => ({ value: v.key, label: `${v.code}${v.label && v.label !== v.code ? ` · ${dataText(v.label, lang)}` : ''}` }))]}
              />
            ) : (
              <span className={s.kvVal}>{x.values.filter((v) => mine.includes(v.key)).map((v) => v.code).join(', ') || '—'}</span>
            )}
          </div>
        );
      })}
      {ties.length > 0 && (
        <>
          <span className={s.kvKey}>{t('Supplier schedules')}</span>
          {ties.map((x) => (
            <span key={x} className={s.kvVal}>
              {x}
            </span>
          ))}
        </>
      )}
    </section>
  );
}
