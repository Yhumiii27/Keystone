// View models of the Inspection & test plan · punch list screen (docs/spec/07 §2.4, template 880–892) and of the
// Commissioning & handover dossier (07 §2.6, template 910–920): KPI tiles, the plan groups and rows with their Codex
// record buttons, the punch list rows with the Start / Close step, the commissioning grid, "Blocking A" and the handover
// dossier — translated. Built from the DAL rows with the pure rules of src/domain/itpcom.ts.
import { OK } from '@/components/app/tones';
import type { FormDef } from '@/components/app/form-def';
import {
  PUNCH_ORIGIN_FILTERS, blockingAOf, commissioningCellLook, filterPunchByOrigin, groupBySystem, inspectionLook, inspectionNcrTitle, itpDateText, openByCategoryText,
  punchLook, punchStep, resultLineText, summariseCommissioning, summariseItp, type PunchOriginFilter,
} from '@/domain/itpcom';
import { COMMON_EQUIPMENT, filterByEquipment, groupByEquipment, sameEquipment, showsEquipment, type EquipmentFilter } from '@/domain/equipment-scope';
import { docHref, documentsHref } from '@/features/docs/links';
import type { Lang, T } from '@/i18n/translate';
import { screenHref } from '@/config/screens';
import type { Commissioning, SatPlanRow } from '@/server/dal/commissioning';
import type { ItpPlan, PunchRow } from '@/server/dal/itp';
import type { ItpResult, PunchStatus } from '@/server/db/codes';
import { vigieReportNcrUrl } from '@/server/integrations/vigie/links';
import { localizeForm, resultFormDef } from './forms';
import { blockedT, dataT, failedT, missingT, planShapeT, stepT } from './i18n';

export interface KpiView {
  label: string;
  value: string;
  sub: string;
  color: string;
}

/** A Codex record button (`ph ph-file-text` + reference): the record drawer, or a vault search when not indexed. */
export interface DocButtonView {
  ref: string;
  href: string;
  /** Accessible name / tooltip: "Open document REC-HLT-007". */
  label: string;
}

const docButton = (ref: string | null, inCodex: boolean, code: string, t: T): DocButtonView | null =>
  ref
    ? {
        ref,
        href: inCodex ? docHref(ref, code) : documentsHref(code, { q: ref }),
        label: `${t(inCodex ? 'Open document' : 'Search in Codex')} ${ref}`,
      }
    : null;

// ── Inspection & test plan · punch list ───────────────────────────────────────────────────────────────

export type ItpViewKey = 'plan' | 'punch';
export const ITP_VIEWS: readonly ItpViewKey[] = ['plan', 'punch'];

/** `?view=` → plan (default; unknown values too) or punch. */
export const itpViewOf = (v: string | string[] | undefined): ItpViewKey => (v === 'punch' ? 'punch' : 'plan');

/** `/projects/{code}/itp` with its view (plan omitted). */
export const itpHref = (code: string, view: ItpViewKey = 'plan') => screenHref('itp', { code }) + (view === 'punch' ? '?view=punch' : '');

/** The punch list filtered on an origin (R-117): `?view=punch&origin=itp|site` (every origin omitted). */
export const punchListHref = (code: string, origin: PunchOriginFilter = 'all') => itpHref(code, 'punch') + (origin === 'all' ? '' : `&origin=${origin}`);

/**
 * R-185: the screen on an equipment line — the plan of a line (`?equipment=EQ-02`) or the punch list filtered on a line
 * (`…&equipment=EQ-02|common`; 'all' / the main line's plan omitted), keeping the punch list's origin filter.
 */
export function itpEquipmentHref(code: string, view: ItpViewKey, equipment: EquipmentFilter | null, origin: PunchOriginFilter = 'all'): string {
  const base = view === 'punch' ? punchListHref(code, origin) : itpHref(code, 'plan');
  if (!equipment || equipment === 'all') return base;
  return `${base}${base.includes('?') ? '&' : '?'}equipment=${encodeURIComponent(equipment)}`;
}

/** An equipment line as the ITP screen offers it (R-185): "EQ-02", "EQ-02 · 3 × MEMU". */
export interface ItpEquipmentLine {
  ref: string;
  label: string;
  position: number;
}

/** Id of a punch item's row (R-117 / R-128: a document relation "P-01" links to `…/itp?view=punch#punch-P-01`). */
export const punchAnchorId = (number: string) => `punch-${number}`;

/** "All" / "Inspection" / "Site" (English; translate with t()). */
export const PUNCH_ORIGIN_FILTER_LABEL: Record<PunchOriginFilter, string> = { all: 'All', itp: 'Inspection', site: 'Site' };

export interface InspectionRowView {
  number: string;
  name: string;
  type: string;
  typeClass: string;
  stage: string;
  reference: string;
  date: string;
  status: string;
  statusClass: string;
  statusColor: string;
  doc: DocButtonView | null;
  /** Result recorded in Keystone (R-112): "Passed 24 Sep · S. Haddad · client N. Bensaïd" (translated); null otherwise. */
  resultLine: string | null;
  /** Comment of the recorded result (typed text, shown as is). */
  comment: string | null;
  /** Vigie NCRs reported from this inspection (internal viewers only, P-10b). */
  ncrs: { number: string; href: string; label: string }[];
  /** Failed without a Vigie NCR yet: "Report the NCR in Vigie", prefilled (internal viewers only, Q-6b). */
  reportNcr: { href: string; label: string } | null;
  /** "Record result" (quality, engineering lead, director on an editable project): the translated form and the result seen. */
  record: { label: string; ariaLabel: string; form: FormDef; from: ItpResult } | null;
}

export interface InspectionGroupView {
  system: string;
  /** "2 / 4" (passed / lines). */
  passedText: string;
  rows: InspectionRowView[];
}

export interface PunchRowView {
  number: string;
  /** Row id (`punch-P-01`): the target of the document relations (R-128). */
  anchor: string;
  item: string;
  /** "Inspection" / "Site" (translated, R-117). */
  origin: string;
  /** Raised on site (R-117): its photos follow the Site screen's rights and are never shown to the client (X-15). */
  siteOrigin: boolean;
  /** Vigie's NCR number or '—'; null for the client (P-10b: the column is not shown). */
  ncr: string | null;
  /** R-185: the item's equipment line ("EQ-02") or "Common"; null when the project has at most one line (no column). */
  equipment: string | null;
  location: string;
  category: string;
  categoryClass: string;
  source: string;
  owner: string;
  due: string;
  status: string;
  statusClass: string;
  color: string;
  /** "Start" / "Close" (translated), its accessible name and the status it starts from; null once closed. */
  step: { label: string; ariaLabel: string; from: PunchStatus } | null;
}

export interface ItpScreenView {
  view: ItpViewKey;
  displayLabel: string;
  views: { value: ItpViewKey; label: string; href: string }[];
  kpis: KpiView[];
  /**
   * R-185 (choice 4): the equipment selector of the plan view (one plan per line) or the equipment filter of the punch list —
   * null when the project has at most one line (the screen of before R-185).
   */
  equipment: { label: string; value: string; options: { value: string; label: string; href: string }[] } | null;
  /** Plan view: one group per template system with lines; `empty` = "No inspection plan…" when there is none. */
  plan: { title: string; groups: InspectionGroupView[]; empty: string | null } | null;
  /**
   * Punch view. `empty` = "No punch item yet" when the project has none (the prototype showed the bare header row; the
   * rebuild's projects without data show an empty state). R-117 (A-6 'a'): one list per project with its Origin filter
   * (All / Inspection / Site); `ncr` = whether the NCR column is shown (internal viewers, P-10b).
   */
  punch: {
    title: string; subtitle: string; rows: PunchRowView[]; empty: string | null;
    origin: PunchOriginFilter; originLabel: string; origins: { value: PunchOriginFilter; label: string; href: string }[]; ncr: boolean;
    /** R-185: the Equipment column is shown (the project has more than one line). */
    equipment: boolean;
  } | null;
}

/** Who looks at the plan (R-112): may they record results, are they internal (Vigie links and NCR numbers), their name. */
export interface ItpViewer {
  /** Quality, engineering lead or director, screen editable for them. */
  canRecord: boolean;
  /** Not the client: Vigie is internal and the client does not see NCRs (P-10b). */
  internal: boolean;
  /** Full name: the inspector proposed by the result form. */
  name: string;
}
const READER: ItpViewer = { canRecord: false, internal: true, name: '' };

export interface ItpScreenInput {
  code: string;
  view: ItpViewKey;
  plan: ItpPlan | null;
  /** The project's punch list, every origin (R-117): the KPIs count it whole. */
  punch: PunchRow[];
  /** Origin filter of the punch view (`?origin=`, default all). */
  origin?: PunchOriginFilter;
  /** Label of the project's machine type (KPI "Template" without a plan). */
  machineType: string | null;
  /** Business date (ISO, R-013): the dates' year window and the result form's default date. */
  today: string;
  /** Default: an internal reader who cannot record results. */
  viewer?: ItpViewer;
  /**
   * R-185: the project's equipment lines (main first), the line whose plan is shown (plan view) and the punch list's equipment
   * filter (`?equipment=`). Absent / at most one line: the screen of before R-185.
   */
  equipment?: { lines: readonly ItpEquipmentLine[]; selected: string | null; filter?: EquipmentFilter };
}

export function itpScreenView({ code, view, plan, punch, origin = 'all', machineType, today, viewer = READER, equipment }: ItpScreenInput, t: T, lang: Lang): ItpScreenView {
  const lines = equipment?.lines ?? [];
  const multi = showsEquipment(lines);
  const filter: EquipmentFilter = equipment?.filter ?? 'all';
  const lineLabel = (ref: string | null) => (ref ? lines.find((l) => l.ref === ref)?.ref ?? ref : t('Common'));
  const equipmentView: ItpScreenView['equipment'] = !multi
    ? null
    : view === 'plan'
      ? {
          label: t('Equipment'), value: equipment?.selected ?? lines[0].ref,
          options: lines.map((l) => ({ value: l.ref, label: l.label, href: itpEquipmentHref(code, 'plan', l.ref === lines[0].ref ? null : l.ref) })),
        }
      : {
          label: t('Equipment'), value: filter,
          options: [
            { value: 'all', label: t('All'), href: itpEquipmentHref(code, 'punch', null, origin) },
            ...lines.map((l) => ({ value: l.ref, label: l.label, href: itpEquipmentHref(code, 'punch', l.ref, origin) })),
            { value: COMMON_EQUIPMENT, label: t('Common to the project'), href: itpEquipmentHref(code, 'punch', COMMON_EQUIPMENT, origin) },
          ],
        };
  const inspections = plan?.inspections ?? [];
  const s = summariseItp(inspections, punch, plan && plan.template ? { template: plan.template, systems: plan.systems.length, custom: plan.customCount } : null, machineType);
  const kpis: KpiView[] = [
    { label: t('Inspections passed'), value: `${s.passed} / ${s.total}`, sub: failedT(s.failed, lang), color: s.passedColor },
    { label: t('Hold points ahead'), value: String(s.holdAhead), sub: t('client presence required'), color: OK },
    { label: t('Open punch items'), value: String(s.open), sub: openByCategoryText(s.openA, s.openB, s.openC), color: s.openColor },
    {
      label: t('Template'),
      value: s.template,
      sub: s.plan ? planShapeT(s.plan.systems, s.plan.custom, lang) : t('standard template for this machine type'),
      color: 'var(--color-neutral-200)',
    },
  ];
  const groups = groupBySystem(plan?.systems ?? [], inspections).map((g) => ({
    system: dataT(g.system, lang),
    passedText: `${g.passed} / ${g.count}`,
    rows: g.rows.map((r) => {
      const look = inspectionLook(r.pointType, r.result);
      const line = !!r.resultOn;
      const name = dataT(r.name, lang);
      const ncrs = viewer.internal ? (r.ncrs ?? []).map((n) => ({ number: n.number, href: n.vigieUrl, label: `${t('Open in Vigie')} · ${n.number}` })) : [];
      const recordLabel = t('Record result');
      return {
        number: r.number, name, type: t(r.pointTypeLabel), typeClass: look.typeClass, stage: t(r.stageLabel), reference: r.reference,
        date: t(itpDateText(r.plannedOn, today)), status: t(r.resultLabel), statusClass: look.statusClass, statusColor: look.statusColor,
        doc: docButton(r.recordRef, r.recordInCodex, code, t),
        resultLine: line ? resultLineText(r, today, t) : null,
        // The comment of a failure describes the non-conformity: internal (P-10b), not shown to the client.
        comment: viewer.internal ? (r.resultComment ?? null) : null,
        ncrs,
        reportNcr:
          viewer.internal && r.result === 'failed' && !ncrs.length
            ? { href: vigieReportNcrUrl({ projectCode: code, title: inspectionNcrTitle(r), inspection: r.number }), label: t('Report the NCR in Vigie') }
            : null,
        record: viewer.canRecord
          ? {
              label: recordLabel,
              ariaLabel: `${recordLabel} · ${r.number}`,
              from: r.result,
              form: localizeForm(resultFormDef(r.pointType, {
                result: r.resultOn ? r.result : 'passed', date: itpDateText(r.resultOn ?? today, today), inspector: r.inspector ?? viewer.name,
                witness: r.clientWitness ?? '', comment: r.resultComment ?? '',
              }), t, lang),
            }
          : null,
      };
    }),
  }));
  return {
    view,
    displayLabel: t('Display'),
    views: [
      { value: 'plan', label: t('Inspection & test plan'), href: itpHref(code, 'plan') },
      { value: 'punch', label: t('Punch list'), href: itpHref(code, 'punch') },
    ],
    kpis,
    equipment: equipmentView,
    plan:
      view === 'plan'
        ? {
            title: multi && equipmentView ? `${t('Inspection & test plan')} · ${lines.find((l) => l.ref === equipmentView.value)?.label ?? equipmentView.value}` : t('Inspection & test plan'),
            groups,
            empty: groups.length
              ? null
              : multi
                ? t('No inspection plan for this equipment yet · its first inspection creates it')
                : t('No inspection plan for this project yet · pick a template when creating the project'),
          }
        : null,
    punch:
      view === 'punch'
        ? (() => {
            const byOrigin = filterPunchByOrigin(punch, origin);
            const rows = multi ? filterByEquipment(byOrigin.map((p) => ({ ...p, equipmentRef: p.equipmentRef ?? null })), filter) : byOrigin;
            return {
              title: t('Punch list'),
              subtitle: t('A blocking · B before SAT · C cosmetic'),
              rows: rows.map((p) => ({ ...punchRowView(p, viewer.internal, today, t, lang), equipment: multi ? lineLabel(p.equipmentRef ?? null) : null })),
              empty: rows.length ? null : t(!punch.length ? 'No punch item yet' : byOrigin.length ? 'No punch item for this equipment' : 'No punch item of this origin'),
              origin,
              originLabel: t('Origin'),
              origins: PUNCH_ORIGIN_FILTERS.map((o) => ({ value: o, label: t(PUNCH_ORIGIN_FILTER_LABEL[o]), href: punchListHref(code, o) })),
              ncr: viewer.internal,
              equipment: multi,
            };
          })()
        : null,
  };
}

/**
 * A row of the unified punch list (R-117). Typed text (item, location, owner person) as typed; the party and the codes'
 * labels through t(); the NCR number for internal viewers only (P-10b).
 */
export function punchRowView(p: PunchRow, internal: boolean, today: string, t: T, lang: Lang): PunchRowView {
  const look = punchLook(p.category, p.status);
  const step = punchStep(p.status);
  const label = step ? stepT(step.label, t, lang) : '';
  return {
    number: p.number, anchor: punchAnchorId(p.number), item: dataT(p.description, lang), origin: t(p.originLabel), siteOrigin: p.origin === 'site',
    ncr: internal ? (p.ncrNumber ?? '—') : null, equipment: null, location: dataT(p.location, lang), category: p.category ?? '—', categoryClass: look.categoryClass,
    source: p.sourceText ? t(p.sourceText) : '—', owner: p.ownerName ? dataT(p.ownerName, lang) : p.owner ? t(p.owner) : '—', due: t(itpDateText(p.dueOn, today)),
    status: t(p.statusLabel), statusClass: look.statusClass, color: look.color, step: step ? { label, ariaLabel: `${label} · ${p.number}`, from: p.status } : null,
  };
}

// ── Commissioning & handover dossier ──────────────────────────────────────────────────────────────────

export interface CommissioningCellView {
  status: string;
  /** Date of the step or the blocking reference ("IF-02"); '' when none. */
  date: string;
  bg: string;
  border: string;
  color: string;
  icon: 'Check' | 'LockSimple' | 'CircleHalf' | 'CircleDashed';
  /** Tooltip of a SAT cell planned in Keystone ("SAT planned by …"). */
  title?: string;
}

export interface CommissioningRowView {
  system: string;
  cells: CommissioningCellView[];
  blockingA: number;
}

export interface DossierRowView {
  item: string;
  type: string;
  status: string;
  statusClass: string;
  doc: DocButtonView | null;
}

export interface CommissioningScreenView {
  kpis: KpiView[];
  title: string;
  columns: string[];
  blockingLabel: string;
  rows: CommissioningRowView[];
  /**
   * R-185: the rows by equipment line — one group without label when the project has at most one line (the grid of before
   * R-185); else a group per line ("EQ-02 · 3 × MEMU") then "Common to the project".
   */
  groups: { label: string | null; rows: CommissioningRowView[] }[];
  dossierTitle: string;
  dossier: DossierRowView[];
}

const satTitle = (p: SatPlanRow, today: string, t: T) =>
  [`${t('SAT planned')} ${t(itpDateText(p.plannedOn, today))} · ${p.plannedBy}`, p.clientWitnesses ? `${t('Client witnesses')} ${p.clientWitnesses}` : ''].filter(Boolean).join(' · ');

/** Null when the project has no commissioning plan (the screen shows its empty panel). `today` = the business date (R-013). */
export function commissioningScreenView(code: string, c: Commissioning | null, punch: readonly PunchRow[], today: string, t: T, lang: Lang): CommissioningScreenView | null {
  if (!c) return null;
  const s = summariseCommissioning(c.systems, c.dossier, punch);
  const dash = (iso: string | null) => (iso ? itpDateText(iso, today) : '—');
  const lastSat = (system: string) => [...c.satPlans].reverse().find((p) => p.system === system);
  return {
    kpis: [
      { label: t('Systems handed over'), value: `${s.handedOver} / ${s.systems}`, sub: t(`SAT planned ${dash(s.satOn)} · handover ${dash(s.handoverOn)}`), color: OK },
      { label: t('Steps completed'), value: `${s.done} / ${s.cells}`, sub: blockedT(s.blocked, lang), color: s.stepsColor },
      { label: t('Blocking punch items (A)'), value: String(s.openA), sub: t('must be closed before SAT'), color: s.punchColor },
      { label: t('Handover dossier'), value: `${s.dossierPct} %`, sub: missingT(s.missing, lang), color: s.dossierColor },
    ],
    title: t('Commissioning by system'),
    columns: c.steps.map((x) => t(x.label)),
    blockingLabel: t('Blocking A'),
    ...(() => {
      // R-185: "Blocking A" of a line's system counts the items of its line and the common ones.
      const entries = c.systems.map((sys) => {
        const sat = lastSat(sys.name);
        const equipmentRef = sys.equipmentRef ?? null;
        const row: CommissioningRowView = {
          system: dataT(sys.name, lang),
          blockingA: blockingAOf(sys.name, punch.filter((p) => sameEquipment(p.equipmentRef, equipmentRef))),
          cells: sys.cells.map((x) => ({
            status: t(x.statusLabel),
            date: x.blockingRef ?? t(itpDateText(x.dateOn, today)),
            ...commissioningCellLook(x.status),
            ...(x.step === 'sat' && sat ? { title: satTitle(sat, today, t) } : {}),
          })),
        };
        return { equipmentRef, row };
      });
      const rows = entries.map((e) => e.row);
      const lines = c.equipment ?? [];
      if (!showsEquipment(lines)) return { rows, groups: [{ label: null, rows }] };
      const label = (ref: string | null) => (ref ? lines.find((l) => l.ref === ref)?.label ?? ref : t('Common to the project'));
      return { rows, groups: groupByEquipment(entries, lines).map((g) => ({ label: label(g.ref), rows: g.rows.map((e) => e.row) })) };
    })(),
    dossierTitle: t('Handover dossier'),
    dossier: c.dossier.map((d) => ({
      item: dataT(d.item, lang), type: d.documentType, status: t(d.statusLabel), statusClass: `tag ${d.statusTag}`, doc: docButton(d.documentRef, d.documentInCodex, code, t),
    })),
  };
}
