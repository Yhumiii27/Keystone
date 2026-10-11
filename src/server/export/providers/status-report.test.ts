// R-131 (C-5 a): the status report adapted to its audience — steering (margin at completion for the roles that see margins,
// contract & billing), internal (+ assigned resources), client (no internal cost figure; changes, deliverables, invoices and
// the contract summary). A client viewer always gets the client report.
import { beforeAll, describe, expect, it } from 'vitest';
import { PERSONA_BY_ROLE } from '@/config/personas';
import type { RoleKey, ScreenId } from '@/config/screens';
import { setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { recordStatusReport } from '@/server/dal/trends';
import { buildExportContext, runExport } from '../run';
import { pdfTextLines } from '../test/pdf-text';
import { effectiveAudience, trendsReportOptions } from './status-report';
import '.';

const NOW = new Date('2026-10-09T08:00:00Z');
const ctxOf = (screen: ScreenId, role: RoleKey, query: string, lang: 'fr' | 'en' = 'en') =>
  buildExportContext({ screen, viewer: PERSONA_BY_ROLE[role], lang, params: new URLSearchParams(query), now: NOW });
/** The PDF's text on one line (KPI and field labels are printed in capitals and may wrap). */
const pdf = async (screen: ScreenId, role: RoleKey, query: string, lang: 'fr' | 'en' = 'en') =>
  pdfTextLines((await runExport(await ctxOf(screen, role, query, lang), 'pdf', { compressPdf: false })).body).join('\n').replace(/\s+/g, ' ');

beforeAll(async () => {
  setDb(await openDatabase());
}, 60_000);

describe('status report per audience (C-5, R-131)', () => {
  it('steering (director): indices, margin at completion (C-10b), contract & billing in the contract currency', async () => {
    const x = await pdf('trends', 'director', 'code=HLT-026&variant=status&audience=steering');
    expect(x).toContain('Steering committee');
    expect(x).toContain('CPI');
    // (5 520 − 5 366) / 5 520 = 3 % — the margin of the portfolio screens (one function), on the live EAC of R-073's computed
    // progress and actual cost (lot cost-control; 5 250 k€ and 5 % on the prototype's figures). The indices tile keeps the
    // last weekly snapshot (EAC 5 236 k€) until the snapshot job takes its figures from the computed EVM (open question).
    expect(x).toContain('MARGIN AT COMPLETION 3% Contract 5,520 k€ · EAC 5,366 k€');
    expect(x).toContain('Contract & billing CONTRACT VALUE €5.52M INVOICED €2.97M COLLECTED €1.62M OVERDUE RECEIVABLES €0k AMENDMENTS PENDING 1 PAYMENT TERMS Net 45 days');
    expect(x).not.toContain('Assigned resources');
    const fr = await pdf('trends', 'director', 'code=HLT-026&variant=status&audience=steering', 'fr');
    expect(fr).toContain('MARGE À TERMINAISON 3%'); // C-10b + R-073
    expect(fr).toContain('Net 45 jours');
  });

  it('internal (PM): the steering content plus the resources assigned to the project', async () => {
    const x = await pdf('trends', 'pm', 'code=HLT-026&variant=status&audience=internal');
    expect(x).toContain('Internal');
    expect(x).toContain('MARGIN AT COMPLETION 3%'); // C-10b + R-073, as the steering report
    expect(x).toContain('Assigned resources');
    expect(x).toContain('Average load');
    expect(x).not.toContain('No one is assigned to this project yet');
  });

  it('client: no internal cost figure; changes, deliverables, invoices, contract summary — whatever the URL asks', async () => {
    for (const [screen, role, q] of [
      ['client', 'client', 'code=HLT-026&variant=status&audience=steering'],
      ['trends', 'client', 'code=HLT-026&variant=status&audience=internal'],
      ['client', 'director', 'code=HLT-026&variant=status&audience=internal'],
    ] as const) {
      const x = await pdf(screen, role, q);
      expect(x, `${screen} ${role}`).toContain('Client');
      for (const s of ['CPI', 'EAC', 'MARGIN AT COMPLETION', 'Contract & billing', 'Assigned resources', 'Top risks']) expect(x, `${screen} ${role} ${s}`).not.toContain(s);
      for (const s of ['Changes', 'Deliverables', 'Invoices', 'Contract summary', 'INV-2026-003']) expect(x, `${screen} ${role} ${s}`).toContain(s);
    }
  });

  it('a recorded internal report with a manager note: the client viewer gets the client report without the note', async () => {
    await recordStatusReport('HLT-026', { period: 'month', audience: 'internal', sections: 'full', note: 'Supplier claim under review' }, 'Romain Aubert');
    const pm = await trendsReportOptions(await ctxOf('trends', 'pm', 'code=HLT-026&variant=status&report=latest'));
    expect(pm).toMatchObject({ audience: 'internal', note: 'Supplier claim under review' });
    const client = await trendsReportOptions(await ctxOf('trends', 'client', 'code=HLT-026&variant=status&report=latest'));
    expect(client).toMatchObject({ audience: 'client', note: null });
    const x = await pdf('trends', 'client', 'code=HLT-026&variant=status&report=latest');
    expect(x).not.toContain('Supplier claim under review');
    expect([effectiveAudience({ viewer: PERSONA_BY_ROLE.client }, 'steering'), effectiveAudience({ viewer: PERSONA_BY_ROLE.pm }, 'internal')]).toEqual(['client', 'internal']);
  });
});
