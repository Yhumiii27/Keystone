// Drawings — PDM vault: the read-side rules of the register (docs/spec/09 §5; prototype `dwgRows` / `dwgChips` /
// `dwgKpis` / `dwgVals`, logic 4371–4380). The vault is a read-only mirror of SolidWorks PDM: revisions and states
// change in the vault, Keystone lists them, filters them and opens the linked part and ECO. No I/O, no translation:
// labels are the prototype's English source strings. Golden values: src/domain/drawings.test.ts.
import { DRAWING_STATE_TAG, drawingState, relativeDayText, type DrawingState } from '@/server/db/codes';
import { DEFAULT_DATA_DATE } from './ch4-defaults';
import { parisDateOf } from './kpis';

export type { DrawingState };

/** Chip order of the State filter (dwgChips): Released, WIP, Under review, Obsolete. */
export const DRAWING_STATE_ORDER: readonly DrawingState[] = ['released', 'wip', 'under_review', 'obsolete'];

export const drawingStateTag = (s: DrawingState) => `tag ${DRAWING_STATE_TAG[s]}`;

/** `?state=` value → state code (unknown → null = All). */
export const drawingFilterOf = (v: unknown): DrawingState | null => (drawingState.isCode(v) ? v : null);

/** Fields the register filters on. */
export interface DrawingLike {
  number: string;
  title: string;
  partRef: string | null;
  state: DrawingState;
}

/** Rows matching the state chip and the search (number + title + part, case-insensitive), register order. */
export function filterDrawings<D extends DrawingLike>(rows: D[], state: DrawingState | null, q: string): D[] {
  const needle = q.trim().toLowerCase();
  return rows.filter((d) => (!state || d.state === state) && (!needle || `${d.number} ${d.title} ${d.partRef ?? ''}`.toLowerCase().includes(needle)));
}

export interface DrawingChip {
  value: DrawingState | null;
  label: string;
  count: number;
}

/** All + the four states with their counts (whole register, not the search). */
export function drawingChips(rows: Pick<DrawingLike, 'state'>[]): DrawingChip[] {
  return [{ value: null, label: 'All', count: rows.length }, ...DRAWING_STATE_ORDER.map((s) => ({ value: s, label: drawingState.label(s), count: rows.filter((d) => d.state === s).length }))];
}

/** Drawing count of the whole vault, grouped by thin spaces as the prototype prints it ("1 248", both languages). */
export const vaultCountText = (n: number) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

export interface DrawingKpi {
  label: string;
  value: string;
  sub: string;
  lo: boolean;
}

/**
 * Day of the last vault sync against the data date (A-12; the prototype always said "today"): "today", "yesterday", else
 * the run's date ("26 Sep" — the seeded PDM connector run is dated the day after the data date). EN source; t() translates.
 */
export const vaultSyncDayText = (syncedAt: string, asOf: string = DEFAULT_DATA_DATE) => relativeDayText(parisDateOf(syncedAt), asOf);

/**
 * Sub-line of "Obsolete still referenced" (R-169; the prototype printed the constant "Superseded by rev 2"): the ECOs
 * that made the referenced drawings obsolete ("Superseded · ECO-2026-012"), "Superseded revision" when none is known,
 * "Nothing to withdraw" when no obsolete drawing is referenced.
 */
export function obsoleteSub(rows: readonly (Pick<DrawingLike, 'state'> & { ecoNumber?: string | null })[]): string {
  const obsolete = rows.filter((d) => d.state === 'obsolete');
  if (!obsolete.length) return 'Nothing to withdraw';
  const ecos = [...new Set(obsolete.map((d) => d.ecoNumber).filter((e): e is string => !!e))];
  return ecos.length ? `Superseded · ${ecos.join(', ')}` : 'Superseded revision';
}

/**
 * The five tiles (dwgKpis). The vault size and the last sync come from the PDM sync record (the prototype's
 * literals "1 248" and "07:40"); the rest counts the register. The sync's day is computed from its instant (`syncedAt`)
 * against the portfolio data date `asOf`.
 */
export function drawingKpis(
  rows: (Pick<DrawingLike, 'state'> & { ecoNumber?: string | null })[],
  sync: { drawingsInVault: number; linkedDrawings: number; time: string; syncedAt?: string } | null,
  asOf: string = DEFAULT_DATA_DATE,
): DrawingKpi[] {
  const n = (s: DrawingState) => rows.filter((d) => d.state === s).length;
  return [
    { label: 'Drawings in vault', value: sync ? vaultCountText(sync.drawingsInVault) : '—', sub: `${sync?.linkedDrawings ?? rows.length} linked to catalogue parts`, lo: false },
    { label: 'Released', value: String(n('released')), sub: 'Current revision', lo: false },
    { label: 'WIP / under review', value: String(n('wip') + n('under_review')), sub: 'Linked to open ECOs', lo: false },
    { label: 'Obsolete still referenced', value: String(n('obsolete')), sub: obsoleteSub(rows), lo: true },
    {
      label: 'Last vault sync',
      value: sync?.time ?? '—',
      sub: sync?.syncedAt ? `SolidWorks PDM · ${vaultSyncDayText(sync.syncedAt, asOf)} · read-only` : 'SolidWorks PDM · read-only',
      lo: false,
    },
  ];
}

export interface RevisionLike {
  revision: string;
  isCurrent: boolean;
  /** Display date of the check-in ("12 Sep"); null when unknown. */
  dateText: string | null;
  ecoNumber: string | null;
}

/** Revision history rows (dwgVals.hist): newest first, "Current · 12 Sep" + its ECO, then "Superseded" / "—". */
export function revisionHistory(revs: RevisionLike[]): { rev: string; label: string; eco: string }[] {
  return revs.map((r, i) => {
    const first = i === 0;
    return { rev: r.revision, label: first ? `Current · ${r.dateText ?? '—'}` : 'Superseded', eco: first ? r.ecoNumber ?? '—' : '—' };
  });
}
