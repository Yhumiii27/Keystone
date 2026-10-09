// "Import P&ID tags" (AF `pid`, docs/spec/09 §6.11, 01 §8) as a structured staging import: the tag list exported from
// the drawing (AutoCAD P&ID export or an Excel list — CSV / TSV text, pasted cells or the first sheet of an .xlsx) is
// parsed into typed rows, checked against the project's tags, the catalogue and the activities, and shown as a staged
// plan (new / updated / unchanged / removed / rejected, with the fields that change and the reasons) before anything
// is written. The prototype only toasted "27 tags imported · 3 new · 1 updated" (no data change, 09 OQ5).
// Rules:
// - the header row (within the first 5 rows) names the columns; "Tag" and "Description" are required, the others
//   (Kind, Scope, Reference, Activity, PLC, State feedback, Role, Sheet, Note) optional; EN and FR names are accepted;
// - a new tag needs a description and a kind; defaults: scope Keystone, role sensor (instrument) / passive (equipment),
//   no PLC, no feedback, sheet 1, note "Client scope — free issue" for client equipment;
// - an existing tag is updated on the columns the file gives; the mapping to a BOM reference is Keystone's: a file
//   reference only maps a tag that has none (a differing one is reported, the Keystone mapping kept); client equipment
//   never carries a reference;
// - "Replace all" removes the tags the file no longer lists (a rejected line keeps its tag);
// - invalid values reject the line (reason given); unknown references and activities are accepted with a warning.
// Pure: no I/O, English messages (the feature translates them). Tests: src/domain/pid-import.test.ts.
import type { BomScope, PidRole, PidTagKind, PlcType } from '@/server/db/codes';

export type PidImportMode = 'merge' | 'replace';
export type PidImportSource = 'autocad' | 'excel';
/** Form options (AF.pid): codes and the prototype's English labels. */
export const PID_IMPORT_MODES: readonly [PidImportMode, string][] = [['merge', 'Add & update'], ['replace', 'Replace all']];
export const PID_IMPORT_SOURCES: readonly [PidImportSource, string][] = [['autocad', 'AutoCAD P&ID export'], ['excel', 'Excel list']];
export const isPidImportMode = (v: unknown): v is PidImportMode => v === 'merge' || v === 'replace';
export const isPidImportSource = (v: unknown): v is PidImportSource => v === 'autocad' || v === 'excel';
export const importModeLabel = (m: PidImportMode) => PID_IMPORT_MODES.find(([c]) => c === m)![1];
export const importSourceLabel = (s: PidImportSource) => PID_IMPORT_SOURCES.find(([c]) => c === s)![1];

/** Limits of one import. */
export const PID_IMPORT_LIMITS = { chars: 1_000_000, rows: 5000, cell: 500 } as const;
/** Note of client-supplied equipment (PID_TAGS seed). */
export const CLIENT_NOTE = 'Client scope — free issue';

export type PidField = 'tag' | 'description' | 'kind' | 'scope' | 'reference' | 'note' | 'activity' | 'plc' | 'feedback' | 'role' | 'sheet';
/** Column order of the staging table and English column names (the template of the expected file). */
export const PID_FIELDS: readonly [PidField, string][] = [
  ['tag', 'Tag'], ['description', 'Description'], ['kind', 'Kind'], ['scope', 'Scope'], ['reference', 'Reference'], ['activity', 'Activity'],
  ['plc', 'PLC'], ['feedback', 'State feedback'], ['role', 'Role'], ['sheet', 'Sheet'], ['note', 'Note'],
];
export const fieldLabel = (f: PidField) => PID_FIELDS.find(([k]) => k === f)![1];

const norm = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’‘`]/g, "'").toLowerCase().replace(/[*:]+$/g, '').replace(/\s+/g, ' ').trim();

/** Accepted header names (normalised: lower case, no accents). */
const HEADERS: Record<PidField, string[]> = {
  tag: ['tag', 'tags', 'tag number', 'tag no', 'tag no.', 'tag name', 'repere', 'numero de tag'],
  description: ['description', 'desc', 'designation', 'libelle'],
  kind: ['kind', 'nature', 'class', 'class name', 'category', 'categorie', 'type'],
  scope: ['scope', 'perimetre', 'supplied by', 'fourni par', 'supply'],
  reference: ['reference', 'bom reference', 'reference nomenclature', 'ref', 'ref.', 'part', 'part number', 'article'],
  note: ['note', 'notes', 'remark', 'remarks', 'remarque', 'comment', 'commentaire'],
  activity: ['activity', 'activite', 'act', 'activity id'],
  plc: ['plc', 'automate', 'plc type', 'controller', 'automation'],
  feedback: ['state feedback', "retour d'etat", 'feedback', 'status feedback'],
  role: ['role', 'function', 'fonction', 'io role'],
  sheet: ['sheet', 'feuille', 'sheet no', 'sheet number', 'drawing sheet'],
};
const FIELD_OF_HEADER = new Map<string, PidField>(Object.entries(HEADERS).flatMap(([f, hs]) => hs.map((h) => [h, f as PidField] as [string, PidField])));

// ── Text tables ──────────────────────────────────────────────────────────────────────────────────────────

/**
 * CSV / TSV / semicolon text → rows of trimmed cells. The delimiter is the most frequent of tab, ";" and "," on the
 * first lines (outside quotes); quoted cells may hold delimiters, line breaks and doubled quotes. Empty rows dropped.
 */
export function parseDelimited(text: string): string[][] {
  const src = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const sample = src.split('\n').filter((l) => l.trim()).slice(0, 5).join('\n').replace(/"[^"]*"/g, '');
  const delim = (['\t', ';', ','] as const).map((d) => [d, sample.split(d).length - 1] as const).reduce((a, b) => (b[1] > a[1] ? b : a), [',', 0] as readonly [string, number])[0];
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell.trim() === '') {
      quoted = true;
      cell = '';
    } else if (ch === delim) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  row.push(cell);
  rows.push(row);
  return rows.map((r) => r.map((c) => c.trim())).filter((r) => r.some((c) => c !== ''));
}

// ── Values ───────────────────────────────────────────────────────────────────────────────────────────────

const KIND: Record<string, PidTagKind> = { instrument: 'instrument', instrumentation: 'instrument', instr: 'instrument', equipment: 'equipment', equipement: 'equipment', equip: 'equipment' };
const SCOPE: Record<string, BomScope> = {
  keystone: 'keystone', 'our supply': 'keystone', 'notre fourniture': 'keystone', 'keystone supply': 'keystone', 'fourniture keystone': 'keystone',
  overlay: 'overlay', surcouche: 'overlay', 'overlay (surcouche)': 'overlay',
  client: 'client', 'client supply': 'client', 'fourniture client': 'client', 'free issue': 'client', 'client-supplied': 'client',
};
const PLC: Record<string, PlcType | null> = {
  '': null, '-': null, '—': null, none: null, aucun: null, p: 'P', process: 'P', 'process plc': 'P', 'automate process': 'P',
  s: 'S', safety: 'S', 'safety plc': 'S', 'automate securite': 'S', sis: 'S', l: 'L', local: 'L',
};
const ROLE: Record<string, PidRole> = {
  sensor: 'sensor', capteur: 'sensor', actuator: 'actuator', actionneur: 'actuator', ctrl: 'ctrl', controller: 'ctrl', control: 'ctrl', controleur: 'ctrl',
  passive: 'passive', passif: 'passive',
};
const EMPTY = new Set(['', '-', '—', 'n/a', 'na']);

/** Tag identifier as stored: upper case, single spaces. */
export const normaliseTag = (s: string) => s.trim().replace(/\s+/g, ' ').toUpperCase();
const TAG_RE = /^[A-Z0-9][A-Z0-9 ./#_×-]{0,39}$/;
/** Catalogue reference: upper case; empty markers → null. */
const normaliseRef = (s: string) => (EMPTY.has(s.trim().toLowerCase()) ? null : s.trim().toUpperCase());

/** Fields a file line sets (only the columns present and non-blank — a blank cell keeps the stored value). */
export interface PidTagFields {
  description?: string;
  kind?: PidTagKind;
  scope?: BomScope;
  /** null = the file says "no reference" (only meaningful for a new tag). */
  partRef?: string | null;
  note?: string;
  activityCode?: string;
  plcType?: PlcType | null;
  stateFeedback?: string;
  role?: PidRole;
  sheet?: number;
}

export interface StagedTag {
  /** 1-based line of the table (header included). */
  line: number;
  tag: string;
  fields: PidTagFields;
}

export interface ParsedPidList {
  /** Recognised columns in file order. */
  columns: PidField[];
  /** Header names not recognised (ignored). */
  ignored: string[];
  rows: StagedTag[];
  rejected: { line: number; tag: string; reason: string }[];
  /** File-level error (EN): nothing can be imported. */
  error: string | null;
}

/** Table (header + rows) → typed staged rows. */
export function parsePidTagList(table: readonly (readonly string[])[]): ParsedPidList {
  const out: ParsedPidList = { columns: [], ignored: [], rows: [], rejected: [], error: null };
  if (!table.length) return { ...out, error: 'The file is empty' };
  const headerIdx = table.slice(0, 5).findIndex((r) => r.some((c) => FIELD_OF_HEADER.get(norm(c)) === 'tag'));
  if (headerIdx < 0) return { ...out, error: 'No "Tag" column in the first rows of the file' };
  const header = table[headerIdx];
  const colOf = new Map<PidField, number>();
  header.forEach((h, i) => {
    const f = FIELD_OF_HEADER.get(norm(h));
    if (f && !colOf.has(f)) colOf.set(f, i);
    else if (h.trim()) out.ignored.push(h.trim());
  });
  out.columns = [...colOf.entries()].sort((a, b) => a[1] - b[1]).map(([f]) => f);
  if (!colOf.has('description')) return { ...out, error: 'No "Description" column in the file' };
  const body = table.slice(headerIdx + 1);
  if (!body.length) return { ...out, error: 'The file lists no tag' };
  if (body.length > PID_IMPORT_LIMITS.rows) return { ...out, error: `Too many lines (more than ${PID_IMPORT_LIMITS.rows})` };

  body.forEach((r, i) => {
    const line = headerIdx + i + 2;
    const cell = (f: PidField) => (colOf.has(f) ? (r[colOf.get(f)!] ?? '').trim() : undefined);
    const rawTag = cell('tag') ?? '';
    const tag = normaliseTag(rawTag);
    const reject = (reason: string) => out.rejected.push({ line, tag: tag || '—', reason });
    if (!tag) return reject('No tag');
    if (!TAG_RE.test(tag)) return reject(`Invalid tag "${rawTag.slice(0, 40)}"`);
    if ([...colOf.keys()].some((f) => (cell(f) ?? '').length > PID_IMPORT_LIMITS.cell)) return reject('A cell is too long');
    const fields: PidTagFields = {};
    const desc = cell('description');
    if (desc) fields.description = desc;
    const kind = cell('kind');
    if (kind) {
      const k = KIND[norm(kind)];
      if (!k) return reject(`Invalid kind "${kind}" (Instrument or Equipment)`);
      fields.kind = k;
    }
    const scope = cell('scope');
    if (scope) {
      const s = SCOPE[norm(scope)];
      if (!s) return reject(`Invalid scope "${scope}" (Keystone, Overlay or Client)`);
      fields.scope = s;
    }
    const ref = cell('reference');
    if (ref !== undefined) fields.partRef = normaliseRef(ref);
    const note = cell('note');
    if (note) fields.note = note;
    const act = cell('activity');
    if (act && !EMPTY.has(act.toLowerCase())) fields.activityCode = act.toUpperCase();
    const plc = cell('plc');
    if (plc !== undefined && plc !== '') {
      const key = norm(plc);
      if (!(key in PLC) && !EMPTY.has(key)) return reject(`Invalid PLC "${plc}" (P, S, L or empty)`);
      fields.plcType = PLC[key] ?? null;
    }
    const fb = cell('feedback');
    if (fb) fields.stateFeedback = EMPTY.has(fb.toLowerCase()) ? '' : fb;
    const role = cell('role');
    if (role) {
      const ro = ROLE[norm(role)];
      if (!ro) return reject(`Invalid role "${role}" (sensor, actuator, ctrl or passive)`);
      fields.role = ro;
    }
    const sheet = cell('sheet');
    if (sheet) {
      const n = Number(sheet);
      if (!Number.isInteger(n) || n < 1 || n > 999) return reject(`Invalid sheet "${sheet}"`);
      fields.sheet = n;
    }
    out.rows.push({ line, tag, fields });
  });
  return out;
}

// ── Plan ─────────────────────────────────────────────────────────────────────────────────────────────────

/** A tag stored in Keystone. */
export interface ExistingPidTag {
  tag: string;
  description: string;
  kind: PidTagKind;
  scope: BomScope;
  partRef: string | null;
  note: string;
  activityCode: string;
  plcType: PlcType | null;
  stateFeedback: string;
  role: PidRole;
  sheet: number;
}

export type PidDeltaKind = 'new' | 'updated' | 'unchanged' | 'removed' | 'rejected';
export const PID_DELTA_ORDER: readonly PidDeltaKind[] = ['new', 'updated', 'unchanged', 'removed', 'rejected'];
export const PID_DELTA_LABEL: Record<PidDeltaKind, string> = { new: 'New', updated: 'Updated', unchanged: 'Unchanged', removed: 'Removed', rejected: 'Rejected' };
/** Delta tag: new / removed accent, updated outline, unchanged neutral, rejected accent. */
export const PID_DELTA_TAG: Record<PidDeltaKind, string> = {
  new: 'tag tag-accent', updated: 'tag tag-outline', unchanged: 'tag tag-neutral', removed: 'tag tag-accent', rejected: 'tag tag-outline',
};

export interface PidImportLine {
  /** File line; null for a removed tag. */
  line: number | null;
  tag: string;
  delta: PidDeltaKind;
  /** The tag after the import (new / updated / unchanged), as stored (removed), or null (rejected). */
  value: ExistingPidTag | null;
  /** Fields an update changes. */
  changes: PidField[];
  /** Rejection reason (EN). */
  reason: string | null;
  /** Warnings (EN): reference not in the catalogue, unknown activity, Keystone mapping kept… */
  warnings: string[];
}

export interface PidImportPlan {
  lines: PidImportLine[];
  counts: Record<PidDeltaKind, number> & { rows: number; imported: number };
  columns: PidField[];
  ignored: string[];
  error: string | null;
}

export interface PidImportContext {
  /** Catalogue references. */
  catalogue: ReadonlySet<string>;
  /** Activity codes of the project. */
  activities: ReadonlySet<string>;
}

const FIELD_KEYS: [PidField, keyof ExistingPidTag][] = [
  ['description', 'description'], ['kind', 'kind'], ['scope', 'scope'], ['reference', 'partRef'], ['activity', 'activityCode'], ['plc', 'plcType'],
  ['feedback', 'stateFeedback'], ['role', 'role'], ['sheet', 'sheet'], ['note', 'note'],
];

/** Staged plan of an import against the project's tags. */
export function planPidImport(parsed: ParsedPidList, existing: readonly ExistingPidTag[], mode: PidImportMode, ctx: PidImportContext): PidImportPlan {
  const byTag = new Map(existing.map((t) => [normaliseTag(t.tag), t]));
  const lines: PidImportLine[] = [];
  const seen = new Map<string, number>();
  const listed = new Set<string>();

  const all = [
    ...parsed.rows.map((r) => ({ kind: 'row' as const, line: r.line, r })),
    ...parsed.rejected.map((x) => ({ kind: 'rej' as const, line: x.line, x })),
  ].sort((a, b) => a.line - b.line);

  for (const item of all) {
    if (item.kind === 'rej') {
      if (item.x.tag !== '—') listed.add(item.x.tag);
      lines.push({ line: item.line, tag: item.x.tag, delta: 'rejected', value: null, changes: [], reason: item.x.reason, warnings: [] });
      continue;
    }
    const { r } = item;
    listed.add(r.tag);
    const dup = seen.get(r.tag);
    if (dup != null) {
      lines.push({ line: r.line, tag: r.tag, delta: 'rejected', value: null, changes: [], reason: `Duplicate tag (line ${dup})`, warnings: [] });
      continue;
    }
    seen.set(r.tag, r.line);
    const f = r.fields;
    const warnings: string[] = [];
    const cur = byTag.get(r.tag);
    if (!cur) {
      if (!f.description) {
        lines.push({ line: r.line, tag: r.tag, delta: 'rejected', value: null, changes: [], reason: 'A new tag needs a description', warnings: [] });
        continue;
      }
      if (!f.kind) {
        lines.push({ line: r.line, tag: r.tag, delta: 'rejected', value: null, changes: [], reason: 'A new tag needs a kind (Instrument or Equipment)', warnings: [] });
        continue;
      }
      const scope = f.scope ?? 'keystone';
      let partRef = f.partRef ?? null;
      if (scope === 'client' && partRef) {
        warnings.push('Reference ignored: client-supplied equipment');
        partRef = null;
      }
      if (partRef && !ctx.catalogue.has(partRef)) warnings.push(`${partRef} is not in the catalogue`);
      const activityCode = f.activityCode ?? '';
      if (activityCode && !ctx.activities.has(activityCode)) warnings.push(`Activity ${activityCode} is not in the project plan`);
      const value: ExistingPidTag = {
        tag: r.tag, description: f.description, kind: f.kind, scope, partRef, note: f.note ?? (scope === 'client' ? CLIENT_NOTE : ''), activityCode,
        plcType: f.plcType ?? null, stateFeedback: f.stateFeedback ?? '', role: f.role ?? (f.kind === 'instrument' ? 'sensor' : 'passive'), sheet: f.sheet ?? 1,
      };
      lines.push({ line: r.line, tag: r.tag, delta: 'new', value, changes: [], reason: null, warnings });
      continue;
    }
    // Existing tag: the columns the file gives, the Keystone mapping kept.
    const next: ExistingPidTag = { ...cur };
    if (f.description !== undefined) next.description = f.description;
    if (f.kind !== undefined) next.kind = f.kind;
    if (f.scope !== undefined) next.scope = f.scope;
    if (f.note !== undefined) next.note = f.note;
    if (f.activityCode !== undefined) next.activityCode = f.activityCode;
    if (f.plcType !== undefined) next.plcType = f.plcType;
    if (f.stateFeedback !== undefined) next.stateFeedback = f.stateFeedback;
    if (f.role !== undefined) next.role = f.role;
    if (f.sheet !== undefined) next.sheet = f.sheet;
    if (next.scope === 'client') {
      if (f.partRef) warnings.push('Reference ignored: client-supplied equipment');
      if (next.partRef) warnings.push(`Mapping to ${next.partRef} removed: client-supplied equipment`);
      next.partRef = null;
      if (cur.scope !== 'client' && f.note === undefined && !next.note) next.note = CLIENT_NOTE;
    } else if (cur.scope === 'client' && f.note === undefined && next.note === CLIENT_NOTE) {
      // Equipment no longer client-supplied: the free-issue note goes with the scope.
      next.note = '';
    }
    if (next.scope !== 'client' && f.partRef) {
      if (!cur.partRef) next.partRef = f.partRef;
      else if (f.partRef !== cur.partRef) warnings.push(`Mapping kept in Keystone (${cur.partRef}; the file gives ${f.partRef})`);
    }
    if (next.partRef && next.partRef !== cur.partRef && !ctx.catalogue.has(next.partRef)) warnings.push(`${next.partRef} is not in the catalogue`);
    if (f.activityCode && f.activityCode !== cur.activityCode && !ctx.activities.has(f.activityCode)) warnings.push(`Activity ${f.activityCode} is not in the project plan`);
    const changes = FIELD_KEYS.filter(([, k]) => next[k] !== cur[k]).map(([field]) => field);
    lines.push({ line: r.line, tag: r.tag, delta: changes.length ? 'updated' : 'unchanged', value: next, changes, reason: null, warnings });
  }

  if (mode === 'replace' && !parsed.error) {
    for (const t of existing) {
      if (listed.has(normaliseTag(t.tag))) continue;
      lines.push({ line: null, tag: t.tag, delta: 'removed', value: t, changes: [], reason: null, warnings: t.partRef ? [`Mapping to ${t.partRef} lost`] : [] });
    }
  }

  const count = (d: PidDeltaKind) => lines.filter((l) => l.delta === d).length;
  const counts = {
    new: count('new'), updated: count('updated'), unchanged: count('unchanged'), removed: count('removed'), rejected: count('rejected'),
    rows: lines.filter((l) => l.line != null).length,
    imported: count('new') + count('updated') + count('unchanged'),
  };
  return { lines: parsed.error ? [] : lines, counts: parsed.error ? { ...counts, new: 0, updated: 0, unchanged: 0, removed: 0, rejected: 0, rows: 0, imported: 0 } : counts, columns: parsed.columns, ignored: parsed.ignored, error: parsed.error };
}

/** Something to write: at least one new, updated or removed tag. */
export const planHasChanges = (p: PidImportPlan) => !p.error && p.counts.new + p.counts.updated + p.counts.removed > 0;

/** Revision of the drawing the tags come from: 1–6 letters / digits ("E", "C1", "02"), upper case; null when invalid. */
export function normaliseRevision(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const r = v.trim().toUpperCase();
  return /^[A-Z0-9][A-Z0-9.-]{0,5}$/.test(r) ? r : null;
}

/** Toast after an import (AF_RESULT.pid with real numbers): "27 tags · rev E imported · 3 new · 1 updated" (+ removed / rejected). */
export function importResultText(p: PidImportPlan, rev: string): string {
  const c = p.counts;
  return `${c.imported} tags · rev ${rev} imported · ${c.new} new · ${c.updated} updated` + (c.removed ? ` · ${c.removed} removed` : '') + (c.rejected ? ` · ${c.rejected} rejected` : '');
}
