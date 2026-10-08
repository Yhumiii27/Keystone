// View models of the Drawings — PDM vault screen (docs/spec/09 §5, template 1377–1419, logic 4371–4380): KPI tiles,
// State chips, the register rows (search) and the drawing drawer, translated for the viewer. The vault is a read-only
// mirror of SolidWorks PDM (src/server/dal/drawings.ts); the derivations are src/domain/drawings.ts. Pure (no I/O).
import { LO, OK } from '@/components/app/tones';
import { drawingChips, drawingKpis, drawingStateTag, filterDrawings, revisionHistory, type DrawingState } from '@/domain/drawings';
import type { T } from '@/i18n/translate';
import { fmtDOfIso } from '@/server/db/codes';
import type { DrawingDetail, DrawingRow, VaultSyncState } from '@/server/dal/drawings';
import { drawingsHref, ecoScreenHref, partRecordHref } from '../links';

export interface DrawingsState {
  state: DrawingState | null;
  q: string;
  dwg: string | null;
}

export interface DrawingRowView {
  number: string;
  /** Row click: opens the drawer, or closes it when this drawing is open. */
  href: string;
  selected: boolean;
  title: string;
  path: string;
  part: string;
  partName: string;
  rev: string;
  state: string;
  stateClass: string;
  /** "Antoine Girard · 12 Sep". */
  byLine: string;
  /** ECO number or "—". */
  eco: string;
}

export interface DrawingsView {
  kpis: { label: string; value: string; sub: string; color: string }[];
  chips: { value: string; label: string; count: number; href: string }[];
  filter: string;
  q: string;
  rows: DrawingRowView[];
  empty: string | null;
}

const dateText = (iso: string | null, t: T) => (iso ? t(fmtDOfIso(iso)) : '—');

/** Register view: KPI tiles, State chips (links keeping the search), rows matching chip and search. */
export function drawingsView(input: { drawings: DrawingRow[]; sync: VaultSyncState | null; state: DrawingsState }, t: T): DrawingsView {
  const { drawings, sync, state } = input;
  const rows = filterDrawings(drawings, state.state, state.q).map((d): DrawingRowView => {
    const selected = state.dwg === d.number;
    return {
      number: d.number,
      href: drawingsHref({ state: state.state, q: state.q, dwg: selected ? null : d.number }),
      selected,
      title: t(d.title),
      path: d.vaultPath,
      part: d.partRef ?? '—',
      partName: d.partName ? t(d.partName) : '',
      rev: d.revision,
      state: t(d.stateLabel),
      stateClass: drawingStateTag(d.state),
      byLine: `${d.checkedInBy} · ${dateText(d.checkedInOn, t)}`,
      eco: d.ecoNumber ?? '—',
    };
  });
  return {
    kpis: drawingKpis(drawings, sync).map((k) => ({ label: t(k.label), value: k.value, sub: t(k.sub), color: k.lo ? LO : OK })),
    chips: drawingChips(drawings).map((c) => ({ value: c.value ?? 'all', label: t(c.label), count: c.count, href: drawingsHref({ state: c.value, q: state.q, dwg: state.dwg }) })),
    filter: state.state ?? 'all',
    q: state.q,
    rows,
    empty: rows.length ? null : t('No drawing matches'),
  };
}

export interface DrawingDrawerView {
  number: string;
  /** "DWG-AS-9000 · rev C". */
  head: string;
  title: string;
  state: string;
  stateClass: string;
  closeHref: string;
  /** PDM preview image (PDF / PNG export) when the vault sync provides one. */
  previewSrc: string | null;
  meta: { k: string; v: string }[];
  history: { rev: string; label: string; eco: string }[];
  /** Part record drawer (PLM). */
  partHref: string | null;
  /** The linked ECO in Keystone's view of Vigie's ECOs. */
  ecoHref: string | null;
  /** The drawing in SolidWorks PDM (OPEN QUESTION E-7: no deep link yet → null). */
  pdmUrl: string | null;
}

/** The drawing drawer. */
export function drawingDrawerView(input: { drawing: DrawingDetail; state: DrawingsState }, t: T): DrawingDrawerView {
  const d = input.drawing;
  return {
    number: d.number,
    head: `${d.number} ${t('· rev')} ${d.revision}`,
    title: t(d.title),
    state: t(d.stateLabel),
    stateClass: drawingStateTag(d.state),
    closeHref: drawingsHref({ state: input.state.state, q: input.state.q }),
    previewSrc: d.previewRef && /^(https?:|\/)/.test(d.previewRef) ? d.previewRef : null,
    meta: [
      { k: 'Part', v: d.partRef ? `${d.partRef}${d.partName ? ` · ${t(d.partName)}` : ''}` : '—' },
      { k: 'Vault path', v: d.vaultFile },
      { k: 'Checked in by', v: `${d.checkedInBy} · ${dateText(d.checkedInOn, t)}` },
      { k: 'Linked ECO', v: d.ecoNumber ?? t('None') },
      { k: 'Formats', v: d.formats },
      { k: 'Part status', v: d.partStatusLabel ? t(d.partStatusLabel) : '—' },
    ].map((x) => ({ ...x, k: t(x.k) })),
    history: revisionHistory(d.revisions.map((r) => ({ revision: r.revision, isCurrent: r.isCurrent, dateText: r.checkedInOn ? fmtDOfIso(r.checkedInOn) : null, ecoNumber: r.ecoNumber }))).map(
      (h) => ({ rev: h.rev, label: t(h.label), eco: h.eco }),
    ),
    partHref: d.partRef ? partRecordHref(d.partRef) : null,
    ecoHref: d.ecoNumber ? ecoScreenHref({ eco: d.ecoNumber }) : null,
    // Opened in a new window: only an http(s) link from the PDM sync is used.
    pdmUrl: d.pdmUrl && /^https?:\/\//i.test(d.pdmUrl) ? d.pdmUrl : null,
  };
}
