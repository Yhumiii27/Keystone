// My approvals feature on an in-memory seeded database: the inline change-request Server Function (input
// validation, outside-workspace and approver checks, write through decideChangeStep) and the static render of the
// inbox (FR/EN text, inline buttons only where the item is decidable and the viewer may decide, open arrows).
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const session = { role: 'director' as string, outside: false };
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push() {}, prefetch() {}, refresh() {} }), usePathname: () => '/my/approvals' }));
vi.mock('@/server/project-context', async () => {
  const { PERSONA_BY_ROLE } = await import('@/config/personas');
  return {
    getScreenAccess: async () => ({ viewer: PERSONA_BY_ROLE[session.role as 'director'], outside: session.outside, canEdit: !session.outside }),
  };
});

import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PERSONA_BY_ROLE } from '@/config/personas';
import type { RoleKey } from '@/config/screens';
import { inboxView } from '@/domain/approvals';
import { I18nProvider } from '@/i18n/client';
import { makeT, type Lang } from '@/i18n/translate';
import { getApprovalInbox } from '@/server/approvals';
import { setDb } from '@/server/db/client';
import { openDatabase } from '@/server/db/open';
import { getChangeControl } from '@/server/dal/changes';
import { listAudit } from '@/server/dal/notifications';
import { decideChangeRequestAction } from './actions';
import { daysFr, inboxT } from './i18n';
import { MyApprovalsBody } from './inbox';

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#x27;/g, '’').replace(/\s+/g, ' ');

async function render(role: RoleKey, lang: Lang, opts: { filter?: string; canDecide?: boolean } = {}) {
  const viewer = PERSONA_BY_ROLE[role];
  const inbox = await getApprovalInbox(viewer, { projectCode: 'HLT-026', lang });
  const view = inboxView(inbox.items, { decided: inbox.decided, roleTitle: viewer.title, filter: opts.filter });
  const body = h(MyApprovalsBody, { view, t: makeT(lang), lang, canDecide: opts.canDecide ?? true });
  return renderToStaticMarkup(h(I18nProvider, { lang, children: body }));
}

describe('My approvals feature', () => {
  beforeAll(async () => {
    setDb(await openDatabase());
  }, 60_000);
  beforeEach(() => {
    session.role = 'director';
    session.outside = false;
  });

  it('renders the director queue in French', async () => {
    const html = await render('director', 'fr');
    const txt = text(html);
    for (const s of [
      'En attente de ma part', 'En tant que Directrice de portefeuille', 'Commande d’achat · Demande de modification · Facture — rapprochement 3 voies',
      'Plus ancienne', '10 sept.', 'Soumise le', 'Décidées cette semaine', 'Piste d’audit conservée par élément',
      'Nature', 'Tous', 'Facture — rapprochement 3 voies', 'En attente de ma décision',
      'Demandes de ressources, commandes, ECO, livraisons, demandes de modification et livrables — à décider ici ou sur leur page',
      'PO-1082', 'Cotswold Fire Systems · 9 k€', 'FD-DET-OPT', 'Fabien Bertrand · 24 sept.',
      'CR-008', 'Seconde équipe charpente — rattrapage du planning', 'Budget · Planning · +85 k€ · -12 j', 'R. Aubert · 24 sept.',
      'Aucune commande référencée', 'Comptabilité fournisseurs · 10 sept.', 'Refuser', 'Approuver',
    ])
      expect(txt).toContain(s);
    // Inline decisions: PO (preview) and CR (persisted); invoices are decided on Sourcing only.
    expect(html.match(/>Approuver</g)).toHaveLength(2);
    expect(html).toContain('href="/my/approvals?filter=invoice"');
    expect(html).toContain('data-href="/projects/HLT-026/changes?cr=CR-008"');
    expect(html).toContain('data-href="/purchasing/sourcing?tab=inv&amp;inv=INV-LE-2210"');
    expect(txt).not.toContain('Rien en attente pour vous');
  });

  it('renders in English, filtered, without inline buttons when the viewer may not decide', async () => {
    const txt = text(await render('director', 'en', { filter: 'invoice' }));
    expect(txt).toContain('Waiting for me 5 As Portfolio director');
    expect(txt).toContain('Halvorsen Cranes · €1,286,400');
    expect(txt).not.toContain('PO-1082 ');
    const ro = await render('client', 'en', { canDecide: false });
    expect(text(ro)).toContain('Test & inspection reports · Accept by 2 Oct');
    expect(ro).not.toContain('>Approve<');
  });

  it('French day unit of the change-request sub line (prototype "-12 d", hyphen kept; "j" as on Change control)', () => {
    expect(inboxT(makeT('fr'), 'fr')('Budget · Schedule · +€85k · -12 d · Change control board')).toBe('Budget · Planning · +€85k · -12 j · Comité de contrôle des modifications');
    expect(daysFr('Schedule · +27 d', 'fr')).toBe('Schedule · +27 j');
    expect(daysFr('Budget · −5 d', 'fr')).toBe('Budget · −5 j');
    expect(daysFr('Budget · -12 d', 'en')).toBe('Budget · -12 d');
    // Only signed counts closing a segment: no change inside words or to unsigned numbers.
    expect(daysFr('Prélèvement 2 d’huile · 3 d', 'fr')).toBe('Prélèvement 2 d’huile · 3 d');
  });

  it('inline buttons name their item for assistive technologies', async () => {
    const html = await render('director', 'en');
    expect(html).toContain('aria-label="Approve CR-008"');
    expect(html).toContain('aria-label="Reject PO-1082"');
  });

  it('empty queue shows the prototype notice', async () => {
    const txt = text(await render('englead', 'fr'));
    expect(txt).toContain('Rien en attente pour vous — changez de rôle (en bas à gauche) pour voir une autre file');
    expect(txt).toContain('Rien en attente');
    expect(txt).toContain('—');
  });

  it('decideChangeRequestAction validates input, the workspace and the approver', async () => {
    const input = { projectCode: 'HLT-026', number: 'CR-008', step: 'director', decision: 'ok' };
    expect(await decideChangeRequestAction({ ...input, step: 'board' })).toEqual({ ok: false, error: 'Invalid request' });
    expect(await decideChangeRequestAction({ ...input, decision: 'maybe' })).toEqual({ ok: false, error: 'Invalid request' });
    expect(await decideChangeRequestAction({ ...input, number: "CR-008'; --" })).toEqual({ ok: false, error: 'Invalid request' });
    session.outside = true;
    expect(await decideChangeRequestAction(input)).toEqual({ ok: false, error: 'Read-only — you cannot decide from this inbox' });
    session.outside = false;
    session.role = 'pm'; // the PM step of CR-008 is already approved; the director step is not his
    expect(await decideChangeRequestAction({ ...input, step: 'pm' })).toEqual({ ok: false, error: 'This decision is not waiting for you any more' });
    expect(await decideChangeRequestAction(input)).toEqual({ ok: false, error: 'This decision is not waiting for you any more' });
    session.role = 'client';
    expect(await decideChangeRequestAction(input)).toEqual({ ok: false, error: 'This decision is not waiting for you any more' });
    expect((await getChangeControl('HLT-026'))!.changeRequests.find((c) => c.id === 'CR-008')!.chain.map((s) => s.decision)).toEqual(['ok', 'pending', 'pending', 'pending']);
  });

  it('the director approves CR-008 inline, then the client rejects it: written through Change control with the viewer as actor', async () => {
    expect(await decideChangeRequestAction({ projectCode: 'HLT-026', number: 'CR-008', step: 'director', decision: 'ok' })).toEqual({ ok: true, status: 'In review' });
    expect((await listAudit({ limit: 1 }))[0]).toMatchObject({ who: 'Marie Lefebvre', object: 'CR-008', change: 'director: pending → ok', area: 'Change control' });
    expect(await decideChangeRequestAction({ projectCode: 'HLT-026', number: 'CR-008', step: 'director', decision: 'ok' })).toEqual({ ok: false, error: 'This decision is not waiting for you any more' });
    // The CCB step is now the director's row (Change control's recorder); nobody else may record it.
    expect(text(await render('director', 'en'))).toContain('Budget · Schedule · +€85k · -12 d · Change control board');
    session.role = 'pm';
    expect(await decideChangeRequestAction({ projectCode: 'HLT-026', number: 'CR-008', step: 'ccb', decision: 'ok' })).toEqual({ ok: false, error: 'This decision is not waiting for you any more' });
    session.role = 'client';
    expect(await decideChangeRequestAction({ projectCode: 'HLT-026', number: 'CR-008', step: 'client', decision: 'rejected' })).toEqual({ ok: true, status: 'Rejected' });
    const cr = (await getChangeControl('HLT-026'))!.changeRequests.find((c) => c.id === 'CR-008')!;
    expect([cr.status, ...cr.chain.map((s) => `${s.step}:${s.decision}:${s.decidedBy ?? ''}`)]).toEqual([
      'rejected', 'pm:ok:', 'director:ok:Marie Lefebvre', 'client:rejected:Nadia Bensaïd', 'ccb:pending:',
    ]);
    const txt = text(await render('director', 'en'));
    expect(txt).not.toContain('CR-008');
    expect(txt).toContain('Decided this week 2');
  });
});
