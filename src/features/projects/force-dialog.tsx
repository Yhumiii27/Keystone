'use client';
// Stage change dialogs of the Projects register (docs/spec/01 §11, 03 §5.7).
// - Force stage change (template 3058–3069, forceVals 3942): opened for a move to Annulé or when the current stage still
//   has unticked deliverables; the reason is mandatory and the confirm button only appears once it is filled in.
// - Change stage (Delivery 7, L-4c = a, R-055): a move with every deliverable ticked asks for its effective date.
// Both carry the effective date of the change (today — the project's data date — by default; not before the previous
// change nor after today, re-checked server-side); the time of entry stays in the audit trail.
import { ArrowRight, CalendarBlank, SealCheck, Square, Warning } from '@phosphor-icons/react/dist/ssr';
import { useId, useState } from 'react';
import { PERSONA_BY_ROLE } from '@/config/personas';
import { Button } from '@/components/ds/Button';
import { Dialog } from '@/components/ds/Dialog';
import { DialogActions } from '@/components/ds/DialogParts';
import { Field, Input } from '@/components/ds/Field';
import { defaultEffectiveDate, effectiveDateError, type StageCode } from '@/domain/lifecycle';
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
  /** Effective-date bounds (ISO): the project's latest stage change and today (its data date). */
  dateBounds: { previous: string | null; today: string };
}

export interface ForceDialogProps {
  request: ForceRequest | null;
  onCancel: () => void;
  onConfirm: (reason: string, effectiveOn: string) => void;
}

/** Remount per request (key) so the reason starts empty, as `forceReason:''` in the prototype. */
export function ForceDialog({ request, onCancel, onConfirm }: ForceDialogProps) {
  return request ? <ForceDialogBody key={`${request.code}>${request.toCode}`} request={request} onCancel={onCancel} onConfirm={onConfirm} /> : null;
}

/** "Effective date" field (max today, min the previous change) and its error / audit hint. */
function EffectiveDateField({ value, onChange, bounds, error }: { value: string; onChange: (v: string) => void; bounds: ForceRequest['dateBounds']; error: string | null }) {
  const { t } = useI18n();
  const id = useId();
  return (
    <Field label={t('Effective date')} htmlFor={id} hint={error ? t(error) : t('Date of the real change (e.g. the signed FAT report). The time you enter it stays in the audit trail.')}>
      <Input
        id={id}
        type="date"
        value={value}
        min={bounds.previous ?? undefined}
        max={defaultEffectiveDate(bounds)}
        required
        aria-required
        aria-invalid={error ? true : undefined}
        onChange={(e) => onChange(e.target.value)}
      />
    </Field>
  );
}

function ForceDialogBody({ request, onCancel, onConfirm }: ForceDialogProps & { request: ForceRequest }) {
  const { t } = useI18n();
  const [reason, setReason] = useState('');
  const [date, setDate] = useState(() => defaultEffectiveDate(request.dateBounds));
  const id = useId();
  const director = PERSONA_BY_ROLE.director;
  const dateError = effectiveDateError(date, request.dateBounds);
  const canConfirm = reason.trim().length > 0 && !dateError;
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
            if (e.key === 'Enter' && canConfirm) onConfirm(reason.trim(), date);
          }}
        />
      </Field>
      <EffectiveDateField value={date} onChange={setDate} bounds={request.dateBounds} error={date ? dateError : null} />
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
          <Button variant="primary" icon={ArrowRight} onClick={() => onConfirm(reason.trim(), date)}>
            {t('Confirm and request validation')}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}

export type MoveRequest = Omit<ForceRequest, 'isCancel' | 'missing'>;

export interface MoveDialogProps {
  request: MoveRequest | null;
  onCancel: () => void;
  onConfirm: (effectiveOn: string) => void;
}

/** "Change stage": every deliverable is ticked — the PM confirms the move and its effective date (L-4c). */
export function MoveDialog({ request, onCancel, onConfirm }: MoveDialogProps) {
  return request ? <MoveDialogBody key={`${request.code}>${request.toCode}`} request={request} onCancel={onCancel} onConfirm={onConfirm} /> : null;
}

function MoveDialogBody({ request, onCancel, onConfirm }: MoveDialogProps & { request: MoveRequest }) {
  const { t } = useI18n();
  const [date, setDate] = useState(() => defaultEffectiveDate(request.dateBounds));
  const dateError = effectiveDateError(date, request.dateBounds);
  return (
    <Dialog
      open
      onClose={onCancel}
      title={t('Change stage')}
      subtitle={`${request.name} · ${request.from} → ${request.to}`}
      width={480}
      placement="center"
      maxHeight={null}
      zIndex={55}
    >
      <form
        className={s.moveForm}
        onSubmit={(e) => {
          e.preventDefault();
          if (!dateError) onConfirm(date);
        }}
      >
        <EffectiveDateField value={date} onChange={setDate} bounds={request.dateBounds} error={date ? dateError : null} />
        <div className={s.note}>
          <CalendarBlank className={s.noteIcon} aria-hidden />
          <span>{t('Every deliverable of the stage is ticked. The history keeps the effective date; the audit trail keeps who entered it and when.')}</span>
        </div>
        <DialogActions variant="flush">
          <Button variant="secondary" onClick={onCancel}>
            {t('Cancel')}
          </Button>
          <Button type="submit" variant="primary" icon={ArrowRight} disabled={!!dateError}>
            {t('Confirm')}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
