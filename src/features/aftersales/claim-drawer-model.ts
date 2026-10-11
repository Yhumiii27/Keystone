// View model of the warranty claim drawer (R-143, Q-8 "a": full follow-up driven by after-sales), opened by `?claim=WC-014`
// on the Claims view: status steps, facts (machine, client, project, dates, severity, coverage, owner, cost, next step,
// diagnosis), the design ECO (Keystone's ECO screen when Vigie reports it, else Vigie) or "Raise ECO in Vigie" prefilled,
// the machine's as-maintained configuration (R-144), the claim's interventions with "Mark done", and the editor's steps
// (Edit claim, Mark diagnosed, Plan intervention, Close claim). Pure: the page passes the data and the forms' options.
import type { FormDef } from '@/components/app/form-def';
import { CLAIM_FLOW, closeBlocker } from '@/domain/claims';
import { SEVERITY_TONE, claimStatusTone, coverageTone } from '@/domain/aftersales';
import type { Lang, T } from '@/i18n/translate';
import { money } from '@/lib/format';
import { NOW_ISO, claimStatus, displayOfIso } from '@/server/db/codes';
import type { MirrorEcoRef } from '@/server/dal/aftersales';
import type { ClaimRow, InterventionRow } from '@/server/dal/claims';
import { vigieEcoUrl, vigieNewEcoUrl } from '@/server/integrations/vigie/links';
import { claimEditFormDef, diagnoseFormDef, interventionDoneFormDef, localizeForm, planInterventionFormDef } from './forms';
import { dataText, interventionStatusText } from './i18n';
import { claimHref, ecoHref } from './links';
import { doneLineText } from './model';

const tag = (tone: string) => `tag tag-${tone}`;
const dateText = (iso: string | null, t: T) => (iso ? t(displayOfIso(iso)) : '—');

export interface ClaimDrawerIntervention {
  number: string;
  /** "8 Oct 2026 · T. Kerbrat + J. Wagner · Corrective · 1 day". */
  line: string;
  status: string;
  statusClass: string;
  doneLine: string | null;
  done: { label: string; ariaLabel: string; form: FormDef } | null;
}

export interface ClaimDrawerView {
  number: string;
  title: string;
  status: string;
  statusClass: string;
  closeHref: string;
  steps: { label: string; reached: boolean }[];
  facts: { k: string; v: string; color?: string }[];
  /** The design ECO: Keystone's ECO screen when Vigie reports it, else Vigie (internal viewers); a plain tag otherwise. */
  eco: { text: string; href: string | null; external: boolean; label: string } | null;
  /** "Raise ECO in Vigie" (internal viewers, no ECO linked, claim not closed): Vigie's form prefilled. */
  raiseEco: { href: string; label: string } | null;
  /** As-maintained configuration of the machine (R-144): part · revision. */
  config: { ref: string; revision: string }[];
  interventions: ClaimDrawerIntervention[];
  /** Editor's steps; null for read-only viewers and closed claims. */
  actions: {
    from: string;
    edit: { label: string; form: FormDef };
    diagnose: { label: string; form: FormDef } | null;
    plan: { label: string; form: FormDef };
    close: { label: string } | null;
    /** Why "Close claim" is not offered yet (translated); null when it is. */
    closeHint: string | null;
  } | null;
}

export interface ClaimDrawerInput {
  claim: ClaimRow & { interventions: InterventionRow[] };
  ecos: Record<string, MirrorEcoRef>;
  config: { ref: string; revision: string }[];
  /** Parts offered by "Mark done" for the machine. */
  parts: string[];
  owners: readonly string[];
  viewer: { vigie: boolean; canEdit: boolean };
}

export function claimDrawerView({ claim: c, ecos, config, parts, owners, viewer }: ClaimDrawerInput, t: T, lang: Lang): ClaimDrawerView {
  const idx = CLAIM_FLOW.indexOf(c.status);
  const known = c.ecoNumber ? ecos[c.ecoNumber] : undefined;
  const eco = c.ecoNumber
    ? known
      ? { text: c.ecoNumber, href: ecoHref(c.ecoNumber), external: false, label: `${c.ecoNumber} · ${known.title}` }
      : viewer.vigie
        ? { text: c.ecoNumber, href: vigieEcoUrl(c.ecoNumber), external: true, label: `${t('Open in Vigie')} · ${c.ecoNumber}` }
        : { text: c.ecoNumber, href: null, external: false, label: c.ecoNumber }
    : null;
  const open = c.status !== 'closed';
  const loc = (def: FormDef) => localizeForm(def, t, lang);
  const technicians = c.interventions.at(-1)?.technicians ?? c.owner;
  const blocker = closeBlocker({ status: c.status, diagnosis: c.diagnosis, plannedInterventions: c.plannedInterventions });
  return {
    number: c.number,
    title: dataText(c.issue, lang),
    status: t(c.statusLabel),
    statusClass: tag(claimStatusTone(c.status)),
    closeHref: claimHref(null),
    steps: CLAIM_FLOW.map((s, i) => ({ label: t(claimStatus.label(s)), reached: i <= idx })),
    facts: [
      { k: t('Machine'), v: `${c.machineNumber} · ${dataText(c.machineName, lang)}` },
      { k: t('Client'), v: dataText(c.client, lang) },
      { k: t('Project'), v: c.projectCode ?? '—' },
      { k: t('Reported'), v: dateText(c.reportedOn, t) },
      { k: t('Severity'), v: t(c.severityLabel), color: SEVERITY_TONE[c.severity] === 'accent' ? 'var(--color-accent-300)' : undefined },
      { k: t('Coverage'), v: t(c.coverageLabel), color: coverageTone(c.coverage) === 'outline' ? 'var(--color-accent-300)' : undefined },
      { k: t('Owner'), v: dataText(c.owner, lang) },
      { k: t('Cost'), v: c.costKeur ? money(c.costKeur, lang) : '—' },
      { k: t('Next step'), v: c.description != null || c.diagnosis != null ? dataText(c.nextStep, lang) : t(c.nextStep) },
      { k: t('Diagnosis'), v: c.diagnosis ?? '—' },
      ...(c.description ? [{ k: t('Description'), v: c.description }] : []),
      ...(c.closedOn ? [{ k: t('Closed on'), v: dateText(c.closedOn, t) }] : []),
    ],
    eco,
    raiseEco:
      viewer.vigie && open && !c.ecoNumber
        ? { href: vigieNewEcoUrl({ projectCode: c.projectCode, title: `${c.number} · ${c.issue}` }), label: t('Raise ECO in Vigie') }
        : null,
    config,
    interventions: c.interventions.map((i) => ({
      number: i.number,
      line: `${dateText(i.scheduledOn, t)} · ${dataText(i.technicians, lang)} · ${t(i.typeText)} · ${t(i.durationText)}`,
      status: interventionStatusText(i.status, t, lang),
      statusClass: tag(i.status === 'done' ? 'neutral' : 'outline'),
      doneLine: doneLineText(i, t),
      done:
        viewer.canEdit && i.status === 'planned'
          ? { label: t('Mark done'), ariaLabel: `${t('Mark done')} · ${i.number}`, form: loc(interventionDoneFormDef(parts, displayOfIso(NOW_ISO))) }
          : null,
    })),
    actions:
      viewer.canEdit && open
        ? {
            from: c.status,
            edit: { label: t('Edit claim'), form: loc(claimEditFormDef(c, owners, lang)) },
            diagnose: c.steps.includes('diagnose') ? { label: t('Mark diagnosed'), form: loc(diagnoseFormDef(c.diagnosis)) } : null,
            plan: { label: t('Plan intervention'), form: loc(planInterventionFormDef(null, { technicians })) },
            close: c.steps.includes('close') ? { label: t('Close claim') } : null,
            closeHint: blocker ? t(blocker) : null,
          }
        : null,
  };
}
