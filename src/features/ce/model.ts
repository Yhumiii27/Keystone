// R-160 (P2, D9-32): view models of the CE conformity screens — the card of the Commissioning & handover screen, the CE file
// editor, the portfolio card of the Projects register and the Settings checklists — translated on the server. Keystone's own
// labels go through t(); what people typed (line labels, signatory, standards, entries added in Settings) as typed (dataText).
import {
  CE_APPLICATION_DATE, CE_CATEGORIES, CE_CHECKLIST_TITLE, CE_CATEGORY_LABEL, CE_REGIMES, CE_REGIME_LABEL, CE_ROUTES, CE_ROUTE_LABEL, CE_STATE_LABEL, EHSR_STATUSES,
  EHSR_STATUS_LABEL, TECH_STATUSES, TECH_STATUS_LABEL, declarationKindOf, type CeEditScope, type CeFileValues, type CeState,
} from '@/domain/ce-conformity';
import type { TagTone } from '@/components/ds/Tag';
import { dataText } from '@/i18n/data-text';
import { intlLocale, type Lang, type T } from '@/i18n/translate';
import { handoverItemStatus } from '@/server/db/codes';
import type { CeChecklistRow, CeChecklists, CeLine, PortfolioCeRow, ProjectCe } from '@/server/dal/ce-conformity';

export const CE_STATE_TONE: Record<CeState, TagTone> = { none: 'outline', in_progress: 'outline', complete: 'neutral' };

const dateFmt = (lang: Lang) => {
  const df = new Intl.DateTimeFormat(intlLocale(lang), { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  return (iso: string | null) => (iso ? df.format(new Date(`${iso}T00:00:00Z`)) : null);
};

/** A checklist entry's title: a default entry is Keystone's (t), an added one is typed text. */
export const checklistTitle = (e: CeChecklistRow, t: T, lang: Lang) => (e.isDefault ? t(e.title) : dataText(e.title, lang));

export interface CeLineView {
  ref: string;
  /** "EQ-02 · 3 × MEMU · Portique 40 t". */
  equipment: string;
  machines: string;
  market: string;
  /** "Regulation (EU) 2023/1230" or "Directive 2006/42/EC". */
  regime: string;
  pct: number;
  progress: string;
  state: string;
  tone: TagTone;
  missing: string;
  /** The handover is reached while the file is incomplete (warning, never a block; Directive or Regulation alike). */
  warn: boolean;
  href: string;
  selected: boolean;
}

export const lineEquipmentText = (l: Pick<CeLine, 'ref' | 'quantity' | 'typeLabel' | 'label'>, lang: Lang) =>
  `${l.ref} · ${l.quantity} × ${l.typeLabel}${l.label ? ` · ${dataText(l.label, lang)}` : ''}`;

export function ceLineView(l: CeLine, t: T, lang: Lang, href: string, selected = false): CeLineView {
  const day = dateFmt(lang);
  return {
    ref: l.ref, equipment: lineEquipmentText(l, lang),
    machines: l.machines.length ? l.machines.map((m) => m.number).join(', ') : '—',
    market: day(l.marketDate) ?? t('Not dated'),
    regime: t(l.regulationApplies ? 'Regulation (EU) 2023/1230' : 'Directive 2006/42/EC'),
    pct: l.readiness.pct / 100, progress: `${l.readiness.done}/${l.readiness.total}`,
    state: t(CE_STATE_LABEL[l.readiness.state]), tone: l.readiness.complete ? 'neutral' : 'accent',
    missing: l.readiness.missing.map(t).join(' · ') || '—',
    warn: l.atHandover && !l.readiness.complete, href, selected,
  };
}

export interface CeCardView {
  title: string;
  hint: string;
  lines: CeLineView[];
  /** "CE file incomplete at the handover · EQ-02 — the handover is not blocked"; null when no warning. */
  warning: string | null;
  /** The handover dossier's CE declaration line, reused ("Handover dossier · CE declaration & certificates of conformity · Partial · COC-…"). */
  dossier: string | null;
  empty: string;
}

export function ceCardView(ce: ProjectCe, t: T, lang: Lang, hrefOf: (ref: string) => string, selected: string | null): CeCardView {
  const lines = ce.lines.map((l) => ceLineView(l, t, lang, hrefOf(l.ref), l.ref === selected));
  const warned = lines.filter((l) => l.warn).map((l) => l.ref);
  const day = dateFmt(lang);
  return {
    title: t('CE conformity · technical file'),
    hint: `${t('Machinery Regulation (EU) 2023/1230')} · ${t('applicable from')} ${day(CE_APPLICATION_DATE)}`,
    lines,
    warning: warned.length ? `${t('CE file incomplete at the handover')} · ${warned.join(', ')} · ${t('the handover is not blocked')}` : null,
    dossier: ce.dossierLine
      ? [t('Handover dossier'), t(ce.dossierLine.item), t(handoverItemStatus.isCode(ce.dossierLine.status) ? handoverItemStatus.label(ce.dossierLine.status) : ce.dossierLine.status), ce.dossierLine.documentRef]
        .filter(Boolean).join(' · ')
      : null,
    empty: t('No equipment line on this project'),
  };
}

// ── The editor ───────────────────────────────────────────────────────────────────────────────────────────────────────

export interface Opt {
  value: string;
  label: string;
}

/** The file as the form holds it (strings; standards one per line). */
export interface CeFormValues {
  regime: string;
  category: string;
  route: string;
  riskAssessmentRef: string;
  standards: string;
  instructionsRef: string;
  declarationSignatory: string;
  declarationOn: string;
  declarationRef: string;
  ceMarkingOn: string;
  ehsr: Record<string, string>;
  techFile: Record<string, { status: string; deliverable: string; codexRef: string }>;
}

export const formValuesOf = (f: CeFileValues | null): CeFormValues => ({
  regime: f?.regime ?? '', category: f?.category ?? '', route: f?.route ?? '', riskAssessmentRef: f?.riskAssessmentRef ?? '',
  standards: (f?.standards ?? []).join('\n'), instructionsRef: f?.instructionsRef ?? '', declarationSignatory: f?.declarationSignatory ?? '',
  declarationOn: f?.declarationOn ?? '', declarationRef: f?.declarationRef ?? '', ceMarkingOn: f?.ceMarkingOn ?? '',
  ehsr: { ...(f?.ehsr ?? {}) },
  techFile: Object.fromEntries(Object.entries(f?.techFile ?? {}).map(([k, v]) => [k, { status: v.status, deliverable: v.deliverable ?? '', codexRef: v.codexRef ?? '' }])),
});

export interface CeEditorView {
  projectCode: string;
  ref: string;
  title: string;
  token: string | null;
  scope: CeEditScope;
  values: CeFormValues;
  regimes: Opt[];
  categories: Opt[];
  routes: Opt[];
  ehsrStatuses: Opt[];
  techStatuses: Opt[];
  deliverables: Opt[];
  /** Active entries, plus inactive ones the file answered (shown "removed from Settings"). */
  ehsr: { code: string; title: string; removed: boolean }[];
  techFile: { code: string; title: string; removed: boolean }[];
  /** "EU declaration of conformity" / "Declaration of incorporation" for each regime. */
  declarationTitles: Record<string, string>;
  checks: { label: string; ok: boolean }[];
  readOnlyNote: string | null;
  updated: string | null;
}

const listView = (rows: CeChecklistRow[], answered: (code: string) => boolean, t: T, lang: Lang) =>
  rows.filter((e) => e.active || answered(e.code)).map((e) => ({ code: e.code, title: checklistTitle(e, t, lang), removed: !e.active }));

export function ceEditorView(ce: ProjectCe, line: CeLine, scope: CeEditScope, t: T, lang: Lang): CeEditorView {
  const f = line.file;
  const lists: CeChecklists = ce.checklists;
  const none = { value: '', label: t('Not chosen') };
  return {
    projectCode: ce.projectCode, ref: line.ref, title: `${t('CE file')} · ${lineEquipmentText(line, lang)}`, token: line.token, scope,
    values: formValuesOf(f),
    regimes: [none, ...CE_REGIMES.map((r) => ({ value: r, label: t(CE_REGIME_LABEL[r]) }))],
    categories: [none, ...CE_CATEGORIES.map((r) => ({ value: r, label: t(CE_CATEGORY_LABEL[r]) }))],
    routes: [none, ...CE_ROUTES.map((r) => ({ value: r, label: t(CE_ROUTE_LABEL[r]) }))],
    ehsrStatuses: EHSR_STATUSES.map((s) => ({ value: s, label: t(EHSR_STATUS_LABEL[s]) })),
    techStatuses: TECH_STATUSES.map((s) => ({ value: s, label: t(TECH_STATUS_LABEL[s]) })),
    deliverables: [{ value: '', label: t('No deliverable') }, ...ce.deliverables.map((d) => ({ value: d.number, label: `${d.number} · ${dataText(d.title, lang)}` }))],
    ehsr: listView(lists.ehsr, (c) => !!f?.ehsr[c], t, lang),
    techFile: listView(lists.techfile, (c) => !!f?.techFile[c], t, lang),
    declarationTitles: Object.fromEntries(['', ...CE_REGIMES].map((r) => [r, t(declarationKindOf((r || null) as never))])),
    checks: line.readiness.checks.map((c) => ({ label: t(c.label), ok: c.ok })),
    readOnlyNote: scope === 'technical' ? null : scope === 'project'
      ? t('You edit the declaration and the CE marking · the engineering lead and quality keep the technical file')
      : t('Read-only · the engineering lead and quality keep the CE file'),
    updated: line.updatedAt ? new Intl.DateTimeFormat(intlLocale(lang), { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' }).format(new Date(line.updatedAt)) : null,
  };
}

// ── Portfolio card ─────────────────────────────────────────────────────────────────────────────────────────────────

export interface CePortfolioRowView extends CeLineView {
  projectCode: string;
  projectName: string;
}

export function cePortfolioView(rows: PortfolioCeRow[], t: T, lang: Lang, hrefOf: (code: string, ref: string) => string) {
  const day = dateFmt(lang);
  return {
    title: `${t('CE conformity · machines placed on the market from')} ${day(CE_APPLICATION_DATE)}`,
    hint: rows.length ? `${rows.length} ${t(rows.length === 1 ? 'machine line with an incomplete CE file' : 'machine lines with an incomplete CE file')}` : '',
    empty: t('Every machine line placed on the market from 20 Jan 2027 has a complete CE file'),
    rows: rows.map((r): CePortfolioRowView => ({ ...ceLineView(r.line, t, lang, hrefOf(r.projectCode, r.line.ref)), projectCode: r.projectCode, projectName: dataText(r.projectName, lang) })),
  };
}

// ── Settings › CE conformity checklists ────────────────────────────────────────────────────────────────────────────

export function ceChecklistsView(lists: CeChecklists, t: T, lang: Lang) {
  return (['ehsr', 'techfile'] as const).map((kind) => ({
    kind, title: t(CE_CHECKLIST_TITLE[kind]),
    entries: lists[kind].map((e) => ({ code: e.code, title: checklistTitle(e, t, lang), active: e.active })),
  }));
}
