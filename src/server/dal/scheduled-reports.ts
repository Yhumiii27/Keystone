import 'server-only';
// R-199 — scheduled reports (job `scheduled-reports`, every morning at the reminders hour; the first run of each ISO week sends —
// Monday morning, a missed Monday caught up the next day, never twice a week):
// - the weekly status report of each running project with planning data, to each of its leads (PM of record, co-PMs, deputies;
//   R-041): the existing status report of R-131 (C-5), steering audience, period "week", full sections — the same document the
//   Trends screen exports, built with the lead's own rights (the margin only for the roles that see it, C-10b);
// - the weekly portfolio report, to the directors: the Portfolio overview export (KPIs, active projects, needs attention).
// Each recipient gets a bell notice (always) and, with e-mail reports on and a transport configured, an e-mail in French with the
// summary in the body and the PDF / workbook attached. Idempotent through `reminder_sends` (src/server/dal/reminders.ts).
import type { Persona } from '@/config/personas';
import type { RoleKey } from '@/config/screens';
import { activeRoleOf } from '@/domain/auth';
import {
  PORTFOLIO_REPORT_TITLE, PROJECT_REPORT_TITLE, reportMail, reportPeriodKey, reportSendKey, sendKeyText, summaryLines,
} from '@/domain/reminders';
import { dataText } from '@/i18n/data-text';
import { makeT } from '@/i18n/translate';
import { businessToday } from '@/server/clock';
import { getDb } from '@/server/db/client';
import { renderPdf } from '@/server/export/pdf';
import { statusReportDocument, statusReportOptions } from '@/server/export/providers/status-report';
import { buildExportContext, exportFileName, runExport } from '@/server/export/run';
import { logError } from '@/server/log';
import { mailTransport, type MailTransport } from '@/server/mail/transport';
import type { MailAttachment } from '@/server/mail/mime';
import { createNotification } from './notifications';
import { personIdsWithRoles, projectLeadIds } from './person-notices';
import { getPortfolioOverview } from './portfolio';
import { listProjects } from './projects';
import { absoluteLink, claimSends, recipientsOf, recordSendOutcome, type MailOutcome, type Recipient, type SendKey } from './reminders';
import { userReminderPrefsMap } from './reminder-preferences';

const ENDED = new Set(['clos', 'annule']);

export interface ReportRun {
  today: string;
  /** ISO week reported ("2026-W39"). */
  period: string;
  /** Projects reported (running, with planning data, at least one lead with an account). */
  projects: number;
  /** Reports claimed by this run (project reports + portfolio reports). */
  reports: number;
  emailed: number;
  emailFailed: number;
  emailSkipped: number;
}

/** The viewer a report is built for: the recipient in their highest role (the rights of the screens). */
export function viewerOfRecipient(r: Recipient): Persona {
  const role = activeRoleOf(r.roles) ?? 'member';
  return {
    role, roles: r.roles, name: r.name, title: '', initials: '', short: r.short, email: r.email, organisation: r.organisation, department: null, personId: r.personId, userId: r.userId,
  };
}

type Built = { lines: string[]; attachment: MailAttachment } | null;

async function sendReport(
  transport: MailTransport, r: Recipient, emailOn: boolean, build: () => Promise<Built>, mail: { title: string; about: string; period: string; link: string },
): Promise<MailOutcome> {
  if (!emailOn) return { status: 'off' };
  if (transport.mode === 'none') return { status: 'no_transport' };
  if (!r.email) return { status: 'no_address' };
  try {
    const built = await build();
    if (!built) return { status: 'failed', error: 'nothing to report' };
    const m = reportMail(r.name, { ...mail, lines: built.lines, attachment: built.attachment.fileName }, { t: makeT('fr') });
    const sent = await transport.send({ to: r.email, toName: r.name, subject: m.subject, text: m.body, attachments: [built.attachment] });
    return sent.status === 'sent' ? { status: 'sent' } : sent.status === 'failed' ? { status: 'failed', error: sent.error } : { status: 'no_transport' };
  } catch (e) {
    return { status: 'failed', error: e instanceof Error ? e.message : String(e) };
  }
}

/** One run at the business date (`on`: tests); `now`: the instant of the files' names. */
export async function runScheduledReports(on?: string, now: Date = new Date()): Promise<ReportRun> {
  const db = await getDb();
  const today = on ?? (await businessToday());
  const period = reportPeriodKey(today);
  const run: ReportRun = { today, period, projects: 0, reports: 0, emailed: 0, emailFailed: 0, emailSkipped: 0 };
  const t = makeT('fr');
  const transport = mailTransport();

  // Who receives what: project → its leads; the directors → the portfolio.
  const projects = (await listProjects()).filter((p) => p.hasData && !ENDED.has(p.stage));
  const leadsOf = new Map<string, string[]>();
  for (const p of projects) leadsOf.set(p.code, await projectLeadIds(db, p.code));
  const directors = await personIdsWithRoles(db, ['director']);
  const recipients = await recipientsOf([...[...leadsOf.values()].flat(), ...directors], db);
  const prefs = await userReminderPrefsMap([...recipients.values()].map((r) => r.userId), db);

  const wanted: { key: SendKey; r: Recipient; projectCode: string | null }[] = [];
  for (const p of projects) {
    const leads = (leadsOf.get(p.code) ?? []).map((id) => recipients.get(id)).filter((r): r is Recipient => !!r && r.roles.some((x) => x !== 'client'));
    if (leads.length) run.projects++;
    for (const r of leads) wanted.push({ key: reportSendKey(r.personId, 'project_weekly', p.code, today), r, projectCode: p.code });
  }
  for (const id of directors) {
    const r = recipients.get(id);
    if (r) wanted.push({ key: reportSendKey(r.personId, 'portfolio_weekly', null, today), r, projectCode: null });
  }
  if (!wanted.length) return run;
  const claimed = await claimSends(wanted.map((w) => w.key), 'report', today);
  const mine = wanted.filter((w) => claimed.has(sendKeyText(w.key)));
  run.reports = mine.length;

  // The documents are built once per project and role (the margin depends on the role), only when an e-mail goes out.
  const pdfCache = new Map<string, Promise<Built>>();
  const projectReport = (r: Recipient, code: string) => {
    const viewer = viewerOfRecipient(r);
    const k = `${code}|${viewer.role}`;
    if (!pdfCache.has(k))
      pdfCache.set(k, (async (): Promise<Built> => {
        const ctx = await buildExportContext({
          screen: 'trends', viewer, lang: 'fr', now, params: new URLSearchParams({ code, audience: 'steering', period: 'week', sections: 'full', variant: 'status' }),
        });
        const doc = await statusReportDocument(ctx, statusReportOptions(ctx, 'steering'));
        if (!doc) return null;
        const body = await renderPdf(doc, 'fr', now);
        return { lines: summaryLines(doc.blocks), attachment: { fileName: exportFileName('status-report', ctx, 'pdf'), mime: 'application/pdf', body } };
      })());
    return pdfCache.get(k)!;
  };
  let portfolio: Promise<Built> | null = null;
  const portfolioReport = (r: Recipient) =>
    (portfolio ??= (async (): Promise<Built> => {
      const viewer = viewerOfRecipient(r);
      const ctx = await buildExportContext({ screen: 'overview', viewer, lang: 'fr', now, params: new URLSearchParams() });
      const [file, data] = await Promise.all([runExport(ctx, 'xlsx'), getPortfolioOverview(null, 'fr')]);
      const lines = [
        ...data.kpis.map((k) => `- ${t(k.label)}: ${k.value}${k.sub ? ` (${t(k.sub)})` : ''}`),
        `- ${t('Needs attention')}: ${data.alerts.length}`,
        ...data.alerts.slice(0, 10).map((a) => `  · ${a.code ? `${a.code} · ` : ''}${a.title}`),
      ];
      return { lines, attachment: { fileName: file.fileName, mime: file.mime, body: file.body } };
    })());

  for (const w of mine) {
    const p = w.projectCode ? projects.find((x) => x.code === w.projectCode)! : null;
    const title = w.projectCode ? PROJECT_REPORT_TITLE : PORTFOLIO_REPORT_TITLE;
    const screen = w.projectCode ? 'trends' : 'overview';
    let code: string | null = null;
    try {
      code = await createNotification({
        kind: 'request', title, sub: w.projectCode ? `${w.projectCode} · ${period}` : `${period} · ${projects.length} ${projects.length > 1 ? 'projects' : 'project'}`,
        screen, params: {}, projectCode: w.projectCode, audience: w.r.roles as RoleKey[], toPersonIds: [w.r.personId],
      });
    } catch (e) {
      logError('runScheduledReports', e, { personId: w.r.personId, projectCode: w.projectCode });
    }
    const emailOn = prefs.get(w.r.userId)?.emailReports ?? false;
    const mail = await sendReport(transport, w.r, emailOn, () => (w.projectCode ? projectReport(w.r, w.projectCode) : portfolioReport(w.r)), {
      title: t(title), about: p ? `${p.code} · ${dataText(p.name, 'fr')}` : t('Portfolio'), period, link: absoluteLink(screen, {}, w.projectCode),
    });
    if (mail.status === 'sent') run.emailed++;
    else if (mail.status === 'failed') {
      run.emailFailed++;
      logError('runScheduledReports.mail', new Error(mail.error ?? 'failed'), { personId: w.r.personId, projectCode: w.projectCode });
    } else run.emailSkipped++;
    await recordSendOutcome([w.key], code, mail);
  }
  return run;
}
