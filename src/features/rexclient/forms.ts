// Action form of Lessons learned & closure (docs/spec/07 §3 AF `rex`): definition in English (FormDialog `translate`; select
// values are codes, except "Applies to" whose stored value is the template / procedure name). Validation lives in
// src/domain/rexclient.ts (parseNewLesson).
import type { FormDef } from '@/components/app/form-def';
import { LESSON_TARGETS, LESSON_THEMES } from '@/domain/rexclient';

/** AF.rex "Add lesson learned" → "Record". */
export const LESSON_FORM: FormDef = {
  title: 'Add lesson learned',
  submit: 'Record',
  kind: 'create',
  fields: [
    { id: 'theme', label: 'Theme', type: 'select', options: LESSON_THEMES },
    { id: 'what', label: 'What happened', type: 'textarea', required: true },
    { id: 'impact', label: 'Impact', type: 'text' },
    { id: 'reco', label: 'Recommendation', type: 'textarea', required: true },
    { id: 'apply', label: 'Applies to', type: 'select', options: [...LESSON_TARGETS] },
  ],
};
