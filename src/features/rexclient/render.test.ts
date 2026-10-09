// Static render of the two screens (Server Components + client islands) on the seeded in-memory database: the
// prototype's texts in EN and FR, the edit controls only for the viewers allowed to act (07 OQ14, 03 §8), the fixed
// Documents labels (03 OQ2), Codex links, empty states.
import { beforeAll, describe, expect, it, vi } from 'vitest';
vi.mock('next/navigation', () => ({ usePathname: () => '/projects/HLT-026/client', useRouter: () => ({ push() {}, replace() {}, refresh() {} }), useSearchParams: () => new URLSearchParams() }));
import { createElement as h, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ClientTab } from '@/domain/rexclient';
import { I18nProvider } from '@/i18n/client';
import { makeT, type Lang } from '@/i18n/translate';
import { setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { ClientView, type ClientCapabilities } from './client-view';
import { recordVerb } from './i18n';
import { RexView } from './rex-view';
import { getClientScreen, getRexScreen } from './screen';

const html = (el: ReactElement, lang: Lang) => renderToStaticMarkup(h(I18nProvider, { lang, children: el }));
const text = (markup: string) => markup.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/\s+/g, ' ');

async function rex(code: string, lang: Lang, canEdit: boolean) {
  return html(h(RexView, { code, view: await getRexScreen(code, makeT(lang), lang), canEdit, t: makeT(lang) }), lang);
}
async function client(code: string, tab: ClientTab, lang: Lang, can: ClientCapabilities) {
  return html(h(ClientView, { code, view: await getClientScreen(code, tab, makeT(lang), lang), can, t: makeT(lang) }), lang);
}
const CLIENT: ClientCapabilities = { decide: true, raise: true };
const DIRECTOR: ClientCapabilities = { decide: false, raise: true };
const NONE: ClientCapabilities = { decide: false, raise: false };

beforeAll(async () => {
  setDb(await openDatabase());
}, 60_000);

describe('Lessons learned & closure render', () => {
  it('EN: tiles, table headers, rows, checklist buttons, survey', async () => {
    const m = await rex('HLT-026', 'en', true);
    const x = text(m);
    for (const s of ['Lessons recorded', '1 applied to templates & procedures', '25 %', '4.0 / 5', 'lowest · Schedule adherence', 'Lessons learned', 'What happened',
      'Applies to', 'LL-04', 'Validate', 'Mark applied', 'Closure checklist', 'Click to cycle · not started → in progress → done', 'Final account agreed with client',
      'Customer satisfaction', 'Survey · 5 criteria', 'Schedule adherence', '3.0'])
      expect(x).toContain(s);
    expect(m.match(/<button[^>]*class="[^"]*clRow/g)?.length).toBe(10);
    expect(m.match(/>Mark applied</g)?.length).toBe(2);
    expect(m).toContain('width:90%');
  });

  it('FR and read-only: translated labels, no buttons', async () => {
    const m = await rex('HLT-026', 'fr', false);
    const x = text(m);
    for (const s of ['REX enregistrés', 'Retours d’expérience', 'Ce qui s’est passé', 'Checklist de clôture', 'Décompte final accepté par le client', 'Satisfaction client', '4,0', 'Respect du planning'])
      expect(x).toContain(s);
    expect(m).not.toContain('<button');
  });

  it('a project without data: empty-state lines', async () => {
    const x = text(await rex('NDC-031', 'en', true));
    for (const s of ['No lesson recorded for this project yet', 'No closure checklist for this project yet', 'Survey not received yet', 'survey not received']) expect(x).toContain(s);
  });
});

describe('client portal render', () => {
  it('Progress & milestones: tiles, Display segments, bars, milestones', async () => {
    const m = await client('HLT-026', 'progress', 'en', CLIENT);
    const x = text(m);
    for (const s of ['Progress', '64%', 'Planned 71% by today', 'Forecast handover', '14 Jan 2027', 'Contract date 18 Dec 2026', '2 of 6', 'Awaiting your decision', 'Open issues',
      'Display', 'Progress & milestones', 'Progress to date', 'Cumulative % complete · planned vs actual', 'Milestones', 'Contract 15 Mar · Forecast 1 Apr', 'Handover'])
      expect(x).toContain(s);
    expect(m.match(/height:71.3%/g)?.length).toBe(1);
    expect(m).toContain('href="/projects/HLT-026/client?tab=decisions"');
  });

  it('Decisions: buttons for the client only', async () => {
    const c = await client('HLT-026', 'decisions', 'en', CLIENT);
    expect(text(c)).toContain('Budget · Schedule · +€85k on contract · -12 d on handover');
    expect(c.match(/>Accept \(PV\)</g)?.length).toBe(2);
    expect(c.match(/>Reject</g)?.length).toBe(3);
    const d = await client('HLT-026', 'decisions', 'en', DIRECTOR);
    expect(d).not.toContain('>Reject<');
    expect(text(d)).toContain('Waiting for your decision');
  });

  it('Invoices: contract plan, summary, statement button', async () => {
    const x = text(await client('HLT-026', 'invoices', 'fr', CLIENT));
    for (const s of ['Factures et paiements', 'INV-2026-003', 'M3 Structure hors d’eau', 'Échéance 10 nov.', 'Synthèse du contrat', '5,52 M€', '+200 k€', 'Télécharger le relevé']) expect(x).toContain(s);
  });

  it('Issues: form for the client and the director only', async () => {
    const c = await client('HLT-026', 'issues', 'en', CLIENT);
    expect(c).toContain('placeholder="Describe a new issue or request"');
    expect(text(c)).toContain('CI-07 · Raised 22 Sep');
    expect(await client('HLT-026', 'issues', 'en', DIRECTOR)).toContain('Raise issue');
    expect(await client('HLT-026', 'issues', 'en', NONE)).not.toContain('Raise issue');
    expect(text(await client('NDC-031', 'issues', 'en', NONE))).toContain('No issue raised yet');
  });

  it('Documents: "Reference" header, Codex links, acknowledgement for the client', async () => {
    const c = await client('HLT-026', 'docs', 'en', CLIENT);
    expect(c).not.toContain('Column mapping');
    expect(text(c)).toContain('Reference');
    expect(text(c)).toContain('Released documents shared with you');
    expect(c).not.toContain('>Deliverables<');
    expect(c).toContain('href="/projects/HLT-026/documents?doc=PID-HLT-026"');
    expect(c.match(/>Acknowledge receipt</g)?.length).toBe(1);
    expect(c.match(/>Acknowledged</g)?.length).toBe(6);
    const d = await client('HLT-026', 'docs', 'en', DIRECTOR);
    expect(d).not.toContain('>Acknowledge receipt<');
    expect(text(d)).toContain('Acknowledgment pending');
    expect(text(await client('EWA-051', 'docs', 'en', NONE))).toContain('No document shared with you yet');
  });

  it('ERP-202 (internal): no invoice, €0k contract summary as in the prototype', async () => {
    const x = text(await client('ERP-202', 'invoices', 'en', CLIENT));
    for (const s of ['Internal project — no client billing', 'Contract value €0k', 'Invoiced €0k', 'Paid €0k', 'Approved changes —']) expect(x).toContain(s);
  });

  it('"Add lesson learned" submit is the verb ("Enregistrer"), not the dictionary noun "Fiche"', () => {
    expect([recordVerb('en'), recordVerb('fr'), makeT('fr')(recordVerb('fr'))]).toEqual(['Record', 'Enregistrer', 'Enregistrer']);
  });

  it('a project without data: empty states', async () => {
    const x = text(await client('EWA-051', 'progress', 'en', NONE));
    expect(x).toContain('No schedule recorded for this project');
    expect(x).toContain('No milestone recorded for this project');
    expect(text(await client('EWA-051', 'decisions', 'en', NONE))).toContain('Nothing waiting for you');
  });
});
