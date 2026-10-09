// Site (chantier) view model (docs/spec/10 §3; prototype logic 4739–4760, template 2268–2309): every text of the
// three tabs, translated, with the tags and colours the template binds. Built on the server from the DAL's
// `SiteData` (null = no site sheet → empty state); the rights (edit, remind) are applied by the view.
// The Cursus approvals and the HSE register are the connectors' records (Cursus / Vigie own them): the view model
// only adds the links to those applications and the last refresh.
import type { FormDef } from '@/components/app/form-def';
import {
  COLLISION_TARGET, DEFAULT_HEADCOUNT, INCIDENT_OPTIONS, SITE_TABS, SITE_TAB_LABEL, WEATHER_OPTIONS, collisionTagClass, equipmentSourceTagClass,
  execKpis, goLabel, isNcrLink, preparationNote, prerequisiteStep, readinessKpis, siteDateText, siteTagClass, teamKpis,
  type SiteFacts, type SiteKpi, type SiteTab,
} from '@/domain/site';
import type { Lang, T } from '@/i18n/translate';
import { money } from '@/lib/format';
import {
  STATUS_ISO, cursusClearance, cursusSyncStatus, cursusVaccination, cursusVerdict, cursusVisa, shortDateOfIso, stampText,
} from '@/server/db/codes';
import type { SiteData } from '@/server/dal/site';
import { cursusChantierUrl } from '@/server/integrations/cursus/links';
import { vigieHseListUrl, vigieReportIncidentUrl } from '@/server/integrations/vigie/links';
import { dataText, incidentText, siteText, weatherText } from './i18n';
import { CURSUS_CARD_ID, qualityNcrHref, screenOf, siteHref } from './links';

const LO = 'var(--color-accent-300)';
const OK = 'var(--color-text)';

export interface KpiView {
  label: string;
  value: string;
  sub: string;
  color: string;
}

export interface ReadyView {
  kpis: KpiView[];
  go: { tag: string; tagClass: string; items: { key: string; label: string; sub: string; ok: boolean; color: string }[] };
  meta: { k: string; v: string }[];
  prereqs: {
    position: number; title: string; act: string; due: string; dueColor: string; status: string; tagClass: string; note: string; late: boolean;
    /** Next step offered ("Client confirms" / "Signed on site"); null when signed. */
    step: { to: 'confirmed' | 'signed'; label: string } | null;
  }[];
  equip: { position: number; name: string; src: string; srcClass: string; status: string; tagClass: string; note: string; canConfirm: boolean }[];
  cursus: {
    rows: {
      /** Cursus's name of the person (the reminder's key; `who` is the displayed text). */
      person: string;
      who: string; visa: string; visaClass: string; vacc: string; vaccClass: string; hab: string; habClass: string; habNote: string; habColor: string;
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
  };
}

export interface TeamView {
  kpis: KpiView[];
  rotation: { who: string; role: string; from: string; to: string; rot: string; lodging: string; travel: string; collision: boolean; collisionLabel: string }[];
  collisions: { position: number; who: string; kind: string; tagClass: string; what: string; fix: string; href: string }[];
  missionCosts: { name: string; budget: string; actual: string; pct: string; left: string }[];
}

export interface ExecView {
  kpis: KpiView[];
  reports: { number: string; date: string; act: string; pct: string; txt: string; detail: string | null; link: string; href: string | null; by: string }[];
  note: string | null;
  punch: { id: string; title: string; ncr: string; owner: string; due: string; status: string; tagClass: string }[];
  hse: {
    rows: { title: string; date: string; status: string; tagClass: string; vigieUrl: string }[];
    lastSync: string;
    listUrl: string;
    reportUrl: string;
    mode: 'mock' | 'http';
  };
}

export interface SiteView {
  tab: SiteTab;
  /** "Display" segmented control (links). */
  segs: { value: SiteTab; label: string; href: string }[];
  /** Empty state (no site sheet), translated; null when the module is open. */
  empty: string | null;
  ready: ReadyView | null;
  team: TeamView | null;
  exec: ExecView | null;
}

/** Empty state of a project without a site sheet (the prototype's sentence without its "in this mockup" clause). */
export const EMPTY_TEXT = 'The site module opens when the project reaches the Expédition stage — no site sheet yet for this project.';

const kpiView = (k: SiteKpi, t: T, lang: Lang): KpiView => ({ label: t(k.label), value: siteText(k.value, t, lang), sub: siteText(k.sub, t, lang), color: k.alert ? LO : OK });
const day = (iso: string | null, t: T) => (iso ? t(shortDateOfIso(iso)) : '—');
const lastSyncText = (iso: string | null, t: T, lang: Lang) => (iso ? siteText(`Last sync ${stampText(new Date(iso))}`, t, lang) : t('Never synced'));

/** The facts the KPI tiles read, from the DAL's site data. */
export function factsOf(d: SiteData): SiteFacts {
  return {
    startOn: d.sheet.startOn, planDays: d.sheet.planDays, doneDays: d.sheet.doneDays, manDaysPlanned: d.sheet.manDaysPlanned, clientDecisions: d.clientDecisions,
    prerequisites: d.prerequisites, people: d.cursus.people, equipment: d.equipment, collisions: d.collisions, rotation: d.rotation, missionCosts: d.missionCosts,
    reports: d.dailyReports.map((r) => ({ reportOn: r.reportOn, headcount: r.headcount, hseIncident: r.hseIncident })),
    punch: d.punch, hse: d.hse,
  };
}

function readyView(code: string, d: SiteData, t: T, lang: Lang): ReadyView {
  const s = d.sheet;
  return {
    kpis: readinessKpis(factsOf(d), d.go).map((k) => kpiView(k, t, lang)),
    go: {
      tag: t(goLabel(d.go.ok)),
      tagClass: siteTagClass(goLabel(d.go.ok)),
      // ok and not ok share accent-300 in the prototype (only the icon differs, 10 OQ9).
      items: d.go.conditions.map((c) => ({ key: c.key, label: t(c.label), sub: siteText(c.sub, t, lang), ok: c.ok, color: LO })),
    },
    meta: ([
      ['Site', s.site], ['Country · time zone', `${s.country} · ${s.timeZone}`], ['Language · currency', `${s.language} · ${s.currency}`],
      ['Client contact on site', s.clientContact], ['Working hours', s.workingHours], ['Local holidays', s.localHolidays], ['Access constraints', s.accessConstraints],
      ['Window', `${siteDateText(s.startOn)} → ${siteDateText(s.endOn)} · ${s.planDays} working days`],
    ] as const).map(([k, v]) => ({ k: t(k), v: t(v) })),
    prereqs: d.prerequisites.map((p) => {
      const step = prerequisiteStep(p.status);
      return {
        position: p.position, title: t(p.title), act: t(p.activityCode + (p.activityName ? ` · ${p.activityName}` : '')), due: day(p.neededBy, t),
        dueColor: p.late ? LO : 'var(--color-neutral-300)', status: t(p.statusLabel), tagClass: siteTagClass(p.statusLabel), note: t(p.evidence), late: p.late,
        step: step && { to: step.to, label: t(step.label) },
      };
    }),
    equip: d.equipment.map((e) => ({
      position: e.position, name: t(e.name), src: t(e.sourceLabel), srcClass: equipmentSourceTagClass(e.source), status: t(e.statusLabel), tagClass: siteTagClass(e.statusLabel),
      note: t(e.note), canConfirm: e.status === 'pending',
    })),
    cursus: {
      rows: d.cursus.people.map((p) => {
        const visa = cursusVisa.label(p.visa);
        const vacc = cursusVaccination.label(p.vaccination);
        const hab = cursusClearance.label(p.clearance);
        const verdict = cursusVerdict.label(p.verdict);
        return {
          person: p.personName, who: t(p.personName), visa: t(visa), visaClass: siteTagClass(visa), vacc: t(vacc), vaccClass: siteTagClass(vacc), hab: t(hab), habClass: siteTagClass(hab),
          habNote: t(p.clearanceNote), habColor: p.clearance === 'ok' ? 'var(--color-neutral-400)' : LO, status: t(verdict), tagClass: siteTagClass(verdict),
          rec: t(stampText(new Date(p.receivedAt))), remindable: p.verdict !== 'go' && !p.reminded, reminded: p.reminded,
          reminderSync: p.reminderSyncStatus ? t(cursusSyncStatus.label(p.reminderSyncStatus)) : null,
        };
      }),
      lastSync: lastSyncText(d.cursus.lastSyncedAt, t, lang),
      openUrl: cursusChantierUrl(s.cursusChantierId),
      mode: d.cursus.mode,
    },
  };
}

function teamView(code: string, d: SiteData, t: T, lang: Lang): TeamView {
  return {
    kpis: teamKpis(factsOf(d), lang).map((k) => kpiView(k, t, lang)),
    rotation: d.rotation.map((r) => ({
      who: t(r.person), role: t(r.roleOnSite), from: day(r.fromOn, t), to: day(r.toOn, t), rot: `R${r.rotationNo}`, lodging: t(r.lodging), travel: t(r.travel),
      collision: r.hasCollision, collisionLabel: t(r.hasCollision ? 'Collision' : 'No collision'),
    })),
    collisions: d.collisions
      .filter((c) => !c.resolved)
      .map((c) => {
        const target = COLLISION_TARGET[c.kind];
        return {
          position: c.position, who: t(c.person), kind: t(c.kindLabel), tagClass: collisionTagClass(c.kind), what: t(c.description), fix: t(c.proposedFix),
          href: target === 'ready' ? siteHref(code, 'ready', CURSUS_CARD_ID) : screenOf(target),
        };
      }),
    missionCosts: d.missionCosts.map((m) => ({
      name: t(m.name), budget: money(m.budgetKeur, lang), actual: m.actualKeur ? money(m.actualKeur, lang) : '—', pct: `${m.usedPct}%`, left: money(m.remainingKeur, lang),
    })),
  };
}

function execView(code: string, d: SiteData, t: T, lang: Lang, today: string): ExecView {
  const note = preparationNote({ startOn: d.sheet.startOn, doneDays: d.sheet.doneDays }, today);
  return {
    kpis: execKpis(factsOf(d)).map((k) => kpiView(k, t, lang)),
    reports: d.dailyReports.map((r) => {
      const detail = r.fromForm
        ? [r.weather ? weatherText(r.weather, t, lang) : null, r.headcount != null ? siteText(`${r.headcount} on site`, t, lang) : null, r.hseIncident ? `HSE${lang === 'fr' ? ' : ' : ': '}${incidentText(r.hseIncident, t)}` : null]
            .filter(Boolean)
            .join(' · ')
        : null;
      return {
        number: r.number, date: day(r.reportOn, t), act: t(r.activity), pct: r.percentComplete == null ? '—' : String(r.percentComplete),
        txt: r.fromForm ? dataText(r.text, lang) : t(r.text), detail: detail || null, link: r.linkRef ?? '—', href: isNcrLink(r.linkRef) ? qualityNcrHref(code, r.linkRef) : null,
        by: t(r.author),
      };
    }),
    note: note && siteText(note, t, lang),
    punch: d.punch.map((p) => ({
      id: p.number, title: t(p.description), ncr: p.ncrNumber ?? '—', owner: t(p.owner ?? '—'), due: day(p.dueOn, t), status: t(p.statusLabel), tagClass: siteTagClass(p.statusLabel),
    })),
    hse: {
      rows: d.hse.map((h) => ({ title: t(h.title), date: day(h.dateOn, t), status: t(h.statusText), tagClass: siteTagClass(h.statusText), vigieUrl: h.vigieUrl })),
      lastSync: lastSyncText(d.hseSource.lastSyncedAt, t, lang),
      listUrl: vigieHseListUrl(),
      reportUrl: vigieReportIncidentUrl({ projectCode: code, location: d.sheet.site }),
      mode: d.hseSource.mode,
    },
  };
}

/** The Site screen of `code` for the selected tab (all three tabs are built; the view renders the selected one). */
export function siteView(code: string, data: SiteData | null, opts: { tab: SiteTab; today?: string }, t: T, lang: Lang): SiteView {
  const segs = SITE_TABS.map((v) => ({ value: v, label: t(SITE_TAB_LABEL[v]), href: siteHref(code, v) }));
  if (!data) return { tab: opts.tab, segs, empty: t(EMPTY_TEXT), ready: null, team: null, exec: null };
  return {
    tab: opts.tab,
    segs,
    empty: null,
    ready: readyView(code, data, t, lang),
    team: teamView(code, data, t, lang),
    exec: execView(code, data, t, lang, opts.today ?? STATUS_ISO),
  };
}

/** The header primary's form (AF.site): weather and HSE codes as values, the status date as the default date. */
export function dailyReportFormDef(t: T, lang: Lang, today: string = STATUS_ISO): FormDef {
  return {
    title: t('Daily report'),
    submit: t('Save report'),
    kind: 'create',
    fields: [
      { id: 'date', label: t('Date'), type: 'text', defaultValue: t(siteDateText(today)) },
      { id: 'weather', label: t('Weather'), type: 'select', options: WEATHER_OPTIONS.map((w) => ({ value: w, label: weatherText(w, t, lang) })) },
      { id: 'headcount', label: t('Headcount on site'), type: 'number', defaultValue: String(DEFAULT_HEADCOUNT) },
      { id: 'progress', label: t('Progress'), type: 'textarea', required: true },
      { id: 'incident', label: t('HSE'), type: 'select', options: INCIDENT_OPTIONS.map((i) => ({ value: i, label: incidentText(i, t) })) },
    ],
  };
}
