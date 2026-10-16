// Site (chantier) view model (docs/spec/10 §3; prototype logic 4739–4760, template 2268–2309): every text of the
// three tabs, translated, with the tags and colours the template binds. Built on the server from the DAL's
// `SiteData` (null = no site sheet → empty state); the rights (edit, remind) are applied by the view.
// The Cursus approvals and the HSE register are the connectors' records (Cursus / Vigie own them): the view model
// only adds the links to those applications and the last refresh. R-118 (D-3 'a'): for the project's leads, the forms of
// "Prepare the site", "Edit site sheet" and the lines, with each line's values and stamp (src/domain/site-sheet.ts).
import type { FormDef, FormValues } from '@/components/app/form-def';
import type { RoleKey } from '@/config/screens';
import {
  COLLISION_TARGET, DEFAULT_HEADCOUNT, SITE_TABS, SITE_TAB_LABEL, WEATHER_OPTIONS, canArbitrateConflict, collisionTagClass, equipmentSourceTagClass,
  execKpis, goLabel, isNcrLink, preparationNote, prerequisiteStep, readinessKpis, siteDateText, siteTagClass, teamKpis,
  type SiteFacts, type SiteKpi, type SiteTab,
} from '@/domain/site';
import { CONTRACTOR_CREW, SITE_CURRENCIES, siteLineEditable, siteLineRemovable, type SiteLineKind } from '@/domain/site-sheet';
import type { Lang, T } from '@/i18n/translate';
import { money } from '@/lib/format';
import {
  cursusClearance, cursusSyncStatus, cursusVaccination, cursusVerdict, cursusVisa, equipmentSource, shortDateOfIso, stampText,
} from '@/server/db/codes';
import type { SiteData } from '@/server/dal/site';
import type { SiteSheetDefaults } from '@/server/dal/site-sheet';
import { cursusChantierUrl, cursusEmployeeUrl } from '@/server/integrations/cursus/links';
import { vigieHseListUrl, vigieReportIncidentUrl } from '@/server/integrations/vigie/links';
import { conflictText, dataText, incidentText, siteText, weatherText } from './i18n';
import { CURSUS_CARD_ID, qualityNcrHref, screenOf, siteHref, sitePunchHref } from './links';
import { fieldsText } from '@/i18n/data-text';

const LO = 'var(--color-accent-300)';
const OK = 'var(--color-text)';

export interface KpiView {
  label: string;
  value: string;
  sub: string;
  color: string;
}

/**
 * R-118: a line as its "Edit" form opens it (typed values as typed), the stamp the form saw, and whether it may be edited or
 * removed (prerequisites and equipment while Pending; a mission cost line without an actual). Present for the leads only.
 */
export interface LineEntry {
  values: FormValues;
  stamp: string;
  editable: boolean;
  removable: boolean;
  /**
   * The line's own "Edit" form when it differs from the kind's (`SheetEntry.edit`): a rotation whose person left the project
   * team offers the team and that person (the line keeps its person — the writer re-checks).
   */
  form?: FormDef;
}

export interface ReadyView {
  kpis: KpiView[];
  go: { tag: string; tagClass: string; items: { key: string; label: string; sub: string; ok: boolean; color: string }[] };
  meta: { k: string; v: string }[];
  prereqs: {
    position: number; title: string; act: string; due: string; dueColor: string; status: string; tagClass: string; note: string; late: boolean;
    /** Next step offered ("Client confirms" / "Signed on site"); null when signed. */
    step: { to: 'confirmed' | 'signed'; label: string } | null;
    /** R-118: the line as the page shows it — the step sends it back (a line replaced at the same position is refused). */
    stamp: string;
    entry: LineEntry | null;
  }[];
  equip: {
    position: number; name: string; src: string; srcClass: string; status: string; tagClass: string; note: string; canConfirm: boolean;
    /** R-118: the line as the page shows it — "Confirm" sends it back. */
    stamp: string;
    entry: LineEntry | null;
  }[];
  /** R-118: the message of an empty table. */
  noPrereq: string | null;
  noEquip: string | null;
  cursus: {
    rows: {
      /** Cursus's name of the person (the reminder's key; `who` is the displayed text). */
      person: string;
      who: string;
      /** R-032 (NEW-CURSUS-3 'a'): the person in Cursus (by matricule, a proposed parameter); null without a matricule. */
      personUrl: string | null;
      visa: string; visaClass: string; vacc: string; vaccClass: string; hab: string; habClass: string; habNote: string; habColor: string;
      status: string; tagClass: string; rec: string;
      /** Verdict not GO and no reminder sent yet (the prototype's `canReq`). */
      remindable: boolean;
      reminded: boolean;
      /** Delivery state of the reminder ("Pending sync with Cursus"). */
      reminderSync: string | null;
    }[];
    /** "Last sync 26 Sep 07:00" / "Never synced". */
    lastSync: string;
    openUrl: string;
    mode: 'mock' | 'http';
    /** R-118: no approval received yet (a new sheet). */
    empty: string | null;
  };
}

export interface TeamView {
  kpis: KpiView[];
  rotation: {
    position: number; who: string; role: string; from: string; to: string; rot: string; lodging: string; travel: string; collision: boolean; collisionLabel: string;
    entry: LineEntry | null;
  }[];
  noRotation: string | null;
  /**
   * R-119 (D-6b 'a'): the open conflicts computed from the rotation plan, with "Resolve" and — for whoever may arbitrate it —
   * "Arbitrate"; then the conflicts arbitrated while their cause is unchanged (who, when, why).
   */
  collisions: { key: string; who: string; kind: string; tagClass: string; what: string; fix: string; href: string; canArbitrate: boolean }[];
  arbitrated: { key: string; who: string; kind: string; what: string; by: string; at: string; comment: string }[];
  /** "No conflict" when there is none open. */
  noCollision: string | null;
  /** The arbitration form (comment required), translated. */
  arbitrationForm: FormDef;
  /** R-118: an actual not received yet shows "—" with "Waiting for Sage X3" (actuals are never typed — C-2a / A-12 'a'). */
  missionCosts: { position: number; name: string; budget: string; actual: string; actualTitle: string | null; pct: string; left: string; entry: LineEntry | null }[];
  noCost: string | null;
}

export interface ExecView {
  kpis: KpiView[];
  reports: { number: string; date: string; act: string; pct: string; txt: string; detail: string | null; link: string; href: string | null; by: string }[];
  /** R-118: no daily report yet (a new sheet). */
  noReport: string | null;
  note: string | null;
  /**
   * R-117 (A-6 'a'): the project's single punch list, the items raised on site by default ("Site" | "All", `?punch=all`);
   * `origin` (translated) is shown with "All". Read-only here, as in the prototype (Start / Close on Inspections & punch list).
   */
  punch: { id: string; title: string; origin: string; siteOrigin: boolean; ncr: string; owner: string; due: string; status: string; tagClass: string }[];
  punchFilter: { value: 'site' | 'all'; options: { value: 'site' | 'all'; label: string; href: string }[]; label: string; empty: string | null };
  hse: {
    rows: { title: string; date: string; status: string; tagClass: string; vigieUrl: string }[];
    lastSync: string;
    listUrl: string;
    reportUrl: string;
    mode: 'mock' | 'http';
  };
}

/** R-118: what the project's leads enter on an existing sheet — the sheet's form and the lines' add / edit forms. */
export interface SheetEntry {
  sheet: { form: FormDef; values: FormValues; stamp: string };
  /** "Add …" forms; the prerequisite's is null when the plan has no activity (`noActivity` explains). */
  add: Record<SiteLineKind, FormDef | null>;
  edit: Record<SiteLineKind, FormDef | null>;
  noActivity: string | null;
}

export interface SiteView {
  tab: SiteTab;
  /** "Display" segmented control (links). */
  segs: { value: SiteTab; label: string; href: string }[];
  /** Empty state (no site sheet), translated; null when the module is open. */
  empty: string | null;
  /** R-118: "Prepare the site" on the empty state for the project's leads (stage window); null otherwise. */
  prepare: { form: FormDef; values: FormValues } | null;
  /** R-118: the leads' entry on an existing sheet; null for everybody else. */
  entry: SheetEntry | null;
  ready: ReadyView | null;
  team: TeamView | null;
  exec: ExecView | null;
}

/**
 * Empty state of a project without a site sheet. D-3 'a' (R-118): the project's leads create it from the Études stage (the
 * prototype said the module opened at the Expédition stage).
 */
export const EMPTY_TEXT = 'No site sheet yet for this project — the project’s leads prepare it from the Études stage.';
const dash = (v: string) => v || '—';

const kpiView = (k: SiteKpi, t: T, lang: Lang): KpiView => ({ label: t(k.label), value: siteText(k.value, t, lang), sub: siteText(k.sub, t, lang), color: k.alert ? LO : OK });
const day = (iso: string | null, t: T) => (iso ? t(shortDateOfIso(iso)) : '—');
const lastSyncText = (iso: string | null, t: T, lang: Lang) => (iso ? siteText(`Last sync ${stampText(new Date(iso))}`, t, lang) : t('Never synced'));

/** The facts the KPI tiles read, from the DAL's site data. */
export function factsOf(d: SiteData): SiteFacts {
  return {
    startOn: d.sheet.startOn, planDays: d.sheet.planDays, doneDays: d.sheet.doneDays, manDaysPlanned: d.sheet.manDaysPlanned, clientDecisions: d.clientDecisions,
    prerequisites: d.prerequisites, people: d.cursus.people, equipment: d.equipment, collisions: d.collisions, rotation: d.rotation, missionCosts: d.missionCosts,
    reports: d.dailyReports.map((r) => ({ reportOn: r.reportOn, headcount: r.headcount })),
    punch: d.punch, hse: d.hse, premium: d.premium,
  };
}

/** A line's entry (R-118): values, stamp, edit / remove rules. */
function lineEntry(kind: SiteLineKind, line: { stamp: string; status?: string; actualKeur?: number }, values: FormValues): LineEntry {
  return { values, stamp: line.stamp, editable: siteLineEditable(kind, line), removable: siteLineRemovable(kind, line) };
}

function readyView(code: string, d: SiteData, t: T, lang: Lang, entry: boolean): ReadyView {
  const s = d.sheet;
  return {
    kpis: readinessKpis(factsOf(d), d.go).map((k) => kpiView(k, t, lang)),
    go: {
      tag: t(goLabel(d.go.ok)),
      tagClass: siteTagClass(goLabel(d.go.ok)),
      // ok and not ok share accent-300 in the prototype (only the icon differs, 10 OQ9).
      items: d.go.conditions.map((c) => ({ key: c.key, label: t(c.label), sub: siteText(c.sub, t, lang), ok: c.ok, color: LO })),
    },
    // R-118: values typed in Keystone may be blank ("—"); "Cursus site" = the site's id in Cursus, "Not created yet" until Cursus
    // creates it (R-028 — Cursus has no site-creation endpoint; no request is queued).
    meta: [
      ...([
        ['Site', dash(s.site)], ['Country · time zone', `${dash(s.country)} · ${dash(s.timeZone)}`], ['Language · currency', `${dash(s.language)} · ${s.currency}`],
        ['Client contact on site', dash(s.clientContact)], ['Working hours', dash(s.workingHours)], ['Local holidays', dash(s.localHolidays)],
        ['Access constraints', dash(s.accessConstraints)], ['Window', `${siteDateText(s.startOn)} → ${siteDateText(s.endOn)} · ${s.planDays} working days`],
      ] as const).map(([k, v]) => ({ k: t(k), v: k === 'Window' ? t(v) : fieldsText(v, t, lang) })),
      { k: t('Cursus site'), v: s.cursusChantierId ?? t('Not created yet') },
    ],
    prereqs: d.prerequisites.map((p) => {
      const step = prerequisiteStep(p.status);
      return {
        position: p.position, title: dataText(p.title, lang), act: p.activityCode + (p.activityName ? ` · ${dataText(p.activityName, lang)}` : ''), due: day(p.neededBy, t),
        dueColor: p.late ? LO : 'var(--color-neutral-300)', status: t(p.statusLabel), tagClass: siteTagClass(p.statusLabel), note: fieldsText(p.evidence, t, lang), late: p.late,
        step: step && { to: step.to, label: t(step.label) },
        stamp: p.stamp,
        entry: entry ? lineEntry('prerequisite', p, { title: p.title, activity: p.activityCode, needed: t(siteDateText(p.neededBy)), evidence: p.evidence }) : null,
      };
    }),
    equip: d.equipment.map((e) => ({
      position: e.position, name: dataText(e.name, lang), src: t(e.sourceLabel), srcClass: equipmentSourceTagClass(e.source), status: t(e.statusLabel), tagClass: siteTagClass(e.statusLabel),
      note: fieldsText(e.note, t, lang), canConfirm: e.status === 'pending', stamp: e.stamp,
      entry: entry ? lineEntry('equipment', e, { name: e.name, source: e.source, note: e.note }) : null,
    })),
    noPrereq: d.prerequisites.length ? null : t('No client prerequisite yet'),
    noEquip: d.equipment.length ? null : t('No equipment yet'),
    cursus: {
      rows: d.cursus.people.map((p) => {
        const visa = cursusVisa.label(p.visa);
        const vacc = cursusVaccination.label(p.vaccination);
        const hab = cursusClearance.label(p.clearance);
        const verdict = cursusVerdict.label(p.verdict);
        return {
          person: p.personName, who: p.personName, personUrl: cursusEmployeeUrl(p.matricule), visa: t(visa), visaClass: siteTagClass(visa), vacc: t(vacc), vaccClass: siteTagClass(vacc), hab: t(hab), habClass: siteTagClass(hab),
          habNote: t(p.clearanceNote), habColor: p.clearance === 'ok' ? 'var(--color-neutral-400)' : LO, status: t(verdict), tagClass: siteTagClass(verdict),
          rec: t(stampText(new Date(p.receivedAt))), remindable: p.verdict !== 'go' && !p.reminded, reminded: p.reminded,
          reminderSync: p.reminderSyncStatus ? t(cursusSyncStatus.label(p.reminderSyncStatus)) : null,
        };
      }),
      lastSync: lastSyncText(d.cursus.lastSyncedAt, t, lang),
      openUrl: cursusChantierUrl(s.cursusChantierId),
      mode: d.cursus.mode,
      empty: d.cursus.people.length ? null : t('No approval received from Cursus yet'),
    },
  };
}

/** Who looks at the conflicts (R-119): their role, the departments they head, and whether they lead the project. */
export interface ConflictArbiter {
  role: RoleKey;
  headed: readonly string[];
  lead: boolean;
}

/** The "Arbitrate" form (R-119): why the conflict is accepted (required). */
export function arbitrationFormDef(t: T): FormDef {
  return {
    title: t('Arbitrate the conflict'),
    submit: t('Mark arbitrated'),
    kind: 'create',
    fields: [{ id: 'comment', label: t('Why it is accepted'), type: 'textarea', required: true }],
  };
}

function teamView(code: string, d: SiteData, t: T, lang: Lang, arbiter: ConflictArbiter | null, entry: { team: readonly string[] } | null): TeamView {
  return {
    kpis: teamKpis(factsOf(d), lang).map((k) => kpiView(k, t, lang)),
    rotation: d.rotation.map((r) => ({
      position: r.position, who: r.person, role: dataText(r.roleOnSite, lang), from: day(r.fromOn, t), to: day(r.toOn, t), rot: `R${r.rotationNo}`,
      lodging: dataText(r.lodging, lang), travel: dataText(r.travel, lang), collision: r.hasCollision, collisionLabel: t(r.hasCollision ? 'Collision' : 'No collision'),
      entry: entry ? rotationEntry(r, d, entry.team, t, lang) : null,
    })),
    noRotation: d.rotation.length ? null : t('No one on the rotation plan yet'),
    collisions: d.collisions
      .filter((c) => !c.resolved)
      .map((c) => {
        const target = COLLISION_TARGET[c.kind];
        return {
          key: c.key, who: c.person, kind: t(c.kindLabel), tagClass: collisionTagClass(c.kind), what: conflictText(c.cause, t, lang), fix: t(c.proposedFix),
          href: target === 'ready' ? siteHref(code, 'ready', CURSUS_CARD_ID) : screenOf(target),
          canArbitrate: !!arbiter && canArbitrateConflict(arbiter.role, arbiter, c),
        };
      }),
    arbitrated: d.collisions
      .filter((c) => c.resolved && c.arbitration)
      .map((c) => ({
        key: c.key, who: c.person, kind: t(c.kindLabel), what: conflictText(c.cause, t, lang), by: c.arbitration!.by, at: t(stampText(new Date(c.arbitration!.at))),
        comment: dataText(c.arbitration!.comment, lang),
      })),
    noCollision: d.collisions.some((c) => !c.resolved) ? null : t('No conflict'),
    arbitrationForm: arbitrationFormDef(t),
    missionCosts: d.missionCosts.map((m) => ({
      position: m.position, name: dataText(m.name, lang), budget: money(m.budgetKeur, lang), actual: m.actualKeur ? money(m.actualKeur, lang) : '—',
      actualTitle: m.actualKeur ? null : t('Waiting for Sage X3'), pct: `${m.usedPct}%`, left: money(m.remainingKeur, lang),
      entry: entry ? lineEntry('cost', m, { name: m.name, budget: String(m.budgetKeur) }) : null,
    })),
    noCost: d.missionCosts.length ? null : t('No mission cost line yet'),
  };
}

/**
 * A rotation line's entry: its values and, when its person left the project team, its own "Edit" form offering the team and
 * that person (the kind's form offers the team only — R-118).
 */
function rotationEntry(r: SiteData['rotation'][number], d: SiteData, team: readonly string[], t: T, lang: Lang): LineEntry {
  const e = lineEntry('rotation', r, rotationValues(r, team, t));
  if (!r.personId || team.includes(r.person)) return e;
  return { ...e, form: siteLineFormDef('rotation', 'edit', { activities: d.planActivities, people: [...team, r.person] }, t, lang) ?? undefined };
}

/** A rotation's form values: a team member (or the line's own person) by name, else the contractor crew typed. */
function rotationValues(r: SiteData['rotation'][number], team: readonly string[], t: T): FormValues {
  const member = !!r.personId || team.includes(r.person);
  return {
    person: member ? r.person : CONTRACTOR_CREW, crew: member ? '' : r.person, role: r.roleOnSite, from: t(siteDateText(r.fromOn)), to: t(siteDateText(r.toOn)),
    rotation: String(r.rotationNo), lodging: r.lodging, travel: r.travel,
  };
}

function execView(code: string, d: SiteData, t: T, lang: Lang, today: string, punchFilter: 'site' | 'all'): ExecView {
  const note = preparationNote({ startOn: d.sheet.startOn, doneDays: d.sheet.doneDays }, today);
  const punch = punchFilter === 'all' ? d.punch : d.punch.filter((p) => p.origin === 'site');
  return {
    kpis: execKpis(factsOf(d)).map((k) => kpiView(k, t, lang)),
    reports: d.dailyReports.map((r) => {
      const detail = r.fromForm
        ? [r.weather ? weatherText(r.weather, t, lang) : null, r.headcount != null ? siteText(`${r.headcount} on site`, t, lang) : null, r.hseIncident ? `HSE${lang === 'fr' ? ' : ' : ': '}${incidentText(r.hseIncident, t)}` : null]
            .filter(Boolean)
            .join(' · ')
        : null;
      return {
        number: r.number, date: day(r.reportOn, t), act: dataText(r.activity, lang), pct: r.percentComplete == null ? '—' : String(r.percentComplete),
        txt: dataText(r.text, lang), detail: detail || null, link: r.linkRef ?? '—', href: isNcrLink(r.linkRef) ? qualityNcrHref(code, r.linkRef) : null,
        by: r.author,
      };
    }),
    noReport: d.dailyReports.length ? null : t('No daily report yet'),
    note: note && siteText(note, t, lang),
    punch: punch.map((p) => ({
      id: p.number, title: dataText(p.description, lang), origin: t(p.originLabel), siteOrigin: p.origin === 'site', ncr: p.ncrNumber ?? '—',
      owner: p.ownerName ? dataText(p.ownerName, lang) : p.owner ? t(p.owner) : '—', due: day(p.dueOn, t), status: t(p.statusLabel), tagClass: siteTagClass(p.statusLabel),
    })),
    punchFilter: {
      value: punchFilter,
      label: t('Origin'),
      options: (['site', 'all'] as const).map((v) => ({ value: v, label: t(v === 'site' ? 'Site' : 'All'), href: sitePunchHref(code, v) })),
      empty: punch.length ? null : t('No punch item yet'),
    },
    hse: {
      rows: d.hse.map((h) => ({ title: dataText(h.title, lang), date: day(h.dateOn, t), status: t(h.statusText), tagClass: siteTagClass(h.statusText), vigieUrl: h.vigieUrl })),
      lastSync: lastSyncText(d.hseSource.lastSyncedAt, t, lang),
      listUrl: vigieHseListUrl({ projectCode: code }),
      reportUrl: vigieReportIncidentUrl({ projectCode: code, location: d.sheet.site }),
      mode: d.hseSource.mode,
    },
  };
}

/**
 * R-118: what the project's leads may enter (`canFillSiteSheet`) — their team's names (the rotation's people) and, without a
 * sheet, the project's defaults for "Prepare the site".
 */
export interface EntryContext {
  team: readonly string[];
  defaults?: SiteSheetDefaults | null;
}

/**
 * The Site screen of `code` for the selected tab (all three tabs are built; the view renders the selected one). `punch`: the
 * Daily execution punch list's origin filter (R-117; default the items raised on site). `entry` (R-118): the viewer may prepare
 * and fill the site sheet.
 */
export function siteView(
  code: string,
  data: SiteData | null,
  opts: { tab: SiteTab; punch?: 'site' | 'all'; arbiter?: ConflictArbiter | null; entry?: EntryContext | null },
  t: T,
  lang: Lang,
): SiteView {
  const segs = SITE_TABS.map((v) => ({ value: v, label: t(SITE_TAB_LABEL[v]), href: siteHref(code, v) }));
  const entry = opts.entry ?? null;
  if (!data) {
    const d = entry?.defaults;
    const prepare = entry
      ? { form: siteSheetFormDef(t, 'prepare'), values: { site: d?.site ?? '', country: d?.country ?? '', currency: d?.currency ?? 'EUR', contact: d?.clientContact ?? '' } }
      : null;
    return { tab: opts.tab, segs, empty: t(EMPTY_TEXT), prepare, entry: null, ready: null, team: null, exec: null };
  }
  return {
    tab: opts.tab,
    segs,
    empty: null,
    prepare: null,
    entry: entry && sheetEntry(data, entry, t, lang),
    ready: readyView(code, data, t, lang, !!entry),
    team: teamView(code, data, t, lang, opts.arbiter ?? null, entry),
    exec: execView(code, data, t, lang, data.today, opts.punch ?? 'site'),
  };
}

// ── Site sheet entry forms (R-118, D-3 'a') ─────────────────────────────────────────────────────────

/** "Prepare the site" / "Edit site sheet": the sheet's values; site and country prefilled from the project on a new sheet. */
export function siteSheetFormDef(t: T, mode: 'prepare' | 'edit'): FormDef {
  return {
    title: t(mode === 'prepare' ? 'Prepare the site' : 'Edit site sheet'),
    submit: t(mode === 'prepare' ? 'Create the site sheet' : 'Save'),
    kind: 'create',
    fields: [
      { id: 'site', label: t('Site'), type: 'text', required: true, span: 'full' },
      { id: 'country', label: t('Country'), type: 'text', required: true },
      { id: 'tz', label: t('Time zone'), type: 'text', placeholder: t('e.g. Europe/Paris (UTC+1)') },
      { id: 'lang', label: t('Language'), type: 'text' },
      { id: 'currency', label: t('Currency'), type: 'select', options: SITE_CURRENCIES.map((c) => ({ value: c, label: c })) },
      { id: 'contact', label: t('Client contact on site'), type: 'text', span: 'full' },
      { id: 'hours', label: t('Working hours'), type: 'text' },
      { id: 'holidays', label: t('Local holidays'), type: 'text' },
      { id: 'access', label: t('Access constraints'), type: 'textarea' },
      { id: 'start', label: t('Site start'), type: 'text', required: true, placeholder: t('e.g. 19 Oct 2026') },
      { id: 'end', label: t('Site end'), type: 'text', required: true, placeholder: t('e.g. 18 Dec 2026') },
    ],
  };
}

const ADD_TITLE: Record<SiteLineKind, string> = {
  prerequisite: 'Add client prerequisite', equipment: 'Add equipment', rotation: 'Add a rotation', cost: 'Add mission cost line',
};
const EDIT_TITLE: Record<SiteLineKind, string> = {
  prerequisite: 'Edit client prerequisite', equipment: 'Edit equipment', rotation: 'Edit rotation', cost: 'Edit mission cost line',
};

/**
 * The form of a line kind: the prototype's columns only. A prerequisite offers the plan's activities (none → no form); a
 * rotation offers `people` — the project team's (and, to edit a line whose person left the team, that person) — or a
 * contractor crew typed by name; a mission cost line has a budget only (the actual comes from Sage X3).
 */
export function siteLineFormDef(
  kind: SiteLineKind, mode: 'add' | 'edit', ctx: { activities: readonly { code: string; name: string }[]; people: readonly string[] }, t: T, lang: Lang,
): FormDef | null {
  const head = { title: t(mode === 'add' ? ADD_TITLE[kind] : EDIT_TITLE[kind]), submit: t(mode === 'add' ? 'Add' : 'Save'), kind: 'create' as const };
  switch (kind) {
    case 'prerequisite':
      if (!ctx.activities.length) return null;
      return {
        ...head,
        fields: [
          { id: 'title', label: t('Prerequisite'), type: 'text', required: true },
          { id: 'activity', label: t('Conditions activity'), type: 'select', options: ctx.activities.map((a) => ({ value: a.code, label: `${a.code} · ${dataText(a.name, lang)}` })) },
          { id: 'needed', label: t('Needed by'), type: 'text', required: true, placeholder: t('e.g. 2 Nov 2026') },
          { id: 'evidence', label: t('Evidence'), type: 'text' },
        ],
      };
    case 'equipment':
      return {
        ...head,
        fields: [
          { id: 'name', label: t('Equipment'), type: 'text', required: true, span: 'full' },
          { id: 'source', label: t('Source'), type: 'select', options: equipmentSource.codes.map((c) => ({ value: c, label: t(equipmentSource.label(c)) })) },
          { id: 'note', label: t('Note'), type: 'text' },
        ],
      };
    case 'rotation':
      return {
        ...head,
        fields: [
          { id: 'person', label: t('Person'), type: 'select', options: [...ctx.people.map((n) => ({ value: n, label: n })), { value: CONTRACTOR_CREW, label: t('Contractor crew (name below)') }] },
          { id: 'crew', label: t('Contractor crew'), type: 'text', placeholder: t('e.g. Contractor — 2 fitters') },
          { id: 'role', label: t('Role on site'), type: 'text', required: true },
          { id: 'rotation', label: t('Rotation'), type: 'number', defaultValue: '1' },
          { id: 'from', label: t('From'), type: 'text', required: true, placeholder: t('e.g. 19 Oct 2026') },
          { id: 'to', label: t('To'), type: 'text', required: true, placeholder: t('e.g. 13 Nov 2026') },
          { id: 'lodging', label: t('Lodging'), type: 'text' },
          { id: 'travel', label: t('Travel'), type: 'text' },
        ],
      };
    case 'cost':
      return {
        ...head,
        fields: [
          { id: 'name', label: t('Line'), type: 'text', required: true, span: 'full' },
          { id: 'budget', label: t('Budget (k€)'), type: 'number', required: true },
        ],
      };
  }
}

function sheetEntry(d: SiteData, entry: EntryContext, t: T, lang: Lang): SheetEntry {
  const s = d.sheet;
  // The rotation's people: the project team only — "Add" accepts nobody else (the Server Function and the writer re-check); a
  // line whose person left the team gets its own "Edit" form with that person (`rotationEntry`).
  const ctx = { activities: d.planActivities, people: entry.team };
  const forms = (mode: 'add' | 'edit') =>
    Object.fromEntries((['prerequisite', 'equipment', 'rotation', 'cost'] as const).map((k) => [k, siteLineFormDef(k, mode, ctx, t, lang)])) as Record<SiteLineKind, FormDef | null>;
  return {
    sheet: {
      form: siteSheetFormDef(t, 'edit'),
      values: {
        site: s.site, country: s.country, tz: s.timeZone, lang: s.language, currency: s.currency, contact: s.clientContact, hours: s.workingHours, holidays: s.localHolidays,
        access: s.accessConstraints, start: t(siteDateText(s.startOn)), end: t(siteDateText(s.endOn)),
      },
      stamp: s.stamp,
    },
    add: forms('add'),
    edit: forms('edit'),
    noActivity: d.planActivities.length ? null : t('A prerequisite conditions an activity of the plan — this project’s plan has no activity yet'),
  };
}

/**
 * The header primary's form (AF.site): weather codes as values, the business date `today` (R-013) as the default date. NEW-SITE-2 'a' (R-122):
 * no HSE field any more — `incidentUrl` (Vigie's "report an incident" page, prefilled with the project and the site) is the
 * note under the fields, "HSE incident? Declare it in Vigie".
 */
export function dailyReportFormDef(t: T, lang: Lang, today: string, incidentUrl?: string): FormDef {
  return {
    title: t('Daily report'),
    submit: t('Save report'),
    kind: 'create',
    fields: [
      { id: 'date', label: t('Date'), type: 'text', defaultValue: t(siteDateText(today)) },
      { id: 'weather', label: t('Weather'), type: 'select', options: WEATHER_OPTIONS.map((w) => ({ value: w, label: weatherText(w, t, lang) })) },
      { id: 'headcount', label: t('Headcount on site'), type: 'number', defaultValue: String(DEFAULT_HEADCOUNT) },
      { id: 'progress', label: t('Progress'), type: 'textarea', required: true },
    ],
    ...(incidentUrl ? { note: { text: t('HSE incident?'), linkLabel: t('Declare it in Vigie'), href: incidentUrl } } : {}),
  };
}
