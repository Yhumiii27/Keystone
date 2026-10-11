// "Client issues" card of the project's Stakeholders & RACI screen (R-137, L-6): the issues the client raised in the portal,
// as the project team handles them — raised by / on, status, the answer the client sees, who took the issue in charge — and
// the project manager's steps (Take in charge, Answer, Close; client island). `?issue=CI-08` (the PM's notification)
// highlights the row. Internal: the client never sees this card (P-10b; the portal shows only the answer and the status).
// Server Component.
import { EmptyState } from '@/components/app/EmptyState';
import { SectionCard } from '@/components/app/SectionCard';
import { cx } from '@/components/ds/cx';
import type { T } from '@/i18n/translate';
import { IssueActions } from './buttons';
import type { ClientIssuesView } from './model';
import s from './client-issues.module.css';

export function ClientIssuesCard({ code, view, t }: { code: string; view: ClientIssuesView; t: T }) {
  return (
    <SectionCard title={t('Client issues')} hint={t('Raised in the client portal · the client sees your answer and the status')}>
      {view.rows.map((r) => (
        <div key={r.number} id={`issue-${r.number}`} className={cx(s.row, r.selected && s.selected)} aria-current={r.selected ? 'true' : undefined}>
          <div className={s.text}>
            <span className={s.title}>
              <span className={s.number}>{r.number}</span>
              {r.title}
            </span>
            <span className={s.meta}>{r.meta}</span>
            <span className={cx(s.answer, !r.answered && s.pending)}>{r.answer}</span>
            {r.handling && <span className={s.meta}>{r.handling}</span>}
          </div>
          <div className={s.side}>
            <span className={r.tagClass}>{r.status}</span>
            {r.actions && (
              <div className={s.actions}>
                <IssueActions code={code} number={r.number} from={r.actions.from} context={`${r.number} · ${r.title}`} take={r.actions.take} answer={r.actions.answer} close={r.actions.close} />
              </div>
            )}
          </div>
        </div>
      ))}
      {!view.rows.length && <EmptyState>{t('No issue raised by the client yet')}</EmptyState>}
    </SectionCard>
  );
}
