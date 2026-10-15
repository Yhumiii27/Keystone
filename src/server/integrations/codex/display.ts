// Codex index texts of the Documents screen (R-021). Pure module, safe in client components. While the Codex connector is
// the mock (./config.ts `codexConnectorMode`), the banner and the "Sync now" toast say so instead of a sync time and an
// "index up to date" that no exchange with Codex backs: "Mock index · 412 records", "Codex · simulated sync (mock
// connector) · 412 records". The live texts are the prototype's ("Last sync 08:02 · 412 records").
// Delivery 8 (R-033): with the HTTP connector (CODEX_API_URL) the banner shows the last read of Codex's index, and the
// "Sync now" toast reports what was sent, what waits and what was refreshed — "index up to date" only when the index was
// really read.
import type { Lang, T } from '@/i18n/translate';
import type { CodexConnectorMode } from './config';

const records = (n: number, lang: Lang) => (lang === 'fr' ? `${n} ${n > 1 ? 'fiches' : 'fiche'}` : `${n} ${n === 1 ? 'record' : 'records'}`);

/** Banner line of the index: its record count, with the time of the last read once Codex is really connected. */
export function codexIndexLineT(sync: { time: string; records: number }, mode: CodexConnectorMode | 'live', t: T, lang: Lang): string {
  if (mode === 'live' || mode === 'http') return t(`Last sync ${sync.time} · ${sync.records} records`);
  return `${lang === 'fr' ? 'Index simulé' : 'Mock index'} · ${records(sync.records, lang)}`;
}

/** What a "Sync now" did: the outbox exchange (HTTP) and whether Codex's index was read. */
export interface CodexSyncRun {
  records: number;
  /** Codex's index was read (HTTP connector); the mock never reads it. */
  indexRead: boolean;
  delivered?: number;
  pending?: number;
  refreshed?: number;
}

const outboxText = (r: CodexSyncRun, lang: Lang) => {
  const [d, p, f] = [r.delivered ?? 0, r.pending ?? 0, r.refreshed ?? 0];
  return lang === 'fr'
    ? `${d} ${d > 1 ? 'envoyés' : 'envoyé'} · ${p} en attente · ${f} ${f > 1 ? 'actualisés' : 'actualisé'}`
    : `${d} sent · ${p} pending · ${f} refreshed`;
};

/** "Sync now" toast of the Documents screen. */
export function codexSyncToastT(run: CodexSyncRun | number, mode: CodexConnectorMode | 'live', t: T, lang: Lang): string {
  const r: CodexSyncRun = typeof run === 'number' ? { records: run, indexRead: mode === 'live' } : run;
  if (mode === 'live') return t(`Codex sync · index up to date · ${r.records} records`);
  if (mode === 'http') {
    // R-033: never "index up to date" unless the index was read.
    if (r.indexRead) return `${t(`Codex sync · index up to date · ${r.records} records`)} · ${outboxText(r, lang)}`;
    return lang === 'fr' ? `Synchro Codex · index non lu · ${outboxText(r, lang)}` : `Codex sync · index not read · ${outboxText(r, lang)}`;
  }
  return lang === 'fr' ? `Codex · synchro simulée (connecteur simulé) · ${records(r.records, lang)}` : `Codex · simulated sync (mock connector) · ${records(r.records, lang)}`;
}
