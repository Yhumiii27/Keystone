'use server';
// Site (chantier) Server Functions (docs/spec/10 §3.4–3.7). Each one validates its raw input, checks that the viewer may
// edit the Site screen of this project (inside their workspace and not a read-only project — the DAL writers re-check
// the workspace), checks the current state of the record against a fresh read, writes through the data-layer writers
// or the Cursus connector with the viewer as the actor, then revalidates (the "NO GO" badge is in every page's sidebar).
// Messages come back translated.
// System boundaries: the individual Go / No Go is Cursus's (Keystone only sends a reminder and refreshes the verdicts),
// the HSE register is Vigie's (no Server Function writes it).
import { revalidatePath } from 'next/cache';
import type { FormDialogResult } from '@/components/app/FormDialog';
import { parseDateInput } from '@/domain/contract';
import { parseDailyReportForm } from '@/domain/site';
import { STATUS_ISO, inWorkspace } from '@/server/db/codes';
import { getProject } from '@/server/dal/projects';
import { advancePrerequisite, confirmEquipment, getSite, remindInCursus, saveDailyReport, syncCursus, type Actor, type SiteData } from '@/server/dal/site';
import { getProjectContext } from '@/server/project-context';
import { getI18n } from '@/server/session';
import { messageText } from './i18n';

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
    console.error('advancePrerequisiteAction', e);
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
    console.error('confirmEquipmentAction', err);
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
    console.error('remindInCursusAction', e);
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
    console.error('syncCursusAction', e);
    return fail('Cursus could not be reached — the last approvals received are shown');
  }
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
    console.error('saveDailyReportAction', e);
    return { error: await tr(FAILED) };
  }
}
