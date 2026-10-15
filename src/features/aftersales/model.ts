// View models of the Warranty & after-sales screens (docs/spec/07 §2.8–2.9, template 948–971, logic 4979–4995), built
// on the server from the screen loaders (src/server/dal/aftersales.ts) and the domain rules (src/domain/aftersales.ts),
// translated with t() and the feature's helpers (./i18n.ts). Pure: no I/O.
// Deliberate deviations from the prototype: the Interventions column headed "Project" showed the intervention type —
// it is headed "Type" (00 §7.16, 07 OQ7); the claims screen's zone notice tests the list on show (07 A.1) and names what
// is missing — the machines, else the view's list (R-155, X-16); the machine sub-line drops the trailing " · " when no
// configuration generation is recorded; a claim's design ECO opens Keystone's
// Change orders screen when Vigie reports it, else the ECO in Vigie (the prototype's tag was inert, 07 OQ20); the
// configuration tags also offer "Open in Vigie" (Vigie owns the ECOs). Vigie is an internal application: the client
// (who reaches these screens outside their workspace) gets no Vigie link — a design ECO Vigie does not report to
// Keystone is then a plain tag, as the prototype's.
import type { MirrorEcoRef, FleetScreenData, SavScreenData } from '@/server/dal/aftersales';
import {
  SAV_VIEWS, SAV_VIEW_LABEL, SEVERITY_TONE, WARRANTY_TONE, claimCostRows, claimStatusTone, configItems, coverageTone, fleetKpis, fleetZoneEmpty,
  interventionTone, savKpis, savZoneEmpty, type KpiCard, type SavView, type ZoneCode,
} from '@/domain/aftersales';
import type { FormDef } from '@/components/app/form-def';
import type { Lang, T } from '@/i18n/translate';
import { money } from '@/lib/format';
import { displayOfIso } from '@/server/db/codes';
import { vigieEcoUrl } from '@/server/integrations/vigie/links';
import { countText, dataText, interventionStatusText } from './i18n';
import { claimHref, ecoHref, savHref } from './links';

const LO = 'var(--color-accent-300)';
const OK = 'var(--color-text)';
const MUTED = 'var(--color-neutral-500)';
const NEUTRAL_200 = 'var(--color-neutral-200)';
const tag = (tone: string) => `tag tag-${tone}`;
/** "14 Dec 2025" / "14 déc. 2025"; "—" when none. */
const dateText = (iso: string | null, t: T) => (iso ? t(displayOfIso(iso)) : '—');

export interface KpiView {
  label: string;
  value: string;
  sub: string;
  color: string;
}

function kpiViews(cards: KpiCard[], t: T, lang: Lang): KpiView[] {
  return cards.map((k) => ({
    label: t(k.label),
    value: k.value,
    sub: k.count ? countText(k.count.kind, k.count.n, lang) : t(k.sub),
    color: k.alert ? LO : k.muted ? NEUTRAL_200 : OK,
  }));
}

/**
 * Zone notice of the machine lists (R-155, X-16): "No machine in this zone" when the zone has no machine; on Warranty &
 * claims, a zone with machines whose view lists nothing names that view's list (07 A.1 — the notice tests the list on
 * show; deviation from X-16's literal text, which would be false for Asia Pacific › Interventions on the seed). The
 * project screens keep "No project in this zone for this view".
 */
const NO_MACHINE = 'No machine in this zone';
const SAV_ZONE_EMPTY: Record<SavView, string> = { claims: 'No claim in this zone', interventions: 'No intervention in this zone', costs: 'No warranty cost in this zone' };

/** Who looks at the screens. */
export interface AftersalesViewer {
  /** Links to Vigie are shown (an internal application: not to the client). */
  vigie: boolean;
  /** R-143: the viewer edits claims and interventions (workspace; the Server Functions re-check). Default false. */
  canEdit?: boolean;
  /** R-143: the claim whose drawer is open (`?claim=`). */
  selectedClaim?: string | null;
  /** R-143: "Mark done" form per planned intervention (translated), built by the page for editors. */
  doneForms?: Record<string, FormDef>;
}
const STAFF: AftersalesViewer = { vigie: true };

// ── Installed base ──────────────────────────────────────────────────────────────────────────────────────

export interface ConfigView {
  items: { text: string; cls: string }[];
  /** Keystone's Change orders screen on the first ECO (the prototype's `openEcoScreen(first)`). */
  href: string;
  /** Accessible name / tooltip: the ECOs counted. */
  title: string;
  /** "Open in Vigie" of the first ECO; null when the viewer gets no Vigie link. */
  vigieHref: string | null;
  vigieLabel: string;
}

export interface FleetRowView {
  number: string;
  name: string;
  /** "EMP · Port authority · Gen 2". */
  sub: string;
  status: string;
  statusClass: string;
  project: string;
  site: string;
  delivered: string;
  warrantyEnd: string;
  warrantyEndColor: string;
  /** "ends in 31 d" or ''. */
  warrantyEndSub: string;
  openText: string;
  openColor: string;
  config: ConfigView | null;
  /** "20 k€" (the prototype's literal suffix, 07 OQ20). */
  cost: string;
}

export interface FleetView {
  kpis: KpiView[];
  zoneEmpty: string | null;
  rows: FleetRowView[];
}

export function fleetView(data: FleetScreenData, zone: ZoneCode | null, t: T, lang: Lang, viewer: AftersalesViewer = STAFF): FleetView {
  const rows = data.machines.map((m): FleetRowView => {
    const items = configItems(m.configuration);
    const first = m.configuration.firstEco;
    return {
      number: m.number,
      name: dataText(m.name, lang),
      sub: [m.machineTypeLabel, dataText(m.client, lang), m.generation ? t(m.generation) : ''].filter(Boolean).join(' · '),
      status: t(m.warrantyText),
      statusClass: tag(WARRANTY_TONE[m.warrantyStatus]),
      project: m.projectCode ?? '—',
      site: dataText(m.site, lang),
      delivered: dateText(m.deliveredOn, t),
      warrantyEnd: dateText(m.warrantyEndOn, t),
      warrantyEndColor: m.warrantyEndingSoon ? LO : OK,
      warrantyEndSub: m.warrantyEndingSoon ? t(`ends in ${m.warrantyEndsInDays} d`) : '',
      openText: m.openClaims ? countText('open', m.openClaims, lang) : '—',
      openColor: m.openClaims ? LO : MUTED,
      config:
        items.length && first
          ? {
              items: items.map((c) => ({ text: t(c.text), cls: tag(c.tone) })),
              href: ecoHref(first),
              title: m.configuration.ecos.join(' · '),
              vigieHref: viewer.vigie ? vigieEcoUrl(first) : null,
              vigieLabel: `${t('Open in Vigie')} · ${first}`,
            }
          : null,
      cost: `${lang === 'fr' ? String(m.warrantyCostKeur).replace('.', ',') : m.warrantyCostKeur} k€`,
    };
  });
  return {
    kpis: kpiViews(fleetKpis(data.machines), t, lang),
    zoneEmpty: fleetZoneEmpty(zone, rows.length) ? t(NO_MACHINE) : null,
    rows,
  };
}

// ── Warranty claims & interventions ─────────────────────────────────────────────────────────────────────

export interface ClaimEcoView {
  text: string;
  /** null: a plain tag (an ECO Vigie does not report, for a viewer without Vigie links). */
  href: string | null;
  /** Opens Vigie (the ECO is not in Keystone's mirror). */
  external: boolean;
  label: string;
}

export interface ClaimRowView {
  number: string;
  /** Row click: opens the claim's drawer (`?claim=WC-014`), or closes it when open (R-143). */
  href: string;
  selected: boolean;
  machineName: string;
  /** "MCH-041 · Port authority". */
  machineSub: string;
  /** Closed claims are greyed (neutral-500). */
  color: string;
  issue: string;
  eco: ClaimEcoView | null;
  severity: string;
  severityClass: string;
  date: string;
  status: string;
  statusClass: string;
  coverage: string;
  coverageClass: string;
  cost: string;
  owner: string;
  next: string;
}

export interface InterventionRowView {
  number: string;
  machineName: string;
  /** "MCH-041 · Le Havre · quay 2". */
  machineSub: string;
  date: string;
  technicians: string;
  /** "Corrective · WC-015" — under the "Type" header (the prototype's "Project" header, 07 OQ7). */
  type: string;
  duration: string;
  status: string;
  statusClass: string;
  /** R-143: "Mark done" (planned interventions, editors): the translated form; null otherwise. */
  done: { label: string; ariaLabel: string; form: FormDef } | null;
  /** R-143 / R-144: "Done 8 Oct · Replaced brake disc · HST-BRK-DSC → rev B" (typed text as typed); null when none. */
  doneLine: string | null;
}

export interface CostRowView {
  number: string;
  name: string;
  /** "Port authority · In warranty". */
  sub: string;
  claims: number;
  warrantyCost: string;
  chargeable: string;
  barPct: number;
}

export interface SavSegView {
  value: SavView;
  label: string;
  href: string;
}

export interface SavScreenView {
  view: SavView;
  seg: SavSegView[];
  kpis: KpiView[];
  zoneEmpty: string | null;
  claims: ClaimRowView[] | null;
  interventions: InterventionRowView[] | null;
  costs: CostRowView[] | null;
}

function claimEco(number: string | null, ecos: Record<string, MirrorEcoRef>, t: T, viewer: AftersalesViewer): ClaimEcoView | null {
  if (!number) return null;
  const known = ecos[number];
  if (known) return { text: number, href: ecoHref(number), external: false, label: `${number} · ${known.title}` };
  return viewer.vigie
    ? { text: number, href: vigieEcoUrl(number), external: true, label: `${t('Open in Vigie')} · ${number}` }
    : { text: number, href: null, external: false, label: number };
}

export function savView(data: SavScreenData, view: SavView, zone: ZoneCode | null, t: T, lang: Lang, viewer: AftersalesViewer = STAFF): SavScreenView {
  const costs = claimCostRows(data.machines, data.claims);
  const listShown = view === 'claims' ? data.claims.length : view === 'interventions' ? data.interventions.length : costs.length;
  return {
    view,
    seg: SAV_VIEWS.map((v) => ({ value: v, label: t(SAV_VIEW_LABEL[v]), href: savHref(v) })),
    kpis: kpiViews(savKpis(data.claims, data.interventions, lang), t, lang),
    zoneEmpty: savZoneEmpty(zone, listShown) ? t(data.machines.length ? SAV_ZONE_EMPTY[view] : NO_MACHINE) : null,
    claims:
      view === 'claims'
        ? data.claims.map((c) => ({
            number: c.number,
            href: claimHref(viewer.selectedClaim === c.number ? null : c.number),
            selected: viewer.selectedClaim === c.number,
            machineName: dataText(c.machineName, lang),
            machineSub: `${c.machineNumber} · ${dataText(c.client, lang)}`,
            color: c.open ? OK : MUTED,
            issue: dataText(c.issue, lang),
            eco: claimEco(c.ecoNumber, data.ecos, t, viewer),
            severity: t(c.severityLabel),
            severityClass: tag(SEVERITY_TONE[c.severity]),
            date: dateText(c.reportedOn, t),
            status: t(c.statusLabel),
            statusClass: tag(claimStatusTone(c.status)),
            coverage: t(c.coverageLabel),
            coverageClass: tag(coverageTone(c.coverage)),
            cost: c.costKeur ? money(c.costKeur, lang) : '—',
            owner: dataText(c.owner, lang),
            // Seeded next steps are the prototype's sentences; a claim opened in Keystone shows its description as typed.
            next: c.description != null ? dataText(c.nextStep, lang) : t(c.nextStep),
          }))
        : null,
    interventions:
      view === 'interventions'
        ? data.interventions.map((i) => ({
            number: i.number,
            machineName: dataText(i.machineName, lang),
            machineSub: `${i.machineNumber} · ${dataText(i.site, lang)}`,
            date: dateText(i.scheduledOn, t),
            technicians: dataText(i.technicians, lang),
            type: t(i.typeText),
            duration: t(i.durationText),
            status: interventionStatusText(i.status, t, lang),
            statusClass: tag(interventionTone(i.status)),
            done:
              viewer.canEdit && i.status === 'planned' && viewer.doneForms?.[i.number]
                ? { label: t('Mark done'), ariaLabel: `${t('Mark done')} · ${i.number}`, form: viewer.doneForms[i.number] }
                : null,
            doneLine: doneLineText(i, t),
          }))
        : null,
    costs:
      view === 'costs'
        ? costs.map((r) => ({
            number: r.machine.number,
            name: dataText(r.machine.name, lang),
            sub: `${dataText(r.machine.client, lang)} · ${t(r.machine.warrantyText)}`,
            claims: r.claims,
            warrantyCost: money(r.warrantyKeur, lang),
            chargeable: money(r.chargeableKeur, lang),
            barPct: r.barPct,
          }))
        : null,
  };
}

/** "Done 8 Oct · Replaced brake disc · HST-BRK-DSC → rev B" of a done intervention recorded in Keystone; null otherwise. */
export function doneLineText(i: { doneOn: string | null; report: string | null; partRef: string | null; partRevision: string | null }, t: T): string | null {
  if (!i.doneOn) return null;
  return [`${t('Done')} ${dateText(i.doneOn, t)}`, i.report ?? '', i.partRef ? `${i.partRef} → ${t('rev')} ${i.partRevision ?? '—'}` : ''].filter(Boolean).join(' · ');
}
