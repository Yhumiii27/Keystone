'use client';
// "Deposit in Codex" hand-off (docs/spec/10 §4.6, template 2363–2374, depVals 5048–5060; numbered stepper 02 C-26):
// centred modal above the drawer, header "Cx" · "Deposit in Codex" · detection line · ×, then three steps —
//   1 "File & type": what Keystone hands over, the new-revision banner, the file (its name proposes the type and the
//     title; the file itself goes to Codex, Keystone keeps no copy), the type chips "Type proposed · confirm or change";
//   2 "Metadata": title (new document), linked purchase order and article;
//   3 "Number & record": project, type, approval circuit, retention, confidentiality, links and the number Codex will
//     give ("by Codex · CER-HLT-042 (preview)") — "Continue in Codex" records the hand-off.
// Opened by `?deposit=new` (+ `dtype`, `po`, `part` context from other screens) or `?deposit=<number>` (new revision).
import { ArrowSquareOut, FileArrowUp, Info } from '@phosphor-icons/react/dist/ssr';
import { useRouter } from 'next/navigation';
import { useId, useState, useTransition } from 'react';
import { Callout } from '@/components/app/Callout';
import { Eyebrow } from '@/components/app/Eyebrow';
import { KeyValueList } from '@/components/app/KeyValueList';
import { NumberedStepper } from '@/components/app/Stepper';
import { Button } from '@/components/ds/Button';
import { CenteredModal } from '@/components/ds/CenteredModal';
import { cx } from '@/components/ds/cx';
import { Field, Input } from '@/components/ds/Field';
import { showToast } from '@/components/ds/Toast';
import { CODEX_LINK_ATTRS } from '@/server/integrations/codex/links';
import { DEPOSIT_TITLE_MAX, DEPOSIT_REF_MAX, detectDocType, linkedToText, titleFromFileName } from '@/domain/documents';
import { useI18n } from '@/i18n/client';
import { depositInCodexAction } from './actions';
import { CxTile } from './codex-banner';
import { documentsHref } from './links';
import type { DepositView } from './model';
import s from './docs.module.css';

const STEPS = ['File & type', 'Metadata', 'Number & record'];

export function DepositWizard({ view }: { view: DepositView }) {
  const { t } = useI18n();
  const router = useRouter();
  const fileId = useId();
  const [step, setStep] = useState(1);
  const [type, setType] = useState(view.initial.type);
  const [po, setPo] = useState(view.initial.po);
  const [part, setPart] = useState(view.initial.part);
  const [fileName, setFileName] = useState('');
  const [detected, setDetected] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  /** R-033 (A-15): with Codex connected the hand-off is refused with a link to deposit in Codex. */
  const [errorLink, setErrorLink] = useState<{ href: string; label: string } | null>(null);
  const [pending, start] = useTransition();

  const revision = view.revision;
  const current = view.types.find((x) => x.code === type) ?? view.types[0];
  const subtitle = revision
    ? t('New revision of an existing document')
    : `${t(detected && detected === current.code ? 'Type detected from file name' : 'Type proposed')} · ${current.label}`;

  const onFile = (name: string) => {
    setFileName(name);
    if (revision) return;
    const code = detectDocType(name);
    const known = code && view.types.some((x) => x.code === code) ? code : null;
    setDetected(known);
    if (known) setType(known);
    if (name && (!title.trim() || title === titleFromFileName(fileName))) setTitle(titleFromFileName(name).slice(0, DEPOSIT_TITLE_MAX));
  };

  const canAdvance = step !== 2 || !!revision || !!title.trim();
  const finish = () =>
    start(async () => {
      setError(null);
      setErrorLink(null);
      const r = await depositInCodexAction({ project: view.page, type, title, po, part, revisionOf: revision?.number ?? '' });
      if ('error' in r) {
        setError(r.error);
        setErrorLink(r.link ?? null);
        return;
      }
      showToast(r.toast);
      // `finish()` resets the saved view, family and status in both modes; a new record opens its drawer, a new
      // revision closes the dialog and the drawer.
      const reset = { ...view.keep, view: null, fam: null, status: null };
      router.push(documentsHref(view.page, r.created ? { ...reset, doc: r.number } : reset), { scroll: false });
    });

  const summary = [
    { k: t('Project'), v: view.projectText },
    { k: t('Type'), v: current.typeText },
    { k: t('Approval circuit'), v: current.circuit },
    { k: t('Retention'), v: current.retention },
    { k: t('Confidentiality'), v: current.confidentiality },
    { k: t('Linked to'), v: linkedToText(po, part) },
    { k: t('Numbering'), v: t(`by Codex · ${current.number} (preview)`) },
  ];

  return (
    <CenteredModal open closeHref={view.closeHref} leading={<CxTile />} title={t('Deposit in Codex')} subtitle={subtitle}>
      <NumberedStepper steps={STEPS.map((x) => t(x))} current={step} />

      {revision && <div className={s.ctxBanner}>{revision.context}</div>}

      {step === 1 && (
        <>
          <Callout variant="emphasis" tone="neutral" icon={Info}>
            {t('Keystone hands the context over to Codex — project, suggested type, linked order or article. Codex numbers the document, runs the approval circuit and sends the record back to this index.')}
          </Callout>
          <label
            htmlFor={fileId}
            className={s.drop}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              onFile(e.dataTransfer.files?.[0]?.name ?? '');
            }}
          >
            <FileArrowUp className={s.dropIcon} aria-hidden />
            {t('Drop a file or click to choose')}
            {fileName && <span className={s.dropFile}>{fileName}</span>}
            <input
              id={fileId}
              type="file"
              className={s.fileInput}
              onChange={(e) => onFile(e.target.files?.[0]?.name ?? '')}
            />
          </label>
          <div className={s.sectionWide}>
            <Eyebrow>{t('Type proposed · confirm or change')}</Eyebrow>
            <div className={s.typeChips} role="group" aria-label={t('Type')}>
              {view.types.map((x) => (
                <button
                  key={x.code}
                  type="button"
                  className={cx(s.typeChip, x.code === type && s.typeChipOn)}
                  aria-pressed={x.code === type}
                  onClick={() => setType(x.code)}
                >
                  <span className={s.typeCode}>{x.code}</span> {x.label}
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      {step === 2 && (
        <div className={s.grid2}>
          <Field label={t('Title')} required={!revision} htmlFor={`${fileId}-title`} className={s.full}>
            <Input
              id={`${fileId}-title`}
              value={revision ? revision.title : title}
              disabled={!!revision}
              maxLength={DEPOSIT_TITLE_MAX}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus={!revision}
            />
          </Field>
          <Field label={t('Linked purchase order')} htmlFor={`${fileId}-po`}>
            <Input id={`${fileId}-po`} value={po} maxLength={DEPOSIT_REF_MAX} onChange={(e) => setPo(e.target.value)} />
          </Field>
          <Field label={t('Linked article')} htmlFor={`${fileId}-part`}>
            <Input id={`${fileId}-part`} value={part} maxLength={DEPOSIT_REF_MAX} onChange={(e) => setPart(e.target.value)} />
          </Field>
        </div>
      )}

      {step === 3 && <KeyValueList items={summary} />}

      {error && (
        <Callout variant="compact" tone="accent" role="alert">
          {error}
          {errorLink && (
            <>
              {' · '}
              <a href={errorLink.href} {...CODEX_LINK_ATTRS}>
                {errorLink.label}
              </a>
            </>
          )}
        </Callout>
      )}

      <div className={s.footer}>
        <Button variant="ghost" size="sm" onClick={() => router.push(view.closeHref, { scroll: false })}>
          {t('Cancel')}
        </Button>
        {step > 1 && (
          <Button variant="secondary" size="sm" onClick={() => setStep(step - 1)}>
            {t('Back')}
          </Button>
        )}
        {step < 3 ? (
          <Button variant="primary" size="sm" disabled={!canAdvance} onClick={() => setStep(step + 1)}>
            {t('Next')}
          </Button>
        ) : (
          <Button variant="primary" size="sm" icon={ArrowSquareOut} disabled={pending} aria-busy={pending || undefined} onClick={finish}>
            {t('Continue in Codex')}
          </Button>
        )}
      </div>
    </CenteredModal>
  );
}
