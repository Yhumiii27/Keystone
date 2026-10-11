'use client';
// Primary button + "New resource request" dialog (docs/spec/01 §12, 08 §5.5; template 3071–3092, logic 4146–4156).
// Task, activity chips, person-or-role chips, week / duration / priority segments, hours, note for the department head
// and the routing panel (department head, the person's load that week). "Send request" creates the request through
// sendResourceRequestAction (sender = the viewer), clears title and note (other fields kept, as `nr.send`) and lands on
// Resource requests with the status filter cleared. Opening keeps the previous draft (`openNr` only sets open).
import { PaperPlaneTilt, Plus, SealCheck } from '@phosphor-icons/react/dist/ssr';
import { useRouter } from 'next/navigation';
import { useId, useState, useTransition } from 'react';
import { Button } from '@/components/ds/Button';
import { Dialog } from '@/components/ds/Dialog';
import { DialogActions } from '@/components/ds/DialogParts';
import { Field, Input } from '@/components/ds/Field';
import { Segmented } from '@/components/ds/Segmented';
import { cx } from '@/components/ds/cx';
import { useToast } from '@/components/ds/Toast';
import {
  CONTRACT_ROLE, NR_DEFAULTS, NR_DURATIONS, NR_PRIORITIES, NR_WEEKS, nrDates, routing, weekLabel, type Priority,
} from '@/domain/requests';
import { useI18n } from '@/i18n/client';
import type { NewRequestSetup } from '@/server/dal/requests-screens';
import { sendResourceRequestAction } from './actions';
import { reqT, routingText, sentByText, weekOfText } from './i18n';
import { requestsHref } from './routes';
import s from './requests.module.css';
import { dataText } from '@/i18n/data-text';

export interface NewRequestLauncherProps {
  /** EN label of the button ("New request" on Resource requests, "Request resource" elsewhere). */
  label: string;
  setup: NewRequestSetup;
  /** Preselected activity / person (e.g. from an activity drawer or a person row). */
  defaults?: Partial<{ act: string; person: string }>;
  /** Short name of the sender (the viewer), for the sub-line. */
  sender: string;
  /** Land on Resource requests after sending (the viewer has the screen in their workspace). */
  openRequests: boolean;
}

interface Draft {
  title: string;
  act: string;
  person: string;
  week: number;
  dur: number;
  hours: string;
  prio: Priority;
  note: string;
}

function initialDraft(setup: NewRequestSetup, defaults?: Partial<{ act: string; person: string }>): Draft {
  const acts = setup.activities.map((a) => a.code);
  const people = [...setup.people.map((p) => p.name), CONTRACT_ROLE];
  const pick = (want: string | undefined, fallback: string, list: string[]) => (want && list.includes(want) ? want : list.includes(fallback) ? fallback : (list[0] ?? ''));
  return {
    title: '',
    act: pick(defaults?.act, NR_DEFAULTS.act, acts),
    person: pick(defaults?.person, NR_DEFAULTS.person, people),
    week: NR_DEFAULTS.week,
    dur: NR_DEFAULTS.dur,
    hours: NR_DEFAULTS.hours,
    prio: NR_DEFAULTS.prio,
    note: '',
  };
}

export function NewRequestLauncher({ label, setup, defaults, sender, openRequests }: NewRequestLauncherProps) {
  const { t: baseT, lang } = useI18n();
  const t = reqT(baseT, lang);
  const router = useRouter();
  const toast = useToast();
  const ids = useId();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(() => initialDraft(setup, defaults));
  const [pending, startTransition] = useTransition();
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  // The chips shown are the source of truth: a kept draft whose activity left the list (refreshed setup) falls back to the first.
  const act = setup.activities.some((a) => a.code === draft.act) ? draft.act : (setup.activities[0]?.code ?? '');

  const route = routing(draft.person, nrDates(draft.week, 0).start, setup.people, setup.weekStarts, setup.departments);

  const send = () =>
    startTransition(async () => {
      const r = await sendResourceRequestAction({ projectCode: setup.project.code, ...draft, act });
      if (!r.ok) {
        toast.showEn(r.error);
        return;
      }
      setOpen(false);
      setDraft((d) => ({ ...d, title: '', note: '' }));
      if (openRequests) router.push(requestsHref());
      else toast.show(`${t('Request sent')} · ${r.number}`);
    });

  const chip = (on: boolean) => cx(s.chip, on && s.chipOn);

  return (
    <>
      <Button variant="primary" icon={Plus} onClick={() => setOpen(true)}>
        {t(label)}
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={t('New resource request')}
        subtitle={sentByText(dataText(setup.project.name, lang), sender, lang)}
        width={720}
        offsetTop="6vh"
        maxHeight="88vh"
      >
        <Field label={t('Task')} htmlFor={`${ids}-title`}>
          <Input id={`${ids}-title`} value={draft.title} maxLength={200} placeholder={t('What needs doing')} onChange={(e) => set({ title: e.target.value })} />
        </Field>
        <Field label={t('Activity')}>
          <div className={s.chips} role="group" aria-label={t('Activity')}>
            {setup.activities.map((a) => (
              <button key={a.code} type="button" className={chip(act === a.code)} aria-pressed={act === a.code} onClick={() => set({ act: a.code })}>
                {`${a.code} · ${dataText(a.name, lang)}`}
              </button>
            ))}
            {!setup.activities.length && <span className={s.noActs}>{t('No open activity on this project')}</span>}
          </div>
        </Field>
        <Field label={t('Person or role')}>
          <div className={s.chips} role="group" aria-label={t('Person or role')}>
            {setup.people.map((p) => (
              <button key={p.name} type="button" className={chip(draft.person === p.name)} aria-pressed={draft.person === p.name} onClick={() => set({ person: p.name })}>
                {p.name}
              </button>
            ))}
            <button type="button" className={chip(draft.person === CONTRACT_ROLE)} aria-pressed={draft.person === CONTRACT_ROLE} onClick={() => set({ person: CONTRACT_ROLE })}>
              {t('Contract role')}
            </button>
          </div>
        </Field>
        <div className={s.fieldGrid}>
          <Field label={t('Week')}>
            <Segmented
              fullWidth
              label={t('Week')}
              value={String(draft.week)}
              options={NR_WEEKS.map((w) => ({ value: String(w), label: weekOfText(weekLabel(nrDates(w, 0).start), t, lang) }))}
              onChange={(v) => set({ week: Number(v) })}
            />
          </Field>
          <Field label={t('Duration')}>
            <Segmented
              fullWidth
              label={t('Duration')}
              value={String(draft.dur)}
              options={NR_DURATIONS.map((d) => ({ value: String(d.value), label: t(d.label) }))}
              onChange={(v) => set({ dur: Number(v) })}
            />
          </Field>
          <Field label={t('Hours')} htmlFor={`${ids}-hours`}>
            <Input id={`${ids}-hours`} alignRight inputMode="decimal" maxLength={8} value={draft.hours} onChange={(e) => set({ hours: e.target.value })} />
          </Field>
          <Field label={t('Priority')}>
            <Segmented
              fullWidth
              label={t('Priority')}
              value={draft.prio}
              options={NR_PRIORITIES.map((p) => ({ value: p.value, label: t(p.label) }))}
              onChange={(v) => set({ prio: v })}
            />
          </Field>
        </div>
        <Field label={t('Note for the department head')} htmlFor={`${ids}-note`}>
          <Input id={`${ids}-note`} value={draft.note} maxLength={1000} placeholder={t('Why now, what it unblocks')} onChange={(e) => set({ note: e.target.value })} />
        </Field>
        <div className={s.routing}>
          <SealCheck className={s.routingIcon} aria-hidden />
          <span className={s.pretty}>{routingText(route, t, lang)}</span>
        </div>
        <DialogActions variant="flush">
          <Button variant="secondary" onClick={() => setOpen(false)}>
            {t('Cancel')}
          </Button>
          <Button variant="primary" icon={PaperPlaneTilt} disabled={pending || !setup.activities.length} onClick={send}>
            {t('Send request')}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
