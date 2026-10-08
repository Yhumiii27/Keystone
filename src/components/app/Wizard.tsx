'use client';
// Multi-step wizard dialog (docs/spec/02 C-21 Wizard / C-26 WizardBars; New project wizard docs/spec/01 §10):
// header "title / Guided setup · step N of M", step bars, current step body, footer Back · Next / Finish.
import { ArrowRight, Check } from '@phosphor-icons/react/dist/ssr';
import type { Icon } from '@phosphor-icons/react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ds/Button';
import { Dialog } from '@/components/ds/Dialog';
import { DialogActions } from '@/components/ds/DialogParts';
import { useI18n } from '@/i18n/client';
import { WizardSteps } from './Stepper';

export interface WizardDialogProps {
  open: boolean;
  onClose: () => void;
  /** Dialog title (translated), e.g. t('New project'). */
  title: ReactNode;
  /** Sub-line; default `"{t('Guided setup · step')} N {t('of M')}"`. */
  subtitle?: ReactNode;
  /** Step labels (translated). */
  steps: ReactNode[];
  /** Current step, 1-based. */
  step: number;
  onStepChange: (step: number) => void;
  /** Called by the last step's primary button. */
  onFinish: () => void;
  /** Disable Next/Finish (the prototype has no validation; available for callers that need it). */
  canAdvance?: boolean;
  pending?: boolean;
  /** Labels (translated); defaults: t('Back'), t('Next'), t('Create project'). */
  labels?: { back?: string; next?: string; finish?: string; close?: string };
  finishIcon?: Icon;
  /** 720 (default). */
  width?: number;
  zIndex?: number;
  /** Body of the current step. */
  children: ReactNode;
}

/** Dialog 720px wide, top 6vh, max-height 88vh; actions `.dialog-actions` with margin-top 0. */
export function WizardDialog({
  open,
  onClose,
  title,
  subtitle,
  steps,
  step,
  onStepChange,
  onFinish,
  canAdvance = true,
  pending,
  labels,
  finishIcon = Check,
  width = 720,
  zIndex,
  children,
}: WizardDialogProps) {
  const { t } = useI18n();
  const last = step >= steps.length;
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      subtitle={subtitle ?? `${t('Guided setup · step')} ${step} ${t(`of ${steps.length}`)}`}
      closeLabel={labels?.close}
      width={width}
      offsetTop="6vh"
      maxHeight="88vh"
      zIndex={zIndex}
    >
      <WizardSteps steps={steps} current={step} />
      {children}
      <DialogActions variant="flush">
        {step > 1 && (
          <Button variant="secondary" onClick={() => onStepChange(step - 1)}>
            {labels?.back ?? t('Back')}
          </Button>
        )}
        {last ? (
          <Button variant="primary" icon={finishIcon} onClick={onFinish} disabled={!canAdvance || pending}>
            {labels?.finish ?? t('Create project')}
          </Button>
        ) : (
          <Button variant="primary" iconRight={ArrowRight} onClick={() => onStepChange(step + 1)} disabled={!canAdvance}>
            {labels?.next ?? t('Next')}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
