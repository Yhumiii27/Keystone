// R-021 — real connector state: link of each connector, what the status column shows, when "Sync now" exists, what the
// last-sync and volume columns may show, and the KPI summary.
import { describe, expect, it } from 'vitest';
import {
  CONNECTOR_STATE_LABEL, connectorCanSync, connectorLink, connectorState, connectorStateNeedsAttention, connectorStateTone, connectorsSummary, isRetiredConnector,
  isSimulatedSync, showsLastSync, showsVolume,
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
