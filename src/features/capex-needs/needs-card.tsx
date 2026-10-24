// R-187 (Arche K-02, K-03, K-10): "Subsidiaries' machine needs" — the inbox of the needs the subsidiaries submit in Arche, the CAPEX
// application, under the Projects register (Portfolio › Projects). Read by the director and the project managers (the roles with the
// register in their workspace; never the client, Finance does not have the register); the portfolio director answers (qualification,
// indicative price, quote, firm offer with its estimate class and range) and, once Arche marks a need ordered (G2 of its CAPEX),
// creates the EPC2i project or adds the need's equipment line to an existing project. Every CAPEX and need links to Arche
// (`<ARCHE_URL>/capex/<code>`, `…/machines`). Server Component; the buttons are client islands (./needs-buttons.tsx). Text typed in
// Arche (CAPEX title, free label, comment) and in Keystone (reason) is shown as typed (dataText).
import { eq, isNotNull } from 'drizzle-orm';
import type { FormDef, FormValues } from '@/components/app/form-def';
import { Card, CardTitle } from '@/components/ds/Card';
import { cx } from '@/components/ds/cx';
import { Table, Th } from '@/components/ds/Table';
import { Tag, type TagTone } from '@/components/ds/Tag';
import {
  ANSWER_NATURES, ANSWER_NATURE_LABEL, ANSWER_STATUS_LABEL, DEFAULT_NEED_CLASS, NEED_STATUS_LABEL, QUALIFICATIONS, QUALIFICATION_LABEL, canAnswerCapexNeeds,
  canReadCapexNeeds, needProjectName, type AnswerStatus,
} from '@/domain/capex-needs';
import { ESTIMATE_CLASSES, ESTIMATE_CLASS_LABEL } from '@/domain/estimate-class';
import { catalogueRef } from '@/domain/machine-catalogue';
import { screenHref } from '@/config/screens';
import { dataText } from '@/i18n/data-text';
import { intlLocale, type T } from '@/i18n/translate';
import { getDb } from '@/server/db/client';
import { machineType } from '@/server/db/codes';
import { countries, machineTypes } from '@/server/db/schema';
import { getNeedsInbox, listOpenProjects, type InboxNeed, type NeedAnswerRow } from '@/server/dal/capex-needs';
import { subsidiaryClientNames } from '@/server/dal/internal-client';
import { getNewProjectSetup } from '@/server/dal/projects-register';
import { archeUrl } from '@/server/integrations/capex/config';
import { ARCHE_LINK_ATTRS, archeCapexUrl, archeNeedsUrl } from '@/server/integrations/capex/links';
import { getScreenAccess } from '@/server/project-context';
import { getI18n } from '@/server/session';
import { AddNeedToProjectButton, AnswerNeedButton, AnswerStatusButton, CreateProjectFromNeedButton, RefreshNeedsButton } from './needs-buttons';
import s from './needs.module.css';

const NEED_TONE: Record<InboxNeed['status'], TagTone> = { submitted: 'outline', ordered: 'accent-2', withdrawn: 'neutral' };
const ANSWER_TONE: Record<AnswerStatus, TagTone> = { en_cours: 'outline', remise: 'neutral', acceptee: 'accent-2', caduque: 'neutral' };

/** Status moves offered on the latest answer (the server checks what each one needs). */
const MOVES: Record<AnswerStatus, { to: AnswerStatus; label: string }[]> = {
  en_cours: [{ to: 'remise', label: 'Send' }, { to: 'caduque', label: 'Lapse' }],
  remise: [{ to: 'acceptee', label: 'Accept' }, { to: 'caduque', label: 'Lapse' }],
  acceptee: [],
  caduque: [],
};

/** The answer form (new answer or edit of one in preparation). */
export function answerFormDef(t: T, title: string, submit: string): FormDef {
  return {
    title, submit,
    fields: [
      { id: 'nature', label: t('Nature'), type: 'select', options: ANSWER_NATURES.map((n) => ({ value: n, label: t(ANSWER_NATURE_LABEL[n]) })) },
      { id: 'qualification', label: t('Qualification'), type: 'select', options: QUALIFICATIONS.map((q) => ({ value: q, label: t(QUALIFICATION_LABEL[q]) })) },
      { id: 'estimateClass', label: t('Estimate class'), type: 'select', options: [{ value: '', label: t('None') }, ...ESTIMATE_CLASSES.map((c) => ({ value: c, label: t(ESTIMATE_CLASS_LABEL[c]) }))] },
      { id: 'centralKeur', label: t('Central amount (k€)'), type: 'number', placeholder: t('Priced answers only') },
      { id: 'leadTimeWeeks', label: t('Lead time (weeks)'), type: 'number', placeholder: t('Optional') },
      { id: 'validUntil', label: t('Valid until'), type: 'text', placeholder: 'YYYY-MM-DD' },
      { id: 'documentRef', label: t('Codex reference'), type: 'text', placeholder: 'OFF-CPX-SAI-2026-01-003', span: 'full' },
      { id: 'reason', label: t('Reason'), type: 'textarea', placeholder: t('Required when the need is to be studied or declined') },
    ],
  };
}

const answerValues = (a: NeedAnswerRow): FormValues => ({
  nature: a.nature, qualification: a.qualification, estimateClass: a.estimateClass ?? '', centralKeur: a.centralKeur == null ? '' : String(a.centralKeur),
  leadTimeWeeks: a.leadTimeWeeks == null ? '' : String(a.leadTimeWeeks), validUntil: a.validUntil ?? '', documentRef: a.documentRef ?? '', reason: a.reason ?? '',
});

/** A new answer starts from the need's catalogue price (E50 indicative price) when it has one, else a qualification. */
const newAnswerValues = (n: InboxNeed): FormValues =>
  n.defaultAmount != null
    ? { nature: 'indicatif', qualification: 'faisable', estimateClass: DEFAULT_NEED_CLASS, centralKeur: String(n.defaultAmount), leadTimeWeeks: '', validUntil: '', documentRef: '', reason: '' }
    : { nature: 'qualification', qualification: 'faisable', estimateClass: '', centralKeur: '', leadTimeWeeks: '', validUntil: '', documentRef: '', reason: '' };

export async function NeedsCard() {
  const { viewer, canEdit } = await getScreenAccess('projects');
  if (!canEdit || !canReadCapexNeeds(viewer.role)) return null;
  const [{ t, lang }, inbox] = await Promise.all([getI18n(), getNeedsInbox()]);
  const director = canAnswerCapexNeeds(viewer.role);
  const base = archeUrl();
  const nf = new Intl.NumberFormat(intlLocale(lang), { maximumFractionDigits: 1 });
  const df = new Intl.DateTimeFormat(intlLocale(lang), { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  const tf = new Intl.DateTimeFormat(intlLocale(lang), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' });
  const day = (iso: string | null) => (iso ? df.format(new Date(`${iso.slice(0, 10)}T00:00:00Z`)) : '—');
  const keur = (n: number | null) => (n == null ? '—' : `${nf.format(n)} k€`);

  // Director only: the wizard's data, the projects a line may go to, the machine types of a free need, the countries by ISO code.
  const db = director ? await getDb() : null;
  // R-190: the client registered for a subsidiary (internal client) is the one the wizard starts from.
  const [setup, openProjects, types, countryRows, subsidiaryClients] = director && db
    ? await Promise.all([
      getNewProjectSetup({ name: viewer.name, role: viewer.role }), listOpenProjects(),
      db.select({ code: machineTypes.code, label: machineTypes.label }).from(machineTypes).where(eq(machineTypes.active, true)).orderBy(machineTypes.sortOrder),
      db.select({ name: countries.name, iso2: countries.iso2 }).from(countries).where(isNotNull(countries.iso2)),
      subsidiaryClientNames(db),
    ])
    : [null, [], [], [], {} as Record<string, string>];
  const typeLabel = (code: string, label: string | null) => label ?? (machineType.isCode(code) ? machineType.label(code) : code);

  const toAnswer = inbox.needs.filter((n) => n.status === 'submitted' && !n.latest).length;
  const toPlace = inbox.needs.filter((n) => n.status === 'ordered' && !n.projectCode).length;
  const sourceText = inbox.source === 'server' ? t('Read from Arche') : inbox.source === 'simulation' ? t('Arche simulated (demo data)') : t('Arche connector off');
  const lastText = inbox.lastRunAt
    ? `${t('Last read')} ${tf.format(new Date(inbox.lastRunAt))}${inbox.lastRunOk === false ? ` · ${t('failed')}` : ''}`
    : t('Never read');

  const machineOf = (n: InboxNeed) => {
    if (n.catalogue) return `${catalogueRef(n.catalogue.code, n.catalogue.version)} · ${dataText(n.catalogue.label, lang)}`;
    return n.freeLabel ? dataText(n.freeLabel, lang) : t('Free need');
  };
  const optionsOf = (n: InboxNeed) =>
    n.options.map((code) => {
      const o = n.catalogue?.options.find((x) => x.code === code);
      return o ? `${code} · ${dataText(o.libelle, lang)}` : code;
    }).join(', ');

  const addForm = (n: InboxNeed): FormDef => ({
    title: `${t('Add to a project')} · ${n.needRef}`, submit: t('Add'),
    fields: [
      { id: 'project', label: t('Project'), type: 'select', options: openProjects.map((p) => ({ value: p.code, label: `${p.code} · ${dataText(p.name, lang)}` })) },
      ...(n.catalogue ? [] : [{ id: 'machineTypeCode', label: t('Machine type'), type: 'select' as const, options: types.map((m) => ({ value: m.code, label: typeLabel(m.code, m.label) })) }]),
    ],
  });

  return (
    <Card className={s.needsCard} id="subsidiary-needs">
      <div className={s.headTop}>
        <div className={s.titleCol}>
          <CardTitle>{t('Subsidiaries’ machine needs')}</CardTitle>
          <span className={s.subtitle}>
            {`${inbox.needs.length} ${t(inbox.needs.length > 1 ? 'needs' : 'need')} · ${toAnswer} ${t('to answer')} · ${toPlace} ${t('ordered without project')}`}
          </span>
          <span className={cx(s.subtitle, inbox.lastRunOk === false && s.warn)}>
            {`${sourceText} · ${lastText}`}
            {inbox.lastRunOk === false && inbox.lastRunError ? ` · ${inbox.lastRunError}` : ''}
          </span>
        </div>
        <RefreshNeedsButton label={t('Refresh')} />
      </div>
      {inbox.needs.length === 0 ? (
        <p className={s.empty}>{t('No machine need submitted by the subsidiaries')}</p>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>{t('Machine need')}</Th>
              <Th>{t('CAPEX')}</Th>
              <Th>{t('Machine')}</Th>
              <Th>{t('Needed by')}</Th>
              <Th>{t('Status')}</Th>
              <Th>{t('Keystone answer')}</Th>
              {director && <Th aria-label={t('Actions')} />}
            </tr>
          </thead>
          <tbody>
            {inbox.needs.map((n) => {
              const a = n.latest;
              const placeable = director && n.status === 'ordered' && !n.projectCode && !!a && !!setup;
              const seedType = n.catalogue ? n.catalogue.typeLabel : (setup?.machineTypes[0] ?? 'EMP');
              const capexTitle = n.capex ? dataText(n.capex.title, lang) : null;
              return (
                <tr key={n.needRef} className={n.status === 'withdrawn' ? s.withdrawn : undefined}>
                  <td className={s.num}>
                    <a className={cx(s.link, s.strong)} href={archeNeedsUrl(base, n.capexCode)} {...ARCHE_LINK_ATTRS}>{n.needRef}</a>
                    {n.comment && <span className={s.meta}>{dataText(n.comment, lang)}</span>}
                  </td>
                  <td>
                    <a className={s.link} href={archeCapexUrl(base, n.capexCode)} {...ARCHE_LINK_ATTRS}>{capexTitle ?? n.capexCode}</a>
                    <span className={s.meta}>{[n.capex?.subsidiaryName ? dataText(n.capex.subsidiaryName, lang) : n.capex?.subsidiaryCode, n.site ? dataText(n.site, lang) : null].filter(Boolean).join(' · ') || n.capexCode}</span>
                  </td>
                  <td>
                    <span className={s.num}>{n.quantity} × </span>{machineOf(n)}
                    <span className={s.meta}>
                      {[
                        n.catalogue ? n.catalogue.typeLabel : null,
                        n.targetCapacity != null ? `${nf.format(n.targetCapacity)} ${n.capacityUnit ?? ''}`.trim() : null,
                        n.options.length ? optionsOf(n) : null,
                        n.catalogue && n.catalogue.status === 'retired' ? t('Retired') : null,
                      ].filter(Boolean).join(' · ')}
                    </span>
                  </td>
                  <td className={s.num}>{day(n.neededOn)}{n.orderedOn && <span className={s.meta}>{`${t('Ordered')} ${day(n.orderedOn)}`}</span>}</td>
                  <td><Tag tone={NEED_TONE[n.status]} size="sm">{t(NEED_STATUS_LABEL[n.status])}</Tag></td>
                  <td>
                    {a ? (
                      <>
                        <span className={s.num}>{`${a.number} · ${t(ANSWER_NATURE_LABEL[a.nature])}`}</span>{' '}
                        <Tag tone={ANSWER_TONE[a.status]} size="xs">{t(ANSWER_STATUS_LABEL[a.status])}</Tag>
                        <span className={cx(s.meta, s.num)}>
                          {[
                            a.qualification !== 'faisable' || a.nature === 'qualification' ? t(QUALIFICATION_LABEL[a.qualification]) : null,
                            a.estimateClass ? `${a.estimateClass} · ${keur(a.centralKeur)} (${keur(a.lowKeur)} – ${keur(a.highKeur)})` : null,
                            a.leadTimeWeeks ? `${a.leadTimeWeeks} ${t(a.leadTimeWeeks > 1 ? 'weeks' : 'week')}` : null,
                            a.validUntil ? `${t('Valid until')} ${day(a.validUntil)}` : null,
                            a.documentRef,
                          ].filter(Boolean).join(' · ')}
                        </span>
                        {a.reason && <span className={s.meta}>{dataText(a.reason, lang)}</span>}
                        {n.projectCode && (
                          <span className={s.meta}>
                            {`${t('Project')} `}
                            <a className={s.link} href={screenHref('contract', { code: n.projectCode })}>{n.projectCode}</a>
                          </span>
                        )}
                      </>
                    ) : (
                      <span className={s.muted}>{n.status === 'withdrawn' ? '—' : t('Not answered yet')}</span>
                    )}
                  </td>
                  {director && (
                    <td className={s.actionCell}>
                      <span className={s.actions}>
                        {n.status !== 'withdrawn' && (
                          <AnswerNeedButton
                            needRef={n.needRef} context={`${n.needRef} · ${machineOf(n)}`} form={answerFormDef(t, `${t('Answer the need')} ${n.needRef}`, t('Record the answer'))}
                            values={newAnswerValues(n)} label={t('Answer')} ariaLabel={`${t('Answer the need')} ${n.needRef}`} saved={t('Answer recorded')}
                          />
                        )}
                        {a && a.status === 'en_cours' && (
                          <AnswerNeedButton
                            needRef={n.needRef} number={a.number} context={`${a.number} · ${n.needRef}`} form={answerFormDef(t, `${t('Edit answer')} ${a.number}`, t('Save'))}
                            values={answerValues(a)} label={t('Edit')} ariaLabel={`${t('Edit answer')} ${a.number}`} saved={t('Answer saved')}
                          />
                        )}
                        {a && MOVES[a.status]
                          .filter((m) => m.to !== 'acceptee' || a.nature === 'devis' || a.nature === 'offre_ferme')
                          .map((m) => (
                            <AnswerStatusButton
                              key={m.to} number={a.number} to={m.to} label={t(m.label)} ariaLabel={`${t(m.label)} ${a.number}`}
                              done={`${a.number} · ${t(ANSWER_STATUS_LABEL[m.to])}`}
                            />
                          ))}
                        {placeable && setup && (
                          <>
                            <CreateProjectFromNeedButton
                              needRef={n.needRef} setup={setup} label={t('Create the project')}
                              seed={{
                                name: needProjectName(capexTitle, n.catalogue ? dataText(n.catalogue.label, lang) : (n.freeLabel ? dataText(n.freeLabel, lang) : n.needRef)),
                                client: (n.capex?.subsidiaryCode ? subsidiaryClients[n.capex.subsidiaryCode] : undefined) ?? n.capex?.subsidiaryName ?? n.capex?.subsidiaryCode ?? '',
                                mt: seedType, qty: n.quantity,
                                city: '', country: countryRows.find((c) => c.iso2 === n.capex?.countryIso2)?.name ?? '',
                              }}
                            />
                            <AddNeedToProjectButton needRef={n.needRef} context={`${n.needRef} · ${machineOf(n)}`} form={addForm(n)} label={t('Add to a project')} added={t('Equipment line added')} />
                          </>
                        )}
                      </span>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </Card>
  );
}
