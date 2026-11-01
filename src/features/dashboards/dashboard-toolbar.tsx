'use client';
// R-203 (K-203): the actions on a dashboard — new, rename, share (with named internal users: they read it, with their own
// rights), set as default, copy (a shared dashboard: copy it to make it one's own), delete. Server Functions: ./actions.ts.
import { Copy, PencilSimple, Plus, PushPin, ShareNetwork, Trash } from '@phosphor-icons/react/dist/ssr';
import { useRouter } from 'next/navigation';
import { useId, useState, useTransition } from 'react';
import { Button } from '@/components/ds/Button';
import { Dialog } from '@/components/ds/Dialog';
import { DialogActions } from '@/components/ds/DialogParts';
import { Field, Input } from '@/components/ds/Field';
import { useToast } from '@/components/ds/Toast';
import { screenHref } from '@/config/screens';
import { DASHBOARD_NAME_MAX } from '@/domain/dashboards';
import { useI18n } from '@/i18n/client';
import { dataText } from '@/i18n/data-text';
import { copyDashboardAction, createDashboardAction, deleteDashboardAction, saveDashboardAction, setDefaultDashboardAction, shareDashboardAction, type DashboardResult } from './actions';
import s from './dashboards.module.css';

export interface ToolbarDashboard {
  id: string;
  name: string;
  own: boolean;
  isDefault: boolean;
  sharedWith: string[];
}

export interface SharePerson {
  userId: string;
  name: string;
  /** EN source string. */
  title: string;
}

type Open = 'new' | 'rename' | 'share' | 'delete' | null;

const hrefOf = (id: string) => `${screenHref('dashboards')}?d=${encodeURIComponent(id)}`;

export function DashboardToolbar({ current, people, canCreate }: { current: ToolbarDashboard | null; people: SharePerson[]; canCreate: boolean }) {
  const { t, lang } = useI18n();
  const toast = useToast();
  const router = useRouter();
  const [open, setOpen] = useState<Open>(null);
  const [pending, start] = useTransition();

  /** Runs an action, shows its message, then goes to `go(result)` when given. */
  const act = (f: () => Promise<DashboardResult>, after?: (r: Extract<DashboardResult, { ok: true }>) => void) =>
    start(async () => {
      try {
        const r = await f();
        toast.showEn(r.ok ? r.toast : r.error);
        if (r.ok) {
          setOpen(null);
          after?.(r);
        }
      } catch {
        toast.showEn('The dashboard could not be saved');
      }
    });

  return (
    <div className={s.toolbar} role="group" aria-label={t('Dashboard actions')}>
      {canCreate && (
        <Button size="sm" icon={Plus} onClick={() => setOpen('new')} aria-haspopup="dialog" disabled={pending}>
          {t('New dashboard')}
        </Button>
      )}
      {current?.own && (
        <>
          <Button size="sm" variant="ghost" icon={PencilSimple} onClick={() => setOpen('rename')} aria-haspopup="dialog" disabled={pending}>
            {t('Rename')}
          </Button>
          <Button size="sm" variant="ghost" icon={ShareNetwork} onClick={() => setOpen('share')} aria-haspopup="dialog" disabled={pending}>
            {current.sharedWith.length ? `${t('Sharing')} (${current.sharedWith.length})` : t('Sharing')}
          </Button>
          {!current.isDefault && (
            <Button size="sm" variant="ghost" icon={PushPin} onClick={() => act(() => setDefaultDashboardAction({ id: current.id }))} disabled={pending}>
              {t('Set as default')}
            </Button>
          )}
        </>
      )}
      {current && canCreate && (
        <Button size="sm" variant="ghost" icon={Copy} onClick={() => act(() => copyDashboardAction({ id: current.id }), (r) => r.id && router.push(hrefOf(r.id)))} disabled={pending}>
          {current.own ? t('Duplicate') : t('Copy to my dashboards')}
        </Button>
      )}
      {current?.own && (
        <Button size="sm" variant="ghost" icon={Trash} onClick={() => setOpen('delete')} aria-haspopup="dialog" disabled={pending}>
          {t('Delete')}
        </Button>
      )}

      {open === 'new' && (
        <NameDialog title={t('New dashboard')} initial="" submit={t('Create')} pending={pending} onClose={() => setOpen(null)}
          onSubmit={(name) => act(() => createDashboardAction({ name }), (r) => r.id && router.push(hrefOf(r.id)))} />
      )}
      {open === 'rename' && current && (
        <NameDialog title={t('Rename the dashboard')} initial={current.name} submit={t('Save')} pending={pending} onClose={() => setOpen(null)}
          onSubmit={(name) => act(() => saveDashboardAction({ id: current.id, name }))} />
      )}
      {open === 'share' && current && (
        <ShareDialog current={current} people={people} pending={pending} onClose={() => setOpen(null)} onSubmit={(userIds) => act(() => shareDashboardAction({ id: current.id, userIds }))} />
      )}
      {open === 'delete' && current && (
        <Dialog open onClose={() => setOpen(null)} title={t('Delete the dashboard?')} subtitle={dataText(current.name, lang)} width={440} placement="center" maxHeight={null}>
          <p className={s.dialogText}>
            {current.sharedWith.length ? t('The people it is shared with will no longer see it.') : t('Its widgets are removed; the data they show stay in Keystone.')}
          </p>
          <DialogActions>
            <Button variant="secondary" onClick={() => setOpen(null)}>
              {t('Cancel')}
            </Button>
            <Button variant="primary" icon={Trash} disabled={pending} onClick={() => act(() => deleteDashboardAction({ id: current.id }), () => router.push(screenHref('dashboards')))}>
              {t('Delete')}
            </Button>
          </DialogActions>
        </Dialog>
      )}
    </div>
  );
}

function NameDialog({ title, initial, submit, pending, onClose, onSubmit }: {
  title: string; initial: string; submit: string; pending: boolean; onClose: () => void; onSubmit: (name: string) => void;
}) {
  const { t } = useI18n();
  const id = useId();
  const [name, setName] = useState(initial);
  const blocked = pending || !name.trim();
  return (
    <Dialog open onClose={onClose} title={title} width={440} placement="center" maxHeight={null}>
      <form
        className={s.form}
        onSubmit={(e) => {
          e.preventDefault();
          if (!blocked) onSubmit(name);
        }}
      >
        <Field label={t('Name')} required htmlFor={id}>
          <Input id={id} value={name} onChange={(e) => setName(e.target.value)} maxLength={DASHBOARD_NAME_MAX} autoFocus required />
        </Field>
        <DialogActions>
          <Button variant="secondary" onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button variant="primary" type="submit" disabled={blocked}>
            {submit}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}

function ShareDialog({ current, people, pending, onClose, onSubmit }: {
  current: ToolbarDashboard; people: SharePerson[]; pending: boolean; onClose: () => void; onSubmit: (userIds: string[]) => void;
}) {
  const { t, lang } = useI18n();
  const [chosen, setChosen] = useState<Set<string>>(() => new Set(current.sharedWith));
  const legend = useId();
  const toggle = (id: string) =>
    setChosen((c) => {
      const n = new Set(c);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  return (
    <Dialog open onClose={onClose} title={t('Share the dashboard')}
      subtitle={t('The people you choose see it read-only, each with their own rights: a widget outside their workspace stays empty for them.')}
      width={520} placement="center" maxHeight="88vh">
      <form
        className={s.form}
        onSubmit={(e) => {
          e.preventDefault();
          if (!pending) onSubmit([...chosen]);
        }}
      >
        <fieldset className={s.people} aria-labelledby={legend}>
          <legend id={legend} className={s.legend}>
            {t('People')}
          </legend>
          {!people.length && <span className={s.hint}>{t('No other internal user')}</span>}
          {people.map((p) => (
            <label key={p.userId} className={s.person}>
              <input type="checkbox" checked={chosen.has(p.userId)} onChange={() => toggle(p.userId)} />
              <span>{dataText(p.name, lang)}</span>
              <span className={s.personTitle}>{t(p.title)}</span>
            </label>
          ))}
        </fieldset>
        <DialogActions>
          <Button variant="secondary" onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button variant="primary" type="submit" disabled={pending}>
            {t('Save')}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
