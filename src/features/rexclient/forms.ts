// Action forms of Lessons learned & closure and of the client portal (docs/spec/07 §3 AF `rex`, 03 §8.8 AF `client`):
// definitions in English (FormDialog `translate`; select values are codes, except "Applies to" whose stored value is
// the template / procedure name). Validation lives in src/domain/rexclient.ts (parseNewLesson, parseClientReport).
import type { FormDef } from '@/components/app/form-def';
import { CLIENT_REPORT_FORMATS, LESSON_TARGETS, LESSON_THEMES, clientReportPeriods } from '@/domain/rexclient';

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

/** AF.client "Download status report" → "Download" (run form), at the business date `today` (the period labels). */
export const statusReportForm = (today: string): FormDef => ({
  title: 'Download status report',
  submit: 'Download',
  kind: 'run',
  fields: [
    { id: 'period', label: 'Period', type: 'select', options: clientReportPeriods(today) },
    { id: 'format', label: 'Format', type: 'select', options: CLIENT_REPORT_FORMATS },
  ],
});
