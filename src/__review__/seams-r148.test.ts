// Throwaway review test (seams): typed demo texts that t() renders differently from dataText() in French.
import { beforeAll, describe, it } from 'vitest';
import { setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { makeT } from '@/i18n/translate';
import { dataText } from '@/i18n/data-text';
import { listProjects } from '@/server/dal/projects';
import { listScheduleSummaries } from '@/server/dal/planning';
import { getContract } from '@/server/dal/contract';
import { listDeliverables, deliverableWbsOptions } from '@/server/dal/quality';
import { listIssueActivityOptions } from '@/server/dal/stock';
import { listCrActivityLinks } from '@/server/dal/change-activities';
import { getChangeControl } from '@/server/dal/changes';
import { getPortfolioAlerts } from '@/server/dal/portfolio-alerts';

beforeAll(async () => {
  setDb(await openDatabase());
}, 120_000);

const t = makeT('fr');
const diffs: string[] = [];
const check = (where: string, s: string | null | undefined, viaT?: string) => {
  if (!s) return;
  const a = viaT ?? t(s);
  const b = dataText(s, 'fr');
  if (a !== b) diffs.push(`${where}: "${s}" → t: "${a}" | dataText: "${b}"`);
};

describe('R-148 seams', () => {
  it('enumerates', async () => {
    const projects = await listProjects();
    for (const p of projects) check(`project ${p.code} name`, p.name);
    const sched = await listScheduleSummaries();
    for (const [code, s] of Object.entries(sched)) for (const m of s.milestones) check(`schedule ${code} milestone`, m.name);
    for (const p of projects) {
      const c = await getContract(p.code);
      if (c) {
        for (const m of c.milestones) { check(`contract ${p.code} milestone label`, m.label); check(`contract ${p.code} milestone condition`, m.condition); }
        for (const a of c.amendments) check(`contract ${p.code} amendment label`, a.label);
        for (const b of c.bonds) check(`contract ${p.code} bond label`, b.label);
        for (const i of c.invoices) check(`contract ${p.code} invoice milestoneLabel`, i.milestoneLabel);
      }
      for (const d of await listDeliverables(p.code)) { check(`deliverable ${p.code} ${d.number} title`, d.title); check(`deliverable ${p.code} ${d.number} acceptanceText`, d.acceptanceText); }
      for (const w of await deliverableWbsOptions(p.code)) check(`wbs ${p.code} ${w.code}`, w.name);
      for (const a of await listIssueActivityOptions(p.code)) { check(`activity ${p.code} name`, a.name); check(`activity label ${p.code}`, a.label, t(a.label)); }
      for (const l of await listCrActivityLinks(p.code)) { check(`cr-link ${p.code} ${l.cr} title`, (l as { title?: string }).title); check(`cr-link ${p.code} name`, l.name); }
      const cc = await getChangeControl(p.code);
      for (const c of cc?.changeRequests ?? []) check(`CR ${p.code} ${c.id} title`, c.title);
    }
    const alerts = await getPortfolioAlerts('fr');
    for (const a of alerts) {
      const rt = t(a.title); const rd = t(a.detail);
      if (rt !== a.title) diffs.push(`alert title re-translated: "${a.title}" → "${rt}"`);
      if (rd !== a.detail) diffs.push(`alert detail re-translated: "${a.detail}" → "${rd}"`);
      diffs.push(`ALERT: ${a.title} || ${a.detail}`);
    }
    (await import('node:fs')).writeFileSync('/tmp/claude-0/-home-user-Keystone/daa84d35-0be7-57a3-895a-75069f5e62a4/scratchpad/rv/r148.txt', diffs.join('\n'));
  }, 300_000);
});
