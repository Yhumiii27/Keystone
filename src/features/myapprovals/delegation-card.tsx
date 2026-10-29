'use client';
// R-051 (owner answer P-7d): the "Delegation" card of My approvals. The approver declares a substitute and a period, sees and
// cancels their delegations; the substitute sees the banner of the approvers they stand in for (their items are listed in the
// queue with "On behalf of"); the portfolio director sees and cancels every delegation. Server Functions:
// ./delegation-actions.ts. Names and notes are typed text (dataText); dates go through t() like the queue's dates.
import { Prohibit, UserSwitch, X } from '@phosphor-icons/react/dist/ssr';
import { useId, useState, useTransition } from 'react';
import { Callout } from '@/components/app/Callout';
import { SectionCard } from '@/components/app/SectionCard';
import { Button } from '@/components/ds/Button';
import { Dialog } from '@/components/ds/Dialog';
import { DialogActions } from '@/components/ds/DialogParts';
import { Field, Input, Select, Textarea } from '@/components/ds/Field';
import { Tag } from '@/components/ds/Tag';
import { useToast } from '@/components/ds/Toast';
import { DELEGATION_NOTE_MAX, type DelegationPanel, type DelegationState, type DelegationView } from '@/domain/delegations';
import { useI18n } from '@/i18n/client';
import { dataText } from '@/i18n/data-text';
import { cancelDelegationAction, declareDelegationAction } from './delegation-actions';
import s from './myapprovals.module.css';

const STATE_LABEL: Record<DelegationState, string> = { upcoming: 'Upcoming', active: 'Running', ended: 'Ended', cancelled: 'Cancelled' };

/** Banner of the substitute (top of My approvals): the approvers they stand in for today, and the delegations to come. */
export function DelegationBanner({ panel }: { panel: DelegationPanel }) {
  const { t, lang } = useI18n();
  if (!panel.standingIn.length && !panel.upcomingFor.length) return null;
  const period = (d: DelegationView) => `${t(d.from)} → ${t(d.to)}`;
  return (
    <>
      {panel.standingIn.map((d) => (
        <Callout key={d.id} variant="emphasis" icon={UserSwitch} role="status">
          {t('You stand in for')} {dataText(d.approverName, lang)} · {period(d)} — {t('their approvals are listed below with “On behalf of”')}
          {d.note ? ` · ${dataText(d.note, lang)}` : ''}
        </Callout>
      ))}
      {panel.upcomingFor.map((d) => (
        <Callout key={d.id} variant="info" icon={UserSwitch}>
          {t('You will stand in for')} {dataText(d.approverName, lang)} · {period(d)}
        </Callout>
      ))}
    </>
  );
}

/** The approver's delegations (declare, cancel) and, for the portfolio director, every delegation. */
export function DelegationCard({ panel }: { panel: DelegationPanel }) {
  const { t, lang } = useI18n();
  const [declaring, setDeclaring] = useState(false);
  const [cancelling, setCancelling] = useState<DelegationView | null>(null);
  const period = (d: DelegationView) => `${t(d.from)} → ${t(d.to)}`;
  const nothing = !panel.mine.length && !panel.all?.length;
  return (
    <SectionCard
      title={t('Delegation')}
      icon={UserSwitch}
      hint={t('Substitute for your approvals while you are away')}
      actions={
        panel.canDeclare ? (
          <Button variant="secondary" size="sm" icon={UserSwitch} onClick={() => setDeclaring(true)} aria-haspopup="dialog">
            {t('Declare a substitute')}
          </Button>
        ) : null
      }
    >
      {panel.mine.map((d) => (
        <DelegationLine key={d.id} d={d} label={`${t('Substitute')}${lang === 'fr' ? ' : ' : ': '}`} name={d.substituteName} period={period(d)} onCancel={setCancelling} />
      ))}
      {panel.all && panel.all.length > 0 && (
        <div className={s.delegationGroup}>
          <span className={s.delegationGroupTitle}>{t('Every delegation')}</span>
          {panel.all.map((d) => (
            <DelegationLine key={d.id} d={d} label="" name={`${d.approverName} → ${d.substituteName}`} period={period(d)} onCancel={setCancelling} />
          ))}
        </div>
      )}
      {nothing && <span className={s.delegationEmpty}>{t('No substitute declared')}</span>}
      {panel.canDeclare && <DeclareDialog open={declaring} panel={panel} onClose={() => setDeclaring(false)} />}
      <CancelDialog d={cancelling} onClose={() => setCancelling(null)} />
    </SectionCard>
  );
}

function DelegationLine({ d, label, name, period, onCancel }: { d: DelegationView; label: string; name: string; period: string; onCancel: (d: DelegationView) => void }) {
  const { t, lang } = useI18n();
  return (
    <div className={s.delegationLine}>
      <span className={s.delegationText}>
        {label}
        <strong>{dataText(name, lang)}</strong> · {period}
        {d.note ? <span className={s.sub}> · {dataText(d.note, lang)}</span> : null}
      </span>
      <Tag tone={d.state === 'active' ? 'accent' : 'outline'}>{t(STATE_LABEL[d.state])}</Tag>
      {d.canCancel && (
        <Button variant="ghost" size="compact" icon={Prohibit} aria-haspopup="dialog" aria-label={`${t('Cancel the delegation')} ${name}`} onClick={() => onCancel(d)}>
          {t('Cancel the delegation')}
        </Button>
      )}
    </div>
  );
}

function DeclareDialog({ open, panel, onClose }: { open: boolean; panel: DelegationPanel; onClose: () => void }) {
  const { t, lang } = useI18n();
  const toast = useToast();
  const ids = { who: useId(), from: useId(), to: useId(), note: useId() };
  const [pending, start] = useTransition();
  const [who, setWho] = useState('');
  const [from, setFrom] = useState(panel.today);
  const [to, setTo] = useState('');
  const [note, setNote] = useState('');
  const close = () => {
    setWho('');
    setFrom(panel.today);
    setTo('');
    setNote('');
    onClose();
  };
  const blocked = pending || !who || !from || !to;
  const submit = () =>
    start(async () => {
      try {
        const r = await declareDelegationAction({ substituteUserId: who, startsOn: from, endsOn: to, note });
        toast.showEn(r.ok ? (r.toast ?? 'Delegation recorded') : r.error);
        if (r.ok) close();
      } catch {
        toast.showEn('The delegation could not be saved');
      }
    });
  return (
    <Dialog open={open} onClose={close} title={t('Declare a substitute')} subtitle={t('During the period, your approvals also reach your substitute, who decides on your behalf')} width={480} placement="center" maxHeight={null}>
      <form
        className={s.rejectForm}
        onSubmit={(e) => {
          e.preventDefault();
          if (!blocked) submit();
        }}
      >
        <Field label={t('Substitute')} required htmlFor={ids.who}>
          <Select id={ids.who} value={who} onChange={(e) => setWho(e.target.value)} autoFocus>
            <option value="">{t('Choose a person')}</option>
            {panel.candidates.map((c) => (
              <option key={c.userId} value={c.userId}>
                {dataText(c.name, lang)} — {t(c.title)}
              </option>
            ))}
          </Select>
        </Field>
        <div className={s.delegationDates}>
          <Field label={t('From')} required htmlFor={ids.from}>
            <Input id={ids.from} type="date" value={from} min={panel.today} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label={t('To')} required htmlFor={ids.to}>
            <Input id={ids.to} type="date" value={to} min={from || panel.today} onChange={(e) => setTo(e.target.value)} />
          </Field>
        </div>
        <Field label={t('Note — your substitute sees this')} htmlFor={ids.note}>
          <Textarea id={ids.note} short value={note} maxLength={DELEGATION_NOTE_MAX} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <DialogActions variant="flush">
          <Button variant="secondary" onClick={close}>
            {t('Cancel')}
          </Button>
          <Button type="submit" variant="primary" icon={UserSwitch} disabled={blocked} aria-busy={pending || undefined}>
            {t('Declare')}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}

function CancelDialog({ d, onClose }: { d: DelegationView | null; onClose: () => void }) {
  const { t, lang } = useI18n();
  const toast = useToast();
  const id = useId();
  const [pending, start] = useTransition();
  const [reason, setReason] = useState('');
  const close = () => {
    setReason('');
    onClose();
  };
  const confirm = () =>
    start(async () => {
      if (!d) return;
      try {
        const r = await cancelDelegationAction({ id: d.id, reason });
        toast.showEn(r.ok ? (r.toast ?? 'Delegation cancelled') : r.error);
        if (r.ok) close();
      } catch {
        toast.showEn('The delegation could not be saved');
      }
    });
  return (
    <Dialog open={!!d} onClose={close} title={t('Cancel the delegation')} subtitle={d ? `${dataText(d.approverName, lang)} → ${dataText(d.substituteName, lang)}` : undefined} width={440} placement="center" maxHeight={null}>
      <form
        className={s.rejectForm}
        onSubmit={(e) => {
          e.preventDefault();
          if (!pending) confirm();
        }}
      >
        <Field label={t('Reason')} htmlFor={id}>
          <Textarea id={id} short value={reason} maxLength={DELEGATION_NOTE_MAX} autoFocus onChange={(e) => setReason(e.target.value)} />
        </Field>
        <DialogActions variant="flush">
          <Button variant="secondary" onClick={close}>
            {t('Back')}
          </Button>
          <Button type="submit" variant="primary" icon={X} disabled={pending} aria-busy={pending || undefined}>
            {t('Confirm cancellation')}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
