'use client';
// Import wizard "Import a list" (docs/spec/09 §8.9, template 2452–2471, `engImpVals` 4813): centred modal above the
// page (z 70/71, 720px), header "Import a list" + "<document> · rev X → <discipline>", numbered stepper Source →
// Column mapping → Check & import, then
//   1 the source tool (radio choice, ENG_TOOLS) and the drop zone with the export file name;
//   2 the column mapping (ENG_MAP, "auto-detected");
//   3 the check: rows / new tags / attribute changed / unknown references and the deltas (ENG_DELTAS).
// "Import · freeze this revision as input" records the import (the discipline's input becomes the document's current
// revision, to confirm; revision-alignment checks close) and closes the wizard. The file itself stays in the business
// tool: the export is simulated, as in the prototype. Opened by `?import=<discipline>&doc=<document>&tool=<n>`; the
// step and the tool are client state (closing resets them, as the prototype's close resets the step).
import { FileXls, UploadSimple } from '@phosphor-icons/react/dist/ssr';
import { useRouter } from 'next/navigation';
import { useState, useTransition, type CSSProperties } from 'react';
import { EmptyState } from '@/components/app/EmptyState';
import { NumberedStepper } from '@/components/app/Stepper';
import { Button } from '@/components/ds/Button';
import { CenteredModal } from '@/components/ds/CenteredModal';
import { Table } from '@/components/ds/Table';
import { Tag } from '@/components/ds/Tag';
import { useI18n } from '@/i18n/client';
import { importToolLook, type Discipline, type ImportTarget } from '@/domain/engineering';
import { importListAction } from './actions';
import type { ImportWizardModel } from './model';
import s from './eng.module.css';

export interface ImportWizardProps {
  code: string;
  /** Screen the wizard was opened from: 'eng' (Synthesis) or a discipline. */
  from: 'eng' | Discipline;
  target: ImportTarget;
  model: ImportWizardModel;
  /** The screen without the wizard (Cancel, ×, scrim, after the import). */
  closeHref: string;
}

export function ImportWizard({ code, from, target, model, closeHref }: ImportWizardProps) {
  const { t } = useI18n();
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [tool, setTool] = useState(target.tool);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const close = () => router.push(closeHref, { scroll: false });
  const finish = () =>
    start(async () => {
      setError(null);
      try {
        const r = await importListAction({ code, from, disc: target.disc, doc: target.doc, tool });
        if (!r.ok) {
          setError(r.error);
          return;
        }
        close();
      } catch {
        setError(t('The change could not be saved'));
      }
    });

  return (
    <CenteredModal open width={720} title={t('Import a list')} subtitle={model.target} closeHref={closeHref}>
      <NumberedStepper steps={model.steps.map((x) => x.label)} current={step} />

      {step === 1 && (
        <>
          <div className={s.wizCol} role="radiogroup" aria-label={t('Source tool')}>
            <span className={s.eyebrow}>{t('Source tool')}</span>
            {model.tools.map((x) => {
              const look = importToolLook(x.position === tool);
              return (
                <button
                  key={x.position}
                  type="button"
                  role="radio"
                  aria-checked={x.position === tool}
                  className={s.tool}
                  style={{ background: look.bg, borderColor: look.border } as CSSProperties}
                  onClick={() => setTool(x.position)}
                >
                  <span className={s.toolDot} style={{ background: look.dot }} />
                  {x.label}
                  <span className={s.toolDisc}>{x.disc}</span>
                </button>
              );
            })}
          </div>
          <EmptyState variant="drop" icon={FileXls}>
            {t('Drop the xlsx / csv export here')}
            <span className={s.fileName}>{model.file}</span>
          </EmptyState>
        </>
      )}

      {step === 2 && (
        <Table size={12.5}>
          <thead>
            <tr>
              <th>{t('Source column')}</th>
              <th>{t('Keystone field')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {model.map.map((m) => (
              <tr key={m.src}>
                <td className={s.tab}>{m.src}</td>
                <td>{m.dst}</td>
                <td className={s.right}>
                  <Tag tone="neutral" size="micro">
                    {t('auto-detected')}
                  </Tag>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      {step === 3 && (
        <>
          <div className={s.stats}>
            {model.stats.map((k) => (
              <div key={k.label} className={s.stat}>
                <span className={s.statValue} style={{ color: k.color }}>
                  {k.value}
                </span>
                <span className={s.statLabel}>{k.label}</span>
              </div>
            ))}
          </div>
          <div className={s.deltas}>
            {model.deltas.map((d) => (
              <div key={d.key} className={s.delta}>
                <span className={s.deltaSym} style={{ color: d.color }}>
                  {d.sym}
                </span>
                <span>{d.label}</span>
                <span className={s.deltaKind}>{d.kind}</span>
              </div>
            ))}
          </div>
          <span className={s.note}>{t('The revision in use is updated · the referent then confirms consumption')}</span>
        </>
      )}

      {error && (
        <span className={s.error} role="alert">
          {error}
        </span>
      )}
      <div className={s.footer}>
        <Button variant="ghost" size="sm" onClick={close}>
          {t('Cancel')}
        </Button>
        {step > 1 && (
          <Button variant="secondary" size="sm" onClick={() => setStep(step - 1)} disabled={pending}>
            {t('Back')}
          </Button>
        )}
        {step < 3 && (
          <Button variant="primary" size="sm" onClick={() => setStep(step + 1)}>
            {t('Next')}
          </Button>
        )}
        {step === 3 && (
          <Button variant="primary" size="sm" icon={UploadSimple} onClick={finish} disabled={pending}>
            {t('Import · freeze this revision as input')}
          </Button>
        )}
      </div>
    </CenteredModal>
  );
}
