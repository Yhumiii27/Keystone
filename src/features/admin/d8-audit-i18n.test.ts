// Delivery 8, R-184 (NEW-D1-2, X-12b, R-148) and R-157 item 2: Admin › Activity, integrations & audit in French — the feed
// and the trail from their message key, else from the stored English without the segment translator (typed values as
// typed), the connector texts Keystone writes in French; the same in the Activity & integrations export.
import { createElement as h, type ReactElement } from 'react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }), usePathname: () => '/admin/integrations', useSearchParams: () => new URLSearchParams() }));

import { renderToStaticMarkup } from 'react-dom/server';
import { PERSONA_BY_ROLE } from '@/config/personas';
import { systemMessage } from '@/domain/system-messages';
import { I18nProvider } from '@/i18n/client';
import { makeT, type Lang } from '@/i18n/translate';
import { getDb, setDb } from '@/server/db/client';
import { recordActivity, writeAudit } from '@/server/db/helpers';
import { openDatabase } from '@/server/db/open';
import { listAdminConnectors } from '@/server/dal/admin-connectors';
import { getPlumbingCounts, listImportFormats } from '@/server/dal/integrations';
import { listActivity, listAudit } from '@/server/dal/notifications';
import { recordActiveRole } from '@/server/dal/users';
import { buildExportContext, runExport } from '@/server/export/run';
import { readXlsx } from '@/server/export/xlsx';
import '@/server/export/providers';
import { activityWhatT, auditChangeT, auditObjectT } from './i18n';
import { plumbingView } from './model';
import { PlumbingBody } from './plumbing-view';

const fr = makeT('fr');
const en = makeT('en');
const html = (el: ReactElement, lang: Lang) => renderToStaticMarkup(h(I18nProvider, { lang, children: el }));
const text = (markup: string) => markup.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#x27;/g, '’').replace(/&quot;/g, '"').replace(/\s+/g, ' ');

describe('display helpers (no database)', () => {
  it('activity feed: key, exact demo entry, connector texts, else as typed', () => {
    expect(activityWhatT({ what: 'Vigie sync (simulated) · 2 sent · 0 pending · 1 refreshed' }, fr, 'fr')).toBe('Synchro Vigie (simulée) · 2 envoyés · 0 en attente · 1 actualisé');
    expect(activityWhatT({ what: 'Cursus sync · 3 approvals received' }, fr, 'fr')).toBe('Synchro Cursus · 3 approbations reçues');
    expect(activityWhatT({ what: 'Codex sync (simulated) · failed' }, fr, 'fr')).toBe('Synchro Codex (simulée) en échec');
    expect(activityWhatT({ what: 'Sage X3 sync' }, fr, 'fr')).toBe('Synchro Sage X3');
    expect(activityWhatT({ what: 'Connector Mon ERP added by IT · not connected yet' }, fr, 'fr')).toBe('Connecteur Mon ERP ajouté par l’IT · pas encore connecté');
    expect(activityWhatT({ what: 'Submitted CR-008 for review · +85 k€ · −12 d' }, fr, 'fr')).toBe('CR-008 soumise en revue · +85 k€ · −12 j');
    // Typed text is never segment-translated ("Mon équipe" → "lun. équipe", "Sun Valley Farm" → "dim. Valley Farm").
    expect(activityWhatT({ what: 'Daily report DR-009 saved · Mon équipe at Sun Valley Farm' }, fr, 'fr')).toBe('Daily report DR-009 saved · Mon équipe at Sun Valley Farm');
    expect(activityWhatT({ what: 'x', messageKey: 'audit.status', messageParams: { from: 'Draft', to: 'Open' } }, fr, 'fr')).toBe('statut : Brouillon → Ouverte');
    expect(activityWhatT({ what: 'Vigie sync · 1 sent · 0 pending · 0 refreshed' }, en, 'en')).toBe('Vigie sync · 1 sent · 0 pending · 0 refreshed');
  });

  it('audit change: key, generic shapes (labels translated, typed values as typed), connector runs', () => {
    expect(auditChangeT({ change: 'status: Draft → Awaiting approval' }, fr, 'fr')).toBe('statut : Brouillon → En attente d’approbation');
    expect(auditChangeT({ change: 'status: Submitted → Accepted (PV) · Mon équipe' }, fr, 'fr')).toBe('statut : Soumis → Accepté (PV) · Mon équipe');
    expect(auditChangeT({ change: 'frequency: Every hour → Mon planning · disabled' }, fr, 'fr')).toBe('fréquence : Every hour → Mon planning · désactivé');
    expect(auditChangeT({ change: 'added · disabled' }, fr, 'fr')).toBe('ajouté · désactivé');
    expect(auditChangeT({ change: 'sync (simulated) · 412 records · 38 linked to HLT-026' }, fr, 'fr')).toBe('synchro (simulée) · 412 fiches · 38 liées à HLT-026');
    expect(auditChangeT({ change: 'sync failed · Vigie unreachable: Mon serveur' }, fr, 'fr')).toBe('synchro en échec · Vigie unreachable: Mon serveur');
    expect(auditChangeT({ change: 'QC: 2 drums rejected → quarantine' }, fr, 'fr')).toBe('Contrôle qualité : 2 tourets refusés → quarantaine');
    expect(auditChangeT({ change: 'x', messageKey: 'signin.signedOut', messageParams: {} }, fr, 'fr')).toBe('Déconnexion');
    // An unknown key or bad parameters: the stored text.
    expect(auditChangeT({ change: 'status: Draft → Open', messageKey: 'nope', messageParams: {} }, fr, 'fr')).toBe('statut : Brouillon → Ouverte');
    expect(auditChangeT({ change: 'status: Draft → Open' }, en, 'en')).toBe('status: Draft → Open');
  });

  it('audit object: the Keystone noun translated, the reference or typed name as is', () => {
    expect(auditObjectT('Request RQ-014', fr, 'fr')).toBe('Demande RQ-014');
    expect(auditObjectT('Prerequisite · Mon permis de levage', fr, 'fr')).toBe('Prérequis · Mon permis de levage');
    expect(auditObjectT('Connector Sage X3', fr, 'fr')).toBe('Connecteur Sage X3');
    expect(auditObjectT('Rate card', fr, 'fr')).toBe('Grille de taux');
    expect(auditObjectT('CR-008', fr, 'fr')).toBe('CR-008');
    expect(auditObjectT('Request RQ-014', en, 'en')).toBe('Request RQ-014');
  });
});

describe('Admin › Activity & audit and its export in French (R-184)', () => {
  beforeAll(async () => {
    setDb(await openDatabase());
    const db = await getDb();
    const pm = PERSONA_BY_ROLE.pm;
    const [{ id }] = (await db.execute<{ id: string }>(`select id from users where role = 'pm'`)).rows as { id: string }[];
    await recordActiveRole(id, 'pm', 'director');
    await recordActivity(db, { actorName: 'Marie Lefebvre', text: 'Vigie sync (simulated) · 2 sent · 0 pending · 1 refreshed', kind: 'sync', occurredAt: new Date('2026-09-27T15:00:00Z') });
    await recordActivity(db, { actorName: pm.name, text: 'Daily report DR-009 saved · Mon équipe at Sun Valley Farm', kind: 'comment', occurredAt: new Date('2026-09-27T15:01:00Z') });
    await recordActivity(db, { actorName: pm.name, message: systemMessage('audit.status', { from: 'Draft', to: 'In review' }), kind: 'change', occurredAt: new Date('2026-09-27T15:02:00Z') });
    await writeAudit(db, { actorName: 'IT · configuration file', objectRef: 'Connector Vigie', change: 'frequency: Every minute → Mon rythme', area: 'Integrations', occurredAt: new Date('2026-09-27T15:03:00Z') });
  }, 60_000);

  async function view(lang: Lang, v: 'activity' | 'audit') {
    const t = makeT(lang);
    const [activity, connectors, imports, audit, counts] = await Promise.all([listActivity(), listAdminConnectors(), listImportFormats(), listAudit(), getPlumbingCounts()]);
    return { t, model: plumbingView({ view: v, source: null, activity, connectors, imports, audit, counts, unread: 0, personaTitle: 'Portfolio director' }, t, lang) };
  }

  it('the feed and the trail read in French, typed values as typed; English unchanged', async () => {
    const { t, model } = await view('fr', 'activity');
    const whats = model.activity.map((a) => a.what);
    expect(whats.slice(0, 3)).toEqual(['statut : Brouillon → En revue', 'Daily report DR-009 saved · Mon équipe at Sun Valley Farm', 'Synchro Vigie (simulée) · 2 envoyés · 0 en attente · 1 actualisé']);
    // The 12 seeded events read in French (exact entries).
    expect(whats).toContain('312 h importées pour S39 · 3 anomalies signalées (heures supplémentaires sans approbation)');
    expect(whats).toContain('Livrable D-015 Plans de récolement des fondations accepté (PV signé)');
    const out = text(html(h(PlumbingBody, { view: model, canEdit: true, t }), 'fr'));
    expect(out).toContain('Daily report DR-009 saved · Mon équipe at Sun Valley Farm');
    expect(out).not.toMatch(/lun\. équipe|dim\. Valley/);

    const audit = (await view('fr', 'audit')).model.audit;
    expect(audit.find((a) => a.object === 'Connecteur Vigie')).toMatchObject({ change: 'fréquence : Every minute → Mon rythme', area: 'Intégrations' });
    expect(audit.find((a) => a.object === fr('Sign-in'))).toMatchObject({ change: `Rôle actif · ${fr('Project manager')} → ${fr('Portfolio director')}` });
    expect(audit.find((a) => a.object === 'CR-008')?.change).toBe('statut : Brouillon → En revue');

    const enAudit = (await view('en', 'audit')).model.audit;
    expect(enAudit.find((a) => a.object === 'Sign-in')).toMatchObject({ change: 'Active role · Project manager → Portfolio director' });
    expect((await view('en', 'activity')).model.activity[0].what).toBe('status: Draft → In review');
  });

  it('the Activity & integrations export renders the same texts', async () => {
    const ctx = await buildExportContext({ screen: 'plumbing', viewer: PERSONA_BY_ROLE.director, lang: 'fr', params: new URLSearchParams(), now: new Date('2026-10-09T08:00:00Z') });
    const sheets = await readXlsx((await runExport(ctx, 'xlsx')).body);
    const feed = sheets.find((s) => s.name === fr('Activity feed'))!;
    const trail = sheets.find((s) => s.name === fr('Audit trail'))!;
    const col = (s: typeof feed, header: string) => s.rows.slice(1).map((r) => r[s.rows[0].indexOf(fr(header))]);
    expect(col(feed, 'What')).toContain('Synchro Vigie (simulée) · 2 envoyés · 0 en attente · 1 actualisé');
    expect(col(feed, 'What')).toContain('Daily report DR-009 saved · Mon équipe at Sun Valley Farm');
    expect(col(trail, 'Change')).toContain(`Rôle actif · ${fr('Project manager')} → ${fr('Portfolio director')}`);
    expect(col(trail, 'Change')).toContain('statut : Brouillon → En revue');
    expect(col(trail, 'Object')).toContain('Demande RQ-014');
    // The export keeps the prototype's columns (the ISO CSV alone has the user, reason and before / after).
    expect(trail.rows[0]).toEqual(['Date', 'Who', 'Object', 'Change', 'Area', 'Project'].map((x) => fr(x)));
  });
});
