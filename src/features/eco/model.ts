// View models of the Engineering change orders screen (docs/spec/09 §4, template 1312–1376, logic 4339–4370): KPI
// tiles, status chips, the register rows and the ECO drawer, translated for the viewer. The ECOs are Vigie's (status,
// effectivity, dispositions, lock and release are computed there); the derivations are src/domain/eco.ts, the data
// src/server/dal/eco-screen.ts. Pure (no I/O): the page passes the data, `t` and the language.
import { LO, OK } from '@/components/app/tones';
import {
  approvalDots, approvalsHint, canDecideDisposition, canSetInterchangeability, costDeltaText, costText, dispositionView, ecoChips, ecoKpis, ecoRowAction,
  ecoStatusTag, ecoSteps, interchangeabilityView, keyStates, partsSummary, pendingDispositionsTag, pendingLine, pinnedListText, requestedStepText,
  schedDeltaText, schedText, syncLabelOf, type EcoRowAction, type EcoViewer,
} from '@/domain/eco';
import { renderTxt } from '@/domain/home';
import type { Lang, T } from '@/i18n/translate';
import { displayOfIso, fmtDOfIso, OPEN_BOM_STAGES, PART_STATUS_TAG, vigieSyncStatus, type EcoApproverKey, type EcoStatus, type StageCode } from '@/server/db/codes';
import type { EcoDrawerData } from '@/server/dal/eco-screen';
import type { EcoView } from '@/server/dal/eco';
import { dataText, ecoT } from './i18n';
import { ecoScreenHref, fleetHref, interventionsHref, partRecordHref, projectBomHref } from './links';

export interface EcoState {
  status: EcoStatus | null;
  eco: string | null;
}

export interface KpiView {
  label: string;
  value: string;
  sub: string;
  color: string;
}

export interface ChipView {
  value: string;
  label: string;
  count: number;
  href: string;
}

export interface EcoRowView {
  number: string;
  /** Row click: opens the drawer, or closes it when this ECO is open. */
  href: string;
  selected: boolean;
  title: string;
  /** "Gabriel Comte · 19 Sep". */
  byLine: string;
  type: string;
  parts: string;
  projects: string;
  cost: string;
  sched: string;
  /** `title` = "Engineering lead · Approved" (+ the Vigie sync state): tooltip and accessible name of the dot. */
  approvals: { key: EcoApproverKey; label: string; dot: string; title: string }[];
  status: string;
  statusClass: string;
  /** "3 dispositions pending" under the status, lock or hourglass icon. */
  pending: { lock: boolean; text: string } | null;
  /** Step button (sent to Vigie) or the "Set interchangeability" tag. */
  action: { kind: 'step'; target: EcoStatus; label: string; variant: 'primary' | 'secondary' } | { kind: 'tag'; label: string } | null;
  /** "Pending sync with Vigie" — progress recorded in Keystone and not yet in Vigie. */
  sync: string | null;
  vigieUrl: string;
}

export interface EcoScreenView {
  kpis: KpiView[];
  chips: ChipView[];
  /** Chip value of the current filter ('all' or a status code). */
  filter: string;
  rows: EcoRowView[];
  empty: string | null;
}

const kpiColor = (lo: boolean) => (lo ? LO : OK);

function rowAction(a: EcoRowAction, t: T): EcoRowView['action'] {
  if (!a) return null;
  return a.kind === 'step' ? { kind: 'step', target: a.target, label: t(a.label), variant: a.variant } : { kind: 'tag', label: t(a.label) };
}

/** Register view: KPI tiles for the viewer, status chips (links), filtered rows. */
export function ecoScreenView(
  input: { ecos: EcoView[]; awaitingMine: number; state: EcoState; viewer: { role: string; title: string }; /** R-013: business date ("released this month"). */ today: string },
  tr: T,
  lang: Lang,
): EcoScreenView {
  const t = ecoT(tr, lang);
  const { ecos, state } = input;
  const roleKey = input.viewer.role === 'englead' || input.viewer.role === 'quality' || input.viewer.role === 'pm' ? input.viewer.role : null;
  const kpis = ecoKpis(ecos, { roleKey, roleTitle: input.viewer.title, awaitingMine: input.awaitingMine, lang, asOf: input.today }).map((k) => ({
    label: t(k.label), value: String(k.value), sub: renderTxt(k.sub, t), color: kpiColor(k.lo),
  }));
  const chips = ecoChips(ecos).map((c) => ({ value: c.value ?? 'all', label: t(c.label), count: c.count, href: ecoScreenHref({ status: c.value, eco: state.eco }) }));
  const shown = state.status ? ecos.filter((e) => e.status === state.status) : ecos;
  const rows = shown.map((e): EcoRowView => {
    const selected = state.eco === e.number;
    const pend = pendingLine(e);
    const sync = syncLabelOf(e);
    return {
      number: e.number,
      href: ecoScreenHref({ status: state.status, eco: selected ? null : e.number }),
      selected,
      title: dataText(e.title, lang),
      byLine: `${e.requestedBy} · ${t(fmtDOfIso(e.raisedOn))}`,
      type: t(e.typeLabel),
      parts: partsSummary(e.parts),
      projects: e.projectNames.map(t).join(', '),
      cost: costText(e.costEur, lang),
      sched: t(schedText(e.scheduleDays)),
      approvals: approvalDots(e).map((d) => {
        const a = e.approvalsView.find((x) => x.key === d.key);
        return { key: d.key, label: t(d.label), dot: d.dot, title: `${t(a?.label ?? d.label)} · ${t(a?.decisionLabel ?? 'Pending')}${d.sync ? ` · ${t(vigieSyncStatus.label(d.sync))}` : ''}` };
      }),
      status: t(e.statusLabel),
      statusClass: ecoStatusTag(e.status),
      pending: pend ? { lock: pend.icon === 'lock', text: t(pend.text) } : null,
      action: rowAction(ecoRowAction(e), t),
      sync: sync ? t(e.requestedStatus ? `${requestedStepText(e.requestedStatus)} · ${sync}` : sync) : null,
      vigieUrl: e.vigieUrl,
    };
  });
  return { kpis, chips, filter: state.status ?? 'all', rows, empty: rows.length ? null : t('No ECO in this status') };
}

// ── Drawer ─────────────────────────────────────────────────────────────────────────────────────────────

export interface TargetView {
  key: string;
  name: string;
  /** "HLT-026 · Frozen BOM · Fabrication & Assemblage · R. Aubert" / "MCH-041 · Port authority · Gen 2 · 14 Dec 2025 · In warranty". */
  sub: string;
  href: string;
  revText: string;
  label: string;
  tagClass: string;
  /** "Decided by PM · Design phase — updated automatically". */
  decidedBy: string;
  /** The prototype let this viewer set the disposition: it is managed in Vigie now ("Manage in Vigie" link). */
  manage: boolean;
}

export interface KeyRowView {
  key: EcoApproverKey;
  label: string;
  who: string;
  state: string;
  tagClass: string;
  /** "Pending sync with Vigie" when the decision shown was recorded in Keystone; null otherwise. */
  sync: string | null;
  canAct: boolean;
}

export interface EcoDrawerView {
  number: string;
  closeHref: string;
  title: string;
  type: string;
  status: string;
  statusClass: string;
  vigieUrl: string;
  /** "Impact analysis requested · Pending sync with Vigie" or "Pending sync with Vigie"; null when nothing waits. */
  sync: string | null;
  steps: { label: string; reached: boolean }[];
  rejected: boolean;
  /** "Raised by Gabriel Comte · 19 Sep". */
  raisedBy: string;
  impact: { k: string; v: string; color: string }[];
  parts: { ref: string; name: string; status: string; statusClass: string; href: string }[];
  /** "FD-DET-OPT · CD-200 → CD-210". */
  revText: string;
  pending: { text: string; tagClass: string };
  interch: { label: string; tagClass: string; hint: string; manage: boolean };
  locked: boolean;
  projectsTitle: string;
  projects: TargetView[];
  machinesTitle: string;
  machines: TargetView[];
  noMachines: string | null;
  retrofit: { text: string; action: string; href: string } | null;
  /** "Pinned revisions keep … do not scrap: MCH-029 (ASM-RMG-250 rev B) · …"; null without a pinned machine. */
  pinned: string | null;
  approvals: KeyRowView[];
  hint: string;
}

/** The ECO drawer for the viewer (`viewer.managedProjects` decides the PM key). */
export function ecoDrawerView(input: { data: EcoDrawerData; state: EcoState; viewer: EcoViewer }, tr: T, lang: Lang): EcoDrawerView {
  const t = ecoT(tr, lang);
  const { data, state, viewer } = input;
  const e = data.eco;
  const sync = syncLabelOf(e);
  const steps = ecoSteps(e.status);
  const target = (kind: 'project' | 'machine') => e.effectivity.filter((x) => x.targetType === kind);

  const projects = target('project').map((x): TargetView => {
    const p = data.projects[x.targetRef];
    const d = dispositionView(x, e);
    const open = !!p && OPEN_BOM_STAGES.includes(p.stage as StageCode);
    return {
      // The project name and its PM as typed (R-148); the BOM state and the status through t().
      key: x.targetRef, name: dataText(x.label, lang),
      sub: [p?.code ?? x.targetRef, t(open ? 'Open BOM' : 'Frozen BOM'), t(p?.status ?? '—'), p?.pm ?? ''].join(' · '),
      href: projectBomHref(p?.code ?? x.targetRef), revText: d.revText, label: t(d.label), tagClass: d.tagClass,
      decidedBy: `${t('Decided by')} ${t(d.decider)}${d.note ? ` · ${dataText(d.note, lang)}` : ''}`,
      manage: canDecideDisposition(e.status, 'project', viewer.role),
    };
  });
  const machines = target('machine').map((x): TargetView => {
    const m = data.machines[x.targetRef];
    const d = dispositionView(x, e);
    return {
      key: x.targetRef, name: dataText(m?.name ?? x.label, lang),
      // The client as typed (R-148); generation, warranty date and warranty state through t().
      sub: [`${x.targetRef} · ${dataText(m?.client ?? '', lang)}`, m?.generation ? t(m.generation) : '', m?.warrantyStart ? t(displayOfIso(m.warrantyStart)) : '', m?.warrantyText ? t(m.warrantyText) : ''].join(' · '),
      href: fleetHref(), revText: t(d.revText), label: t(d.label), tagClass: d.tagClass,
      decidedBy: `${t('Decided by')} ${t(d.decider)}${d.note ? ` · ${dataText(d.note, lang)}` : ''}`,
      manage: canDecideDisposition(e.status, 'machine', viewer.role),
    };
  });
  const pinned = pinnedListText(e.effectivity);
  const inter = interchangeabilityView(e.interchangeability);
  const pend = pendingDispositionsTag(e.pendingDispositions);
  const partsByRef = new Map(data.parts.map((p) => [p.ref, p]));

  return {
    number: e.number,
    closeHref: ecoScreenHref({ status: state.status }),
    title: dataText(e.title, lang),
    type: t(e.typeLabel),
    status: t(e.statusLabel),
    statusClass: ecoStatusTag(e.status),
    vigieUrl: e.vigieUrl,
    sync: sync ? t(e.requestedStatus ? `${requestedStepText(e.requestedStatus)} · ${sync}` : sync) : null,
    steps: steps.steps.map((s) => ({ label: t(s.label), reached: s.reached })),
    rejected: steps.rejected,
    raisedBy: `${t('Raised by')} ${e.requestedBy} · ${t(fmtDOfIso(e.raisedOn))}`,
    impact: [
      { k: 'Projects & BOMs', v: e.projectNames.map(t).join(', '), color: OK },
      { k: 'Open purchase orders', v: e.openPurchaseOrders.map((o) => `${o.number} · ${o.supplier} · ${t(o.statusLabel)}`).join(' · ') || t('None'), color: OK },
      { k: 'Stock to scrap / rework', v: dataText(e.stockImpact, lang), color: OK },
      { k: 'Cost delta', v: t(costDeltaText(e.costEur, lang)), color: e.costEur > 5000 ? LO : OK },
      { k: 'Schedule delta', v: t(schedDeltaText(e.scheduleDays)), color: OK },
      { k: 'Documents to update', v: e.documentRefs.map((d) => dataText(d, lang)).join(' · '), color: OK },
    ].map((x) => ({ ...x, k: t(x.k) })),
    parts: e.parts.map((ref) => {
      const p = partsByRef.get(ref);
      return { ref, name: p ? dataText(p.name, lang) : '', status: p ? t(p.statusLabel) : '', statusClass: p ? `tag ${PART_STATUS_TAG[p.status]}` : 'tag tag-neutral', href: partRecordHref(ref) };
    }),
    revText: `${e.parts[0] ?? ''} · ${e.fromRevision} → ${e.toRevision}`,
    pending: { text: t(pend.text), tagClass: pend.tagClass },
    interch: { label: t(inter.label), tagClass: inter.tagClass, hint: t(inter.hint), manage: canSetInterchangeability(e.status, viewer.role) },
    locked: e.locked,
    projectsTitle: `${t('Projects & BOMs')} · ${projects.length}`,
    projects,
    machinesTitle: `${t('Installed base')} · ${machines.length}`,
    machines,
    noMachines: machines.length ? null : t('No machine in the installed base carries these parts.'),
    retrofit: e.effectivity.some((x) => x.targetType === 'machine' && x.disposition === 'retrofit')
      ? { text: t('Retrofit interventions are planned manually in After-sales.'), action: t('Plan intervention'), href: interventionsHref() }
      : null,
    pinned: pinned ? `${t('Pinned revisions keep their spare parts and stock — do not scrap:')} ${t(pinned)}` : null,
    approvals: keyStates(e, viewer).map((k) => ({
      key: k.key, label: t(k.label), who: k.who, state: t(k.state), tagClass: k.tagClass, sync: k.sync ? t(vigieSyncStatus.label(k.sync)) : null, canAct: k.canAct,
    })),
    hint: t(approvalsHint(e.status, viewer.role)),
  };
}
