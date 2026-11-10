// R-160 (P2, D9-32): static render of the CE file editor and of the Settings checklists card, from the seeded in-memory database,
// in English and French: the sections, the checklists of Settings, the fields disabled outside the viewer's scope.
import { createElement as h, type ReactElement } from 'react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
vi.mock('./actions', () => ({ saveCeFileAction: vi.fn(), addCeChecklistItemAction: vi.fn(), setCeChecklistItemActiveAction: vi.fn(), resetCeChecklistsAction: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh() {}, push() {}, replace() {} }) }));

import { renderToStaticMarkup } from 'react-dom/server';
import { I18nProvider } from '@/i18n/client';
import { makeT, type Lang } from '@/i18n/translate';
import { setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { getProjectCe, listCeChecklists } from '@/server/dal/ce-conformity';
import { CeFileEditor } from './ce-file-editor';
import { CeChecklistsCard } from './checklists-card';
import { ceCardView, ceChecklistsView, ceEditorView } from './model';

const html = (el: ReactElement, lang: Lang) => renderToStaticMarkup(h(I18nProvider, { lang, children: el }));

beforeAll(async () => {
  setDb(await openDatabase());
}, 60_000);

describe('CE conformity render', () => {
  it.each(['en', 'fr'] as const)('%s: the card of HLT-026 — two lines, the handover warning, the dossier line reused', async (lang) => {
    const ce = (await getProjectCe('HLT-026'))!;
    const v = ceCardView(ce, makeT(lang), lang, (ref) => `?ce=${ref}`, 'EQ-01');
    expect(v.lines.map((l) => [l.ref, l.progress, l.warn, l.selected])).toEqual([['EQ-01', '3/9', true, true], ['EQ-02', '0/9', true, false]]);
    expect(v.warning).toBe(lang === 'en'
      ? 'CE file incomplete at the handover · EQ-01, EQ-02 · the handover is not blocked'
      : 'Dossier CE incomplet à la livraison · EQ-01, EQ-02 · la livraison n’est pas bloquée');
    expect(v.dossier).toContain('COC-HLT-012');
    expect(v.lines[0].regime).toBe(lang === 'en' ? 'Directive 2006/42/EC' : 'Directive 2006/42/CE');
  });

  it.each(['en', 'fr'] as const)('%s: the editor of EQ-01 for the engineering lead (all fields) and a PM (declaration only)', async (lang) => {
    const ce = (await getProjectCe('HLT-026'))!;
    const t = makeT(lang);
    const tech = html(h(CeFileEditor, { view: ceEditorView(ce, ce.lines[0], 'technical', t, lang) }), lang);
    expect(tech).toContain(lang === 'en' ? 'Essential health and safety requirements (Annex III)' : 'Exigences essentielles de santé et de sécurité (annexe III)');
    expect(tech).toContain(lang === 'en' ? 'Protection against mechanical hazards' : 'Protection contre les risques mécaniques');
    expect(tech).toContain(lang === 'en' ? 'Save the CE file' : 'Enregistrer le dossier CE');
    expect(tech).toContain('EN 60204-32:2008');
    expect(tech).not.toContain('disabled=""');
    const pm = html(h(CeFileEditor, { view: ceEditorView(ce, ce.lines[0], 'project', t, lang) }), lang);
    expect(pm).toContain('id="ce-EQ-01-regime" disabled=""');
    expect(pm).not.toMatch(/id="ce-EQ-01-signatory"[^>]*disabled/);
    const read = html(h(CeFileEditor, { view: ceEditorView(ce, ce.lines[0], 'none', t, lang) }), lang);
    expect(read).not.toContain(lang === 'en' ? 'Save the CE file' : 'Enregistrer le dossier CE');
  });

  it.each(['en', 'fr'] as const)('%s: the Settings checklists card', async (lang) => {
    const t = makeT(lang);
    const lists = ceChecklistsView(await listCeChecklists(), t, lang);
    expect(lists.map((l) => l.entries.length)).toEqual([20, 11]);
    const out = html(h(CeChecklistsCard, { lists, canEdit: true }), lang);
    expect(out).toContain(lang === 'en' ? 'CE conformity checklists' : 'Listes de contrôle de la conformité CE');
    expect(out).toContain(lang === 'en' ? 'Copy of the EU declaration of conformity' : 'Copie de la déclaration UE de conformité');
    expect(html(h(CeChecklistsCard, { lists, canEdit: false }), lang)).not.toContain(lang === 'en' ? 'Reset to defaults' : 'Réinitialiser');
  });
});
