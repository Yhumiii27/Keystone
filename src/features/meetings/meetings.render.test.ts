// Static render of the Meetings & minutes screen body (seeded in-memory database, FR and EN): view segment and KPI
// row, meeting cards and detail card, Decisions register with the corrected headers (00 §7.16), Actions register,
// and the read-only rendering (no composer, no Send, no ticks, no transcript buttons).
import { beforeAll, describe, expect, it, vi } from 'vitest';
vi.mock('next/navigation', () => ({ usePathname: () => '/projects/HLT-026/meetings', useRouter: () => ({ push() {}, replace() {}, refresh() {} }) }));
vi.mock('./actions', () => ({
  addMinutesLineAction: vi.fn(), analyseTranscriptAction: vi.fn(), applyTranscriptAction: vi.fn(), createMeetingAction: vi.fn(), sendMinutesAction: vi.fn(),
  toggleMeetingActionAction: vi.fn(), importTranscriptAction: vi.fn(), reviewProposalAction: vi.fn(), editProposalAction: vi.fn(), addProposalRiskAction: vi.fn(),
  addProposalQuestionAction: vi.fn(),
}));

import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { MeetingsView } from '@/domain/meetings';
import { I18nProvider } from '@/i18n/client';
import { makeT, type Lang } from '@/i18n/translate';
import { setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { analyseTranscript } from '@/server/dal/meetings';
import { getMeetingsScreen } from '@/server/dal/meetings-screen';
import { MeetingsBody } from './meetings-view';
import { meetingsScreenView } from './model';
import type { TranscriptAi } from './transcript-client';

beforeAll(async () => {
  setDb(await openDatabase());
}, 60_000);

async function html(lang: Lang, q: { view?: MeetingsView; meeting?: string | null } = {}, canEdit = true, code = 'HLT-026', ai?: TranscriptAi) {
  const d = await getMeetingsScreen(code);
  const t = makeT(lang);
  const view = meetingsScreenView({ code, meetings: d.meetings, questions: d.questions, query: { view: q.view ?? 'meetings', filter: 'all', meeting: q.meeting ?? null } }, t, lang);
  const body = h(MeetingsBody, { code, view, canEdit, pinned: !!q.meeting, organizer: 'R. Aubert', t, ai });
  return renderToStaticMarkup(h(I18nProvider, { lang, children: body }));
}
const text = (h: string) => h.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');

describe('meetings screen render', () => {
  it('FR: segment, KPIs, cards, MTG-118 detail with prep pack, agenda, composer and Send', async () => {
    const h = text(await html('fr'));
    for (const s of [
      'Vue', 'Réunions', 'Décisions', 'Actions', 'Réunions cette semaine', '2 à venir', 'CR à rédiger', 'à envoyer sous 24 h', 'Statut', 'Tous 5', 'CR à rédiger 1',
      'Réunion de chantier hebdo n°24', '29 sept. 2026 · 08:30 · 5 conviés · 3 actions', 'Notes en cours', 'Synchronisé depuis Outlook · Réunion de chantier hebdo',
      'Participants · 5 Conviés', 'T. Kerbrat · absent', 'Décisions de la réunion précédente', 'Réunion de chantier hebdo n°23 · 22 sept. 2026', '2 / 2', 'Close depuis',
      'Issu de la réunion client — questions à préparer', 'Question client · N. Bensaïd · S. Haddad', 'Ordre du jour & notes', 'L. Fabre · 2 oct.',
      'Ajouter une note au point sélectionné', 'Envoyer le CR à tous les conviés',
    ])
      expect(h, s).toContain(s);
    expect(h).not.toContain('Diffusion & accusés de lecture');
  });

  it('EN: sent minutes — distribution, read receipts and the Codex link; no composer', async () => {
    const raw = await html('en', { meeting: 'MTG-117' });
    const h = text(raw);
    for (const s of ['Distribution & read receipts', 'Sent 26 Sep · MIN-HLT-023', 'N. Bensaïd · Read 27 Sep', 'P. Noguès · Not read yet', 'Open minutes', 'P. Noguès · absent'])
      expect(h, s).toContain(s);
    expect(raw).toContain('href="/projects/HLT-026/documents?doc=MIN-HLT-023"');
    expect(h).not.toContain('Send minutes to all invitees');
    expect(h).not.toContain('Add a note to the selected agenda point');
  });

  it('EN: transcript with "Analyse transcript" for editors only', async () => {
    expect(text(await html('en', { meeting: 'MTG-119' }))).toContain('Analyse transcript');
    const ro = text(await html('en', { meeting: 'MTG-119' }, false));
    expect(ro).toContain('Transcript');
    expect(ro).not.toContain('Analyse transcript');
  });

  it('Decisions register: headers Decision / Meeting / Agenda point / Type (not Project / Status)', async () => {
    const raw = await html('en', { view: 'decisions' });
    expect(raw.match(/<th[^>]*>([^<]*)<\/th>/g)!.map((x) => x.replace(/<[^>]+>/g, ''))).toEqual(['Decision', 'Meeting', 'Agenda point', 'Type']);
    expect(text(await html('fr', { view: 'decisions' }))).toContain('Point de l’ordre du jour');
  });

  it('Actions register: ticks are buttons for editors, static icons when read-only', async () => {
    const ed = await html('en', { view: 'actions' });
    expect(ed.match(/aria-label="Close action"/g)!.length).toBe(6);
    expect(ed.match(/aria-label="Reopen action"/g)!.length).toBe(2);
    const ro = await html('en', { view: 'actions' }, false);
    expect(ro).not.toContain('Close action');
    expect(text(ro)).toContain('Tick to close · closed actions leave the carry-over list');
  });

  it('read-only detail: no point selection, no composer, no Send; empty register for a project without meetings', async () => {
    const ro = text(await html('fr', {}, false));
    expect(ro).not.toContain('Envoyer le CR à tous les conviés');
    expect(ro).not.toContain('Ajouter une note au point sélectionné');
    expect(ro).not.toContain('Clore l’action');
    const empty = text(await html('fr', {}, true, 'EWA-051'));
    expect(empty).toContain('Aucune réunion dans cette vue');
    expect(empty).toContain('Tous 0');
  });
});

describe('meetings screen render — transcript (chapter 4, S-10)', () => {
  it('a meeting without transcript: "Import transcript" for editors only, with the analyser hint', async () => {
    const ed = text(await html('fr', { meeting: 'MTG-118' }));
    for (const x of ['Importer une transcription', 'Pas encore de transcription · collez-la ou chargez un fichier .txt, .vtt ou .srt', 'Analyse locale (règles) · la transcription reste dans Keystone'])
      expect(ed, x).toContain(x);
    expect(text(await html('fr', { meeting: 'MTG-118' }, false))).not.toContain('Importer une transcription');
  });

  it('before the analysis: where it runs is said (local / Claude); Replace and Analyse for editors only', async () => {
    const local = text(await html('en', { meeting: 'MTG-119' }));
    for (const x of ['Teams transcript', 'Analyse transcript', 'Replace transcript', 'Local analysis (rules) · the transcript stays in Keystone']) expect(local, x).toContain(x);
    const claude = text(await html('fr', { meeting: 'MTG-119' }, true, 'HLT-026', { claude: true, model: 'claude-opus-5-5' }));
    expect(claude).toContain('Analyse par Claude (Anthropic) · la transcription est envoyée à Anthropic');
    const ro = text(await html('en', { meeting: 'MTG-119' }, false));
    expect(ro).not.toContain('Replace transcript');
    expect(ro).not.toContain('Local analysis (rules)');
  });

  it('after the local analysis: summary, analyser, proposals with review controls; read-only shows them without controls', async () => {
    await analyseTranscript('MTG-119', 'Antoine Girard');
    const raw = await html('fr', { meeting: 'MTG-119' });
    const ed = text(raw);
    for (const x of ['Résumé', 'Analyse locale (règles) · la transcription est restée dans Keystone', 'Freeze the I/O list on rev D by Friday', 'S. Haddad · 6 oct.', 'A. Girard · —', 'Ajouter au CR', 'Relancer l’analyse'])
      expect(ed, x).toContain(x);
    expect(raw.match(/aria-label="Écarter la proposition"/g)).toHaveLength(6);
    expect(raw.match(/aria-label="Modifier la proposition"/g)).toHaveLength(6);
    const ro = await html('fr', { meeting: 'MTG-119' }, false);
    expect(ro).not.toContain('Écarter la proposition');
    expect(text(ro)).toContain('Update the electrical schematics for the three tags');
  });
});
