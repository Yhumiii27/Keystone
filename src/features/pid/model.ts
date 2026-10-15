// View models of P&ID — tags, overlay & process validation (docs/spec/09 §6, template 2472–2534, logic 4762–4782): KPI
// tiles, the P&ID drawing card, the process validation steps, the status chips and scope segment, the tag register, the
// overlay table and the tag drawer, translated for the viewer. The derivations are src/domain/pid.ts, the data
// src/server/dal/pid.ts. Pure (no I/O): the page passes the data, the URL state, `t` and the language.
import { LO, OK } from '@/components/app/tones';
import {
  PID_SCOPE_SEG, PID_SEARCH_LIMIT, activityText, candidateTag, feedbackMissing, feedbackView, filterPidTags, kindLabel, overlayTags, partLine, pidChips, pidCoverage, pidKpis,
  pidScopeTag, pidStatusTag, pidStepView, pidTagActions, plcView, refText, scopeLabel, scopeNote, statusLabel, type PidTagLike,
} from '@/domain/pid';
import type { Lang, T } from '@/i18n/translate';
import { exportHref } from '@/lib/export-href';
import { documentStatus, partStatus, partType, type DocumentStatus, type PartStatus } from '@/server/db/codes';
import type { PidValidation } from '@/server/dal/pid';
import { dataT, linkedSubT, pidValueT, placeholderT, refineT, revT, revisionGapT, scopeSubT, sheetLabelT, sheetsSubT, stepDateT, stepLabelT, stepWhoT } from './i18n';
import { activityHref, pidHref, type PidState } from './links';

export interface KpiView {
  label: string;
  value: string;
  sub: string;
  color: string;
}

export interface StepView {
  label: string;
  /** "P. Noguès · 12 Sep". */
  whoDate: string;
  dot: string;
  color: string;
  state: string;
  tagClass: string;
}

export interface TagRowView {
  tag: string;
  /** Row click: opens the drawer, or closes it when this tag is open. */
  href: string;
  selected: boolean;
  desc: string;
  kind: string;
  scope: string;
  scopeClass: string;
  plc: { text: string; asTag: boolean; tagClass: string };
  feedback: { text: string; tone: 'warn' | 'text' | 'muted' };
  refText: string;
  partName: string;
  actText: string;
  status: string;
  statusClass: string;
}

export interface OverlayRowView {
  tag: string;
  href: string;
  desc: string;
  scope: string;
  scopeClass: string;
  refText: string;
  status: string;
  statusClass: string;
}

export interface PidScreenView {
  kpis: KpiView[];
  drawing: {
    title: string;
    documentNumber: string;
    /** "rev C" / "rév. C". */
    rev: string;
    /** Codex record of the P&ID (Codex owns the document); null when the sheet has none. */
    docHref: string | null;
    /** "Codex · rev D · Released" (tooltip of the document link — OPEN QUESTION A-9: Codex is ahead of the tag list). */
    docTitle: string | null;
    placeholder: string;
    /**
     * R-109 (A-9 = a): banner when Codex's reference revision is ahead of the tags' (`ahead`, with the revision to re-import)
     * or not comparable with it (neutral); null when there is no Codex record or nothing to report.
     */
    gap: { text: string; ahead: boolean; suggestedRevision: string } | null;
  };
  steps: StepView[];
  chips: { value: string; label: string; count: number; href: string }[];
  /** Chip value of the current filter ('all' or a status code). */
  filter: string;
  scopes: { value: string; label: string; href: string }[];
  scope: string;
  rows: TagRowView[];
  /** "No tag matches". */
  empty: string | null;
  overlay: OverlayRowView[];
  /** "Export overlay list": the overlay list PDF to agree and sign with the client (chapter 4 exports). */
  overlayExportHref: string;
}

export interface CandidateView {
  ref: string;
  name: string;
  /** The part status, or "In the BOM" for an article of the project BOM (R-108). */
  status: string;
  tagClass: string;
  /** R-108: in the project BOM (picking it links the tag); otherwise the pick asks "Link and add to the BOM" / "Link only". */
  inBom: boolean;
  /** The part's own status (Not validated / Outdated / Obsolete stay selectable — default, E-6). */
  partStatus: string;
}

/** R-108 (E-6 = a): the tag drawer's catalogue search — text, type filter, and the "refine" note beyond 20 results. */
export interface CandidateSearchView {
  /** The register's filters kept by the search URL (with the open tag). */
  keep: { status: PidState['status']; scope: PidState['scope']; q: string };
  q: string;
  type: string;
  types: { value: string; label: string }[];
  /** "First 20 results · refine the search"; null when everything is shown. */
  more: string | null;
  /** "No catalogue article matches" when the search finds nothing. */
  empty: string | null;
}

export interface PidTagDrawerView {
  tag: string;
  /** "LT-101 · Instrument". */
  head: string;
  scope: string;
  scopeClass: string;
  status: string;
  statusClass: string;
  title: string;
  record: { k: string; v: string; href?: string }[];
  /** Mapping candidates (null: client-supplied equipment — no BOM reference expected). */
  candidates: CandidateView[] | null;
  /** R-108: the catalogue search of the candidates (null with the candidates). */
  search: CandidateSearchView | null;
  isClient: boolean;
  fbWarn: boolean;
  /** "Part record": the shared part drawer over this screen (`?part=`); null when the reference is not in the catalogue. */
  partHref: string | null;
  /** "Unlink" offered (a reference is mapped). */
  canUnlink: boolean;
  /** "Add reference to project BOM" (status Not in BOM): the project BOM with the part record open. */
  bomHref: string | null;
  partRef: string | null;
  closeHref: string;
}

const kpiColor = (lo: boolean) => (lo ? LO : OK);

/** Displayed (translated) search text of a row: the FR search also matches what the viewer reads. */
function displayedText(r: PidTagLike, t: T, lang: Lang): string {
  if (lang !== 'fr') return '';
  return `${dataT(r.description, lang)} ${t(plcView(r.plcType).text)} ${feedbackView(r).tone === 'warn' ? t('Missing') : dataT(feedbackView(r).text, lang)}`;
}

/** Screen view: KPIs, drawing card, steps, chips (links), scope segment (links), filtered register, overlay table. */
export function pidScreenView(
  input: { code: string; data: PidValidation; state: PidState; docHref: string | null },
  t: T,
  lang: Lang,
): PidScreenView {
  const { code, data, state } = input;
  const tags = data.tags;
  const c = pidCoverage(tags);
  const subs: Record<string, string> = {
    pid: sheetsSubT(data.sheet.sheetCount, data.sheet.statusLabel, data.sheet.issuedOn, t, lang),
    scope: scopeSubT(c.overlay, c.client, lang),
    linked: linkedSubT(c.linked, c.inScope),
    unmapped: t('Blocks release for construction'),
    issues: t('Not in BOM · outdated · not validated'),
  };
  const kpis = pidKpis(data.sheet, c).map((k) => ({
    label: t(k.label),
    value: k.key === 'pid' ? pidValueT(data.sheet.documentNumber, data.sheet.revision, lang) : String(k.value),
    sub: subs[k.key],
    color: kpiColor(k.lo),
  }));

  const codex = data.sheet.codexRevision && data.sheet.codexStatus
    ? `Codex · ${revT(data.sheet.codexRevision, lang)} · ${t(documentStatus.isCode(data.sheet.codexStatus) ? documentStatus.label(data.sheet.codexStatus as DocumentStatus) : data.sheet.codexStatus)}`
    : null;

  const shown = filterPidTags(tags, { status: state.status, scope: state.scope, q: state.q }, (r) => displayedText(r, t, lang));
  const keep = { status: state.status, scope: state.scope, q: state.q };
  const rows = shown.map((r): TagRowView => {
    const selected = state.tag === r.tag;
    const plc = plcView(r.plcType);
    const fb = feedbackView(r);
    return {
      tag: r.tag,
      href: pidHref(code, { ...keep, tag: selected ? null : r.tag }),
      selected,
      desc: dataT(r.description, lang),
      kind: t(kindLabel(r.kind)),
      scope: t(scopeLabel(r.scope)),
      scopeClass: pidScopeTag(r.scope),
      plc: { text: t(plc.text), asTag: plc.asTag, tagClass: plc.tagClass },
      feedback: { text: fb.tone === 'text' ? dataT(fb.text, lang) : t(fb.text), tone: fb.tone },
      refText: refText(r),
      partName: dataT(partLine(r), lang),
      actText: activityText(r.activityCode, r.activityName ? dataT(r.activityName, lang) : null),
      status: t(statusLabel(r.status)),
      statusClass: pidStatusTag(r.status),
    };
  });

  return {
    kpis,
    drawing: {
      title: t('P&ID drawing'),
      documentNumber: data.sheet.documentNumber,
      rev: revT(data.sheet.revision, lang),
      docHref: input.docHref,
      docTitle: codex,
      placeholder: placeholderT(data.sheet.sheetCount, t, lang),
      gap: data.sheet.gap && data.sheet.codexRevision && data.sheet.codexStatus
        ? {
            text: revisionGapT(
              data.sheet.gap, data.sheet.revision, data.sheet.codexRevision,
              t(documentStatus.isCode(data.sheet.codexStatus) ? documentStatus.label(data.sheet.codexStatus as DocumentStatus) : data.sheet.codexStatus), lang,
            ),
            ahead: data.sheet.gap.ahead,
            suggestedRevision: data.sheet.gap.referenceRevision,
          }
        : null,
    },
    steps: data.steps.map((s) => {
      const v = pidStepView(s.state);
      return { label: stepLabelT(s.label, t, lang), whoDate: `${stepWhoT(s.who, lang)} · ${stepDateT(s.dateOn, t)}`, dot: v.dot, color: v.color, state: t(v.label), tagClass: v.tagClass };
    }),
    chips: pidChips(tags).map((ch) => ({ value: ch.value ?? 'all', label: t(ch.label), count: ch.count, href: pidHref(code, { ...keep, status: ch.value, tag: state.tag }) })),
    filter: state.status ?? 'all',
    scopes: PID_SCOPE_SEG.map((o) => ({ value: o.value ?? 'all', label: t(o.label), href: pidHref(code, { ...keep, scope: o.value, tag: state.tag }) })),
    scope: state.scope ?? 'all',
    rows,
    empty: rows.length ? null : t('No tag matches'),
    overlayExportHref: exportHref('pid', { format: 'pdf', code, variant: 'overlay' }),
    overlay: overlayTags(tags).map((r) => ({
      tag: r.tag,
      href: pidHref(code, { ...keep, tag: r.tag }),
      desc: dataT(r.description, lang),
      scope: t(scopeLabel(r.scope)),
      scopeClass: pidScopeTag(r.scope),
      refText: refText(r),
      status: t(statusLabel(r.status)),
      statusClass: pidStatusTag(r.status),
    })),
  };
}

/** Tag drawer view (`pidTagVals` 4781). `bomHrefOf` builds the project BOM link with the part open. */
export function pidTagDrawerView(
  input: {
    code: string;
    data: PidValidation;
    tag: PidValidation['tags'][number];
    candidates: { ref: string; name: string; status: PartStatus; inBom?: boolean }[];
    state: PidState;
    bomHrefOf: (ref: string) => string;
    /** R-108: more than the 20 candidates shown (refine the search). */
    more?: boolean;
  },
  t: T,
  lang: Lang,
): PidTagDrawerView {
  const { code, tag: r, state } = input;
  const a = pidTagActions(r);
  const plc = plcView(r.plcType);
  const fb = feedbackView(r);
  const keep = { status: state.status, scope: state.scope, q: state.q };
  const inBom = r.partRef && r.status !== 'not_in_bom' && r.status !== 'unknown_ref';
  return {
    tag: r.tag,
    head: `${r.tag} · ${t(kindLabel(r.kind))}`,
    scope: t(scopeLabel(r.scope)),
    scopeClass: pidScopeTag(r.scope),
    status: t(statusLabel(r.status)),
    statusClass: pidStatusTag(r.status),
    title: dataT(r.description, lang),
    record: [
      // The BOM reference opens the project BOM line (the part record over the BOM).
      { k: t('Reference'), v: refText(r), href: inBom ? input.bomHrefOf(r.partRef!) : undefined },
      { k: t('Part'), v: dataT(partLine(r), lang) || '—' },
      { k: t('Activity'), v: activityText(r.activityCode, r.activityName ? dataT(r.activityName, lang) : null), href: r.activityName ? activityHref(code, r.activityCode) : undefined },
      { k: t('PLC'), v: t(plc.text) },
      { k: t('State feedback'), v: fb.tone === 'text' ? dataT(fb.text, lang) : t(fb.text) },
      { k: t('Sheet'), v: sheetLabelT(input.data.sheet.documentNumber, r.sheet, lang) },
      { k: t('Scope'), v: t(scopeNote(r.scope)) },
    ],
    candidates: a.canMap
      ? input.candidates.map((x) => ({
          ref: x.ref, name: dataT(x.name, lang), status: x.inBom ? t('In the BOM') : t(partStatus.label(x.status)), tagClass: x.inBom ? 'tag tag-neutral' : candidateTag(x.status),
          inBom: !!x.inBom, partStatus: t(partStatus.label(x.status)),
        }))
      : null,
    search: a.canMap
      ? {
          keep,
          q: state.cq ?? '',
          type: state.ctype ?? 'compatible',
          types: [
            { value: 'compatible', label: t('Compatible types') },
            { value: 'all', label: t('All types') },
            ...partType.codes.map((c) => ({ value: c, label: t(partType.label(c)) })),
          ],
          more: input.more ? refineT(PID_SEARCH_LIMIT, lang) : null,
          empty: input.candidates.length ? null : t('No catalogue article matches'),
        }
      : null,
    isClient: a.isClient,
    fbWarn: feedbackMissing(r),
    // The part drawer replaces the tag drawer; closing it comes back to this tag.
    partHref: a.hasPart && r.partRef ? pidHref(code, { ...keep, tag: r.tag, part: r.partRef }) : null,
    canUnlink: a.canUnlink,
    bomHref: a.notInBom && r.partRef ? input.bomHrefOf(r.partRef) : null,
    partRef: r.partRef,
    closeHref: pidHref(code, keep),
  };
}
