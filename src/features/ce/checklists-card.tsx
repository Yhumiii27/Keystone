'use client';
// R-160 (P2, D9-32): Settings › CE conformity checklists — the essential health and safety requirements (Annex III headings by
// number and short title) and the technical-file headings (Annex IV) the CE files are checked against. The Settings editors (the
// portfolio director, A-14) add an entry, remove (deactivate: the files keep their answers) or restore one, and reset to the
// defaults; the other roles read. The content is to be validated by QHSE (docs/delivery-9/notes-d9-p2ce.md § 6).
import { ArrowCounterClockwise, Plus, SealCheck, X } from '@phosphor-icons/react/dist/ssr';
import { useState, useTransition } from 'react';
import { SectionCard } from '@/components/app/SectionCard';
import { Button } from '@/components/ds/Button';
import { Field, Input, Select } from '@/components/ds/Field';
import { cx } from '@/components/ds/cx';
import { showToast } from '@/components/ds/Toast';
import { useI18n } from '@/i18n/client';
import { addCeChecklistItemAction, resetCeChecklistsAction, setCeChecklistItemActiveAction, type CeActionResult } from './actions';
import s from './ce.module.css';

export interface ChecklistListView {
  kind: 'ehsr' | 'techfile';
  title: string;
  entries: { code: string; title: string; active: boolean }[];
}

async function attempt(p: Promise<CeActionResult>): Promise<boolean> {
  const r = await p;
  if ('error' in r) {
    showToast(r.error);
    return false;
  }
  if (r.toast) showToast(r.toast);
  return true;
}

export function CeChecklistsCard({ lists, canEdit }: { lists: ChecklistListView[]; canEdit: boolean }) {
  const { t } = useI18n();
  const [pending, startTransition] = useTransition();
  const [kind, setKind] = useState<'ehsr' | 'techfile'>('ehsr');
  const [code, setCode] = useState('');
  const [title, setTitle] = useState('');
  const run = (p: () => Promise<CeActionResult>, after?: () => void) =>
    startTransition(async () => {
      if (await attempt(p())) after?.();
    });
  return (
    <SectionCard
      title={t('CE conformity checklists')}
      subtitle={t('Machinery Regulation (EU) 2023/1230 · headings only, the text of the requirements stays in the Regulation · to be validated by QHSE')}
      icon={SealCheck}
      actions={
        canEdit ? (
          <Button variant="ghost" size="sm" icon={ArrowCounterClockwise} disabled={pending} onClick={() => run(() => resetCeChecklistsAction())}>
            {t('Reset to defaults')}
          </Button>
        ) : undefined
      }
    >
      <div className={s.lists}>
        {lists.map((l) => (
          <div key={l.kind} className={s.list}>
            <div className="card-title">{l.title}</div>
            {l.entries.map((e) => (
              <div key={e.code} className={s.entry}>
                <span className={s.code}>{e.code}</span>
                <span className={cx(s.entryTitle, !e.active && s.removed)}>{e.title}</span>
                {canEdit && (
                  <Button
                    variant="ghost"
                    size="xs"
                    icon={e.active ? X : ArrowCounterClockwise}
                    disabled={pending}
                    aria-label={`${t(e.active ? 'Remove' : 'Restore')} · ${e.code}`}
                    onClick={() => run(() => setCeChecklistItemActiveAction(l.kind, e.code, !e.active))}
                  >
                    {t(e.active ? 'Remove' : 'Restore')}
                  </Button>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
      {canEdit && (
        <div className={s.addRow}>
          <Field label={t('List')} htmlFor="ce-add-kind">
            <Select id="ce-add-kind" size="sm" value={kind} options={lists.map((l) => ({ value: l.kind, label: l.title }))} onChange={(e) => setKind(e.target.value as 'ehsr' | 'techfile')} />
          </Field>
          <Field label={t('Number or key')} htmlFor="ce-add-code">
            <Input id="ce-add-code" size="sm" value={code} placeholder={kind === 'ehsr' ? '1.1.9' : 'noise_data'} onChange={(e) => setCode(e.target.value)} />
          </Field>
          <Field label={t('Short title')} htmlFor="ce-add-title">
            <Input id="ce-add-title" size="sm" value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Button
            variant="secondary"
            size="sm"
            icon={Plus}
            disabled={pending || !code.trim() || !title.trim()}
            onClick={() => run(() => addCeChecklistItemAction(kind, code, title), () => {
              setCode('');
              setTitle('');
            })}
          >
            {t('Add')}
          </Button>
        </div>
      )}
    </SectionCard>
  );
}
