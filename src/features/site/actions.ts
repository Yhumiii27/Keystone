'use server';
// Site (chantier) Server Functions (docs/spec/10 §3.4–3.7). Each one validates its raw input, checks that the viewer may
// edit the Site screen of this project (inside their workspace and not a read-only project — the DAL writers re-check
// the workspace), checks the current state of the record against a fresh read, writes through the data-layer writers
// or the Cursus connector with the viewer as the actor, then revalidates (the "NO GO" badge is in every page's sidebar).
// Messages come back translated.
// System boundaries: the individual Go / No Go is Cursus's (Keystone only sends a reminder and refreshes the verdicts),
// the HSE register is Vigie's (no Server Function writes it). R-118 (D-3 'a'): the project's leads prepare and fill the site
// sheet — no Cursus site-creation request is queued (R-028), mission actuals are never typed (Sage X3).
import { revalidatePath } from 'next/cache';
import type { FormDialogResult } from '@/components/app/FormDialog';
import { parseDateInput } from '@/domain/contract';
import { canArbitrateConflict, parseArbitration, parseDailyReportForm } from '@/domain/site';
import {
  NO_PLAN_ACTIVITY, PERSON_REQUIRED, SITE_COST_KEPT, SITE_LEADS_ONLY, SITE_LINE_CHANGED, SITE_LINE_KEPT, SITE_SHEET_CHANGED, SITE_SHEET_EXISTS, SITE_STAGE_ERROR,
  UNKNOWN_ACTIVITY, isSiteLineKind, parseSiteLine, parseSiteSheetForm, siteLineEditable, siteLineRemovable, siteSheetOpen, type SiteLineForm, type SiteLineKind,
} from '@/domain/site-sheet';
import { STATUS_ISO, inWorkspace } from '@/server/db/codes';
import { getProject } from '@/server/dal/projects';
import {
  ARBITRATION_REFUSED, CONFLICT_ARBITRATED, CONFLICT_CHANGED, advancePrerequisite, arbitrateSiteConflict, confirmEquipment, getSite, remindInCursus, saveDailyReport,
  syncCursus, type Actor, type SiteData,
} from '@/server/dal/site';
import { getApproverIdentity } from '@/server/dal/myapprovals-identity';
import {
  addSiteLine, createSiteSheet, hasSiteSheet, planActivities, removeSiteLine, siteSheetDefaults, updateSiteLine, updateSiteSheet,
} from '@/server/dal/site-sheet';
import { getProjectContext } from '@/server/project-context';
import { getI18n } from '@/server/session';
import { messageText } from './i18n';
import { logError } from '@/server/log';

export type SiteActionResult = { ok: true; toast?: string } | { ok: false; error: string };

const READ_ONLY = 'The site is read-only for you';
const INVALID = 'Invalid request';
const FAILED = 'The change could not be saved';
const NO_SHEET = 'This project has no site sheet';
const STALE = 'This step is not available any more';
const NO_CURSUS_SITE = 'No Cursus site is linked to this project';

/** The sidebar badge and the screen: every page shows the Site "NO GO" badge. */
const refresh = () => revalidatePath('/', 'layout');

async function tr(english: string) {
  const { t, lang } = await getI18n();
  return messageText(english, t, lang);
}
const fail = async (english: string): Promise<{ ok: false; error: string }> => ({ ok: false, error: await tr(english) });

/** Project, viewer (as the writers' actor) and the site data, when the viewer may edit the project's Site screen. */
async function access(code: unknown): Promise<{ code: string; actor: Actor; site: SiteData } | { error: string }> {
  if (typeof code !== 'string' || !code) return { error: INVALID };
  const project = await getProject(code);
  if (!project) return { error: 'Unknown project' };
  const ctx = await getProjectContext(project.code, 'site');
  // canEdit covers the outside-workspace and read-only project rules; the role list is re-checked like the writers do.
  if (!ctx.canEdit('site') || !inWorkspace('site', ctx.viewer.role)) return { error: READ_ONLY };
  const site = await getSite(project.code);
  if (!site) return { error: NO_SHEET };
  return { code: project.code, actor: { name: ctx.viewer.name, role: ctx.viewer.role }, site };
}

const isPosition = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < 10_000;

// ── Readiness: client prerequisites and equipment ───────────────────────────────────────────────────

/** "Client confirms" (Pending → Confirmed) and "Signed on site" (Confirmed → Signed) on a client prerequisite. */
export async function advancePrerequisiteAction(code: string, position: number, to: 'confirmed' | 'signed'): Promise<SiteActionResult> {
  if (!isPosition(position) || (to !== 'confirmed' && to !== 'signed')) return fail(INVALID);
  const ok = await access(code);
  if ('error' in ok) return fail(ok.error);
  const p = ok.site.prerequisites.find((x) => x.position === position);
  if (!p) return fail('Unknown prerequisite');
  if (p.status !== (to === 'confirmed' ? 'pending' : 'confirmed')) {
    refresh();
    return fail(STALE);
  }
  try {
    await advancePrerequisite(ok.code, position, to, ok.actor);
  } catch (e) {
    logError('advancePrerequisiteAction', e);
    return fail(FAILED);
  }
  refresh();
  return { ok: true };
}

/** "Confirm" on a pending equipment line. */
export async function confirmEquipmentAction(code: string, position: number): Promise<SiteActionResult> {
  if (!isPosition(position)) return fail(INVALID);
  const ok = await access(code);
  if ('error' in ok) return fail(ok.error);
  const e = ok.site.equipment.find((x) => x.position === position);
  if (!e) return fail('Unknown equipment');
  if (e.status !== 'pending') {
    refresh();
    return fail(STALE);
  }
  try {
    await confirmEquipment(ok.code, position, ok.actor);
  } catch (err) {
    logError('confirmEquipmentAction', err);
    return fail(FAILED);
  }
  refresh();
  return { ok: true };
}

// ── Cursus (individual go / no go) ─────────────────────────────────────────────────────────────────

/** "Remind in Cursus" on a person whose verdict is not GO (one reminder per person; pending sync with Cursus). */
export async function remindInCursusAction(code: string, person: string): Promise<SiteActionResult> {
  if (typeof person !== 'string' || !person.trim() || person.length > 200) return fail(INVALID);
  const ok = await access(code);
  if ('error' in ok) return fail(ok.error);
  const p = ok.site.cursus.people.find((x) => x.personName === person);
  if (!p) return fail('This person is not mobilised on the site in Cursus');
  if (p.verdict === 'go' || p.reminded) {
    refresh();
    return fail(STALE);
  }
  try {
    await remindInCursus(ok.code, p.personName, ok.actor);
  } catch (e) {
    logError('remindInCursusAction', e);
    return fail(FAILED);
  }
  refresh();
  return { ok: true, toast: await tr(`Reminder sent via Cursus · ${p.personName}`) };
}

/** "Sync Cursus": refreshes the verdicts from Cursus (HTTP mode) and delivers what waits for Cursus. */
export async function syncCursusAction(code: string): Promise<SiteActionResult> {
  const ok = await access(code);
  if ('error' in ok) return fail(ok.error);
  // HTTP mode reads Cursus's go / no go per Cursus site: without the link there is nothing to ask Cursus for.
  if (ok.site.cursus.mode === 'http' && !ok.site.sheet.cursusChantierId) return fail(NO_CURSUS_SITE);
  try {
    const r = await syncCursus(ok.code, ok.actor);
    refresh();
    const extra = r.delivered || r.failed ? ` · ${r.delivered} sent · ${r.failed} failed` : '';
    return { ok: true, toast: await tr(`Cursus sync · ${r.received} approvals received${extra}`) };
  } catch (e) {
    logError('syncCursusAction', e);
    return fail('Cursus could not be reached — the last approvals received are shown');
  }
}

// ── Site-team conflicts (R-119, D-6b 'a') ───────────────────────────────────────────────────────────

/**
 * "Arbitrate" a computed conflict of the site team with a comment (required). Not the Site's edit right: the director, the
 * head of the person's department (even off the project's team, which reads the Site — R-041), and for a contractor crew or
 * a person without a department the director and the project's leads (`canArbitrateConflict`; the writer re-checks it with
 * the actor). A conflict whose cause changed or that was arbitrated meanwhile is refused and the page refreshed. The client
 * never reaches the Site (sent home, R-042). Revalidates every page (the NO GO badge).
 */
export async function arbitrateConflictAction(code: string, key: string, values: Record<string, string>): Promise<FormDialogResult> {
  if (typeof code !== 'string' || !code || typeof key !== 'string' || !key || key.length > 600) return { error: await tr(INVALID) };
  const project = await getProject(code);
  if (!project) return { error: await tr('Unknown project') };
  const ctx = await getProjectContext(project.code, 'site');
  const site = await getSite(project.code);
  if (!site) return { error: await tr(NO_SHEET) };
  const c = site.collisions.find((x) => x.key === key);
  if (!c) {
    refresh();
    return { error: await tr(CONFLICT_CHANGED) };
  }
  const identity = await getApproverIdentity(ctx.viewer);
  if (!canArbitrateConflict(ctx.viewer.role, { headed: identity.departments, lead: ctx.isLead }, c)) return { error: await tr(ARBITRATION_REFUSED) };
  if (c.resolved) {
    refresh();
    return { error: await tr(CONFLICT_ARBITRATED) };
  }
  const parsed = parseArbitration(strings(values));
  if (!parsed.ok) return { error: await tr(parsed.error) };
  try {
    await arbitrateSiteConflict(project.code, key, parsed.value.comment, { name: ctx.viewer.name, role: ctx.viewer.role });
  } catch (e) {
    const m = e instanceof Error ? e.message : '';
    if (m === CONFLICT_CHANGED || m === CONFLICT_ARBITRATED) {
      refresh();
      return { error: await tr(m) };
    }
    if (m === ARBITRATION_REFUSED) return { error: await tr(m) };
    logError('arbitrateConflictAction', e);
    return { error: await tr(FAILED) };
  }
  refresh();
  return { toast: `${await tr('Conflict arbitrated')} · ${c.person}` };
}

// ── Daily report (header primary, AF.site) ─────────────────────────────────────────────────────────

/** Form values as sent by the client, keeping string entries only (a forged payload never reaches `.trim()`). */
const strings = (values: unknown): Record<string, string> =>
  values && typeof values === 'object' && !Array.isArray(values)
    ? Object.fromEntries(Object.entries(values).filter((e): e is [string, string] => typeof e[1] === 'string'))
    : {};

/** "Daily report": saved as the project's next report (DR-003…) by the viewer, listed in Daily execution. */
export async function saveDailyReportAction(code: string, values: Record<string, string>): Promise<FormDialogResult & { number?: string }> {
  const ok = await access(code);
  if ('error' in ok) return { error: await tr(ok.error) };
  const parsed = parseDailyReportForm(strings(values), { today: STATUS_ISO, parseDate: (s) => parseDateInput(s) });
  if (!parsed.ok) return { error: await tr(parsed.error) };
  try {
    const number = await saveDailyReport(ok.code, parsed.value, ok.actor);
    refresh();
    return { toast: await tr(`Daily report saved · ${number}`), number };
  } catch (e) {
    logError('saveDailyReportAction', e);
    return { error: await tr(FAILED) };
  }
}

// ── Site sheet entered by the project's leads (R-118, D-3 'a') ──────────────────────────────────────

/** The writers' refusals shown as they are (translated); the stale ones refresh the page. */
const SHEET_ERRORS = new Set([
  SITE_LEADS_ONLY, SITE_STAGE_ERROR, SITE_SHEET_EXISTS, SITE_SHEET_CHANGED, SITE_LINE_CHANGED, SITE_LINE_KEPT, SITE_COST_KEPT, NO_PLAN_ACTIVITY, UNKNOWN_ACTIVITY,
  PERSON_REQUIRED, NO_SHEET,
]);
const STALE_ERRORS = new Set([SITE_STAGE_ERROR, SITE_SHEET_EXISTS, SITE_SHEET_CHANGED, SITE_LINE_CHANGED, SITE_LINE_KEPT, SITE_COST_KEPT, NO_SHEET]);

async function sheetError(where: string, e: unknown): Promise<{ error: string }> {
  const m = e instanceof Error ? e.message : '';
  if (SHEET_ERRORS.has(m) || m === 'Site is outside your workspace') {
    if (STALE_ERRORS.has(m)) refresh();
    return { error: await tr(m) };
  }
  logError(where, e);
  return { error: await tr(FAILED) };
}

/**
 * The viewer may prepare and fill the project's site sheet (R-118): may edit its Site screen (inside the workspace, not
 * read-only), leads the project (PM of record, co-PM, deputy, or the director — `ctx.isLead`), and the project is between
 * Études and Mise en service & SAT. The writers re-check all of it with the actor.
 */
async function leadAccess(code: unknown): Promise<{ code: string; actor: Actor; team: string[] } | { error: string }> {
  if (typeof code !== 'string' || !code) return { error: INVALID };
  const project = await getProject(code);
  if (!project) return { error: 'Unknown project' };
  const ctx = await getProjectContext(project.code, 'site');
  if (!ctx.canEdit('site') || !inWorkspace('site', ctx.viewer.role)) return { error: READ_ONLY };
  if (!ctx.isLead) return { error: SITE_LEADS_ONLY };
  if (!siteSheetOpen(project.stage)) {
    refresh();
    return { error: SITE_STAGE_ERROR };
  }
  return { code: project.code, actor: { name: ctx.viewer.name, role: ctx.viewer.role }, team: ctx.team.map((m) => m.name) };
}

const isStamp = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-z]{1,16}$/.test(v);
const parseDate = (s: string) => parseDateInput(s);

/**
 * "Prepare the site" on the Site's empty state: creates the project's site sheet. The site, country, currency and client contact
 * left blank take the project's defaults (its site and country, the contract's currency else the project's else EUR, its first
 * client stakeholder).
 */
export async function prepareSiteAction(code: string, values: Record<string, string>): Promise<FormDialogResult> {
  const ok = await leadAccess(code);
  if ('error' in ok) return { error: await tr(ok.error) };
  if (await hasSiteSheet(ok.code)) {
    refresh();
    return { error: await tr(SITE_SHEET_EXISTS) };
  }
  const v = strings(values);
  const d = await siteSheetDefaults(ok.code);
  const blank = (k: string) => !(v[k] ?? '').trim();
  const filled = {
    ...v, site: blank('site') ? d.site : v.site, country: blank('country') ? d.country : v.country, currency: blank('currency') ? d.currency : v.currency,
    contact: blank('contact') ? d.clientContact : v.contact,
  };
  const parsed = parseSiteSheetForm(filled, parseDate);
  if (!parsed.ok) return { error: await tr(parsed.error) };
  try {
    await createSiteSheet(ok.code, parsed.value, ok.actor);
  } catch (e) {
    return sheetError('prepareSiteAction', e);
  }
  refresh();
  return { toast: await tr('Site sheet prepared') };
}

/** "Edit site sheet": refused when the sheet changed since the form opened (`stamp`, re-read by the writer). */
export async function editSiteSheetAction(code: string, stamp: string, values: Record<string, string>): Promise<FormDialogResult> {
  if (!isStamp(stamp)) return { error: await tr(INVALID) };
  const ok = await leadAccess(code);
  if ('error' in ok) return { error: await tr(ok.error) };
  const parsed = parseSiteSheetForm(strings(values), parseDate);
  if (!parsed.ok) return { error: await tr(parsed.error) };
  try {
    await updateSiteSheet(ok.code, stamp, parsed.value, ok.actor);
  } catch (e) {
    return sheetError('editSiteSheetAction', e);
  }
  refresh();
  return { toast: await tr('Site sheet saved') };
}

const ADDED: Record<SiteLineKind, string> = { prerequisite: 'Prerequisite added', equipment: 'Equipment added', rotation: 'Rotation added', cost: 'Mission cost line added' };

/** The line of `kind` at `position` as the Site shows it now (stamp, status, actual, person, name). */
function lineOf(site: SiteData, kind: SiteLineKind, position: number): { stamp: string; status?: string; actualKeur?: number; person?: string; name: string } | null {
  switch (kind) {
    case 'prerequisite': {
      const x = site.prerequisites.find((r) => r.position === position);
      return x ? { stamp: x.stamp, status: x.status, name: x.title } : null;
    }
    case 'equipment': {
      const x = site.equipment.find((r) => r.position === position);
      return x ? { stamp: x.stamp, status: x.status, name: x.name } : null;
    }
    case 'rotation': {
      const x = site.rotation.find((r) => r.position === position);
      return x ? { stamp: x.stamp, person: x.person, name: x.person } : null;
    }
    case 'cost': {
      const x = site.missionCosts.find((r) => r.position === position);
      return x ? { stamp: x.stamp, actualKeur: x.actualKeur, name: x.name } : null;
    }
  }
}

/** The typed name of a line (shown after the translated toast, never through t() — R-148). */
const nameOf = (l: SiteLineForm) => (l.kind === 'prerequisite' ? l.value.title : l.kind === 'rotation' ? l.value.personName : l.value.name);

/**
 * "Add client prerequisite" (an activity of the plan; Pending), "Add equipment" (Pending), "Add a rotation" (a team member or a
 * contractor crew), "Add mission cost line" (budget only): the next position of its table.
 */
export async function addSiteLineAction(code: string, kind: SiteLineKind, values: Record<string, string>): Promise<FormDialogResult> {
  if (!isSiteLineKind(kind)) return { error: await tr(INVALID) };
  const ok = await leadAccess(code);
  if ('error' in ok) return { error: await tr(ok.error) };
  if (!(await hasSiteSheet(ok.code))) {
    refresh();
    return { error: await tr(NO_SHEET) };
  }
  const activities = kind === 'prerequisite' ? (await planActivities(ok.code)).map((a) => a.code) : [];
  const parsed = parseSiteLine(kind, strings(values), { activities, team: ok.team, parseDate });
  if (!parsed.ok) return { error: await tr(parsed.error) };
  try {
    await addSiteLine(ok.code, parsed.value, ok.actor);
  } catch (e) {
    return sheetError('addSiteLineAction', e);
  }
  refresh();
  return { toast: `${await tr(ADDED[kind])} · ${nameOf(parsed.value)}` };
}

/** "Edit" of a line (prerequisites and equipment while Pending): refused when it changed since the page showed it. */
export async function editSiteLineAction(code: string, kind: SiteLineKind, position: number, stamp: string, values: Record<string, string>): Promise<FormDialogResult> {
  if (!isSiteLineKind(kind) || !isPosition(position) || !isStamp(stamp)) return { error: await tr(INVALID) };
  const ok = await leadAccess(code);
  if ('error' in ok) return { error: await tr(ok.error) };
  const site = await getSite(ok.code);
  if (!site) {
    refresh();
    return { error: await tr(NO_SHEET) };
  }
  const cur = lineOf(site, kind, position);
  if (!cur || cur.stamp !== stamp) {
    refresh();
    return { error: await tr(SITE_LINE_CHANGED) };
  }
  if (!siteLineEditable(kind, cur)) {
    refresh();
    return { error: await tr(SITE_LINE_KEPT) };
  }
  const parsed = parseSiteLine(kind, strings(values), { activities: site.planActivities.map((a) => a.code), team: ok.team, keepPerson: cur.person, parseDate });
  if (!parsed.ok) return { error: await tr(parsed.error) };
  try {
    await updateSiteLine(ok.code, position, stamp, parsed.value, ok.actor);
  } catch (e) {
    return sheetError('editSiteLineAction', e);
  }
  refresh();
  return { toast: `${await tr('Line saved')} · ${nameOf(parsed.value)}` };
}

/** "Remove" of a line without recorded evidence (pending prerequisite or equipment, rotation, mission line without an actual). */
export async function removeSiteLineAction(code: string, kind: SiteLineKind, position: number, stamp: string): Promise<SiteActionResult> {
  if (!isSiteLineKind(kind) || !isPosition(position) || !isStamp(stamp)) return fail(INVALID);
  const ok = await leadAccess(code);
  if ('error' in ok) return fail(ok.error);
  const site = await getSite(ok.code);
  if (!site) {
    refresh();
    return fail(NO_SHEET);
  }
  const cur = lineOf(site, kind, position);
  if (!cur || cur.stamp !== stamp) {
    refresh();
    return fail(SITE_LINE_CHANGED);
  }
  if (!siteLineRemovable(kind, cur)) {
    refresh();
    return fail(kind === 'cost' ? SITE_COST_KEPT : SITE_LINE_KEPT);
  }
  try {
    await removeSiteLine(ok.code, kind, position, stamp, ok.actor);
  } catch (e) {
    return { ok: false, error: (await sheetError('removeSiteLineAction', e)).error };
  }
  refresh();
  return { ok: true, toast: `${await tr('Line removed')} · ${cur.name}` };
}
