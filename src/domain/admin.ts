// Administration rules (pure): Settings — personalisable lists (docs/spec/10 §1, logic 4437–4445), Standard machine
// types (09 §9, logic 5083–5099) and Activity, integrations & audit (10 §2, logic 4692–4718). Texts are the prototype's
// English source strings; screens translate them with t(). Golden-tested against the prototype's own render values
// (src/domain/admin.test.ts, src/features/admin/admin.golden.json from scripts/proto-golden-admin.ts).
//
// Settled differently from the prototype (asserted in the tests):
// - singular forms in counts ("1 ITP system", the prototype wrote "1 ITP systems");
// - thresholds are validated (numbers in ]0, 2], "Off track below" strictly under "At risk below", 10 OQ2) instead of
//   keeping any parsed number;
// - the machine-type calendar select offers the stored calendar ("Site 6d · 10h" is the site calendar, so SPUR's
//   "Chantier 6d · 10h" shows selected — E-9);
// - connectors in error count with the warnings (needs attention);
// - R-021 (A-15): the Connectors and Channels tiles count what is really connected (src/domain/connectors.ts);
// - the audit trail exports to CSV (ISO 9001), RFC 4180 quoting, ISO-8601 timestamps.
import { LO, OK } from '@/components/app/tones';
import type { ActivityKind, CalendarCode, ConnectorStatus, CostType } from '@/server/db/codes';
import { connectorsSummary, type ConnectorLink, type ConnectorState } from './connectors';

/** KPI tile in English (label, value, sub) with its value colour. */
export interface AdminKpi {
  label: string;
  value: string;
  sub: string;
  color: string;
}

/** "1 project" / "2 projects" (English source; FR through the dictionary rules). */
export const countText = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// ── Settings ───────────────────────────────────────────────────────────────────────────────────────────

export type SettingsCardKey = 'locations' | 'skills' | 'costCats' | 'statuses' | 'riskCats' | 'delivTypes' | 'holidays';
export type SettingsIcon = 'warehouse' | 'certificate' | 'coins' | 'flag' | 'warning' | 'files' | 'calendar-x';

/** The seven list cards (`settingsCards`, 4441), in order. */
export const SETTINGS_CARDS: readonly { key: SettingsCardKey; title: string; sub: string; icon: SettingsIcon }[] = [
  { key: 'locations', title: 'Stock locations & workshops', sub: 'Create the places your sites need — receipts, transfers and reservations use them', icon: 'warehouse' },
  { key: 'skills', title: 'Skills & levels', sub: 'Skill families rated 1–5 in the matrix', icon: 'certificate' },
  { key: 'costCats', title: 'Cost categories', sub: 'Default categories offered when a project budget is set up', icon: 'coins' },
  { key: 'statuses', title: 'Project statuses', sub: 'Lifecycle stages available on the Projects page', icon: 'flag' },
  { key: 'riskCats', title: 'Risk categories', sub: 'Used by the risk register (5×5 + EMV)', icon: 'warning' },
  { key: 'delivTypes', title: 'Deliverable types', sub: 'Register with RACI-B (B = backup)', icon: 'files' },
  { key: 'holidays', title: 'Public holidays 2026 — France', sub: 'Removed from capacity · Lucca stays the source for leave', icon: 'calendar-x' },
];

export const isSettingsCardKey = (v: unknown): v is SettingsCardKey => typeof v === 'string' && SETTINGS_CARDS.some((c) => c.key === v);

/** Threshold as the prototype prints it (raw JS number: 0.90 → "0.9"). */
export const thresholdText = (n: number) => String(n);

export interface HealthThresholdValues {
  risk: number;
  off: number;
}

/** Subtitle of the "Project health rules" card (`health.text`). */
export const healthRuleText = (h: HealthThresholdValues) =>
  `On track when CPI and SPI ≥ ${thresholdText(h.risk)} · At risk below ${thresholdText(h.risk)} · Off track below ${thresholdText(h.off)}`;

/** KPI tiles (`settingsKpis`, 4445) — all coloured OK. */
export function settingsKpis(i: { locationTypes: readonly string[]; skills: number; costCats: number; holidays: number; health: HealthThresholdValues }): AdminKpi[] {
  return [
    { label: 'Stock locations', value: String(i.locationTypes.length), sub: `${new Set(i.locationTypes).size} types in use`, color: OK },
    { label: 'Skill families', value: String(i.skills), sub: 'Rated 1–5', color: OK },
    { label: 'Cost categories', value: String(i.costCats), sub: 'Per-project overrides allowed', color: OK },
    { label: 'Health rules', value: `${thresholdText(i.health.risk)} / ${thresholdText(i.health.off)}`, sub: 'At-risk / off-track thresholds', color: OK },
    { label: 'Public holidays', value: String(i.holidays), sub: '2026 · France', color: OK },
  ];
}

/** Location type option of the Locations card (`locTypeSeg`): " (QC hold)" and " at supplier" dropped. */
export const locationTypeShortLabel = (label: string) => label.replace(' (QC hold)', '').replace(' at supplier', '');

/** Threshold input (`setHealth`: parseFloat); null when not a number (the prototype then keeps the previous value). */
export function parseThresholdInput(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== 'string') return null;
  const v = parseFloat(raw.trim().replace(',', '.'));
  return Number.isFinite(v) ? v : null;
}

/** Thresholds the rebuild accepts (11 §3.1 AppSetting); null when valid, else the English message. */
export function thresholdsError(h: HealthThresholdValues): string | null {
  for (const v of [h.risk, h.off]) if (!Number.isFinite(v) || v <= 0 || v > 2) return 'Enter a threshold between 0 and 2';
  if (h.off >= h.risk) return '"Off track below" must be lower than "At risk below"';
  return null;
}

/** Draft of the "Add an entry" field: trimmed; '' adds nothing (`add`, 4440). */
export const settingsEntry = (raw: unknown) => (typeof raw === 'string' ? raw.trim() : '');

const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_FR = ['janv', 'févr', 'mars', 'avr', 'mai', 'juin', 'juil', 'août', 'sept', 'oct', 'nov', 'déc'];
const MONTHS_FR_LONG = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

/**
 * A public holiday as stored ("14 Jul · Fête nationale", the date in English as SETTINGS0): a French date typed in the
 * French UI ("14 juil. · Fête nationale", "14 juillet · …") is converted; anything else is returned trimmed.
 */
export function holidayEntry(raw: unknown): string {
  const text = settingsEntry(raw);
  const m = /^(\d{1,2})\s+([^\s·]+)\s*·\s*(.+)$/u.exec(text);
  if (!m) return text;
  const mon = m[2].replace(/\.$/, '').toLowerCase();
  const i = [MONTHS_EN.map((x) => x.toLowerCase()), MONTHS_FR, MONTHS_FR_LONG].map((list) => list.indexOf(mon)).find((x) => x >= 0) ?? -1;
  return i >= 0 ? `${Number(m[1])} ${MONTHS_EN[i]} · ${m[3].trim()}` : text;
}

// ── Machine types ──────────────────────────────────────────────────────────────────────────────────────

/** Identity card "Default calendar" options (`calOpts`, 5097). "Site 6d · 10h" is the site calendar (FR "Chantier 6j · 10h"). */
export const MT_CALENDAR_OPTIONS: readonly { value: CalendarCode; label: string }[] = [
  { value: 'standard_5x8', label: 'Standard 5d · 8h' },
  { value: 'standard_5x8_workshop', label: 'Standard 5d · 8h + Atelier' },
  { value: 'site_6x10', label: 'Site 6d · 10h' },
];

/** "New machine type" form calendars (`AF.mtype.cal`, the template data's labels). */
export const MT_FORM_CALENDARS: readonly { value: CalendarCode; label: string }[] = [
  { value: 'standard_5x8', label: 'Standard 5d · 8h' },
  { value: 'standard_5x8_workshop', label: 'Standard 5d · 8h + Atelier' },
  { value: 'site_6x10', label: 'Chantier 6d · 10h' },
];

/** "Copy template from" options (`AF.mtype.base`): value = stored machine-type code, 'blank' = Blank. */
export const MT_FORM_BASES: readonly { value: string; label: string }[] = [
  { value: 'EMP', label: 'EMP' }, { value: 'MEMU', label: 'MEMU' }, { value: 'SPUR', label: 'SPUR' }, { value: 'AUTRE', label: 'AUTRE' },
  { value: 'rnd', label: 'R&D' }, { value: 'blank', label: 'Blank' },
];

/** Cost category types (`typeOpts`, 5097): Labor, Material, Equipment, Subcontract, Fees. */
export const MT_COST_TYPES: readonly CostType[] = ['labor', 'material', 'equipment', 'subcontract', 'fees'];

/** List-item sub-line: "6 phases · 7 cost categories · 6 ITP systems" (singular when 1). */
export const machineTypeListSub = (phases: number, costCategories: number, itpSystems: number) =>
  `${countText(phases, 'phase', 'phases')} · ${countText(costCategories, 'cost category', 'cost categories')} · ${countText(itpSystems, 'ITP system', 'ITP systems')}`;

/** List-item use line (`use`): "no project" / "1 project" / "2 projects". */
export const machineTypeUseText = (projects: number) => (projects ? countText(projects, 'project', 'projects') : 'no project');

export interface MachineTypeFacts {
  active: boolean;
  isStandard: boolean;
  phases: number;
  itpSystems: number;
  rexReferences: number;
}

/** KPI tiles (`mtKpis`, 5089). `projectsTyped` / `projectsTotal` = projects with a machine type / all projects. */
export function machineTypeKpis(types: readonly MachineTypeFacts[], projectsTyped: number, projectsTotal: number): AdminKpi[] {
  const withPhases = types.filter((t) => t.phases > 0).length;
  return [
    { label: 'Machine types', value: String(types.filter((t) => t.active).length), sub: `${types.filter((t) => !t.active).length} inactive · ${types.filter((t) => !t.isStandard).length} custom`, color: OK },
    { label: 'Projects covered', value: `${projectsTyped} / ${projectsTotal}`, sub: 'typed projects inherit the template at creation', color: OK },
    { label: 'Planning templates', value: `${withPhases} / ${types.length}`, sub: 'phases, cost categories, calendar', color: withPhases === types.length ? OK : LO },
    { label: 'ITP systems', value: String(types.reduce((s, t) => s + t.itpSystems, 0)), sub: 'inspection systems across types', color: OK },
    { label: 'REX patterns', value: String(types.filter((t) => t.rexReferences > 0).length), sub: 'deposit / delivery / acceptance', color: OK },
  ];
}

/** Payment pattern total ("Total 100 %"); `ok` shows the check, otherwise "Shares must total 100 %" (a warning). */
export function paymentTerms(deposit: number, delivery: number, acceptance: number): { sum: number; ok: boolean; text: string } {
  const sum = deposit + delivery + (acceptance || 0);
  return { sum, ok: sum === 100, text: `${sum} %` };
}

/** Percentage input of the payment pattern (`setDep`…: parseInt || 0). */
export function parsePercentInput(raw: unknown): number {
  const n = typeof raw === 'number' ? Math.trunc(raw) : parseInt(String(raw ?? ''), 10);
  return Number.isFinite(n) ? n || 0 : 0;
}

/** Budget input of a cost category, k€ (`parseFloat`); null when not a number. */
export function parseBudgetInput(raw: unknown): number | null {
  const n = typeof raw === 'number' ? raw : parseFloat(String(raw ?? '').trim().replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

/** Reference budget total of the cost categories, k€ (`catTotal`). */
export const costCategoriesTotal = (cats: readonly { budgetKeur: number }[]) => cats.reduce((s, c) => s + (Number.isFinite(c.budgetKeur) ? c.budgetKeur : 0), 0);

/** Code of a new machine type (AF.mtype): trimmed, upper-cased, spaces → "-". */
export const normaliseMachineTypeCode = (code: string) => code.trim().toUpperCase().replace(/\s+/g, '-');

/** Template of "Copy template from: Blank": no phases, no categories, ITP "General", 30 / 60 / 10. */
export const BLANK_MACHINE_TYPE = { phases: [] as string[], costCategories: [] as { name: string; type: CostType; budgetKeur: number }[], itpSystems: ['General'], depositPct: 30, deliveryPct: 60, acceptancePct: 10 };

/** Defaults appended by "Add phase", "Add system" and "Add category". */
export const NEW_PHASE = 'New phase';
export const NEW_ITP_SYSTEM = 'New system';
export const NEW_COST_CATEGORY = { name: 'New category', type: 'labor' as CostType, budgetKeur: 0 };

// ── Activity, integrations & audit ─────────────────────────────────────────────────────────────────────

export type PlumbView = 'activity' | 'connectors' | 'imports' | 'audit';

/** "Display" segmented control (`plumbSeg`). */
export const PLUMB_VIEWS: readonly { value: PlumbView; label: string }[] = [
  { value: 'activity', label: 'Activity feed' },
  { value: 'connectors', label: 'Connectors' },
  { value: 'imports', label: 'Import / export' },
  { value: 'audit', label: 'Audit trail' },
];

/** `?view=` → display (default: the activity feed). */
export const parsePlumbView = (raw: unknown): PlumbView => (PLUMB_VIEWS.some((v) => v.value === raw) ? (raw as PlumbView) : 'activity');

export type ActivityIcon =
  | 'arrows-clockwise' | 'warehouse' | 'chat-circle' | 'git-pull-request' | 'camera' | 'shield-warning' | 'paper-plane-tilt' | 'truck' | 'receipt'
  | 'git-branch' | 'buildings';

/** Icon of an activity row (`ACT_ICON`, 4710). */
export const ACTIVITY_ICON: Record<ActivityKind, ActivityIcon> = {
  sync: 'arrows-clockwise', stock: 'warehouse', comment: 'chat-circle', change: 'git-pull-request', snapshot: 'camera', quality: 'shield-warning',
  request: 'paper-plane-tilt', delivery: 'truck', invoice: 'receipt', eco: 'git-branch', client: 'buildings',
};

/** Chip label of an activity kind (`k[0].toUpperCase()+k.slice(1)`). */
export const activityKindLabel = (kind: string) => kind.charAt(0).toUpperCase() + kind.slice(1);

/** "Source" chips (`actChips`): All, then one chip per kind in order of first appearance (newest first), with counts. */
export function activityChips(kinds: readonly ActivityKind[]): { value: ActivityKind | null; label: string; count: number }[] {
  const order: ActivityKind[] = [];
  const counts = new Map<ActivityKind, number>();
  for (const k of kinds) {
    if (!counts.has(k)) order.push(k);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return [{ value: null, label: 'All', count: kinds.length }, ...order.map((k) => ({ value: k, label: activityKindLabel(k), count: counts.get(k)! }))];
}

/** `?source=` → an activity kind present in the feed, else null (All). */
export const parseActivitySource = (raw: unknown, kinds: readonly ActivityKind[]): ActivityKind | null =>
  typeof raw === 'string' && (kinds as readonly string[]).includes(raw) ? (raw as ActivityKind) : null;

/** Connector status tag (`tagClass`): OK neutral, Warning (and Error) accent, anything else (Ready) outline. */
export const connectorTone = (status: ConnectorStatus): 'neutral' | 'accent' | 'outline' =>
  status === 'ok' ? 'neutral' : status === 'warning' || status === 'error' ? 'accent' : 'outline';

/** A connector needs attention (nav badge "!", KPI colour). */
export const connectorNeedsAttention = (status: ConnectorStatus) => status === 'warning' || status === 'error';

/** KPI tiles (`plumbKpis`, 4718). */
export function plumbingKpis(i: {
  eventsToday: number;
  /** The listed connectors with their real link and state (src/domain/connectors.ts). */
  connectors: readonly { name: string; link: ConnectorLink; state: ConnectorState }[];
  unread: number;
  personaTitle: string;
  auditEntries: number;
}): AdminKpi[] {
  // R-021 (A-15): the prototype counted the seeded statuses ("7 healthy · 1 warning", "3 channels"); the tiles now say what is
  // really connected — mock and missing connectors are neither healthy nor failing, and e-mail / Teams are channels only
  // once their connector is live.
  const c = connectorsSummary(i.connectors);
  const channels = notificationChannels(i.connectors);
  return [
    { label: 'Events today', value: String(i.eventsToday), sub: 'Across all projects', color: OK },
    {
      label: 'Connectors', value: String(i.connectors.length),
      sub: `${c.connected} connected · ${c.mock} mock · ${c.notConnected} not connected${c.warning ? ` · ${c.warning} warning` : ''}`, color: c.warning ? LO : OK,
    },
    { label: 'Unread notifications', value: String(i.unread), sub: i.personaTitle, color: i.unread ? LO : OK },
    { label: 'Audit entries · 7 days', value: String(i.auditEntries), sub: 'Every status, approval and value change', color: OK },
    { label: 'Channels', value: String(channels.count), sub: channels.sub, color: OK },
  ];
}

/** Connector rows of the e-mail and Teams notification channels (CONNECTORS). */
export const EMAIL_CONNECTOR = 'E-mail (SMTP)';
export const TEAMS_CONNECTOR = 'Microsoft Teams';

/**
 * Notification channels really available: in-app always, e-mail and Teams when their connector is live (X-6: no mail is sent
 * today). Sub-line "In-app · e-mail · Teams", or "In-app · e-mail and Teams not connected".
 */
export function notificationChannels(rows: readonly { name: string; link: ConnectorLink; state: ConnectorState }[]): { count: number; sub: string } {
  const live = (name: string) => rows.some((r) => r.name === name && r.link === 'live' && r.state !== 'disabled');
  const email = live(EMAIL_CONNECTOR);
  const teams = live(TEAMS_CONNECTOR);
  const missing = [email ? null : 'e-mail', teams ? null : 'Teams'].filter((x): x is string => !!x);
  const on = ['In-app', email ? 'e-mail' : null, teams ? 'Teams' : null].filter((x): x is string => !!x);
  return { count: on.length, sub: missing.length ? `${on.join(' · ')} · ${missing.join(' and ')} not connected` : on.join(' · ') };
}

export interface AuditCsvRow {
  /** ISO instant. */
  occurredAt: string;
  who: string;
  object: string;
  change: string;
  area: string;
  projectCode: string | null;
}

/** RFC 4180 cell; a cell starting with = + - @ (or a tab / CR) is prefixed with ' so a spreadsheet never runs it as a formula. */
const csvCell = (raw: string) => {
  const v = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return /[",\r\n;]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
};

/**
 * ISO 9001 export of the audit trail: one row per entry, newest first, RFC 4180 (comma separator, CRLF, quoted cells
 * when needed), timestamps in ISO 8601 UTC. `headers` = the column titles in the viewer's language.
 */
export function auditCsv(rows: readonly AuditCsvRow[], headers: readonly [string, string, string, string, string, string] = ['When (UTC)', 'Who', 'Object', 'Change', 'Area', 'Project']): string {
  const lines = [headers.map(csvCell).join(',')];
  for (const r of rows) lines.push([r.occurredAt, r.who, r.object, r.change, r.area, r.projectCode ?? ''].map(csvCell).join(','));
  return lines.join('\r\n') + '\r\n';
}

/** File name of the export: keystone-audit-trail-2026-09-25.csv. */
export const auditCsvFileName = (isoDay: string) => `keystone-audit-trail-${isoDay}.csv`;
