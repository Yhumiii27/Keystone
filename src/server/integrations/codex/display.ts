// Codex index texts of the Documents screen (R-021). Pure module, safe in client components. While the Codex connector is
// the mock (./config.ts `codexConnectorMode`), the banner and the "Sync now" toast say so instead of a sync time and an
// "index up to date" that no exchange with Codex backs: "Mock index · 412 records", "Codex · simulated sync (mock
// connector) · 412 records". The live texts are the prototype's ("Last sync 08:02 · 412 records").
import type { Lang, T } from '@/i18n/translate';
import type { CodexConnectorMode } from './config';

const records = (n: number, lang: Lang) => (lang === 'fr' ? `${n} ${n > 1 ? 'fiches' : 'fiche'}` : `${n} ${n === 1 ? 'record' : 'records'}`);

/** Banner line of the index: its record count, with the time of the last sync once Codex is really connected. */
export function codexIndexLineT(sync: { time: string; records: number }, mode: CodexConnectorMode | 'live', t: T, lang: Lang): string {
  if (mode === 'live') return t(`Last sync ${sync.time} · ${sync.records} records`);
  return `${lang === 'fr' ? 'Index simulé' : 'Mock index'} · ${records(sync.records, lang)}`;
}

/** "Sync now" toast of the Documents screen. */
export function codexSyncToastT(count: number, mode: CodexConnectorMode | 'live', t: T, lang: Lang): string {
  // A real exchange with Codex (HTTP connector, CODEX_API_URL): the index is up to date; the mock says it simulates (R-021).
  if (mode === 'live' || mode === 'http') return t(`Codex sync · index up to date · ${count} records`);
  return lang === 'fr' ? `Codex · synchro simulée (connecteur simulé) · ${records(count, lang)}` : `Codex · simulated sync (mock connector) · ${records(count, lang)}`;
}
