// "New deliverable" form (R-115, Q-3b: the project manager adds the contractual deliverables) — type (Settings › Deliverable
// types, active), title, due date, WBS element of the project, responsible (R) and backup (B) from the project team.
// Built and translated on the server; FormDialog renders it as is. Values are codes (type, WBS) and full names (people).
import type { FormDef } from '@/components/app/form-def';
import type { T } from '@/i18n/translate';

/** "—" option of the backup select (no backup). */
export const NO_BACKUP = '—';

export function newDeliverableFormDef(
  opts: { types: readonly { code: string; label: string }[]; wbs: readonly { code: string; name: string }[]; team: readonly string[] },
  t: T,
): FormDef {
  return {
    title: t('New deliverable'),
    kind: 'create',
    submit: t('Add deliverable'),
    fields: [
      { id: 'type', label: t('Type'), type: 'select', options: opts.types.map((x) => ({ value: x.code, label: t(x.label) })) },
      { id: 'title', label: t('Title'), type: 'text', required: true },
      { id: 'due', label: t('Due'), type: 'text', required: true, placeholder: t('e.g. 15 Oct') },
      { id: 'wbs', label: t('WBS'), type: 'select', options: opts.wbs.map((w) => ({ value: w.code, label: `${w.code} · ${w.name}` })) },
      { id: 'r', label: t('Responsible (R)'), type: 'select', options: [...opts.team] },
      { id: 'b', label: t('Backup (B)'), type: 'select', options: [NO_BACKUP, ...opts.team] },
    ],
  };
}
