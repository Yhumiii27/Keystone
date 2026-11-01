'use client';
// R-198 — dialogs of the interactive Gantt: the keyboard way to do everything a drag does.
// - Activity: start (a "Start no earlier than" constraint), duration in working days, removal of the date constraint, and its
//   predecessors (type, lag, remove, add). Read-only viewers see the same facts without the controls.
// - Relationship (a clicked arrow): type and lag, or removal.
import { useId, useState } from 'react';
import { Button } from '@/components/ds/Button';
import { Dialog } from '@/components/ds/Dialog';
import { DialogActions } from '@/components/ds/DialogParts';
import { Field, Input, Select } from '@/components/ds/Field';
import { useI18n } from '@/i18n/client';
import {
  GANTT_EDIT_ERRORS, GANTT_LINK_TYPES, linkLabel, lockOf, parseDurationDays, parseLag, type GanttActivity, type GanttDates, type GanttEdit, type GanttLink,
  type GanttNetwork,
} from '@/domain/gantt-edit';
import type { CpmLinkType } from '@/domain/cpm';
import type { GanttActivityValues } from './gantt-actions';
import s from './gantt.module.css';

const LINK_TYPE_LABELS: Record<CpmLinkType, string> = {
  FS: 'Finish-to-start', SS: 'Start-to-start', FF: 'Finish-to-finish', SF: 'Start-to-finish',
};
const CONSTRAINT_LABELS: Record<string, string> = {
  SNET: 'Start no earlier than', SNLT: 'Start no later than', FNET: 'Finish no earlier than', FNLT: 'Finish no later than', MSO: 'Must start on', MFO: 'Must finish on',
};

export interface GanttActivityDialogProps {
  activity: GanttActivity;
  network: GanttNetwork;
  /** Dates shown on the Gantt (stored, or the preview). */
  dates: GanttDates | null;
  editable: boolean;
  pending: boolean;
  nameOf: (id: string) => string;
  dayText: (iso: string) => string;
  onClose: () => void;
  onApply: (edits: GanttEdit[], values: GanttActivityValues) => void;
  onAddLink: (link: GanttLink) => void;
  onEditLink: (link: GanttLink) => void;
  onRemoveLink: (link: GanttLink) => void;
}

export function GanttActivityDialog({ activity: a, network, dates, editable, pending, nameOf, dayText, onClose, onApply, onAddLink, onEditLink, onRemoveLink }: GanttActivityDialogProps) {
  const { t } = useI18n();
  const id = useId();
  const lock = lockOf(a);
  const [start, setStart] = useState(dates?.start ?? '');
  const [duration, setDuration] = useState(String(a.duration));
  const [clear, setClear] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const preds = network.links.filter((l) => l.succ === a.id);
  const succs = network.links.filter((l) => l.pred === a.id);
  // R-204: supplier activities are tied on the purchase order, never linked here.
  const isSupplier = (x: string) => !!network.activities.find((y) => y.id === x)?.source;
  const others = network.activities.filter((x) => !x.source && x.id !== a.id && !preds.some((l) => l.pred === x.id));
  const [newPred, setNewPred] = useState('');
  const [newType, setNewType] = useState<CpmLinkType>('FS');
  const [newLag, setNewLag] = useState('0');
  const canMove = editable && !lock;
  const canResize = editable && lock !== 'complete' && a.duration > 0;
  const typeOptions = GANTT_LINK_TYPES.map((x) => ({ value: x, label: `${x} · ${t(LINK_TYPE_LABELS[x])}` }));
  const constraintText = a.constraint && a.constraint.date ? `${t(CONSTRAINT_LABELS[a.constraint.type] ?? a.constraint.type)} ${dayText(a.constraint.date)}` : t('As soon as possible');
  const lockText = lock === 'complete' ? t(GANTT_EDIT_ERRORS.complete) : lock === 'started' ? t(GANTT_EDIT_ERRORS.started) : null;

  const apply = () => {
    setError(null);
    const values: GanttActivityValues = {};
    const edits: GanttEdit[] = [];
    if (clear && a.constraint) {
      values.clearConstraint = true;
      edits.push({ kind: 'clearConstraint', id: a.id });
    }
    if (canMove && !clear && start && start !== dates?.start) {
      values.start = start;
      edits.push({ kind: 'move', id: a.id, start });
    }
    if (canResize && duration.trim() !== String(a.duration)) {
      const days = parseDurationDays(duration);
      if (days == null) return setError(t(GANTT_EDIT_ERRORS.duration));
      values.duration = String(days);
      edits.push({ kind: 'duration', id: a.id, days });
    }
    if (!edits.length) return onClose();
    onApply(edits, values);
  };

  return (
    <Dialog open onClose={onClose} title={nameOf(a.id)} subtitle={dates ? `${dayText(dates.start)} → ${dayText(dates.finish)}` : undefined} width={640}>
      <div className={s.dlgFacts}>
        <span>
          {t('Duration')} · {a.duration} {t('working days')}
        </span>
        <span>
          {t('Total float')} · {dates?.totalFloat ?? '—'}
        </span>
        <span>
          {t('Constraint')} · {constraintText}
        </span>
        {lockText && <span className={s.dlgNote}>{lockText}</span>}
      </div>

      {editable && (
        <form
          className={s.dlgGrid}
          onSubmit={(e) => {
            e.preventDefault();
            apply();
          }}
        >
          <Field label={t('Start date')} htmlFor={`${id}-start`} hint={t('Sets a “Start no earlier than” constraint · the logic can still push the activity later')}>
            <Input id={`${id}-start`} type="date" value={start} disabled={!canMove || clear || pending} onChange={(e) => setStart(e.target.value)} />
          </Field>
          <Field label={t('Duration (working days)')} htmlFor={`${id}-dur`}>
            <Input id={`${id}-dur`} type="number" min={1} max={9999} step={1} value={duration} disabled={!canResize || pending} onChange={(e) => setDuration(e.target.value)} />
          </Field>
          {a.constraint && (
            <label className={s.dlgCheck}>
              <input type="checkbox" checked={clear} disabled={pending} onChange={(e) => setClear(e.target.checked)} />
              {t('Remove the date constraint (as soon as possible)')}
            </label>
          )}
          {error && (
            <div role="alert" className={s.dlgError}>
              {error}
            </div>
          )}
          <DialogActions>
            <Button variant="secondary" onClick={onClose}>
              {t('Cancel')}
            </Button>
            <Button variant="primary" type="submit" disabled={pending}>
              {t('Apply')}
            </Button>
          </DialogActions>
        </form>
      )}

      <div className={s.dlgSection}>
        <div className={s.dlgTitle}>{t('Predecessors')}</div>
        {preds.length === 0 && <div className={s.dlgMuted}>{t('No predecessor')}</div>}
        {preds.map((l) => (
          <LinkRow key={`${l.pred}:${l.type}:${l.lag}`} link={l} other={nameOf(l.pred)} editable={editable && !isSupplier(l.pred)} pending={pending} typeOptions={typeOptions} onSave={onEditLink} onRemove={onRemoveLink} />
        ))}
        {editable && others.length > 0 && (
          <form
            className={s.linkRow}
            onSubmit={(e) => {
              e.preventDefault();
              const lag = parseLag(newLag);
              if (!newPred) return setError(t('Choose an activity'));
              if (lag == null) return setError(t(GANTT_EDIT_ERRORS.lag));
              setError(null);
              onAddLink({ pred: newPred, succ: a.id, type: newType, lag });
              setNewPred('');
            }}
          >
            <Select
              size="inline"
              aria-label={t('New predecessor')}
              value={newPred}
              disabled={pending}
              onChange={(e) => setNewPred(e.target.value)}
              options={[{ value: '', label: t('Add a predecessor…') }, ...others.map((x) => ({ value: x.id, label: nameOf(x.id) }))]}
            />
            <Select size="inline" aria-label={t('Relationship type')} value={newType} disabled={pending} onChange={(e) => setNewType(e.target.value as CpmLinkType)} options={typeOptions} />
            <Input size="inline" aria-label={t('Lag (working days)')} className={s.lagInput} value={newLag} disabled={pending} onChange={(e) => setNewLag(e.target.value)} />
            <Button size="sm" variant="secondary" type="submit" disabled={pending || !newPred}>
              {t('Add')}
            </Button>
          </form>
        )}
      </div>

      {succs.length > 0 && (
        <div className={s.dlgSection}>
          <div className={s.dlgTitle}>{t('Successors')}</div>
          {succs.map((l) => (
            <div key={l.succ} className={s.dlgMuted}>
              {`${linkLabel(l)} → ${nameOf(l.succ)}`}
            </div>
          ))}
        </div>
      )}
      {!editable && (
        <DialogActions>
          <Button variant="secondary" onClick={onClose}>
            {t('Close')}
          </Button>
        </DialogActions>
      )}
    </Dialog>
  );
}

function LinkRow({
  link, other, editable, pending, typeOptions, onSave, onRemove,
}: {
  link: GanttLink;
  other: string;
  editable: boolean;
  pending: boolean;
  typeOptions: { value: string; label: string }[];
  onSave: (l: GanttLink) => void;
  onRemove: (l: GanttLink) => void;
}) {
  const { t } = useI18n();
  const [type, setType] = useState<CpmLinkType>(link.type);
  const [lag, setLag] = useState(String(link.lag));
  if (!editable) return <div className={s.dlgMuted}>{`${other} · ${linkLabel(link)}`}</div>;
  const parsed = parseLag(lag);
  return (
    <form
      className={s.linkRow}
      onSubmit={(e) => {
        e.preventDefault();
        if (parsed != null) onSave({ ...link, type, lag: parsed });
      }}
    >
      <span className={s.linkOther} title={other}>
        {other}
      </span>
      <Select size="inline" aria-label={`${t('Relationship type')} · ${link.pred}`} value={type} disabled={pending} onChange={(e) => setType(e.target.value as CpmLinkType)} options={typeOptions} />
      <Input size="inline" aria-label={`${t('Lag (working days)')} · ${link.pred}`} className={s.lagInput} value={lag} disabled={pending} onChange={(e) => setLag(e.target.value)} aria-invalid={parsed == null || undefined} />
      <Button size="sm" variant="secondary" type="submit" disabled={pending || parsed == null || (type === link.type && parsed === link.lag)}>
        {t('Save')}
      </Button>
      <Button size="sm" variant="ghost" disabled={pending} onClick={() => onRemove(link)}>
        {t('Remove')}
      </Button>
    </form>
  );
}

export interface GanttLinkDialogProps {
  link: GanttLink;
  editable: boolean;
  pending: boolean;
  nameOf: (id: string) => string;
  onClose: () => void;
  onSave: (link: GanttLink) => void;
  onRemove: () => void;
}

export function GanttLinkDialog({ link, editable, pending, nameOf, onClose, onSave, onRemove }: GanttLinkDialogProps) {
  const { t } = useI18n();
  const id = useId();
  const [type, setType] = useState<CpmLinkType>(link.type);
  const [lag, setLag] = useState(String(link.lag));
  const parsed = parseLag(lag);
  return (
    <Dialog open onClose={onClose} title={`${link.pred} ${linkLabel(link)} → ${link.succ}`} subtitle={`${nameOf(link.pred)} → ${nameOf(link.succ)}`} width={520}>
      {editable ? (
        <form
          className={s.dlgGrid}
          onSubmit={(e) => {
            e.preventDefault();
            if (parsed != null) onSave({ ...link, type, lag: parsed });
          }}
        >
          <Field label={t('Relationship type')} htmlFor={`${id}-type`}>
            <Select
              id={`${id}-type`}
              value={type}
              disabled={pending}
              onChange={(e) => setType(e.target.value as CpmLinkType)}
              options={GANTT_LINK_TYPES.map((x) => ({ value: x, label: `${x} · ${t(LINK_TYPE_LABELS[x])}` }))}
            />
          </Field>
          <Field label={t('Lag (working days)')} htmlFor={`${id}-lag`} hint={t('Negative = lead')}>
            <Input id={`${id}-lag`} value={lag} disabled={pending} onChange={(e) => setLag(e.target.value)} aria-invalid={parsed == null || undefined} />
          </Field>
          {parsed == null && (
            <div role="alert" className={s.dlgError}>
              {t(GANTT_EDIT_ERRORS.lag)}
            </div>
          )}
          <DialogActions>
            <Button variant="ghost" disabled={pending} onClick={onRemove}>
              {t('Remove')}
            </Button>
            <Button variant="secondary" onClick={onClose}>
              {t('Cancel')}
            </Button>
            <Button variant="primary" type="submit" disabled={pending || parsed == null}>
              {t('Save')}
            </Button>
          </DialogActions>
        </form>
      ) : (
        <DialogActions>
          <Button variant="secondary" onClick={onClose}>
            {t('Close')}
          </Button>
        </DialogActions>
      )}
    </Dialog>
  );
}
