// View models of the Engineering synthesis, the four discipline screens and the import wizard (docs/spec/09 §7–8):
// the domain values (src/domain/engineering.ts, the prototype's English, tag classes and colour tokens) translated
// with t(), with the links of the screen (discipline cards and gate items → discipline screen, chips → `?status=`,
// "Import a list" / "Import new rev" → `?import=`, document ids → their Codex record) and the edit rights of the
// viewer (outside the workspace or read-only project: no action; "Validate release (PM)": the project's PM or the
// director, 09 OQ11). Pure: no I/O.
import type { Lang, T } from '@/i18n/translate';
import {
  disciplineView, importTargetFor, importWizardView, synthesisView, type CheckFilter, type Discipline, type EngRegister, type ImportTarget, type ImportWizardV,
  type KpiV,
} from '@/domain/engineering';
import { docHref } from '@/features/docs/links';
import { disciplineHref, importHref } from './links';
import { engT, generatedLine } from './i18n';

export interface KpiView { label: string; value: string; sub: string; color: string }
const kpiView = (k: KpiV, t: T): KpiView => ({ label: t(k.label), value: t(String(k.value)), sub: t(k.sub), color: k.color });

export interface EngRights {
  /** Edit controls on this screen for this project (not outside the workspace, not read-only). */
  canEdit: boolean;
  /** The viewer validates releases (the project's PM or the director). */
  canValidate: boolean;
}

// ── Synthesis ───────────────────────────────────────────────────────────────────────────────────────────

export interface SynthesisScreenView {
  kpis: KpiView[];
  from: string[];
  matrix: {
    label: string;
    cells: { key: string; bg: string; items: { key: string; label: string; sub: string; color: string; border: string; dot: string; dotBorder: string }[] }[];
  }[];
  discCards: { disc: Discipline; href: string; icon: string; label: string; lead: string; tools: string; pct: string; relText: string; openText: string; openColor: string }[];
  gate: { cls: string; text: string; items: { number: string; href: string; title: string; id: string; ruleLabel: string; lead: string; status: string; stClass: string; sevDot: string }[] };
  changes: { key: string; date: string; text: string; impact: string }[];
}

export function synthesisScreenView(reg: EngRegister, tr: T, lang: Lang): SynthesisScreenView {
  const t = engT(tr, lang);
  const v = synthesisView(reg);
  const code = reg.projectCode;
  return {
    kpis: v.kpis.map((k) => kpiView(k, t)),
    from: v.from.map((f) => t(f.label)),
    matrix: v.matrix.map((r) => ({
      label: t(r.label),
      cells: r.cells.map((c) => ({
        key: `${r.to}-${c.from}`,
        bg: c.bg,
        items: c.items.map((i) => ({ key: i.doc, label: t(i.label), sub: t(i.sub), color: i.color, border: i.border, dot: i.dot, dotBorder: i.dotBorder })),
      })),
    })),
    discCards: v.discCards.map((d) => ({
      disc: d.disc, href: disciplineHref(code, d.disc), icon: d.icon, label: t(d.label), lead: t(d.lead), tools: t(d.tools), pct: d.pct, relText: t(d.relText),
      openText: t(d.openText), openColor: d.openColor,
    })),
    gate: {
      cls: v.gate.cls,
      text: t(v.gate.text),
      items: v.gate.items.map((c) => ({
        number: c.number, href: disciplineHref(code, c.owner), title: t(c.title), id: t(c.number), ruleLabel: t(c.ruleLabel), lead: t(c.lead), status: t(c.status), stClass: c.stClass,
        sevDot: c.sevDot,
      })),
    },
    changes: v.changes.map((c, i) => ({ key: `${i}`, date: t(c.date), text: t(c.text), impact: t(c.impact) })),
  };
}

// ── Discipline screens ──────────────────────────────────────────────────────────────────────────────────

export interface DisciplineScreenView {
  disc: Discipline;
  head: { icon: string; lead: string; tools: string };
  kpis: KpiView[];
  /** Inputs card "Import a list" (`openEngImp`); null when the viewer cannot import. */
  importHref: string | null;
  inputs: {
    doc: string;
    /** Codex record of the document (null for an external document). */
    docHref: string | null;
    title: string;
    from: string;
    revText: string;
    latestText: string;
    revColor: string;
    state: string;
    stClass: string;
    canConfirm: boolean;
    importHref: string | null;
  }[];
  docs: {
    id: string;
    docHref: string;
    /** "Electrical schematics · 24 Sep · S. Haddad". */
    sub: string;
    rev: string;
    status: string;
    stClass: string;
    toText: string;
    canFreeze: boolean;
    canPropose: boolean;
    proposeBlocked: boolean;
    blockedText: string;
    canValidate: boolean;
    /** Delivery 7: "Awaiting PM validation", "Approval circuit started · Pending sync with Codex"… (translated); null when none. */
    codexNote: string | null;
  }[];
  outputs: { id: string; name: string; toText: string; source: string; genText: string; stateText: string; stClass: string; canGen: boolean }[];
  checks: {
    id: string;
    title: string;
    detail: string;
    /** "C-01 · Process ↔ Electrical · Electrical · Sami Haddad". */
    meta: string;
    note: string;
    sevDot: string;
    sevLabel: string;
    sevClass: string;
    status: string;
    stClass: string;
    color: string;
    canAct: boolean;
  }[];
  chips: { value: CheckFilter; label: string; count: number; href: string }[];
  filter: CheckFilter;
}

export interface DisciplineScreenOpts {
  filter: CheckFilter;
  rights: EngRights;
  /** Today (Paris day of the real clock) and the Paris day of an instant — generation stamps. */
  todayIso: string;
  parisDay: (iso: string) => string;
}

export function disciplineScreenView(reg: EngRegister, disc: Discipline, opts: DisciplineScreenOpts, tr: T, lang: Lang): DisciplineScreenView {
  const t = engT(tr, lang);
  const v = disciplineView(reg, disc, { filter: opts.filter, todayIso: opts.todayIso, parisDay: opts.parisDay });
  const code = reg.projectCode;
  const { canEdit, canValidate } = opts.rights;
  const inRegister = new Set(reg.deliverables.map((d) => d.number));
  // Delivery 7 (R-106): the Codex circuit line of a deliverable, from the data layer.
  const codexNoteOf = (n: string) => {
    const note = reg.deliverables.find((d) => d.number === n)?.codexNote;
    return note ? t(note) : null;
  };
  const bodyTarget = canEdit ? importTargetFor(reg, disc) : null;
  return {
    disc,
    head: { icon: v.head.icon, lead: t(v.head.lead), tools: t(v.head.tools) },
    kpis: v.kpis.map((k) => kpiView(k, t)),
    importHref: bodyTarget ? importHref(code, disc, bodyTarget, opts.filter) : null,
    inputs: v.inputs.map((r) => {
      const target = canEdit && r.canImport ? importTargetFor(reg, disc, r.doc) : null;
      return {
        doc: r.doc, docHref: inRegister.has(r.doc) ? docHref(r.doc, code) : null, title: t(r.title), from: t(r.from), revText: t(r.revText), latestText: t(r.latestText),
        revColor: r.revColor, state: t(r.state), stClass: r.stClass, canConfirm: canEdit && r.canConfirm, importHref: target ? importHref(code, disc, target, opts.filter) : null,
      };
    }),
    docs: v.docs.map((d) => ({
      id: d.id, docHref: docHref(d.id, code), sub: `${t(d.title)} · ${t(d.date)} · ${t(d.by)}`, rev: d.rev, status: t(d.status), stClass: d.stClass, toText: t(d.toText),
      canFreeze: canEdit && d.canFreeze, canPropose: canEdit && d.canPropose, proposeBlocked: d.proposeBlocked, blockedText: t(d.blockedText),
      canValidate: canEdit && canValidate && d.canValidate, codexNote: codexNoteOf(d.id),
    })),
    outputs: v.outputs.map((o) => ({
      id: o.id, name: t(o.name), toText: t(o.toText), source: t(o.source), genText: generatedLine(o.generated, t, lang), stateText: t(o.stateText), stClass: o.stClass,
      canGen: canEdit && o.canGen,
    })),
    checks: v.checks.map((c) => ({
      id: c.id, title: t(c.title), detail: t(c.detail), meta: [c.id, c.ruleLabel, c.ownerLabel, c.lead].map(t).join(' · '), note: t(c.note), sevDot: c.sevDot, sevLabel: t(c.sevLabel),
      sevClass: c.sevClass, status: t(c.status), stClass: c.stClass, color: c.color, canAct: canEdit && c.canAct,
    })),
    chips: v.chips.map((c) => ({ value: c.value, label: t(c.label), count: c.count, href: disciplineHref(code, disc, { status: c.value }) })),
    filter: v.filter,
  };
}

// ── Import wizard ───────────────────────────────────────────────────────────────────────────────────────

export interface ImportWizardModel {
  target: string;
  file: string;
  steps: { label: string; n: number }[];
  tools: { position: number; label: string; disc: string }[];
  map: { src: string; dst: string }[];
  stats: { value: number; label: string; color: string }[];
  deltas: { key: string; sym: string; label: string; kind: string; color: string }[];
}

/** Translated wizard values (the selection colours and the step look are the client's, from the tool / step it holds). */
export function importWizardModel(reg: EngRegister, target: ImportTarget, t: T): ImportWizardModel {
  const v: ImportWizardV = importWizardView(reg, target, 1);
  return {
    target: t(v.target),
    file: t(v.file),
    steps: v.steps.map((s) => ({ label: t(s.label), n: s.n })),
    tools: v.tools.map((x) => ({ position: x.position, label: t(x.label), disc: t(x.disc) })),
    map: v.map.map((m) => ({ src: m.src, dst: t(m.dst) })),
    stats: v.stats.map((s) => ({ value: s.value, label: t(s.label), color: s.color })),
    deltas: v.deltas.map((d, i) => ({ key: `${i}`, sym: d.sym, label: t(d.label), kind: t(d.kind), color: d.color })),
  };
}
