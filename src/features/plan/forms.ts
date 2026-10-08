// The Plan's three add-forms (prototype `AF.plan`, `AF.wp`, `AF.progress`, logic 3674–3700), in English
// (FormDialog `translate` renders them in French). Option lists are resolved per project by the page.
import type { FormDef } from '@/components/app/form-def';

export type PlanFormKey = 'plan' | 'wp' | 'progress';

export interface PlanFormSources {
  /** WP: "1.1 · Design & permits", … */
  wp: string[];
  /** TEAM: the project team's full names (DEFS.team). */
  team: string[];
  /** ACTOPEN: "A1250 · Steel erection — Bays 3–4" for activities below 100 %. */
  actOpen: string[];
}

export function planFormDefs(src: PlanFormSources): Record<PlanFormKey, FormDef> {
  return {
    plan: {
      title: 'Add activity',
      kind: 'create',
      submit: 'Create activity',
      fields: [
        { id: 'name', label: 'Activity name', type: 'text', required: true },
        { id: 'wp', label: 'Work package', type: 'select', options: src.wp },
        { id: 'owner', label: 'Owner', type: 'select', options: src.team },
        { id: 'start', label: 'Start date', type: 'text', defaultValue: '5 Oct 2026' },
        { id: 'finish', label: 'Finish', type: 'text', defaultValue: '30 Oct 2026' },
        { id: 'budget', label: 'Budget (k€)', type: 'number', defaultValue: '40' },
        { id: 'critical', label: 'Critical path', type: 'select', options: ['No', 'Yes'] },
        { id: 'desc', label: 'Description', type: 'textarea' },
      ],
    },
    wp: {
      title: 'Add work package',
      kind: 'create',
      submit: 'Create work package',
      fields: [
        { id: 'name', label: 'Work package name', type: 'text', required: true },
        { id: 'owner', label: 'Owner', type: 'select', options: src.team },
        { id: 'budget', label: 'Budget (k€)', type: 'number', defaultValue: '100' },
        { id: 'desc', label: 'Scope', type: 'textarea' },
      ],
    },
    progress: {
      title: 'Update progress',
      kind: 'run',
      submit: 'Save progress',
      fields: [
        { id: 'act', label: 'Activity', type: 'select', options: src.actOpen },
        { id: 'pc', label: '% complete', type: 'number', defaultValue: '50', required: true },
        { id: 'note', label: 'Note', type: 'textarea' },
      ],
    },
  };
}
