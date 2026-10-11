// Deliverable drawer (docs/spec/07 §2.3.b, template 1955–1967, dlvVals 4639), opened by `?dlv=D-015` and closed (×,
// scrim, Esc) to the register URL: step indicator (grey when rejected), RACI-B, the record (linked NCRs open the NCR
// log), the issued document — the prototype's drop slot becomes the Codex record of the document (Codex owns the
// documents: "Deposit in Codex" hand-off, "Link a Codex document" for the project team) — the role hint, and the
// client review history (R-114), the actions "Submit to client" and "Start next revision" after a rejection (project
// team), "Accept (PV)" / "Reject with comments" (the project's client contact),
// "Open plan", and on an accepted deliverable "Download PV (PDF)" (acceptance certificate, chapter 4 exports). Server
// Component; the buttons are client islands.
import { FilePlus, FileText, TreeStructure } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { DocumentPreview } from '@/components/app/DocumentPreview';
import { Eyebrow } from '@/components/app/Eyebrow';
import { KeyValueList } from '@/components/app/KeyValueList';
import { ButtonLink } from '@/components/ds/Button';
import { Drawer } from '@/components/ds/Drawer';
import { depositHref, docHref } from '@/features/docs/links';
import { ExportFileButton } from '@/features/exports/export-file-button';
import type { T } from '@/i18n/translate';
import type { DlvDrawerView } from './model';
import { RecordValue } from './ncr-drawer';
import { DeliverableDecideDrawer, DeliverableMoveButton, LinkDocumentButton } from './quality-buttons';
import { QualityStepper } from './stepper';
import s from './quality.module.css';

export function DeliverableDrawer({ code, view: d, context, t }: { code: string; view: DlvDrawerView; context: string; t: T }) {
  return (
    <Drawer open closeHref={d.closeHref} id={d.head} title={d.title} meta={<span className={d.statusClass}>{d.status}</span>}>
      <QualityStepper steps={d.steps} label={t('Status')} />

      <div className={s.section}>
        <Eyebrow>{t('RACI-B')}</Eyebrow>
        {d.raci.map((r) => (
          <div key={r.k} className={s.raciRow}>
            <span className={s.raciKey}>{r.k}</span>
            <span className={s.raciLabel}>{r.l}</span>
            <span>{r.who}</span>
          </div>
        ))}
      </div>

      <KeyValueList title={t('Record')} items={d.record.map((r) => ({ id: r.k, k: r.k, v: <RecordValue r={r} />, color: 'var(--color-text)' }))} />

      <div className={s.section6}>
        <Eyebrow>{t('Document')}</Eyebrow>
        <DocumentPreview ratio="16/7" fit="contain" placeholder={t('Drop the issued document (PDF preview)')} />
        {(d.document || d.canLinkDocument) && (
          <div className={s.docRow}>
            {d.document ? (
              <Link href={docHref(d.document.number, code)} className={s.docLink} scroll={false}>
                <FileText className={s.docIcon} aria-hidden />
                <span className={s.docNumber}>{d.document.number}</span>
                {d.document.title && <span>{d.document.title}</span>}
                {d.document.revision && (
                  <span className={s.docMeta}>
                    {t('Rev')} {d.document.revision} · {t(d.document.statusLabel)}
                  </span>
                )}
              </Link>
            ) : (
              <span className={s.docMeta}>{t('No issued document linked yet')}</span>
            )}
            {d.canLinkDocument && (
              <>
                <ButtonLink variant="ghost" size="compact" icon={FilePlus} href={depositHref(code, { type: d.depositType })} scroll={false}>
                  {t('Deposit in Codex')}
                </ButtonLink>
                <LinkDocumentButton code={code} number={d.number} context={context} options={d.documentOptions} />
              </>
            )}
          </div>
        )}
      </div>

      {d.reviews.length > 0 && (
        <div className={s.section6}>
          <Eyebrow>{t('Client review history')}</Eyebrow>
          {d.reviews.map((r, i) => (
            <div key={i} className={s.reviewRow}>
              <span className={s.reviewLine}>{r.line}</span>
              {r.comments && <span className={s.reviewComments}>{r.comments}</span>}
            </div>
          ))}
        </div>
      )}

      {/* Always rendered, as the prototype's span (template 1964): an empty hint still takes its 12px gap. */}
      <span className={s.hint}>{d.hint}</span>

      <div className={s.drawerActions}>
        {d.canSubmit && <DeliverableMoveButton code={code} number={d.number} to="submitted" label={t('Submit to client')} variant="primary" place="drawer" />}
        {d.restart && <DeliverableMoveButton code={code} number={d.number} to="in_progress" label={d.restart} variant="primary" place="drawer" restart />}
        {d.canDecide && <DeliverableDecideDrawer code={code} number={d.number} context={context} />}
        {d.pvHref && <ExportFileButton href={d.pvHref} label={t('Download PV (PDF)')} variant="secondary" ariaLabel={`${t('Download PV (PDF)')} · ${d.number}`} />}
        <ButtonLink variant="secondary" size="sm" icon={TreeStructure} href={d.planHref}>
          {t('Open plan')}
        </ButtonLink>
      </div>
    </Drawer>
  );
}
