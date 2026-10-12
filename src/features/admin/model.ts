// View models of the administration screens, translated: Settings — personalisable lists (docs/spec/10 §1, template
// 1573–1597), Standard machine types (09 §9, template 1529–1572) and Activity, integrations & audit (10 §2, template
// 2237–2267). Built from the DAL rows with the pure rules of src/domain/admin.ts; English is the prototype's source text,
// French goes through t() as the prototype's `deepTr` did (data texts included), with the fixes of ./i18n.ts.
import { screenHref } from '@/config/screens';
import {
  ACTIVITY_ICON, MT_CALENDAR_OPTIONS, MT_COST_TYPES, PLUMB_VIEWS, SETTINGS_CARDS, activityChips, costCategoriesTotal, healthRuleText,
  locationTypeShortLabel, machineTypeKpis, machineTypeUseText, paymentTerms, plumbingKpis, settingsKpis, thresholdText,
  type ActivityIcon, type PlumbView, type SettingsCardKey, type SettingsIcon,
} from '@/domain/admin';
import { IMPORTS_ENABLED } from '@/domain/ch4-defaults';
import { HOURS_VARIANCE_RULE } from '@/domain/hr';
import { connectorStateTone } from '@/domain/connectors';
import type { Lang, T } from '@/i18n/translate';
import { money } from '@/lib/format';
import { calendar, costType, locationType, stampText, type ActivityKind, type CalendarCode, type CostType, type LocationType } from '@/server/db/codes';
import type { ConnectorRow } from '@/server/dal/integrations';
import type { MachineTypeRow } from '@/server/dal/mtypes';
import type { ActivityRow, AuditRow } from '@/server/dal/notifications';
import type { ProjectRow } from '@/server/dal/projects';
import type { SettingsData } from '@/server/dal/settings';
import { activityChipT, addedConnectorDataT, auditAreaT, connectorLinkT, connectorsSubT, mtListSubT, outboxT, volumeT } from './i18n';
import { integrationsHref, machineTypesHref } from './links';
import { dataText, fieldsText } from '@/i18n/data-text';

export interface KpiView {
  label: string;
  value: string;
  sub: string;
  color: string;
}

const kpiT = (k: { label: string; value: string; sub: string; color: string }, t: T): KpiView => ({ label: t(k.label), value: k.value, sub: t(k.sub), color: k.color });

// ── Settings ───────────────────────────────────────────────────────────────────────────────────────────

export interface SettingsItemView {
  /** Stable key of the entry: the location name, or the reference value code. */
  id: string;
  label: string;
  /** Location type (Locations card only). */
  sub: string | null;
}

export interface SettingsCardView {
  key: SettingsCardKey;
  title: string;
  sub: string;
  icon: SettingsIcon;
  count: string;
  isLoc: boolean;
  items: SettingsItemView[];
}

export interface SettingsView {
  kpis: KpiView[];
  health: { risk: number; off: number; riskText: string; offText: string; text: string };
  /** R-088 (R-6b): the hours-variance threshold (% of planned) and its rule, translated. */
  hoursVariance: { pct: number; text: string };
  cards: SettingsCardView[];
  /** Location type options of the Locations card (shortened labels). */
  locTypes: { value: LocationType; label: string }[];
}

export function settingsView(data: SettingsData, t: T, lang: Lang): SettingsView {
  const items: Record<SettingsCardKey, SettingsItemView[]> = {
    locations: data.locations.map((l) => ({ id: l.name, label: dataText(l.name, lang), sub: t(l.typeLabel) })),
    skills: [], costCats: [], statuses: [], riskCats: [], delivTypes: [], holidays: [],
  };
  for (const key of ['skills', 'costCats', 'statuses', 'riskCats', 'delivTypes', 'holidays'] as const) {
    // R-148: entries typed by the director are shown as typed (a holiday's date part is Keystone's format, translated).
    items[key] = data.lists[key].map((v) => ({ id: v.code, label: fieldsText(v.label, t, lang), sub: null }));
  }
  const locTypeCodes = data.lists.locTypes.length ? data.lists.locTypes.map((v) => v.code as LocationType).filter((c) => locationType.isCode(c)) : locationType.codes;
  return {
    kpis: settingsKpis({
      locationTypes: data.locations.map((l) => l.type), skills: data.lists.skills.length, costCats: data.lists.costCats.length, holidays: data.lists.holidays.length,
      health: data.health,
    }).map((k) => kpiT(k, t)),
    health: { risk: data.health.risk, off: data.health.off, riskText: thresholdText(data.health.risk), offText: thresholdText(data.health.off), text: t(healthRuleText(data.health)) },
    hoursVariance: { pct: data.hoursVariance, text: t(HOURS_VARIANCE_RULE) },
    cards: SETTINGS_CARDS.map((c) => ({ key: c.key, title: t(c.title), sub: t(c.sub), icon: c.icon, count: String(items[c.key].length), isLoc: c.key === 'locations', items: items[c.key] })),
    locTypes: locTypeCodes.map((code) => ({ value: code, label: t(locationTypeShortLabel(locationType.label(code))) })),
  };
}

// ── Machine types ──────────────────────────────────────────────────────────────────────────────────────

export interface MtListItemView {
  /** Stored code (URL `?type=`). */
  code: string;
  displayCode: string;
  sub: string;
  use: string;
  active: boolean;
  stateText: string;
  custom: boolean;
  selected: boolean;
  href: string;
}

/** An editable text: the stored value (written back) and what the input shows (translated, as the prototype). */
export interface EditableText {
  value: string;
  display: string;
}

export interface MtDetailView {
  code: string;
  displayCode: string;
  label: string;
  description: string;
  calendar: CalendarCode;
  calendarOptions: { value: CalendarCode; label: string }[];
  active: boolean;
  stateText: string;
  toggleLabel: string;
  deposit: number;
  delivery: number;
  acceptance: number;
  termsText: string;
  termsOk: boolean;
  phases: EditableText[];
  itpSystems: EditableText[];
  costCategories: { name: EditableText; type: CostType; budget: string; budgetKeur: number }[];
  costTypeOptions: { value: CostType; label: string }[];
  costTotal: string;
  refs: { analyticCode: string; name: string }[];
  projects: { code: string; name: string; sub: string; openHref: string | null }[];
}

export interface MachineTypesView {
  kpis: KpiView[];
  list: MtListItemView[];
  mt: MtDetailView | null;
}

const editable = (v: string, t: T): EditableText => ({ value: v, display: t(v) });

/** `selected` = the `?type=` code (stored or display code, any case); unknown → the first type. */
export function machineTypesView(input: { types: MachineTypeRow[]; projects: ProjectRow[]; selected: string | null }, t: T, lang: Lang): MachineTypesView {
  const { types, projects } = input;
  const want = (input.selected ?? '').trim().toLowerCase();
  const sel = types.find((m) => m.code.toLowerCase() === want || m.displayCode.toLowerCase() === want) ?? types[0] ?? null;
  const typed = projects.filter((p) => !!p.machineType).length;
  const kpis = machineTypeKpis(
    types.map((m) => ({ active: m.active, isStandard: m.isStandard, phases: m.phases.length, itpSystems: m.itpSystems.length, rexReferences: m.rexReferences.length })),
    typed, projects.length,
  ).map((k) => kpiT(k, t));
  const list = types.map((m) => ({
    code: m.code, displayCode: m.displayCode, sub: mtListSubT(m.phases.length, m.costCategories.length, m.itpSystems.length, lang), use: t(machineTypeUseText(m.projects.length)),
    active: m.active, stateText: t(m.active ? 'Active' : 'Inactive'), custom: !m.isStandard, selected: m === sel, href: machineTypesHref(m.code),
  }));
  if (!sel) return { kpis, list, mt: null };
  const terms = paymentTerms(sel.depositPct, sel.deliveryPct, sel.acceptancePct);
  const byCode = new Map(projects.map((p) => [p.code, p]));
  const calendarOptions = MT_CALENDAR_OPTIONS.map((o) => ({ value: o.value, label: t(o.label) }));
  if (!calendarOptions.some((o) => o.value === sel.calendar)) calendarOptions.push({ value: sel.calendar, label: t(calendar.label(sel.calendar)) });
  return {
    kpis,
    list,
    mt: {
      code: sel.code, displayCode: sel.displayCode, label: sel.label, description: sel.description, calendar: sel.calendar, calendarOptions, active: sel.active,
      stateText: t(sel.active ? 'Active' : 'Inactive'), toggleLabel: t(sel.active ? 'Deactivate' : 'Activate'),
      deposit: sel.depositPct, delivery: sel.deliveryPct, acceptance: sel.acceptancePct, termsText: terms.text, termsOk: terms.ok,
      phases: sel.phases.map((p) => editable(p, t)),
      itpSystems: sel.itpSystems.map((s) => editable(s, t)),
      costCategories: sel.costCategories.map((c) => ({ name: editable(c.name, t), type: c.type, budget: String(c.budgetKeur), budgetKeur: c.budgetKeur })),
      costTypeOptions: MT_COST_TYPES.map((c) => ({ value: c, label: t(costType.label(c)) })),
      costTotal: money(costCategoriesTotal(sel.costCategories), lang),
      refs: sel.rexReferences.map((r) => ({ analyticCode: r.analyticCode, name: `${r.analyticCode} · ${dataText(r.projectName, lang)} · ${r.year}` })),
      projects: sel.projects.map((p) => {
        const row = byCode.get(p.code);
        return {
          code: p.code, name: `${row?.displayId ?? p.number ?? p.code} · ${dataText(p.name, lang)}`, sub: `${p.code} · ${t(row?.status ?? '—')}`,
          openHref: row?.hasData ? screenHref('plan', { code: p.code }) : null,
        };
      }),
    },
  };
}

// ── Activity, integrations & audit ─────────────────────────────────────────────────────────────────────

export interface ActivityRowView {
  key: string;
  icon: ActivityIcon;
  who: string;
  what: string;
  when: string;
}

export interface ConnectorRowView {
  /** Stored name (the key "Sync now" sends). */
  rawName: string;
  name: string;
  /** Line under the name: connector-layer mode (Codex, Vigie, Cursus), file exchange (MS Project); null otherwise (R-021). */
  mode: string | null;
  /** "Sync now" offered (live and mock connectors not disabled, R-021). */
  canSync: boolean;
  data: string;
  frequency: string;
  status: string;
  tone: 'neutral' | 'accent' | 'outline';
  last: string;
  volume: string;
}

export type ImportIcon = 'file-arrow-down' | 'file-xls' | 'file-arrow-up' | 'file-pdf';

export interface ImportCardView {
  name: string;
  description: string;
  icon: ImportIcon;
  direction: 'import' | 'export';
}

export interface AuditRowView {
  key: string;
  when: string;
  who: string;
  object: string;
  change: string;
  area: string;
}

export interface PlumbingView {
  kpis: KpiView[];
  view: PlumbView;
  seg: { value: PlumbView; label: string; href: string }[];
  /** Source chips ('' = All). */
  chips: { value: string; label: string; count: string; href: string }[];
  chipValue: string;
  activity: ActivityRowView[];
  connectors: ConnectorRowView[];
  imports: ImportCardView[];
  audit: AuditRowView[];
}

export interface PlumbingInput {
  view: PlumbView;
  source: ActivityKind | null;
  activity: ActivityRow[];
  connectors: ConnectorRow[];
  imports: { name: string; description: string; icon: string; direction: 'import' | 'export' }[];
  audit: AuditRow[];
  counts: { eventsToday: number; auditLast7Days: number };
  unread: number;
  /** Persona title of the viewer (EN source). */
  personaTitle: string;
}

/**
 * Import / export cards listed on the screen. D-7b ("Ne traite rien pour le moment concernant les imports"): the import cards
 * (MS Project XML, Excel / CSV, Primavera P6 XER) only while IMPORTS_ENABLED is on; the "Export — …" cards always.
 */
export function visibleImportFormats<F extends { direction: 'import' | 'export' }>(formats: readonly F[], importsEnabled: boolean = IMPORTS_ENABLED): F[] {
  return formats.filter((f) => importsEnabled || f.direction === 'export');
}

const IMPORT_ICONS: readonly ImportIcon[] = ['file-arrow-down', 'file-xls', 'file-arrow-up', 'file-pdf'];
const importIcon = (cls: string): ImportIcon => {
  const name = cls.replace(/^ph\s+ph-/, '') as ImportIcon;
  return IMPORT_ICONS.includes(name) ? name : 'file-arrow-down';
};

/** "26 Sep 07:00" in the viewer's language (`stampText` of the instant), "—" before the first sync. */
const stampOf = (iso: string | null, t: T) => (iso ? t(stampText(new Date(iso))) : '—');

export function plumbingView(i: PlumbingInput, t: T, lang: Lang): PlumbingView {
  const kinds = i.activity.map((a) => a.kind);
  const chips = activityChips(kinds);
  const rows = i.source ? i.activity.filter((a) => a.kind === i.source) : i.activity;
  return {
    kpis: plumbingKpis({
      eventsToday: i.counts.eventsToday, connectors: i.connectors, unread: i.unread, personaTitle: i.personaTitle, auditEntries: i.counts.auditLast7Days,
    }).map((k) => (k.label === 'Connectors' ? { ...kpiT(k, t), sub: connectorsSubT(k.sub, t, lang) } : kpiT(k, t))),
    view: i.view,
    seg: PLUMB_VIEWS.map((v) => ({ value: v.value, label: t(v.label), href: integrationsHref({ view: v.value }) })),
    chips: chips.map((c) => ({ value: c.value ?? '', label: activityChipT(c.label, t, lang), count: String(c.count), href: integrationsHref({ source: c.value }) })),
    chipValue: i.source ?? '',
    activity: rows.map((a, n) => ({ key: `${a.occurredAt}-${n}`, icon: ACTIVITY_ICON[a.kind] ?? 'arrows-clockwise', who: dataText(a.who, lang), what: t(a.what), when: t(a.when) })),
    connectors: i.connectors.map((c) => {
      const outbox = outboxT(c.pending, c.failed, lang);
      const volume = volumeT(c.lastVolume, t, lang);
      return {
        rawName: c.name,
        name: dataText(c.name, lang),
        mode: connectorLinkT(c.link, t),
        canSync: c.canSync,
        // R-148: the data scope and frequency are IT's typed settings (connectors file), shown as typed.
        data: c.dataScope ? dataText(c.dataScope, lang) : addedConnectorDataT(c.direction ? directionLabel(c.direction) : null, c.owner, t),
        frequency: dataText(c.frequency, lang),
        // R-021: the real state — the live status, Mock, Not connected, Ready (file exchange); D-7a: "Disabled" (calm tone)
        // for a connector disabled by IT.
        status: t(c.statusLabel),
        tone: connectorStateTone(c.state),
        last: stampOf(c.lastSyncAt, t),
        volume: [volume, outbox].filter(Boolean).join(' · ') || '—',
      };
    }),
    imports: i.imports.map((f) => ({ name: t(f.name), description: t(f.description), icon: importIcon(f.icon), direction: f.direction })),
    audit: i.audit.map((a, n) => ({ key: `${a.occurredAt}-${n}`, when: t(a.when), who: dataText(a.who, lang), object: t(a.object), change: t(a.change), area: auditAreaT(a.area, t, lang) })),
  };
}

const DIRECTION_LABEL: Record<string, string> = { import: 'Import', export: 'Export', both: 'Both' };
const directionLabel = (d: string) => DIRECTION_LABEL[d] ?? d;
