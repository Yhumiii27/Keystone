// View model of the "Client issues" card (R-137): rows translated for the viewer, with the project manager's steps and
// their forms. Pure (no I/O): the page passes the DAL rows, whether the viewer handles issues on this project, the
// highlighted issue, `t` and the language. Texts typed by the client or the PM are shown as typed (exact dictionary
// matches only, as the client portal).
import type { FormDef } from '@/components/app/form-def';
import { TAG_CLASS } from '@/components/app/tones';
import { ISSUE_ACKNOWLEDGEMENT, hasRealAnswer } from '@/domain/client-issues';
import { ISSUE_TONE, issueRow } from '@/domain/rexclient';
import { exactText } from '@/features/rexclient/i18n';
import type { Lang, T } from '@/i18n/translate';
import { fmtDOfIso } from '@/server/db/codes';
import type { ClientIssueHandlingRow } from '@/server/dal/client';

export interface ClientIssueRowView {
  number: string;
  title: string;
  /** "Raised 22 Sep · Nadia Bensaïd". */
  meta: string;
  status: string;
  tagClass: string;
  /** The answer the client sees, or "Not answered yet" while only acknowledged. */
  answer: string;
  answered: boolean;
  /** "Taken in charge 30 Sep · Romain Aubert · Answered 30 Sep · Closed on 2 Oct"; null when nobody took it yet. */
  handling: string | null;
  selected: boolean;
  /** The PM's steps on this row; null for read-only viewers or a closed issue. */
  actions: {
    from: string;
    take: string | null;
    answer: { label: string; form: FormDef } | null;
    close: { label: string; form: FormDef } | null;
  } | null;
}

export interface ClientIssuesView {
  rows: ClientIssueRowView[];
}

const answerForm = (t: T, title: string, submit: string, required: boolean, current: string): FormDef => ({
  title,
  submit,
  fields: [
    {
      id: 'answer', label: t('Answer to the client'), type: 'textarea', required, defaultValue: current,
      placeholder: required ? t('The client sees this answer in the portal') : t('Leave empty to keep the current answer'),
    },
  ],
});

export function clientIssuesView(rows: readonly ClientIssueHandlingRow[], opts: { canHandle: boolean; selected: string | null }, t: T, lang: Lang): ClientIssuesView {
  return {
    rows: rows.map((i) => {
      const r = issueRow(i);
      const real = hasRealAnswer(i.response);
      const handling = i.handledBy
        ? [
            `${t('Taken in charge')} ${t(fmtDOfIso(i.takenOn ?? i.raisedOn))} · ${i.handledBy}`,
            i.answeredOn ? `${t('Answered')} ${t(fmtDOfIso(i.answeredOn))}` : '',
            i.closedOn ? `${t('Closed on')} ${t(fmtDOfIso(i.closedOn))}` : '',
          ].filter(Boolean).join(' · ')
        : null;
      const current = real ? i.response : '';
      const can = opts.canHandle && i.steps.length > 0;
      return {
        number: i.number,
        title: exactText(i.title, lang),
        meta: `${t(r.when)} · ${i.raisedBy}`,
        status: t(r.status),
        tagClass: TAG_CLASS[ISSUE_TONE[i.status]],
        answer: real ? exactText(i.response, lang) : t(i.response === ISSUE_ACKNOWLEDGEMENT ? 'Acknowledged — not answered yet' : 'Not answered yet'),
        answered: real,
        handling,
        selected: opts.selected === i.number,
        actions: can
          ? {
              from: i.status,
              take: i.steps.includes('take') ? t('Take in charge') : null,
              answer: i.steps.includes('answer') ? { label: t('Answer'), form: answerForm(t, t('Answer the client'), t('Send answer'), true, current) } : null,
              close: i.steps.includes('close') ? { label: t('Close issue'), form: answerForm(t, t('Close the issue'), t('Close the issue'), !real, '') } : null,
            }
          : null,
      };
    }),
  };
}
