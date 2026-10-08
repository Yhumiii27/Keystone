// View models of the Team & exchanges screens (docs/spec/05 §6 Stakeholders & RACI, template 870–879; 07 §2.5
// Interface register, template 893–899): KPI tiles, register rows, RACI grid, need-date texts, row actions and empty
// states, translated. Built from the DAL rows with the pure rules of src/domain/team.ts.
import { LO, OK, TAG_CLASS, raciCell, statusTagClass } from '@/components/app/tones';
import {
  interfaceRowState, raciGrid, stakeholderTone, summariseInterfaces, summariseStakeholders,
} from '@/domain/team';
import type { Lang, T } from '@/i18n/translate';
import type { InterfaceRow } from '@/server/dal/interfaces';
import type { StakeholderRegister } from '@/server/dal/stakeholders';
import type { CommissioningBlocker } from '@/server/dal/team';
import { blockersText, dataT, dueWithinText, frozenReceivedText, rolesText, stakeholderMixText, statusT } from './i18n';

export interface KpiView {
  label: string;
  value: string;
  sub: string;
  color: string;
}

// ── Stakeholders & RACI ─────────────────────────────────────────────────────────────────────────────

export interface StakeholderRowView {
  key: string;
  name: string;
  initials: string;
  /** "{org} · {role}" (just the organisation when no role was given). */
  sub: string;
  type: string;
  typeClass: string;
  owner: string;
  /** "12 Mar · > 30 d" when stale. */
  lastText: string;
  lastColor: string;
  /** E-mail or "—". */
  contactText: string;
  notes: string;
}

export interface RaciCellView {
  /** 'R' | 'A' | 'C' | 'I' | 'B' | '' (empty cell). */
  v: string;
  color: string;
  bg: string;
  border: string;
}

export interface RaciView {
  columns: string[];
  rows: { label: string; cells: RaciCellView[] }[];
  /** `grid-template-columns` and `min-width` (dynamic column count). */
  template: string;
  minWidth: number;
}

export interface StakeholdersView {
  kpis: KpiView[];
  rows: StakeholderRowView[];
  /** "No stakeholder yet" when the register is empty. */
  empty: string | null;
  /** Null when the project has no RACI matrix (the card is not shown). */
  raci: RaciView | null;
}

export function stakeholdersView(register: StakeholderRegister, t: T, lang: Lang): StakeholdersView {
  const rows = register.stakeholders;
  const s = summariseStakeholders(rows, register.raci);
  const kpis: KpiView[] = [
    { label: t('Stakeholders'), value: String(s.count), sub: stakeholderMixText(s.clients, s.authorities, s.suppliersAndThirdParties, lang), color: OK },
    { label: t('Relationship owners'), value: String(s.owners.length), sub: s.owners.join(' · ') || '—', color: OK },
    { label: t('RACI responsibilities'), value: String(s.raciRows), sub: rolesText(s.raciRoles, lang), color: OK },
    { label: t('No contact > 30 days'), value: String(s.stale), sub: t('relationship owner to follow up'), color: s.stale ? LO : OK },
  ];
  const raci = register.raci?.rows.length
    ? {
        columns: register.raci.columns.map((c) => dataT(c, lang)),
        rows: register.raci.rows.map((r) => ({ label: dataT(r.label, lang), cells: r.cells.map((v) => ({ v: v ?? '', ...raciCell(v) })) })),
        ...raciGrid(register.raci.columns.length),
      }
    : null;
  return {
    kpis,
    rows: rows.map((r, i) => ({
      key: `${i}:${r.name}`,
      name: r.name,
      initials: r.initials,
      sub: [dataT(r.organisation, lang), dataT(r.role, lang)].filter(Boolean).join(' · '),
      type: t(r.typeLabel),
      typeClass: TAG_CLASS[stakeholderTone(r.type)],
      owner: r.owner,
      lastText: t(r.lastText) + (r.stale ? ` · ${t('> 30 d')}` : ''),
      lastColor: r.stale ? LO : 'var(--color-neutral-400)',
      contactText: r.contactEmail || '—',
      notes: dataT(r.notes, lang),
    })),
    empty: rows.length ? null : t('No stakeholder yet'),
    raci,
  };
}

// ── Interface register ──────────────────────────────────────────────────────────────────────────────

export interface InterfaceRowView {
  number: string;
  title: string;
  side: string;
  otherParty: string;
  data: string;
  /** "15 Oct". */
  needed: string;
  /** "in 15 d" / "10 d late" / ''. */
  neededSub: string;
  neededColor: string;
  /** "12 Sep" or "—". */
  provided: string;
  status: string;
  statusClass: string;
  owner: string;
  /** Row actions the status allows (the page also needs edit rights). */
  canReceive: boolean;
  canFreeze: boolean;
}

export interface InterfacesView {
  kpis: KpiView[];
  rows: InterfaceRowView[];
  /** "No interface registered" when the register is empty. */
  empty: string | null;
  /** Late count for the nav badge (`ifcBadge`). */
  late: number;
}

export function interfacesView(interfaces: readonly InterfaceRow[], blockers: readonly CommissioningBlocker[], t: T, lang: Lang): InterfacesView {
  const facts = interfaces.map((r) => ({ number: r.number, status: r.status, daysToNeed: r.daysToNeed }));
  const s = summariseInterfaces(facts, blockers.map((b) => b.number));
  const st = statusT(t, lang);
  const blockingLabels = s.blocking.map((n) => blockers.find((b) => b.number === n)!.label);
  const kpis: KpiView[] = [
    { label: t('Interfaces'), value: String(s.count), sub: frozenReceivedText(s.frozen, s.received, lang), color: OK },
    { label: t('Open'), value: String(s.open), sub: dueWithinText(s.dueWithin30, lang), color: OK },
    { label: t('Late'), value: String(s.late.length), sub: s.late.join(' · ') || '—', color: s.late.length ? LO : OK },
    // Sub: what the still-open blockers hold up (the prototype always printed "HV cell · anti-collision zones").
    // Colour: LO while any blocker is open or late (the prototype turned it LO only for an Open one, so two late
    // blockers showed in the normal colour).
    { label: t('Blocking commissioning'), value: String(s.blocking.length), sub: blockersText(blockingLabels, t, lang), color: s.blocking.length ? LO : OK },
  ];
  return {
    kpis,
    rows: interfaces.map((r, i) => {
      const rs = interfaceRowState(facts[i]);
      return {
        number: r.number,
        title: dataT(r.title, lang),
        side: t(r.keystoneSideLabel),
        otherParty: dataT(r.otherParty, lang),
        data: dataT(r.dataExpected, lang),
        needed: t(r.neededText),
        neededSub: rs.neededSub ? t(rs.neededSub.kind === 'late' ? `${rs.neededSub.days} d late` : `in ${rs.neededSub.days} d`) : '',
        neededColor: rs.neededAlert ? LO : OK,
        provided: r.providedOn ? t(r.providedText) : '—',
        status: st(r.statusLabel),
        statusClass: statusTagClass('interface', r.status),
        owner: r.owner,
        canReceive: rs.canReceive,
        canFreeze: rs.canFreeze,
      };
    }),
    empty: interfaces.length ? null : t('No interface registered'),
    late: s.late.length,
  };
}
