// Static markup of the document record drawer and the "Deposit in Codex" hand-off (FR and EN), with the overlay
// hooks forced "client side" and portals rendered in place: template order and classes of the drawer (2346–2362),
// header and first step of the dialog (2363–2374).
import { beforeAll, describe, expect, it, vi } from 'vitest';
vi.mock('next/navigation', () => ({ usePathname: () => '/', useRouter: () => ({ push() {}, replace() {}, refresh() {} }), useSearchParams: () => new URLSearchParams() }));
vi.mock('./actions', () => ({ depositInCodexAction: vi.fn(), approveDocumentAction: vi.fn(), logDownloadAction: vi.fn(), syncCodexAction: vi.fn() }));
vi.mock('@/components/ds/overlay', () => ({ useIsClient: () => true, useOverlay: () => {} }));
vi.mock('react-dom', async (orig) => ({ ...(await orig<typeof import('react-dom')>()), createPortal: (el: unknown) => el }));
vi.stubGlobal('document', { body: null });

import { createElement, type ComponentProps, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nProvider } from '@/i18n/client';
import { makeT, type Lang } from '@/i18n/translate';
import { setDb } from '@/server/db/client';
import { DEPOSIT_TYPES } from '@/server/db/codes';
import { openDatabase } from '@/server/db/open';
import { getDocumentRecord, listDocumentTypes, listVaultDocuments } from '@/server/dal/documents';
import { DepositWizard } from './deposit-wizard';
import { DocumentDrawer } from './document-drawer';
import { depositView, drawerView, type DocsState } from './model';

const S0: DocsState = { scope: 'proj', view: 'all', family: null, status: null, q: '', doc: null };
const withI18n = (lang: Lang, el: ReactElement) => createElement(I18nProvider, { lang } as ComponentProps<typeof I18nProvider>, el);
/** Text content in document order (tags stripped, entities decoded for the few the markup uses). */
const text = (html: string) => html.replace(/<[^>]+>/g, '|').replace(/&amp;/g, '&').replace(/&#x27;/g, "'").split('|').map((x) => x.trim()).filter(Boolean);

beforeAll(async () => {
  setDb(await openDatabase());
}, 60_000);

async function drawerHtml(lang: Lang, number: string, viewer = { short: 'M. Lefebvre', role: 'director' }) {
  const record = (await getDocumentRecord(number))!;
  const t = makeT(lang);
  const view = drawerView({ project: 'HLT-026', record, state: { ...S0, doc: number }, viewer, canEdit: true }, t, lang);
  return renderToStaticMarkup(withI18n(lang, createElement(DocumentDrawer, { project: 'HLT-026', view, t })));
}

describe('document record drawer markup', () => {
  it('FR, RPT-HLT-014 (release proposed, director): header, actions, sections in template order', async () => {
    const html = await drawerHtml('fr', 'RPT-HLT-014');
    const seq = text(html);
    const order = [
      'Fiche document · RPT-HLT-014 · rév. A', 'Codex', 'Client', 'Diffusion proposée', 'Rapport d’alignement des rails de grue', 'Ouvrir dans Codex', 'Télécharger le PDF',
      'Nouvelle révision · Codex', 'Approuver dans Codex · Responsable qualité · G. Comte',
      'Fiche miroir de Codex · révisions, approbations et diffusion en lecture seule ici', 'Identité', 'Numéro', 'RPT-HLT-014', 'Type', 'Rapport d’essai & contrôle (RPT)',
      'Classification', 'A1320', 'D-014', 'Révisions', 'rev A', 'Première émission', '28 sept. · G. Comte · A.3', 'Diffusion proposée', 'Natif', 'PDF',
      'Preuve d’approbation', 'Auteur · G. Comte', 'Signé · 26 sept.', 'Responsable qualité · G. Comte', 'En attente · —', 'Chef de projet · R. Aubert', 'En attente · —',
      'Journal des téléchargements', 'Relations', 'Livrable', 'D-014',
    ];
    let at = 0;
    for (const s of order) {
      const i = seq.indexOf(s, at);
      expect(i, `${s} after #${at}`).toBeGreaterThanOrEqual(0);
      at = i + 1;
    }
    expect(html).not.toContain('Distribution');
    expect(html).toContain('class="tag tag-accent');
    expect(html).toContain('href="/projects/HLT-026/documents?deposit=RPT-HLT-014"');
  });

  it('EN, PID-HLT-026: distribution with the client acknowledgement, download log, Codex download entries', async () => {
    const seq = text(await drawerHtml('en', 'PID-HLT-026', { short: 'R. Aubert', role: 'pm' }));
    for (const s of ['Distribution', 'Client — Port authority · N. Bensaïd', '· rev D · 26 Sep', 'Acknowledgment pending', 'Mechanical', 'Received', 'Download log',
      'S. Haddad · rev D · 27 Sep · PDF', 'N. Bensaïd · rev D · 28 Sep · PDF', 'Deliverable', 'D-016', 'rev C', 'Withdrawn 26 Sep', '5 Sep · P. Noguès · 4 working versions'])
      expect(seq, s).toContain(s);
    expect(seq.some((x) => x.startsWith('Approve in Codex'))).toBe(false);
  });
});

describe('"Deposit in Codex" markup', () => {
  it.each(['fr', 'en'] as Lang[])('%s: header, stepper, first step (hand-off note, file, type chips), footer', async (lang) => {
    const [docs, types] = await Promise.all([listVaultDocuments(), listDocumentTypes()]);
    const t = makeT(lang);
    const view = depositView({ project: 'HLT-026', docs, types, depositTypes: DEPOSIT_TYPES, state: S0, deposit: 'new', context: { type: null, po: 'PO-2026-118', part: null } }, t, lang)!;
    const seq = text(renderToStaticMarkup(withI18n(lang, createElement(DepositWizard, { view }))));
    const want =
      lang === 'fr'
        ? ['Cx', 'Déposer dans Codex', 'Type proposé · Certificat matière', '1', 'Fichier & type', '2', 'Métadonnées', '3', 'Numéro & fiche',
          'Keystone transmet le contexte à Codex — projet, type proposé, commande ou article lié. Codex numérote le document, déroule le circuit d’approbation et renvoie la fiche dans cet index.',
          'Déposer un fichier ou cliquer pour choisir', 'Type proposé · confirmer ou changer', 'RPT', 'Rapport d’essai & contrôle', 'CER', 'Certificat matière', 'PHO', 'Photos chantier',
          'Annuler', 'Suivant']
        : ['Cx', 'Deposit in Codex', 'Type proposed · Material certificate', 'File & type', 'Metadata', 'Number & record', 'Drop a file or click to choose',
          'Type proposed · confirm or change', 'Material certificate', 'Cancel', 'Next'];
    let at = 0;
    for (const s of want) {
      const i = seq.indexOf(s, at);
      expect(i, `${s} after #${at}`).toBeGreaterThanOrEqual(0);
      at = i + 1;
    }
    expect(seq).not.toContain(lang === 'fr' ? 'Retour' : 'Back');
  });
});
