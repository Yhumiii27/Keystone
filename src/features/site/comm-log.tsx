'use client';
// "Client communication log" (chapter 4; the ghost button of the Site's HSE card, template 2300): opens a drawer with
// the project's log, loaded when it opens (Server Function), newest first — date · channel · direction, subject, client
// contact, summary, follow-up (owner, due date; ticked done by the editors) — and, for viewers who may edit the Site,
// "Log an exchange" (inline form: date, channel, direction, client contact, subject, summary, optional follow-up owner in
// the project team and due date). Keystone owns this log (no external system). Rules: src/domain/client-comms.ts.
import { Chats, Check, Plus, Warning } from '@phosphor-icons/react/dist/ssr';
import { useId, useState, useTransition, type FormEvent } from 'react';
import { Callout } from '@/components/app/Callout';
import { CheckCircle } from '@/components/app/Check';
import { Button } from '@/components/ds/Button';
import { Drawer } from '@/components/ds/Drawer';
import { Field, Input, Select, Textarea } from '@/components/ds/Field';
import { Tag } from '@/components/ds/Tag';
import { showToast } from '@/components/ds/Toast';
import { cx } from '@/components/ds/cx';
import { CLIENT_COMM_LIMITS, DEFAULT_CLIENT_COMM_CHANNEL, DEFAULT_CLIENT_COMM_DIRECTION } from '@/domain/client-comms';
import { useI18n } from '@/i18n/client';
import { addClientExchangeAction, loadClientLogAction, setClientFollowUpDoneAction, type ClientLogData } from './comm-log-actions';
import { followUpText } from './comm-log-model';
import site from './site.module.css';
import s from './comm-log.module.css';

const FAILED = 'The change could not be saved';

/** The HSE card's "Client communication log" button and its drawer. */
export function CommunicationLogButton({ code }: { code: string }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<ClientLogData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, startLoading] = useTransition();

  const load = () =>
    startLoading(async () => {
      try {
        const r = await loadClientLogAction(code);
        if (r.ok) {
          setData(r.data);
          setError(null);
        } else setError(r.error);
      } catch {
        setError(t('The client communication log could not be loaded'));
      }
    });

  return (
    <>
      <Button
        variant="ghost"
        icon={Chats}
        className={site.hseBtn}
        aria-haspopup="dialog"
        onClick={() => {
          setOpen(true);
          load();
        }}
      >
        {t('Client communication log')}
      </Button>
      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        id={code}
        title={t('Client communication log')}
        meta={data ? <Tag tone="outline">{data.counts}</Tag> : undefined}
      >
        <span className={s.lead}>{t('Every exchange with the client and its follow-up — kept in Keystone')}</span>
        {error && (
          <Callout variant="emphasis" icon={Warning} role="alert">
            {error}
          </Callout>
        )}
        {!data && !error && <span className={s.muted}>{t('Loading…')}</span>}
        {data && <LogBody code={code} data={data} busy={loading} reload={load} />}
      </Drawer>
    </>
  );
}

function LogBody({ code, data, busy, reload }: { code: string; data: ClientLogData; busy: boolean; reload: () => void }) {
  const { t, lang } = useI18n();
  const [adding, setAdding] = useState(false);
  const [pending, startTransition] = useTransition();

  const toggle = (number: string, done: boolean) =>
    startTransition(async () => {
      try {
        const r = await setClientFollowUpDoneAction(code, number, done);
        if (!r.ok) showToast(r.error);
        reload();
      } catch {
        showToast(t(FAILED));
      }
    });

  return (
    <>
      {data.canWrite && !adding && (
        <Button variant="primary" icon={Plus} className={s.addBtn} onClick={() => setAdding(true)}>
          {t('Log an exchange')}
        </Button>
      )}
      {data.canWrite && adding && (
        <ExchangeForm
          code={code}
          data={data}
          onDone={(logged) => {
            setAdding(false);
            if (logged) reload();
          }}
        />
      )}
      <div className={s.list} aria-busy={busy || pending || undefined}>
        {data.rows.map((r) => (
          <article key={r.number} className={s.item}>
            <div className={s.itemHead}>
              <span className={s.when}>
                {r.date} · {r.channel}
              </span>
              <Tag tone={r.inbound ? 'outline' : 'neutral'} size="sm">
                {r.direction}
              </Tag>
              <span className={s.number}>{r.number}</span>
            </div>
            <span className={s.subject}>{r.subject}</span>
            <span className={s.contact}>{r.contact}</span>
            {r.summary && <p className={s.summary}>{r.summary}</p>}
            {r.followUp && (
              <div className={cx(s.follow, r.followUp.state === 'overdue' && s.overdue, r.followUp.state === 'done' && s.followDone)}>
                <CheckCircle
                  done={r.followUp.state === 'done'}
                  size={14}
                  label={r.followUp.state === 'done' ? t('Reopen the follow-up') : t('Mark the follow-up done')}
                  onToggle={data.canWrite && !pending ? () => toggle(r.number, r.followUp!.state !== 'done') : undefined}
                />
                <span>{followUpText(r.followUp.owner, r.followUp.due, lang)}</span>
              </div>
            )}
            <span className={s.by}>
              {t('Logged by')} {r.by}
            </span>
          </article>
        ))}
        {!data.rows.length && <span className={s.muted}>{t('No exchange logged yet')}</span>}
      </div>
    </>
  );
}

/** Inline "Log an exchange" form (the drawer sits above dialogs, so no nested dialog). */
function ExchangeForm({ code, data, onDone }: { code: string; data: ClientLogData; onDone: (logged: boolean) => void }) {
  const { t } = useI18n();
  const id = useId();
  const [v, setV] = useState({
    occurredOn: data.today, channel: DEFAULT_CLIENT_COMM_CHANNEL as string, direction: DEFAULT_CLIENT_COMM_DIRECTION as string, contactName: '', subject: '',
    summary: '', followUpOwner: '', followUpDueOn: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV((cur) => ({ ...cur, [k]: e.target.value }));
  const valid = !!v.occurredOn && !!v.contactName.trim() && !!v.subject.trim() && !!v.followUpOwner === !!v.followUpDueOn;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!valid || pending) return;
    setError(null);
    startTransition(async () => {
      try {
        const r = await addClientExchangeAction(code, v);
        if (!r.ok) return setError(r.error);
        showToast(r.toast);
        onDone(true);
      } catch {
        setError(t(FAILED));
      }
    });
  };

  return (
    <form className={cx('card', s.form)} onSubmit={submit} noValidate>
      <div className={s.grid}>
        <Field label={t('Date')} required htmlFor={`${id}-date`}>
          <Input id={`${id}-date`} type="date" value={v.occurredOn} onChange={set('occurredOn')} aria-required />
        </Field>
        <Field label={t('Channel')} htmlFor={`${id}-channel`}>
          <Select id={`${id}-channel`} value={v.channel} onChange={set('channel')} options={data.channels} />
        </Field>
        <Field label={t('Direction')} htmlFor={`${id}-dir`}>
          <Select id={`${id}-dir`} value={v.direction} onChange={set('direction')} options={data.directions} />
        </Field>
        <Field label={t('Client contact')} required htmlFor={`${id}-contact`}>
          <Input id={`${id}-contact`} value={v.contactName} maxLength={CLIENT_COMM_LIMITS.contact} onChange={set('contactName')} aria-required />
        </Field>
        <Field label={t('Subject')} required htmlFor={`${id}-subject`} span="full">
          <Input id={`${id}-subject`} value={v.subject} maxLength={CLIENT_COMM_LIMITS.subject} onChange={set('subject')} aria-required />
        </Field>
        <Field label={t('Summary')} htmlFor={`${id}-summary`} span="full">
          <Textarea id={`${id}-summary`} short value={v.summary} maxLength={CLIENT_COMM_LIMITS.summary} onChange={set('summary')} />
        </Field>
        <Field label={t('Follow-up owner')} htmlFor={`${id}-owner`}>
          <Select
            id={`${id}-owner`}
            value={v.followUpOwner}
            onChange={set('followUpOwner')}
            options={[{ value: '', label: t('No follow-up') }, ...data.team.map((p) => ({ value: p, label: p }))]}
          />
        </Field>
        <Field label={t('Follow-up due')} htmlFor={`${id}-due`}>
          <Input id={`${id}-due`} type="date" value={v.followUpDueOn} min={v.occurredOn || undefined} onChange={set('followUpDueOn')} />
        </Field>
      </div>
      {!!v.followUpOwner !== !!v.followUpDueOn && <span className={s.hint}>{t('A follow-up needs an owner and a due date')}</span>}
      {error && (
        <Callout variant="emphasis" icon={Warning} role="alert">
          {error}
        </Callout>
      )}
      <div className={s.formActions}>
        <Button variant="secondary" onClick={() => onDone(false)}>
          {t('Cancel')}
        </Button>
        <Button type="submit" variant="primary" icon={Check} disabled={!valid || pending} aria-busy={pending || undefined}>
          {t('Log the exchange')}
        </Button>
      </div>
    </form>
  );
}
