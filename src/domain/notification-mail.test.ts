// R-036 — the pure rules of the notification e-mails: families, modes and their form, the routing (immediate, digest, off; the
// client rule), the initial state of a recipient row, the digest key, and the French texts of the two e-mails.
import { describe, expect, it } from 'vitest';
import { DEMO_TODAY_ISO } from '@/domain/clock';
import { fieldsText } from '@/i18n/data-text';
import { makeT } from '@/i18n/translate';
import { NOTIFICATION_ICON, type NotificationKind } from '@/server/db/codes';
import {
  DEFAULT_NOTIFICATION_MODES, FAMILY_OF_KIND, digestMail, digestSendKey, formOfModes, initialMailState, isClientOnly, mailRoute, modesOfForm, normaliseModes, noticeMail,
} from './notification-mail';

const t = makeT('fr');
const tr = { t, fields: (s: string) => fieldsText(s, t, 'fr') };

describe('families and modes', () => {
  it('every notification kind has a family; what waits for an action is immediate by default, the rest goes to the digest', () => {
    expect(Object.keys(FAMILY_OF_KIND).sort()).toEqual(Object.keys(NOTIFICATION_ICON).sort());
    const kinds = Object.keys(FAMILY_OF_KIND) as NotificationKind[];
    expect(Object.fromEntries(kinds.map((k) => [k, mailRoute(k, DEFAULT_NOTIFICATION_MODES, false)]))).toEqual({
      approval: 'immediate', eco: 'immediate', request: 'immediate', task: 'immediate', mention: 'immediate',
      alert: 'digest', quality: 'digest', delivery: 'digest', invoice: 'digest', sync: 'digest',
    });
  });

  it('a client receives at once what the others get in the digest; "no e-mail" stays their choice', () => {
    expect(mailRoute('quality', DEFAULT_NOTIFICATION_MODES, true)).toBe('immediate');
    expect(mailRoute('approval', { ...DEFAULT_NOTIFICATION_MODES, approvals: 'off' }, true)).toBe('off');
    expect([isClientOnly(['client']), isClientOnly(['client', 'pm']), isClientOnly([])]).toEqual([true, false, false]);
  });

  it('the initial state: off before anything, then no transport, then the route', () => {
    const off = { ...DEFAULT_NOTIFICATION_MODES, tasks: 'off' as const };
    expect([
      initialMailState('task', off, false, 'file'), initialMailState('task', DEFAULT_NOTIFICATION_MODES, false, 'none'),
      initialMailState('task', DEFAULT_NOTIFICATION_MODES, false, 'file'), initialMailState('invoice', DEFAULT_NOTIFICATION_MODES, false, 'file'),
    ]).toEqual(['off', 'no_transport', 'immediate', 'digest']);
  });

  it('stored values and forms: completed family by family, an unknown mode refused', () => {
    expect(normaliseModes({ alerts: 'off', tasks: 'weekly' })).toEqual({ ...DEFAULT_NOTIFICATION_MODES, alerts: 'off' });
    expect(normaliseModes(null, { approvals: 'digest', tasks: 'digest', mentions: 'off', alerts: 'off' })).toEqual({ approvals: 'digest', tasks: 'digest', mentions: 'off', alerts: 'off' });
    expect(formOfModes(DEFAULT_NOTIFICATION_MODES)).toEqual({ notifApprovals: 'immediate', notifTasks: 'immediate', notifMentions: 'immediate', notifAlerts: 'digest' });
    expect(modesOfForm({ notifMentions: 'digest' })).toEqual({ ...DEFAULT_NOTIFICATION_MODES, mentions: 'digest' });
    expect(modesOfForm({ notifMentions: 'later' })).toBeNull();
  });

  it('one digest per person and business date', () => {
    expect(digestSendKey('p1', DEMO_TODAY_ISO)).toEqual({ personId: 'p1', itemKey: 'notification_digest', slot: 'daily', occurrence: DEMO_TODAY_ISO });
  });
});

describe('e-mail texts (French)', () => {
  const n = {
    title: 'Change request awaiting your decision · CR-008', sub: 'Second steel crew — schedule recovery · 25 Sep', projectCode: 'HLT-026', when: '25 Sep 09:12',
    link: 'https://keystone.epc2i.fr/projects/HLT-026/changes?cr=CR-008',
  };

  // The sub-line is shown as the bell shows it: a demo text has its French entry (dataText), a date is translated.
  it('immediate: the notice as the bell shows it, its project, the link, the footer', () => {
    const m = noticeMail('Romain Aubert', n, tr);
    expect(m.subject).toBe('Keystone — Demande de modification en attente de votre décision · CR-008 · HLT-026');
    expect(m.body.split('\n')).toEqual([
      'Bonjour Romain Aubert,', '', 'Demande de modification en attente de votre décision · CR-008', 'Seconde équipe charpente — rattrapage du planning · 25 sept.', 'Projet HLT-026', '',
      'Ouvrir dans Keystone: https://keystone.epc2i.fr/projects/HLT-026/changes?cr=CR-008', '', '—',
      'Message automatique de Keystone · modifiez vos e-mails de notification depuis la cloche des notifications › Notifications et rappels',
    ]);
  });

  it('digest: one line block per notice, the count in the subject', () => {
    const m = digestMail('Romain Aubert', [n, { ...n, title: 'Inspection failed · I-02', sub: 'Weld inspection', projectCode: null }], DEMO_TODAY_ISO, 'https://k/my', tr);
    expect(m.subject).toBe('Keystone — Résumé quotidien · 2 notifications');
    expect(m.body).toContain('- HLT-026 · Demande de modification en attente de votre décision · CR-008');
    expect(m.body).toContain('- Inspection non conforme · I-02\n  Weld inspection\n  25 sept. 09:12 · https://keystone.epc2i.fr/projects/HLT-026/changes?cr=CR-008');
    expect(m.body).toContain('Ouvrir Keystone: https://k/my');
  });
});
