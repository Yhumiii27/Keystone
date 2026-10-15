// R-184 (NEW-D1-2, X-12b, R-148): system messages — the English templates stay byte-identical to what readers match, the
// French renders from typed parameters (data as typed, labels translated, dates with Intl), stored rows are checked.
import { describe, expect, it } from 'vitest';
import { makeT } from '@/i18n/translate';
import { isSystemActor, parseChange } from './audit-trail';
import { isMessageKey, messageFormat, messageText, renderMessage, systemMessage } from './system-messages';

const fr = makeT('fr');
const en = makeT('en');

describe('system messages (R-184)', () => {
  it('the English templates keep the texts kpis.ts and quality.ts query', () => {
    // kpis.ts: eq(change, 'status: Draft → Open') or like(change, 'RFQ sent to %').
    expect(messageText(systemMessage('audit.status', { from: 'Draft', to: 'Open' }))).toBe('status: Draft → Open');
    const rfq = messageText(systemMessage('rfq.sent', { suppliers: ['Dillinger', 'Salzgitter'], replyDue: '2026-10-15', incoterm: 'FCA — Free carrier' }));
    expect(rfq).toBe('RFQ sent to Dillinger, Salzgitter · reply 2026-10-15 · FCA — Free carrier');
    expect(rfq.startsWith('RFQ sent to ')).toBe(true);
    // quality.ts: change.startsWith('status: Submitted → ').
    expect(messageText(systemMessage('audit.status', { from: 'Submitted', to: 'Accepted (PV)' })).startsWith('status: Submitted → ')).toBe(true);
    // users.ts sign-in rows, as the Entra tests read them.
    expect(messageText(systemMessage('signin.signedIn', { roles: ['Portfolio director', 'Project manager'] }))).toBe('Signed in · Portfolio director / Project manager');
    expect(messageText(systemMessage('signin.refused', { reason: 'Unknown e-mail' }))).toBe('Sign-in refused · Unknown e-mail');
    expect(messageText(systemMessage('signin.signedOut', {}))).toBe('Signed out');
    expect(messageText(systemMessage('signin.activeRole', { from: 'Project manager', to: 'Portfolio director' }))).toBe('Active role · Project manager → Portfolio director');
  });

  it('French: labels translated, typed data as typed (or its exact demo entry), dates with Intl', () => {
    expect(renderMessage('audit.status', { from: 'Draft', to: 'In review' }, fr, 'fr')).toBe('statut : Brouillon → En revue');
    expect(renderMessage('signin.signedIn', { roles: ['Portfolio director', 'Project manager'] }, fr, 'fr')).toBe(`Connexion · ${fr('Portfolio director')} / ${fr('Project manager')}`);
    expect(renderMessage('signin.signedOut', {}, fr, 'fr')).toBe('Déconnexion');
    // A supplier typed "Mon Atelier" is never turned into "lun. Atelier" (R-148).
    expect(renderMessage('rfq.sent', { suppliers: ['Mon Atelier'], replyDue: '2026-10-15', incoterm: 'FCA' }, fr, 'fr')).toBe('RFQ envoyée à Mon Atelier · réponse le 15 oct. 2026 · FCA');
    // English renders the stored text.
    expect(renderMessage('audit.status', { from: 'Draft', to: 'In review' }, en, 'en')).toBe('status: Draft → In review');
  });

  it('a stored row is data: unknown keys and parameters that do not match the template render nothing (the text is shown)', () => {
    expect(renderMessage(null, {}, fr, 'fr')).toBeNull();
    expect(renderMessage('nope', {}, fr, 'fr')).toBeNull();
    expect(renderMessage('toString', {}, fr, 'fr')).toBeNull();
    expect(renderMessage('audit.status', { from: 'Draft' }, fr, 'fr')).toBeNull();
    expect(renderMessage('audit.status', { from: 'Draft', to: 3 }, fr, 'fr')).toBeNull();
    expect(renderMessage('audit.status', ['Draft', 'Open'], fr, 'fr')).toBeNull();
    expect(renderMessage('rfq.sent', { suppliers: 'Dillinger', replyDue: '2026-10-15', incoterm: 'FCA' }, fr, 'fr')).toBeNull();
    expect(renderMessage('rfq.sent', { suppliers: ['Dillinger'], replyDue: '15/10/2026', incoterm: 'FCA' }, fr, 'fr')).toBeNull();
    expect([isMessageKey('audit.status'), isMessageKey('__proto__'), isMessageKey(42)]).toEqual([true, false, false]);
    expect(() => messageText({ key: 'audit.status', params: { from: 'Draft' } })).toThrow();
  });

  it('French formats: counts, plurals (singular for 0 and 1), dates', () => {
    const f = messageFormat(fr, 'fr');
    expect([f.count(1234), f.plural(0, 'machine', 'machines'), f.plural(1, 'machine', 'machines'), f.plural(2, 'machine', 'machines'), f.date('2027-01-14')])
      .toEqual(['1\u202f234', '0 machine', '1 machine', '2 machines', '14 janv. 2027']);
    expect(messageFormat(en, 'en').date('2027-01-14')).toBe('14 Jan 2027');
  });
});

describe('audit trail rules (R-168, R-184)', () => {
  it('system actors have no user account', () => {
    for (const s of ['System', 'Lucca', 'Codex', 'Cursus', 'Vigie', 'Sage X3', 'Keystone', 'IT · configuration file', 'codex', '', null]) expect([s, isSystemActor(s)]).toEqual([s, true]);
    for (const p of ['Romain Aubert', 'R. Aubert', 'Accounts payable']) expect([p, isSystemActor(p)]).toEqual([p, false]);
  });

  it('change texts in their generic shapes', () => {
    expect(parseChange('status: Draft → In review')).toEqual([{ kind: 'status', from: 'Draft', to: 'In review' }]);
    expect(parseChange('created · status: Draft')).toEqual([{ kind: 'word', word: 'created' }, { kind: 'text', text: 'status: Draft' }]);
    expect(parseChange('frequency: Every hour → Daily · enabled')).toEqual([{ kind: 'field', field: 'frequency', from: 'Every hour', to: 'Daily' }, { kind: 'word', word: 'enabled' }]);
    expect(parseChange('Structural engineer base: 82 → 85 €/h')).toEqual([{ kind: 'text', text: 'Structural engineer base: 82 → 85 €/h' }]);
    expect(parseChange('status: Submitted → Accepted (PV) · Mon équipe')).toEqual([{ kind: 'status', from: 'Submitted', to: 'Accepted (PV)' }, { kind: 'text', text: 'Mon équipe' }]);
  });
});
