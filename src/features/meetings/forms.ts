// "New meeting" — AF `meetings` (docs/spec/05 §5.5; prototype AF catalogue): title*, type, series, date*, time,
// location, invitees*, agenda. Built already translated (the shared dictionary has "Time" → "Temps" and
// "Location" → "Emplacement"; this form says "Heure" and "Lieu", 05 OQ23). Select values are codes.
import type { FormDef } from '@/components/app/form-def';
import { MEETING_SERIES } from '@/domain/meetings';
import type { Lang, T } from '@/i18n/translate';
import { meetingSeries, meetingType } from '@/server/db/codes';
import { formT } from './i18n';

/** AF_RESULT.meetings; the action prefixes the meeting title ("{title} · Meeting created · …"). */
export const MEETING_RESULT = 'Meeting created · invitation synced to the calendar';
/** Prototype default date of the form (Tue 6 Oct 2026, the week after the data set's "now"). */
export const DEFAULT_MEETING_DATE = '6 Oct 2026';

/**
 * The form, translated. `invitees` pre-fills "Invitees" — the prototype's fixed "R. Aubert, L. Fabre, J. Wagner"
 * follows the viewer here (the viewer, then the project manager).
 */
export function meetingFormDef(t: T, lang: Lang, invitees: string): FormDef {
  const tr = formT(t, lang);
  return {
    title: tr('New meeting'),
    kind: 'create',
    submit: tr('Create & invite'),
    fields: [
      { id: 'title', label: tr('Title'), type: 'text', required: true },
      { id: 'type', label: tr('Type'), type: 'select', options: meetingType.codes.map((c) => ({ value: c, label: tr(meetingType.label(c)) })) },
      { id: 'series', label: tr('Series'), type: 'select', options: MEETING_SERIES.map((c) => ({ value: c, label: tr(meetingSeries.label(c)) })) },
      { id: 'date', label: tr('Date'), type: 'text', defaultValue: tr(DEFAULT_MEETING_DATE), required: true },
      { id: 'time', label: tr('Time'), type: 'text', defaultValue: '09:00' },
      { id: 'loc', label: tr('Location'), type: 'text', defaultValue: 'Teams' },
      { id: 'invited', label: tr('Invitees'), type: 'text', defaultValue: invitees, required: true },
      { id: 'agenda', label: tr('Agenda (one point per line)'), type: 'textarea' },
    ],
  };
}

/** Default invitees: the viewer, then the project manager when different ("M. Lefebvre, R. Aubert"). */
export const defaultInvitees = (viewerShort: string, pmShort: string | null | undefined) =>
  [...new Set([viewerShort, pmShort].filter((x): x is string => !!x))].join(', ');
