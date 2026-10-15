// R-021 — real connector state: link of each connector, what the status column shows, when "Sync now" exists, what the
// last-sync and volume columns may show, and the KPI summary.
import { describe, expect, it } from 'vitest';
import { dataText } from '@/i18n/data-text';
import {
  CONNECTOR_STATE_LABEL, connectorCanSync, connectorLink, connectorScopeText, connectorState, connectorStateNeedsAttention, connectorStateTone, connectorsSummary,
  isRetiredConnector, isSimulatedSync, showsLastSync, showsVolume,
} from './connectors';

describe('connector link', () => {
  it('Vigie and Cursus: live with their API URL (http), mock without', () => {
    expect(connectorLink({ name: 'Vigie', kind: 'vigie', mode: 'http' })).toBe('live');
    expect(connectorLink({ name: 'Vigie', kind: 'vigie', mode: 'mock' })).toBe('mock');
    expect(connectorLink({ name: 'Cursus', kind: 'cursus', mode: 'http' })).toBe('live');
    expect(connectorLink({ name: 'Cursus', kind: 'cursus', mode: null })).toBe('mock');
  });

  it('Codex is a mock, MS Project exchanges files, every other recorded connector does not exist', () => {
    expect(connectorLink({ name: 'Codex', kind: 'static', mode: null })).toBe('mock');
    // Delivery 8 (R-033): Codex is live once CODEX_API_URL is set (outbox delivered, index read), a mock otherwise.
    expect(connectorLink({ name: 'Codex', kind: 'static', mode: 'mock' })).toBe('mock');
    expect(connectorLink({ name: 'Codex', kind: 'static', mode: 'http' })).toBe('live');
    expect(connectorState(connectorLink({ name: 'Codex', kind: 'static', mode: 'http' }), 'ok', true)).toBe('ok');
    expect(connectorCanSync('live', true)).toBe(true);
    expect([showsLastSync('live'), isSimulatedSync('live')]).toEqual([true, false]);
    expect(connectorLink({ name: 'MS Project', kind: 'static', mode: null })).toBe('file');
    for (const name of ['Sage X3', 'SolidWorks PDM', 'Outlook / Exchange', 'Microsoft Teams', 'E-mail (SMTP)', 'SharePoint', 'Lucca']) {
      expect(connectorLink({ name, kind: 'static', mode: null }), name).toBe('none');
    }
  });

  it('Lucca is retired (NEW-CURSUS-4)', () => {
    expect([isRetiredConnector('Lucca'), isRetiredConnector('Cursus')]).toEqual([true, false]);
  });
});

describe('what the row shows', () => {
  it('status: the live status, Mock, Not connected, Ready for a file exchange, Disabled when IT switched it off', () => {
    expect(connectorState('live', 'warning', true)).toBe('warning');
    expect(connectorState('live', 'ok', true)).toBe('ok');
    expect(connectorState('mock', 'ok', true)).toBe('mock');
    expect(connectorState('mock', 'warning', true)).toBe('mock');
    expect(connectorState('none', 'warning', true)).toBe('not_connected');
    expect(connectorState('file', 'ok', true)).toBe('ready');
    expect(connectorState('live', 'ok', false)).toBe('disabled');
    expect(connectorState('none', 'ok', false)).toBe('disabled');
    expect(CONNECTOR_STATE_LABEL).toEqual({ ok: 'OK', warning: 'Warning', error: 'Error', ready: 'Ready', mock: 'Mock', not_connected: 'Not connected', disabled: 'Disabled' });
  });

  it('tones (mono-accent) and attention: only a failing live connector', () => {
    expect((['ok', 'warning', 'error', 'ready', 'mock', 'not_connected', 'disabled'] as const).map(connectorStateTone))
      .toEqual(['neutral', 'accent', 'accent', 'outline', 'outline', 'outline', 'neutral']);
    expect((['ok', 'warning', 'error', 'ready', 'mock', 'not_connected', 'disabled'] as const).map(connectorStateNeedsAttention))
      .toEqual([false, true, true, false, false, false, false]);
  });

  it('"Sync now": live (real) and mock (simulated) connectors not disabled; never a missing one or a file exchange', () => {
    expect([connectorCanSync('live', true), connectorCanSync('mock', true), connectorCanSync('file', true), connectorCanSync('none', true)]).toEqual([true, true, false, false]);
    expect([connectorCanSync('live', false), connectorCanSync('mock', false)]).toEqual([false, false]);
    expect([isSimulatedSync('mock'), isSimulatedSync('live')]).toEqual([true, false]);
  });

  it('last sync only for a real exchange; no volume for a connector that does not exist', () => {
    expect((['live', 'mock', 'file', 'none'] as const).map(showsLastSync)).toEqual([true, false, true, false]);
    expect((['live', 'mock', 'file', 'none'] as const).map(showsVolume)).toEqual([true, true, true, false]);
  });

  it('KPI summary: connected (live, file), mock, not connected (incl. disabled), warning', () => {
    expect(connectorsSummary([
      { link: 'live', state: 'ok' }, { link: 'live', state: 'warning' }, { link: 'file', state: 'ready' }, { link: 'mock', state: 'mock' },
      { link: 'none', state: 'not_connected' }, { link: 'mock', state: 'disabled' },
    ])).toEqual({ connected: 3, mock: 1, notConnected: 2, warning: 1 });
    expect(connectorsSummary([])).toEqual({ connected: 0, mock: 0, notConnected: 0, warning: 0 });
  });
});

describe('data scope shown (requalified seeded texts)', () => {
  const CURSUS_SEEDED = 'Individual go / no go: visa approval, vaccination confirmation, clearances & badges — approvals only, no personal data imported';
  const CURSUS_SCOPE = 'Individual go / no go (visa, vaccination, clearances & badges) · approved leave and absences · staff directory: name, e-mail, matricule, team (R-027, R-031)';

  it('Cursus: the prototype’s "no personal data imported" becomes what the connector receives since delivery 8 (R-027, R-031)', () => {
    expect(connectorScopeText('Cursus', CURSUS_SEEDED)).toBe(CURSUS_SCOPE);
    expect(dataText(connectorScopeText('Cursus', CURSUS_SEEDED), 'fr')).toBe(
      'Go / no go individuel (visa, vaccinations, habilitations & badges) · congés et absences approuvés · annuaire du personnel : nom, e-mail, matricule, équipe (R-027, R-031)',
    );
  });

  it('a scope IT set in the connectors file (R-020) is shown as set; other rows as stored', () => {
    expect(connectorScopeText('Cursus', 'Go / no go and absences')).toBe('Go / no go and absences');
    expect(connectorScopeText('Sage X3', CURSUS_SEEDED)).toBe(CURSUS_SEEDED);
    expect(connectorScopeText('Outlook / Exchange', 'Calendar sync for milestones and approvals')).toBe('Meetings carrying the project code, Outlook / Teams → Keystone (S-11)');
  });
});
