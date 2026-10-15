// Confirmation toasts of the projects register (X-9 = yes, L-1; R-152): built here so they are unit-tested. Keystone's own
// vocabulary goes through `t()`; the project code and number stay as they are and the typed project name is shown as typed
// (R-148: never segment-translated, "Sun Valley Farm" stays "Sun Valley Farm").
import { dataText } from '@/i18n/data-text';
import type { Lang, T } from '@/i18n/translate';

/** L-1: a forced stage change (missing deliverables, or Annulé) waits for the portfolio director's validation. */
export const forcedMoveToastText = (code: string, t: T) => `${code} · ${t('Validation requested from the portfolio director')}`;

/** New project created: "#052 · {name as typed} · Project created". */
export const projectCreatedToastText = (number: string, name: string, t: T, lang: Lang) => `${number} · ${dataText(name, lang)} · ${t('Project created')}`;
