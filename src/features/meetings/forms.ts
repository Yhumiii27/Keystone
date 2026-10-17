// "New meeting" — AF `meetings` (docs/spec/05 §5.5; prototype AF catalogue): title*, type, series, date*, time,
// location, invitees*, agenda. Built already translated (the shared dictionary has "Time" → "Temps" and
// "Location" → "Emplacement"; this form says "Heure" and "Lieu", 05 OQ23). Select values are codes.
import type { FormDef } from '@/components/app/form-def';
import { formDateText, newMeetingDateIso } from '@/domain/form-dates';
import { MEETING_SERIES } from '@/domain/meetings';
import type { Lang, T } from '@/i18n/translate';
import { meetingSeries, meetingType } from '@/server/db/codes';
import { formT } from './i18n';

/**
 * AF_RESULT.meetings; the action prefixes the meeting title ("{title} · Meeting created"). S-11 / A-15 (R-037): no invitation is
 * sent and nothing is synced to a calendar (the prototype said "invitation synced to the calendar").
 */
export const MEETING_RESULT = 'Meeting created';
/**
 * Default date of the form: the Tuesday of the week after next from the data date (R-169; Tue 6 Oct 2026 on the seed, the
 * prototype's literal).
 */
export const defaultMeetingDate = (dataDate: string) => formDateText(newMeetingDateIso(dataDate));

/**
 * The form, translated. `invitees` pre-fills "Invitees" — the prototype's fixed "R. Aubert, L. Fabre, J. Wagner"
 * follows the viewer here (the viewer, then the project manager).
 */
export function meetingFormDef(t: T, lang: Lang, invitees: string, dataDate: string): FormDef {
  const tr = formT(t, lang);
  return {
    title: tr('New meeting'),
    kind: 'create',
    // S-11 / A-15 (R-037): the meeting is created in Keystone, no invitation goes out (was "Create & invite").
    submit: tr('Create meeting'),
    fields: [
      { id: 'title', label: tr('Title'), type: 'text', required: true },
      { id: 'type', label: tr('Type'), type: 'select', options: meetingType.codes.map((c) => ({ value: c, label: tr(meetingType.label(c)) })) },
      { id: 'series', label: tr('Series'), type: 'select', options: MEETING_SERIES.map((c) => ({ value: c, label: tr(meetingSeries.label(c)) })) },
      { id: 'date', label: tr('Date'), type: 'text', defaultValue: tr(defaultMeetingDate(dataDate)), required: true },
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
