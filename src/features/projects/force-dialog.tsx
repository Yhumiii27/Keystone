'use client';
// Force stage change dialog (docs/spec/01 §11, 03 §5.7; template 3058–3069, forceVals 3942). Opened for a move
// to Annulé or when the current stage still has unticked deliverables; the reason is mandatory and the confirm
// button only appears once it is filled in.
import { ArrowRight, SealCheck, Square, Warning } from '@phosphor-icons/react/dist/ssr';
import { useId, useState } from 'react';
import { PERSONA_BY_ROLE } from '@/config/personas';
import { Button } from '@/components/ds/Button';
import { Dialog } from '@/components/ds/Dialog';
import { DialogActions } from '@/components/ds/DialogParts';
import { Field, Input } from '@/components/ds/Field';
import type { StageCode } from '@/domain/lifecycle';
import { useI18n } from '@/i18n/client';
import s from './register.module.css';

export interface ForceRequest {
  code: string;
  /** "#026 · Harbor Line Terminal Expansion" (translated). */
  name: string;
  /** Translated stage labels. */
  from: string;
  to: string;
  /** Target stage code. */
  toCode: StageCode;
  isCancel: boolean;
  /** Unticked deliverables of the current stage (translated); empty for Annulé. */
  missing: string[];
}

export interface ForceDialogProps {
  request: ForceRequest | null;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}

/** Remount per request (key) so the reason starts empty, as `forceReason:''` in the prototype. */
export function ForceDialog({ request, onCancel, onConfirm }: ForceDialogProps) {
  return request ? <ForceDialogBody key={`${request.code}>${request.toCode}`} request={request} onCancel={onCancel} onConfirm={onConfirm} /> : null;
}

function ForceDialogBody({ request, onCancel, onConfirm }: ForceDialogProps & { request: ForceRequest }) {
  const { t } = useI18n();
  const [reason, setReason] = useState('');
  const id = useId();
  const director = PERSONA_BY_ROLE.director;
  const canConfirm = reason.trim().length > 0;
  return (
    <Dialog
      open
      onClose={onCancel}
      title={t('Force stage change')}
      subtitle={`${request.name} · ${request.from} → ${request.to}`}
      width={560}
      placement="center"
      maxHeight={null}
      zIndex={55}
    >
      {request.missing.length > 0 && (
        <div className={s.missing}>
          <div className={s.missingTitle}>
            <Warning className={s.accentIcon} aria-hidden />
            {t('Missing deliverables')}
          </div>
          {request.missing.map((m) => (
            <span key={m} className={s.missingItem}>
              <Square className={s.squareIcon} aria-hidden />
              {m}
            </span>
          ))}
        </div>
      )}
      {request.isCancel && (
        <span className={s.cancelNote}>
          {t('Cancelling a project stops every open request, order and task. The decision is recorded in the stage history.')}
        </span>
      )}
      <Field label={t('Reason for forcing (required)')} htmlFor={id}>
        <Input
          id={id}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={t('e.g. client pressure on delivery date, deliverable to follow next week')}
          maxLength={500}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && canConfirm) onConfirm(reason.trim());
          }}
        />
      </Field>
      <div className={s.note}>
        <SealCheck className={s.noteIcon} aria-hidden />
        <span>
          {t('A forced change is applied immediately and sent for validation to the portfolio director')} — {director.name} ·{' '}
          {t(director.title)}. {t('The history keeps the mode (auto / forced) and the reason.')}
        </span>
      </div>
      <DialogActions variant="flush">
        <Button variant="secondary" onClick={onCancel}>
          {t('Cancel')}
        </Button>
        {canConfirm && (
          <Button variant="primary" icon={ArrowRight} onClick={() => onConfirm(reason.trim())}>
            {t('Confirm and request validation')}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
